import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import {
  ExpenseCategoriesRepository,
  type CreateExpenseCategoryData,
  type ExpenseCategoryView,
  type UpdateExpenseCategoryData,
} from '../domain/expense-categories.repository';

const COLS = ['id', 'key', 'label', 'tax_rate', 'sort_order', 'archived'] as const;

type Row = { id: string; key: string; label: string; tax_rate: string; sort_order: number; archived: boolean };

const toView = (r: Row): ExpenseCategoryView => ({
  id: r.id,
  key: r.key,
  label: r.label,
  taxRate: Number(r.tax_rate),
  sortOrder: r.sort_order,
  archived: r.archived,
});

@Injectable()
export class KyselyExpenseCategoriesRepository extends ExpenseCategoriesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findAll(includeArchived: boolean): Promise<ExpenseCategoryView[]> {
    let q = this.db.q.selectFrom('app.expense_category_defs').select(COLS).where('business_id', '=', this.db.businessId);
    if (!includeArchived) q = q.where('archived', '=', false);
    return (await q.orderBy('sort_order').orderBy('key').execute()).map(toView);
  }

  async findById(id: string): Promise<ExpenseCategoryView | null> {
    return this.findOneBy('id', id);
  }

  async findByKey(key: string): Promise<ExpenseCategoryView | null> {
    return this.findOneBy('key', key);
  }

  private async findOneBy(col: 'id' | 'key', val: string): Promise<ExpenseCategoryView | null> {
    const row = await this.db.q
      .selectFrom('app.expense_category_defs')
      .select(COLS)
      .where('business_id', '=', this.db.businessId)
      .where(col, '=', val)
      .executeTakeFirst();
    return row ? toView(row) : null;
  }

  async create(data: CreateExpenseCategoryData): Promise<ExpenseCategoryView> {
    const row = await this.db.q
      .insertInto('app.expense_category_defs')
      .values({
        id: newId(), // ponytail: Prisma used cuid(); uuid is fine for a text id
        business_id: this.db.businessId,
        key: data.key,
        label: data.label,
        tax_rate: data.taxRate,
        sort_order: data.sortOrder,
        updated_at: new Date(),
      })
      .returning(COLS)
      .executeTakeFirstOrThrow();
    return toView(row);
  }

  async update(id: string, data: UpdateExpenseCategoryData): Promise<number> {
    const set = Object.fromEntries(
      Object.entries({
        label: data.label,
        tax_rate: data.taxRate,
        sort_order: data.sortOrder,
        archived: data.archived,
      }).filter(([, v]) => v !== undefined),
    );
    const r = await this.db.q
      .updateTable('app.expense_category_defs')
      .set({ ...set, updated_at: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  async countUses(key: string): Promise<number> {
    const r = await this.db.q
      .selectFrom('app.expenses')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('business_id', '=', this.db.businessId)
      .where('category', '=', key)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async delete(id: string): Promise<number> {
    const r = await this.db.q
      .deleteFrom('app.expense_category_defs')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numDeletedRows);
  }
}
