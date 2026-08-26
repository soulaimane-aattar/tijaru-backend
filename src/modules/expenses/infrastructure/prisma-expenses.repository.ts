import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  ExpensesRepository,
  type CreateExpenseData,
  type ExpenseDuplicate,
  type ExpenseRef,
  type ExpenseSummary,
  type UpdateExpenseData,
} from '../domain/expenses.repository';
import type { ListExpensesQuery } from '../dto/expense.dto';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const LIST_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PrismaExpensesRepository extends ExpensesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private where(query: ListExpensesQuery): Prisma.ExpenseWhereInput {
    const where: Prisma.ExpenseWhereInput = {};
    if (query.from || query.to) {
      where.date = compact({ gte: query.from, lte: query.to });
    }
    if (query.category) where.category = query.category;
    return where;
  }

  findAll(query: ListExpensesQuery): Promise<unknown[]> {
    return this.prisma.expense.findMany({
      where: this.where(query),
      orderBy: { date: 'desc' },
      take: 500,
      include: LIST_INCLUDE,
    });
  }

  findDetail(id: string): Promise<unknown | null> {
    return this.prisma.expense.findUnique({ where: { id }, include: LIST_INCLUDE });
  }

  findById(id: string): Promise<ExpenseRef | null> {
    return this.prisma.expense.findUnique({
      where: { id },
      // businessId must stay selected: the tenant middleware post-filters
      // findUnique results on it (see tenant.middleware.ts).
      select: { id: true, receiptPath: true, businessId: true },
    });
  }

  findByReceiptHash(hash: string): Promise<ExpenseDuplicate | null> {
    return this.prisma.expense.findFirst({
      where: { receiptHash: hash },
      orderBy: { createdAt: 'desc' },
      select: { id: true, date: true, amount: true, merchantName: true },
    });
  }

  async summary(query: ListExpensesQuery): Promise<ExpenseSummary> {
    const grouped = await this.prisma.expense.groupBy({
      by: ['category'],
      where: this.where(query),
      _sum: { amount: true },
    });
    const byCategory = grouped.map((row) => ({
      category: row.category as string,
      total: Number(row._sum.amount ?? 0),
    }));
    return {
      total: byCategory.reduce((sum, row) => sum + row.total, 0),
      byCategory,
    };
  }

  create(data: CreateExpenseData): Promise<unknown> {
    return this.prisma.expense.create({
      data: scoped<Prisma.ExpenseUncheckedCreateInput>(
        compact(data) as Omit<Prisma.ExpenseUncheckedCreateInput, 'businessId'>,
      ),
    });
  }

  async update(id: string, data: UpdateExpenseData): Promise<number> {
    const r = await this.prisma.expense.updateMany({ where: { id }, data: compact(data) });
    return r.count;
  }

  async delete(id: string): Promise<number> {
    const r = await this.prisma.expense.deleteMany({ where: { id } });
    return r.count;
  }
}
