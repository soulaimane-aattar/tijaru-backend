
import { Injectable } from '@nestjs/common';

import { ConflictError } from '../../../common/errors';
import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow, defined } from '../../row-case';
import {
  CustomerCategoriesRepository,
  type CategoryData,
  CustomersRepository,
  type CreateCustomerData,
  type UpdateCustomerData,
} from '../domain/customers.repository';

/** DTO field → DB column (`creditLimit`, `categoryId` differ). */
const cols = ({ creditLimit, categoryId, ...rest }: UpdateCustomerData) =>
  defined({ ...rest, credit_limit: creditLimit, category_id: categoryId });

@Injectable()
export class KyselyCustomersRepository extends CustomersRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findAll(search: string | undefined): Promise<unknown[]> {
    let q = this.db.q.selectFrom('app.customers').selectAll().where('business_id', '=', this.db.businessId);
    if (search) {
      q = q.where((eb) =>
        eb.or([
          eb('name', 'ilike', `%${search}%`),
          eb('phone', 'like', `%${search}%`),
          eb('ice', 'like', `%${search}%`),
        ]),
      );
    }
    return (await q.orderBy('name').execute()).map(camelRow);
  }

  async findById(id: string): Promise<unknown | null> {
    const row = await this.db.q
      .selectFrom('app.customers')
      .selectAll()
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? camelRow(row) : null;
  }

  async create(data: CreateCustomerData): Promise<unknown> {
    const row = await this.db.q
      .insertInto('app.customers')
      .values({ id: newId(), business_id: this.db.businessId, updatedAt: new Date(), ...cols(data) } as never)
      .returningAll()
      .executeTakeFirstOrThrow();
    return camelRow(row);
  }

  async update(id: string, data: UpdateCustomerData): Promise<unknown | null> {
    const row = await this.db.q
      .updateTable('app.customers')
      .set({ ...cols(data), updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ? camelRow(row) : null;
  }

  async delete(id: string): Promise<number> {
    const r = await this.db.q
      .deleteFrom('app.customers')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numDeletedRows);
  }
}

/** Postgres unique_violation -> 409 instead of a 500. */
const uniqueLabel = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw new ConflictError('A category with this label already exists');
    }
    throw e;
  }
};

@Injectable()
export class KyselyCustomerCategoriesRepository extends CustomerCategoriesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findAll(): Promise<unknown[]> {
    const rows = await this.db.q
      .selectFrom('app.customer_categories')
      .selectAll()
      .where('business_id', '=', this.db.businessId)
      .orderBy('label')
      .execute();
    return rows.map(camelRow);
  }

  async findById(id: string): Promise<unknown | null> {
    const row = await this.db.q
      .selectFrom('app.customer_categories')
      .selectAll()
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? camelRow(row) : null;
  }

  async create(data: CategoryData & { label: string; color: string }): Promise<unknown> {
    const row = await uniqueLabel(() =>
      this.db.q
        .insertInto('app.customer_categories')
        .values({
          id: newId(),
          business_id: this.db.businessId,
          label: data.label,
          color: data.color,
          credit_limit: data.creditLimit ?? null,
        } as never)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return camelRow(row);
  }

  async update(id: string, { creditLimit, ...rest }: CategoryData): Promise<unknown | null> {
    const set = defined({ ...rest, credit_limit: creditLimit });
    if (Object.keys(set).length === 0) return this.findById(id);
    const row = await uniqueLabel(() =>
      this.db.q
        .updateTable('app.customer_categories')
        .set(set as never)
        .where('business_id', '=', this.db.businessId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst(),
    );
    return row ? camelRow(row) : null;
  }

  async delete(id: string): Promise<number> {
    const r = await this.db.q
      .deleteFrom('app.customer_categories')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numDeletedRows);
  }
}
