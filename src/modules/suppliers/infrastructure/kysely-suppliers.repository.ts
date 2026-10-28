
import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow, defined } from '../../row-case';
import {
  SuppliersRepository,
  type CreateSupplierData,
  type UpdateSupplierData,
} from '../domain/suppliers.repository';

@Injectable()
export class KyselySuppliersRepository extends SuppliersRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findAll(): Promise<unknown[]> {
    const rows = await this.db.q
      .selectFrom('app.suppliers as s')
      .selectAll('s')
      .select((qb) => [
        qb
          .selectFrom('app.products as p')
          .select(qb.fn.countAll<string>().as('n'))
          .whereRef('p.supplierId', '=', 's.id')
          .as('products'),
        qb
          .selectFrom('app.purchase_orders as po')
          .select(qb.fn.countAll<string>().as('n'))
          .whereRef('po.supplierId', '=', 's.id')
          .as('purchaseOrders'),
      ])
      .where('s.business_id', '=', this.db.businessId)
      .orderBy('s.name')
      .execute();
    return rows.map(({ products, purchaseOrders, ...s }) => ({
      ...camelRow(s),
      _count: { products: Number(products), purchaseOrders: Number(purchaseOrders) },
    }));
  }

  async findDetail(id: string): Promise<unknown | null> {
    const s = await this.findById(id);
    if (!s) return null;
    const businessId = this.db.businessId;
    const [products, purchaseOrders] = await Promise.all([
      this.db.q
        .selectFrom('app.products')
        .select(['id', 'name', 'sku'])
        .where('business_id', '=', businessId)
        .where('supplierId', '=', id)
        .execute(),
      this.db.q
        .selectFrom('app.purchase_orders')
        .select(['id', 'number', 'status', 'date'])
        .where('business_id', '=', businessId)
        .where('supplierId', '=', id)
        .orderBy('date', 'desc')
        .limit(20)
        .execute(),
    ]);
    return { ...(s as object), products, purchaseOrders };
  }

  async findById(id: string): Promise<unknown | null> {
    const row = await this.db.q
      .selectFrom('app.suppliers')
      .selectAll()
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? camelRow(row) : null;
  }

  async create(data: CreateSupplierData): Promise<unknown> {
    const row = await this.db.q
      .insertInto('app.suppliers')
      .values({ id: newId(), business_id: this.db.businessId, updatedAt: new Date(), ...defined(data) } as never)
      .returningAll()
      .executeTakeFirstOrThrow();
    return camelRow(row);
  }

  async update(id: string, data: UpdateSupplierData): Promise<number> {
    const r = await this.db.q
      .updateTable('app.suppliers')
      .set({ ...defined(data), updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  async delete(id: string): Promise<number> {
    const r = await this.db.q
      .deleteFrom('app.suppliers')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numDeletedRows);
  }
}
