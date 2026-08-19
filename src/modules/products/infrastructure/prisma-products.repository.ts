import { Injectable } from '@nestjs/common';
import type { Prisma, Unit } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  ProductsRepository,
  type ActivityLog,
  type CreateProductData,
  type ProductIdentity,
  type ProductSearchCriteria,
  type ProductStockView,
  type UpdateProductData,
} from '../domain/products.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaProductsRepository extends ProductsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findAllMatching(
    criteria: ProductSearchCriteria,
  ): Promise<{ items: (ProductStockView & ProductIdentity)[]; total: number }> {
    const where: Prisma.ProductWhereInput = { deletedAt: null };

    if (criteria.search) {
      where.OR = [
        { name: { contains: criteria.search, mode: 'insensitive' } },
        { sku: { contains: criteria.search, mode: 'insensitive' } },
        { barcode: { contains: criteria.search } },
      ];
    }
    if (criteria.categoryId) where.categoryId = criteria.categoryId;
    if (criteria.supplierId) where.supplierId = criteria.supplierId;
    if (criteria.expiringBefore) {
      where.trackExpiry = true;
      where.expiry = { lte: criteria.expiringBefore, gte: new Date() };
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput = { [criteria.sort]: criteria.order };

    const [items, total] = await this.prisma.$transaction([
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

    return { items, total };
  }

  findDetail(id: string): Promise<unknown | null> {
    return this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        stockLevels: { include: { warehouse: { select: { id: true, name: true, city: true } } } },
        category: true,
        supplier: true,
      },
    });
  }

  findByBarcode(code: string): Promise<unknown | null> {
    return this.prisma.product.findFirst({
      where: { barcode: code, deletedAt: null },
      include: {
        stockLevels: { include: { warehouse: { select: { id: true, name: true, city: true } } } },
        category: true,
        supplier: true,
      },
    });
  }

  findIdentity(id: string): Promise<ProductIdentity | null> {
    return this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, sku: true, barcode: true },
    });
  }

  async hasBarcodeOrSkuConflict(
    barcode: string | undefined,
    sku: string | undefined,
    excludeId?: string,
  ): Promise<boolean> {
    if (!barcode && !sku) return false;
    const dup = await this.prisma.product.findFirst({
      where: {
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
        OR: [...(barcode ? [{ barcode }] : []), ...(sku ? [{ sku }] : [])],
      },
      select: { id: true },
    });
    return dup !== null;
  }

  create(data: CreateProductData): Promise<unknown> {
    const { stock, unit, ...rest } = data;
    // Nested `stockLevels.create` bypasses the tenant middleware (it only
    // stamps `businessId` on the model at the top of `params`, i.e. Product
    // here) — write each StockLevel as its own `create` inside a transaction
    // so the middleware scopes it too.
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: scoped<Prisma.ProductUncheckedCreateInput>({
          ...compact(rest),
          unit: unit as Unit,
        }),
      });
      if (stock.length > 0) {
        await tx.stockLevel.createMany({
          data: stock.map((s) =>
            scoped<Prisma.StockLevelUncheckedCreateInput>({
              productId: product.id,
              warehouseId: s.warehouseId,
              qty: s.qty,
            }),
          ),
        });
      }
      return tx.product.findFirstOrThrow({
        where: { id: product.id },
        include: { stockLevels: true },
      });
    });
  }

  update(id: string, data: UpdateProductData): Promise<unknown> {
    const { unit, ...rest } = data;
    return this.prisma.product.update({
      where: { id },
      data: { ...compact(rest), ...(unit !== undefined ? { unit: unit as Unit } : {}) },
      include: { stockLevels: true },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async warehouseExists(id: string): Promise<boolean> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return warehouse !== null;
  }

  async logActivity(activity: ActivityLog, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).activity.create({
      data: scoped<Prisma.ActivityUncheckedCreateInput>(compact({ ...activity })),
    });
  }

  async findImagePath(id: string): Promise<string | null> {
    const row = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { imagePath: true },
    });
    return row?.imagePath ?? null;
  }

  async setImagePath(id: string, path: string): Promise<string | null> {
    const prev = await this.findImagePath(id);
    await this.prisma.product.update({ where: { id }, data: { imagePath: path } });
    return prev;
  }

  async clearImagePath(id: string): Promise<string | null> {
    const prev = await this.findImagePath(id);
    if (!prev) return null;
    await this.prisma.product.update({ where: { id }, data: { imagePath: null } });
    return prev;
  }

  async duplicateFrom(
    sourceId: string,
    identity: { name: string; sku: string; barcode: string },
  ): Promise<unknown> {
    const src = await this.prisma.product.findFirstOrThrow({ where: { id: sourceId } });
    return this.prisma.product.create({
      data: scoped<Prisma.ProductUncheckedCreateInput>({
        name: identity.name,
        barcode: identity.barcode,
        sku: identity.sku,
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
      }),
    });
  }
}
