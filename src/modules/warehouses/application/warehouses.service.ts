import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import type { CreateWarehouseInput, UpdateWarehouseInput } from '../dto/warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<unknown> {
    return this.prisma.warehouse.findMany({
      where: { deletedAt: null },
      include: {
        manager: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async get(id: string): Promise<unknown> {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
      include: {
        manager: { select: { id: true, name: true, role: true } },
        users: { select: { userId: true } },
      },
    });
    if (!wh) throw new NotFoundError('Warehouse', id);
    return wh;
  }

  async create(input: CreateWarehouseInput): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.warehouse.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.warehouse.create({
        data: {
          name: input.name,
          city: input.city,
          ...(input.address ? { address: input.address } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.managerId ? { managerId: input.managerId } : {}),
          active: input.active,
          isDefault: input.isDefault,
        },
      });
    });
  }

  async update(id: string, input: UpdateWarehouseInput): Promise<unknown> {
    const existing = await this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Warehouse', id);

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.warehouse.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      const data: Record<string, unknown> = {};
      for (const k of ['name', 'city', 'address', 'phone', 'managerId', 'active', 'isDefault'] as const) {
        const v = input[k];
        if (v !== undefined) data[k] = v;
      }
      return tx.warehouse.update({ where: { id }, data });
    });
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Warehouse', id);
    await this.prisma.warehouse.update({
      where: { id },
      data: { deletedAt: new Date(), active: false, isDefault: false },
    });
  }
}
