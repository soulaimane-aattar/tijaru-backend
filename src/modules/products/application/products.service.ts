import { Injectable } from '@nestjs/common';
import type { MovementReason } from '@prisma/client';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import {
  ProductsRepository,
  type ProductStockView,
} from '../domain/products.repository';
import type { AdjustProductInput } from '../dto/adjust.dto';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from '../dto/product.dto';

/**
 * Maps the user-facing adjustment reason to the closest Prisma `MovementReason`.
 * The DB enum (achat|vente|transfert|peremption|ajustement|casse) is narrower
 * than what users pick from — the original reason is preserved in the
 * movement `ref` for audit clarity.
 */
const ADJUST_REASON_MAP: Record<AdjustProductInput['reason'], MovementReason> = {
  ecart: 'ajustement',
  casse: 'casse',
  perime: 'peremption',
  vol: 'casse',
  retour: 'ajustement',
};

type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

const DAY_MS = 86_400_000;

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly ledger: StockLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  async list(query: ListProductsQuery): Promise<Paginated<unknown>> {
    const { items: allMatching, total } = await this.products.findAllMatching({
      search: query.search,
      categoryId: query.categoryId,
      supplierId: query.supplierId,
      expiringBefore: query.expiringDays
        ? new Date(Date.now() + query.expiringDays * DAY_MS)
        : undefined,
      sort: query.sort,
      order: query.order,
    });

    // Low/out-of-stock depend on the sum across warehouses → business rule, applied here.
    const stockOf = (p: ProductStockView) => {
      const sum = p.stockLevels.reduce((s, l) => s + l.qty, 0);
      return { low: sum <= p.minStock && sum > 0, out: sum === 0 };
    };

    let filtered = allMatching;
    if (query.lowStock) filtered = filtered.filter((p) => stockOf(p).low);
    if (query.outOfStock) filtered = filtered.filter((p) => stockOf(p).out);
    if (query.warehouseId) {
      filtered = filtered.filter((p) =>
        p.stockLevels.some((l) => l.warehouseId === query.warehouseId && l.qty > 0),
      );
    }

    const start = (query.page - 1) * query.pageSize;
    const items = filtered.slice(start, start + query.pageSize);
    const effectiveTotal =
      query.lowStock || query.outOfStock || query.warehouseId ? filtered.length : total;

    return { items, page: query.page, pageSize: query.pageSize, total: effectiveTotal };
  }

  async get(id: string): Promise<unknown> {
    const product = await this.products.findDetail(id);
    if (!product) throw new NotFoundError('Product', id);
    return product;
  }

  async create(input: CreateProductInput): Promise<unknown> {
    if (await this.products.hasBarcodeOrSkuConflict(input.barcode, input.sku)) {
      throw new ConflictError('Barcode or SKU already in use');
    }
    return this.products.create(input);
  }

  async update(id: string, input: UpdateProductInput): Promise<unknown> {
    const existing = await this.products.findIdentity(id);
    if (!existing) throw new NotFoundError('Product', id);

    if (
      (input.barcode || input.sku) &&
      (await this.products.hasBarcodeOrSkuConflict(input.barcode, input.sku, id))
    ) {
      throw new ConflictError('Barcode or SKU already in use');
    }

    return this.products.update(id, input);
  }

  /**
   * Manual stock adjustment for one product at one warehouse. Posts a single
   * ledger line (positive delta → `in`, negative → `out`) so `StockLevel`
   * stays the single source of truth — this is the only sanctioned way to
   * correct stock outside of movements/POS/PO/inventory flows (fix B2).
   */
  async adjust(user: AuthUser, productId: string, input: AdjustProductInput): Promise<unknown> {
    const existing = await this.products.findIdentity(productId);
    if (!existing) throw new NotFoundError('Product', productId);

    if (!(await this.products.warehouseExists(input.warehouseId))) {
      throw new NotFoundError('Warehouse', input.warehouseId);
    }

    if (input.delta === 0) throw new ValidationError('adjust_delta_zero');

    const movements = await this.prisma.$transaction(async (tx) => {
      const posted = await this.ledger.post(
        {
          businessId: user.businessId,
          userId: user.id,
          type: input.delta > 0 ? 'in' : 'out',
          reason: ADJUST_REASON_MAP[input.reason],
          ref: input.note ? `${input.reason}: ${input.note}` : input.reason,
          lines: [{ productId, warehouseId: input.warehouseId, delta: input.delta }],
        },
        tx,
      );

      await this.products.logActivity(
        {
          userId: user.id,
          action: 'stock.adjust',
          desc: `Ajustement ${input.delta > 0 ? '+' : ''}${input.delta} × ${existing.name} (${input.reason})`,
          ...(user.device !== undefined ? { device: user.device } : {}),
        },
        tx,
      );

      return posted;
    });

    return movements[0];
  }

  async remove(id: string): Promise<void> {
    const existing = await this.products.findIdentity(id);
    if (!existing) throw new NotFoundError('Product', id);
    await this.products.softDelete(id);
  }

  async duplicate(id: string): Promise<unknown> {
    const src = await this.products.findIdentity(id);
    if (!src) throw new NotFoundError('Product', id);
    const sku = `${src.sku}-COPY-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    // Same barcode would conflict; suffix it. User must update it before real use.
    const barcode = src.barcode.slice(0, 12) + '0';
    return this.products.duplicateFrom(id, { name: `${src.name} (copie)`, sku, barcode });
  }
}
