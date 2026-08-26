/**
 * Port: persistence contract for the expenses business logic.
 *
 * `businessId` never appears here — the Prisma tenant middleware injects it on
 * writes and filters it on reads for every model in `TENANT_MODELS`.
 */

import type { ListExpensesQuery } from '../dto/expense.dto';

export type CreateExpenseData = {
  date: Date;
  amount: number;
  taxAmount?: number | undefined;
  category: string;
  supplierId?: string | undefined;
  warehouseId?: string | undefined;
  merchantName?: string | undefined;
  note?: string | undefined;
  paymentMethod: string;
  receiptPath?: string | undefined;
  receiptHash?: string | undefined;
  ocrStatus?: string | undefined;
  ocrRaw?: unknown;
  createdById: string;
};

export type UpdateExpenseData = {
  [K in keyof Omit<CreateExpenseData, 'createdById'>]?: CreateExpenseData[K] | undefined;
};

/** Minimal projection the service needs for existence checks and file cleanup. */
export type ExpenseRef = { id: string; receiptPath: string | null; businessId: string };

/** Fields shown when warning the user that a scanned receipt already exists. */
export type ExpenseDuplicate = {
  id: string;
  date: Date;
  amount: unknown;
  merchantName: string | null;
};

export type ExpenseSummary = {
  total: number;
  byCategory: { category: string; total: number }[];
};

export abstract class ExpensesRepository {
  /** Most recent first, capped. */
  abstract findAll(query: ListExpensesQuery): Promise<unknown[]>;

  abstract findDetail(id: string): Promise<unknown | null>;

  abstract findById(id: string): Promise<ExpenseRef | null>;

  /** Most recent expense (in the current tenant) that stored the same receipt bytes. */
  abstract findByReceiptHash(hash: string): Promise<ExpenseDuplicate | null>;

  abstract summary(query: ListExpensesQuery): Promise<ExpenseSummary>;

  abstract create(data: CreateExpenseData): Promise<unknown>;

  /** Rows updated (0 when the expense does not exist). */
  abstract update(id: string, data: UpdateExpenseData): Promise<number>;

  /** Rows deleted (0 when the expense does not exist). */
  abstract delete(id: string): Promise<number>;
}
