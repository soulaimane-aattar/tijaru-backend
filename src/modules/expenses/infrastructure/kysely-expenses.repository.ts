import { Injectable } from '@nestjs/common';
import { sql, type SelectQueryBuilder } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { DB } from '../../../database/types';
import {
  ExpensesRepository,
  type CreateExpenseData,
  type ExpenseDuplicate,
  type ExpenseRef,
  type ExpenseSummary,
  type UpdateExpenseData,
} from '../domain/expenses.repository';
import type { ListExpensesQuery } from '../dto/expense.dto';

type Q = SelectQueryBuilder<DB & { e: DB['app.expenses'] }, 'e', object>;

/** Strip keys whose value is `undefined`. */
const compact = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

/** camelCase API shape → snake_case columns (undefined values dropped). */
const toCols = (d: UpdateExpenseData & { createdById?: string }): Record<string, unknown> =>
  compact({
    date: d.date,
    amount: d.amount,
    tax_amount: d.taxAmount,
    category: d.category,
    supplier_id: d.supplierId,
    warehouse_id: d.warehouseId,
    merchant_name: d.merchantName,
    note: d.note,
    payment_method: d.paymentMethod as never,
    receipt_path: d.receiptPath,
    receipt_hash: d.receiptHash,
    ocr_status: d.ocrStatus as never,
    ocr_raw: d.ocrRaw === undefined ? undefined : (JSON.stringify(d.ocrRaw) as never),
    created_by_id: d.createdById,
  });

@Injectable()
export class KyselyExpensesRepository extends ExpensesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  /** Tenant + list filters shared by findAll and summary. */
  private filtered(query: ListExpensesQuery): Q {
    let q = this.db.q
      .selectFrom('app.expenses as e')
      .where('e.business_id', '=', this.db.businessId) as unknown as Q;
    if (query.from) q = q.where('e.date', '>=', query.from);
    if (query.to) {
      // Include the entire to-day regardless of time component on stored dates
      const endOfDay = new Date(query.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      q = q.where('e.date', '<=', endOfDay);
    }
    if (query.category) q = q.where('e.category', '=', query.category);
    if (query.createdById) q = q.where('e.created_by_id', '=', query.createdById);
    return q;
  }

  private withRelations(q: Q) {
    return q
      .select([
        'e.id',
        'e.business_id as businessId',
        'e.date',
        'e.amount',
        'e.tax_amount as taxAmount',
        'e.category',
        'e.supplier_id as supplierId',
        'e.warehouse_id as warehouseId',
        'e.merchant_name as merchantName',
        'e.note',
        'e.payment_method as paymentMethod',
        'e.receipt_path as receiptPath',
        'e.receipt_hash as receiptHash',
        'e.ocr_status as ocrStatus',
        'e.ocr_raw as ocrRaw',
        'e.created_by_id as createdById',
        'e.created_at as createdAt',
        'e.updated_at as updatedAt',
      ])
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('app.suppliers as s')
            .select(['s.id', 's.name'])
            .whereRef('s.id', '=', 'e.supplier_id'),
        ).as('supplier'),
        jsonObjectFrom(
          eb
            .selectFrom('app_auth.users as u')
            .select(['u.id', 'u.name'])
            .whereRef('u.id', '=', 'e.created_by_id'),
        ).as('createdBy'),
      ]);
  }

  findAll(query: ListExpensesQuery): Promise<unknown[]> {
    return this.withRelations(this.filtered(query)).orderBy('e.date', 'desc').limit(500).execute();
  }

  async findDetail(id: string): Promise<unknown | null> {
    const row = await this.withRelations(this.filtered({} as ListExpensesQuery))
      .where('e.id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return { ...row, photos: await this.listPhotosRaw(id) };
  }

  async findById(id: string): Promise<ExpenseRef | null> {
    const r = await this.db.q
      .selectFrom('app.expenses')
      .select(['id', 'receipt_path as receiptPath', 'business_id as businessId'])
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return r ?? null;
  }

  async findByReceiptHash(hash: string): Promise<ExpenseDuplicate | null> {
    // Called from the @SkipTenantTx() scan route, so open a short tenant txn if none is ambient.
    return this.db.scoped(async () => {
      const r = await this.db.q
        .selectFrom('app.expenses')
        .select(['id', 'date', 'amount', 'merchant_name as merchantName'])
        .where('business_id', '=', this.db.businessId)
        .where('receipt_hash', '=', hash)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      return r ?? null;
    });
  }

  async summary(query: ListExpensesQuery): Promise<ExpenseSummary> {
    const rows = await this.filtered(query)
      .select(['e.category', sql<string>`sum(e.amount)`.as('total')])
      .groupBy('e.category')
      .execute();
    const byCategory = rows.map((r) => ({ category: r.category, total: Number(r.total ?? 0) }));
    return { total: byCategory.reduce((s, r) => s + r.total, 0), byCategory };
  }

  async create(data: CreateExpenseData): Promise<unknown> {
    const r = await this.db.q
      .insertInto('app.expenses')
      .values({
        ...toCols(data),
        id: newId(),
        business_id: this.db.businessId,
        updated_at: new Date(),
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    return this.findRaw(r.id);
  }

  /** Bare expense row (no relations), camelCase — what Prisma's `create` returned. */
  private findRaw(id: string) {
    return this.db.q
      .selectFrom('app.expenses as e')
      .where('e.business_id', '=', this.db.businessId)
      .where('e.id', '=', id)
      .select([
        'e.id',
        'e.business_id as businessId',
        'e.date',
        'e.amount',
        'e.tax_amount as taxAmount',
        'e.category',
        'e.supplier_id as supplierId',
        'e.warehouse_id as warehouseId',
        'e.merchant_name as merchantName',
        'e.note',
        'e.payment_method as paymentMethod',
        'e.receipt_path as receiptPath',
        'e.receipt_hash as receiptHash',
        'e.ocr_status as ocrStatus',
        'e.ocr_raw as ocrRaw',
        'e.created_by_id as createdById',
        'e.created_at as createdAt',
        'e.updated_at as updatedAt',
      ])
      .executeTakeFirstOrThrow();
  }

  async update(id: string, data: UpdateExpenseData): Promise<number> {
    const r = await this.db.q
      .updateTable('app.expenses')
      .set({ ...toCols(data), updated_at: new Date() } as never)
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  async delete(id: string): Promise<number> {
    const r = await this.db.q
      .deleteFrom('app.expenses')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numDeletedRows);
  }

  // ── Expense photos ──

  async addPhoto(expenseId: string, path: string): Promise<{ id: string }> {
    return this.db.q
      .insertInto('app.expense_photos')
      .values({
        id: newId(),
        business_id: this.db.businessId,
        expense_id: expenseId,
        path,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  private listPhotosRaw(expenseId: string) {
    return this.db.q
      .selectFrom('app.expense_photos')
      .select(['id', 'path', 'created_at as createdAt'])
      .where('business_id', '=', this.db.businessId)
      .where('expense_id', '=', expenseId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  listPhotos(expenseId: string): Promise<{ id: string; path: string; createdAt: Date }[]> {
    return this.listPhotosRaw(expenseId);
  }

  async findPhoto(photoId: string): Promise<{ id: string; path: string; expenseId: string } | null> {
    const r = await this.db.q
      .selectFrom('app.expense_photos')
      .select(['id', 'path', 'expense_id as expenseId'])
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', photoId)
      .executeTakeFirst();
    return r ?? null;
  }

  async deletePhoto(photoId: string): Promise<number> {
    const r = await this.db.q
      .deleteFrom('app.expense_photos')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', photoId)
      .executeTakeFirst();
    return Number(r.numDeletedRows);
  }
}
