import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  ExpenseCategoriesRepository,
  type CreateExpenseCategoryData,
  type ExpenseCategoryView,
  type UpdateExpenseCategoryData,
} from '../domain/expense-categories.repository';

const compact = <T extends Record<string, unknown>>(obj: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const SELECT = {
  id: true,
  key: true,
  label: true,
  taxRate: true,
  sortOrder: true,
  archived: true,
} as const;

type Row = {
  id: string;
  key: string;
  label: string;
  taxRate: Prisma.Decimal;
  sortOrder: number;
  archived: boolean;
};

const toView = (row: Row): ExpenseCategoryView => ({
  id: row.id,
  key: row.key,
  label: row.label,
  taxRate: Number(row.taxRate),
  sortOrder: row.sortOrder,
  archived: row.archived,
});

@Injectable()
export class PrismaExpenseCategoriesRepository extends ExpenseCategoriesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findAll(includeArchived: boolean): Promise<ExpenseCategoryView[]> {
    const rows = await this.prisma.expenseCategoryDef.findMany({
      where: includeArchived ? {} : { archived: false },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      select: SELECT,
    });
    return rows.map(toView);
  }

  async findById(id: string): Promise<ExpenseCategoryView | null> {
    const row = await this.prisma.expenseCategoryDef.findFirst({ where: { id }, select: SELECT });
    return row ? toView(row) : null;
  }

  async findByKey(key: string): Promise<ExpenseCategoryView | null> {
    const row = await this.prisma.expenseCategoryDef.findFirst({ where: { key }, select: SELECT });
    return row ? toView(row) : null;
  }

  async create(data: CreateExpenseCategoryData): Promise<ExpenseCategoryView> {
    const row = await this.prisma.expenseCategoryDef.create({
      data: scoped<Prisma.ExpenseCategoryDefUncheckedCreateInput>({
        key: data.key,
        label: data.label,
        taxRate: data.taxRate,
        sortOrder: data.sortOrder,
      }),
      select: SELECT,
    });
    return toView(row);
  }

  async update(id: string, data: UpdateExpenseCategoryData): Promise<number> {
    const r = await this.prisma.expenseCategoryDef.updateMany({
      where: { id },
      data: compact(data),
    });
    return r.count;
  }

  async countUses(key: string): Promise<number> {
    return this.prisma.expense.count({ where: { category: key } });
  }

  async delete(id: string): Promise<number> {
    const r = await this.prisma.expenseCategoryDef.deleteMany({ where: { id } });
    return r.count;
  }
}
