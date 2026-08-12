import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  InventoryRepository,
  type ActivityLog,
  type CountLineInput,
  type InventoryCountView,
  type StockSnapshotLine,
} from '../domain/inventory.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaInventoryRepository extends InventoryRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findAll(): Promise<unknown[]> {
    return this.prisma.inventoryCount.findMany({
      include: {
        warehouse: { select: { id: true, name: true, city: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  findDetail(id: string): Promise<unknown | null> {
    return this.prisma.inventoryCount.findUnique({
      where: { id },
      include: {
        warehouse: true,
        lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  }

  async warehouseExists(id: string): Promise<boolean> {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return wh !== null;
  }

  findActiveStockLevels(warehouseId: string): Promise<StockSnapshotLine[]> {
    return this.prisma.stockLevel.findMany({
      where: { warehouseId, product: { deletedAt: null } },
      select: { productId: true, qty: true },
    });
  }

  createCount(
    warehouseId: string,
    lines: CountLineInput[],
    notes?: string | undefined,
  ): Promise<unknown> {
    return this.prisma.inventoryCount.create({
      data: scoped<Prisma.InventoryCountUncheckedCreateInput>({
        warehouseId,
        ...(notes ? { notes } : {}),
        lines: { create: lines },
      }),
      include: {
        lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  }

  findWithLines(id: string): Promise<InventoryCountView | null> {
    return this.prisma.inventoryCount.findUnique({
      where: { id },
      select: {
        id: true,
        warehouseId: true,
        appliedAt: true,
        lines: { select: { id: true, productId: true, expected: true, counted: true } },
      },
    });
  }

  findLiveStockLevels(
    warehouseId: string,
    productIds: string[],
    tx: Prisma.TransactionClient,
  ): Promise<StockSnapshotLine[]> {
    return tx.stockLevel.findMany({
      where: { warehouseId, productId: { in: productIds } },
      select: { productId: true, qty: true },
    });
  }

  async updateLineCounted(
    lineId: string,
    counted: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.inventoryCountLine.update({ where: { id: lineId }, data: { counted } });
  }

  async markApplied(countId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.inventoryCount.update({ where: { id: countId }, data: { appliedAt: new Date() } });
  }

  async logActivity(activity: ActivityLog, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).activity.create({
      data: scoped<Prisma.ActivityUncheckedCreateInput>(compact({ ...activity })),
    });
  }
}
