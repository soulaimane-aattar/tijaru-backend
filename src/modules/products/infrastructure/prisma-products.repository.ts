import { Injectable } from '@nestjs/common';
import type { Prisma, Unit } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  ProductsRepository,
  type CreateProductData,
  type ProductIdentity,
  type ProductSearchCriteria,
  type ProductStockView,
  type StockLevelInput,
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
    return this.prisma.product.create({
      data: scoped<Prisma.ProductUncheckedCreateInput>({
        ...compact(rest),
        unit: unit as Unit,
        stockLevels: {
          create: stock.map((s) => ({ warehouseId: s.warehouseId, qty: s.qty })),
        },
      }),
      include: { stockLevels: true },
    });
  }

  update(id: string, data: UpdateProductData, stock?: StockLevelInput[]): Promise<unknown> {
    const { unit, ...rest } = data;
    return this.prisma.$transaction(async (tx) => {
      if (stock !== undefined) {
        await tx.stockLevel.deleteMany({ where: { productId: id } });
        await tx.stockLevel.createMany({
          data: stock.map((s) => ({ productId: id, warehouseId: s.warehouseId, qty: s.qty })),
        });
      }
      return tx.product.update({
        where: { id },
        data: { ...compact(rest), ...(unit !== undefined ? { unit: unit as Unit } : {}) },
        include: { stockLevels: true },
      });
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
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
