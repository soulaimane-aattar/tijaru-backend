import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  InventoryRepository,
  type ApplyCountData,
  type CountLineInput,
  type InventoryCountView,
  type StockSnapshotLine,
} from '../domain/inventory.repository';

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

  applyCount(data: ApplyCountData): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      for (const adj of data.adjustments) {
        await tx.movement.create({
          data: scoped<Prisma.MovementUncheckedCreateInput>({
            type: adj.diff > 0 ? 'in' : 'out',
            productId: adj.productId,
            qty: Math.abs(adj.diff),
            warehouseId: data.warehouseId,
            userId: data.actorId,
            reason: 'ajustement',
            ref: data.movementRef,
          }),
        });
        await tx.stockLevel.upsert({
          where: {
            productId_warehouseId: {
              productId: adj.productId,
              warehouseId: data.warehouseId,
            },
          },
          create: { productId: adj.productId, warehouseId: data.warehouseId, qty: adj.counted },
          update: { qty: adj.counted },
        });
      }
      for (const correction of data.corrections) {
        await tx.inventoryCountLine.update({
          where: { id: correction.lineId },
          data: { counted: correction.counted },
        });
      }

      await tx.inventoryCount.update({
        where: { id: data.countId },
        data: { appliedAt: new Date() },
      });
      await tx.activity.create({
        data: scoped<Prisma.ActivityUncheckedCreateInput>({
          userId: data.actorId,
          action: 'inventory.applied',
          desc: data.activityDesc,
          ...(data.actorDevice ? { device: data.actorDevice } : {}),
        }),
      });

      return tx.inventoryCount.findUniqueOrThrow({
        where: { id: data.countId },
        include: {
          lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      });
    });
  }
}
