import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  CategoriesRepository,
  type CreateCategoryData,
  type UpdateCategoryData,
} from '../domain/categories.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaCategoriesRepository extends CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findAll(): Promise<unknown[]> {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async existsByName(name: string): Promise<boolean> {
    const dup = await this.prisma.category.findFirst({ where: { name }, select: { id: true } });
    return dup !== null;
  }

  async existsById(id: string): Promise<boolean> {
    const found = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    return found !== null;
  }

  async isInUse(id: string): Promise<boolean> {
    const inUse = await this.prisma.product.findFirst({
      where: { categoryId: id, deletedAt: null },
      select: { id: true },
    });
    return inUse !== null;
  }

  create(data: CreateCategoryData): Promise<unknown> {
    return this.prisma.category.create({
      data: scoped<Prisma.CategoryUncheckedCreateInput>(data),
    });
  }

  update(id: string, data: UpdateCategoryData): Promise<unknown> {
    return this.prisma.category.update({ where: { id }, data: compact(data) });
  }

  async delete(id: string): Promise<number> {
    const r = await this.prisma.category.deleteMany({ where: { id } });
    return r.count;
  }
}
