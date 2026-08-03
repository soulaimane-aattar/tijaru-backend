import { Injectable } from '@nestjs/common';
import type { BuiltInRole, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  UsersRepository,
  type CreateUserData,
  type UpdateUserData,
} from '../domain/users.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaUsersRepository extends UsersRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private readonly safeSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    role: true,
    active: true,
    lastLogin: true,
    createdAt: true,
    updatedAt: true,
    warehouses: { select: { warehouseId: true } },
  } as const;

  findAllSafe(): Promise<unknown> {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: this.safeSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  findDetail(id: string): Promise<unknown | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { ...this.safeSelect, overrides: true },
    });
  }

  async exists(id: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return user !== null;
  }

  async emailInUse(email: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    return user !== null;
  }

  create(data: CreateUserData): Promise<unknown> {
    const { role, warehouseIds, ...rest } = data;
    return this.prisma.user.create({
      data: scoped<Prisma.UserUncheckedCreateInput>({
        ...rest,
        role: role as BuiltInRole,
        warehouses: {
          create: warehouseIds.map((wid) => ({ warehouseId: wid })),
        },
      }),
      select: this.safeSelect,
    });
  }

  update(id: string, data: UpdateUserData, warehouseIds?: string[]): Promise<unknown> {
    const { role, ...rest } = data;
    return this.prisma.$transaction(async (tx) => {
      if (warehouseIds !== undefined) {
        await tx.userWarehouse.deleteMany({ where: { userId: id } });
        await tx.userWarehouse.createMany({
          data: warehouseIds.map((wid) => ({ userId: id, warehouseId: wid })),
        });
      }
      return tx.user.update({
        where: { id },
        data: { ...compact(rest), ...(role !== undefined ? { role: role as BuiltInRole } : {}) },
        include: { warehouses: { select: { warehouseId: true } } },
      });
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), active: false, tokenVersion: { increment: 1 } },
    });
  }
}
