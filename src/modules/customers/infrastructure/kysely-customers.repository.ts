
import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow, defined } from '../../row-case';
import {
  CustomersRepository,
  type CreateCustomerData,
  type UpdateCustomerData,
} from '../domain/customers.repository';

/** DTO field → DB column (only `creditLimit` differs). */
const cols = ({ creditLimit, ...rest }: UpdateCustomerData) =>
  defined({ ...rest, credit_limit: creditLimit });

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

  async update(id: string, data: UpdateCustomerData): Promise<number> {
    const r = await this.db.q
      .updateTable('app.customers')
      .set({ ...cols(data), updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
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
