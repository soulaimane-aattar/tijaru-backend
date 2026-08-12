import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { TenantContext } from '../../../common/tenant/tenant-context';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  WarehousesRepository,
  type CreateWarehouseData,
  type UpdateWarehouseData,
} from '../domain/warehouses.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaWarehousesRepository extends WarehousesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {
    super();
  }

  findAll(): Promise<unknown> {
    return this.prisma.warehouse.findMany({
      where: { deletedAt: null },
      include: {
        manager: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  findDetail(id: string): Promise<unknown | null> {
    return this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
      include: {
        manager: { select: { id: true, name: true, role: true } },
        users: { select: { userId: true } },
      },
    });
  }

  countActive(): Promise<number> {
    return this.prisma.warehouse.count({ where: { deletedAt: null } });
  }

  countNonZeroStock(id: string): Promise<number> {
    return this.prisma.stockLevel.count({ where: { warehouseId: id, qty: { gt: 0 } } });
  }

  async exists(id: string): Promise<boolean> {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return wh !== null;
  }

  create(data: CreateWarehouseData): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        const businessId = this.tenant.getBusinessId();
        await tx.warehouse.updateMany({
          where: { isDefault: true, ...(businessId !== undefined ? { businessId } : {}) },
          data: { isDefault: false },
        });
      }
      return tx.warehouse.create({
        data: scoped<Prisma.WarehouseUncheckedCreateInput>(compact(data)),
      });
    });
  }

  update(id: string, data: UpdateWarehouseData): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        const businessId = this.tenant.getBusinessId();
        await tx.warehouse.updateMany({
          where: { isDefault: true, NOT: { id }, ...(businessId !== undefined ? { businessId } : {}) },
          data: { isDefault: false },
        });
      }
      return tx.warehouse.update({ where: { id }, data: compact(data) });
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.warehouse.update({
      where: { id },
      data: { deletedAt: new Date(), active: false, isDefault: false },
    });
  }
}
