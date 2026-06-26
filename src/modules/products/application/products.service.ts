import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
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

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListProductsQuery): Promise<Paginated<unknown>> {
    const where: Prisma.ProductWhereInput = { deletedAt: null };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.supplierId) where.supplierId = query.supplierId;

    if (query.expiringDays) {
      const horizon = new Date(Date.now() + query.expiringDays * 86_400_000);
      where.trackExpiry = true;
      where.expiry = { lte: horizon, gte: new Date() };
    }

    // lowStock / outOfStock are applied after fetching (depend on sum across warehouses).
    const orderBy: Prisma.ProductOrderByWithRelationInput = { [query.sort]: query.order };

    const [allMatching, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          stockLevels: true,
          category: { select: { id: true, name: true, tone: true, icon: true } },
          supplier: { select: { id: true, name: true } },
        },
        orderBy,
      }),
      this.prisma.product.count({ where }),
    ]);

    const isLowOrOut = (p: { stockLevels: { qty: number }[]; minStock: number }) => {
      const total = p.stockLevels.reduce((s, l) => s + l.qty, 0);
      return { total, low: total <= p.minStock && total > 0, out: total === 0 };
    };

    let filtered = allMatching;
    if (query.lowStock) filtered = filtered.filter((p) => isLowOrOut(p).low);
    if (query.outOfStock) filtered = filtered.filter((p) => isLowOrOut(p).out);
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
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        stockLevels: { include: { warehouse: { select: { id: true, name: true, city: true } } } },
        category: true,
        supplier: true,
      },
    });
    if (!product) throw new NotFoundError('Product', id);
    return product;
  }

  async create(input: CreateProductInput): Promise<unknown> {
    const dup = await this.prisma.product.findFirst({
      where: {
        deletedAt: null,
        OR: [{ barcode: input.barcode }, { sku: input.sku }],
      },
    });
    if (dup) throw new ConflictError('Barcode or SKU already in use');

    return this.prisma.product.create({
      data: {
        name: input.name,
        barcode: input.barcode,
        sku: input.sku,
        categoryId: input.categoryId,
        purchase: input.purchase,
        sale: input.sale,
        vat: input.vat,
        unit: input.unit,
        ...(input.supplierId ? { supplierId: input.supplierId } : {}),
        trackExpiry: input.trackExpiry,
        ...(input.expiry ? { expiry: input.expiry } : {}),
        ...(input.batch ? { batch: input.batch } : {}),
        minStock: input.minStock,
        maxStock: input.maxStock,
        ...(input.notes ? { notes: input.notes } : {}),
        tone: input.tone,
        stockLevels: {
          create: input.stock.map((s) => ({ warehouseId: s.warehouseId, qty: s.qty })),
        },
      },
      include: { stockLevels: true },
    });
  }

  async update(id: string, input: UpdateProductInput): Promise<unknown> {
    const existing = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Product', id);

    if (input.barcode || input.sku) {
      const dup = await this.prisma.product.findFirst({
        where: {
          deletedAt: null,
          NOT: { id },
          OR: [
            ...(input.barcode ? [{ barcode: input.barcode }] : []),
            ...(input.sku ? [{ sku: input.sku }] : []),
          ],
        },
      });
      if (dup) throw new ConflictError('Barcode or SKU already in use');
    }

    const data: Record<string, unknown> = {};
    for (const k of [
      'name',
      'barcode',
      'sku',
      'categoryId',
      'purchase',
      'sale',
      'vat',
      'unit',
      'supplierId',
      'trackExpiry',
      'expiry',
      'batch',
      'minStock',
      'maxStock',
      'notes',
      'tone',
    ] as const) {
      const v = input[k];
      if (v !== undefined) data[k] = v;
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.stock !== undefined) {
        await tx.stockLevel.deleteMany({ where: { productId: id } });
        await tx.stockLevel.createMany({
          data: input.stock.map((s) => ({ productId: id, warehouseId: s.warehouseId, qty: s.qty })),
        });
      }
      return tx.product.update({ where: { id }, data, include: { stockLevels: true } });
    });
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Product', id);
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async duplicate(id: string): Promise<unknown> {
    const src = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { stockLevels: true },
    });
    if (!src) throw new NotFoundError('Product', id);
    const newSku = `${src.sku}-COPY-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    // duplicate keeps same barcode would conflict; suffix it. User must update before saving in real flow.
    const newBarcode = src.barcode.slice(0, 12) + '0';
    return this.prisma.product.create({
      data: {
        name: `${src.name} (copie)`,
        barcode: newBarcode,
        sku: newSku,
        categoryId: src.categoryId,
        purchase: src.purchase,
        sale: src.sale,
        vat: src.vat,
        unit: src.unit,
        supplierId: src.supplierId,
        trackExpiry: src.trackExpiry,
        expiry: src.expiry,
        batch: src.batch,
        minStock: src.minStock,
        maxStock: src.maxStock,
        notes: src.notes,
        tone: src.tone,
      },
    });
  }
}
