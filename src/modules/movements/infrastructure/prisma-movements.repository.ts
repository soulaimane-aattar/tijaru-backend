import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  MovementsRepository,
  type ActivityLog,
  type MovementSearchCriteria,
  type ProductRef,
} from '../domain/movements.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaMovementsRepository extends MovementsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findPage(
    criteria: MovementSearchCriteria,
  ): Promise<{ items: unknown[]; total: number }> {
    const where: Prisma.MovementWhereInput = {};
    if (criteria.type) where.type = criteria.type;
    if (criteria.productId) where.productId = criteria.productId;
    if (criteria.warehouseId) {
      where.OR = [{ warehouseId: criteria.warehouseId }, { toWarehouseId: criteria.warehouseId }];
    }
    if (criteria.userId) where.userId = criteria.userId;
    if (criteria.from || criteria.to) {
      where.date = compact({ gte: criteria.from, lte: criteria.to });
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.movement.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, tone: true } },
          warehouse: { select: { id: true, name: true, city: true } },
          toWarehouse: { select: { id: true, name: true, city: true } },
          user: { select: { id: true, name: true, role: true } },
        },
        orderBy: { date: 'desc' },
        skip: criteria.skip,
        take: criteria.take,
      }),
      this.prisma.movement.count({ where }),
    ]);
    return { items, total };
  }

  findProductRef(id: string): Promise<ProductRef | null> {
    return this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  async warehouseExists(id: string): Promise<boolean> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return warehouse !== null;
  }

  async logActivity(activity: ActivityLog): Promise<void> {
    await this.prisma.activity.create({
      data: scoped<Prisma.ActivityUncheckedCreateInput>(compact({ ...activity })),
    });
  }
}
