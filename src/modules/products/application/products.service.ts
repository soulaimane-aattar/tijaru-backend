import { Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../common/errors';
import {
  ProductsRepository,
  type ProductStockView,
} from '../domain/products.repository';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from '../dto/product.dto';

type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

const DAY_MS = 86_400_000;

@Injectable()
export class ProductsService {
  constructor(private readonly products: ProductsRepository) {}

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

    const { stock, ...fields } = input;
    return this.products.update(id, fields, stock);
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
