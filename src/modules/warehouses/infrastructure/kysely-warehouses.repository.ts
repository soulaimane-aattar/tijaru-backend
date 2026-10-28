
import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow, defined } from '../../row-case';
import {
  WarehousesRepository,
  type CreateWarehouseData,
  type UpdateWarehouseData,
} from '../domain/warehouses.repository';

@Injectable()
export class KyselyWarehousesRepository extends WarehousesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  /** Warehouse rows joined with their manager `{ id, name, role }` (null when unassigned). */
  private withManager() {
    return this.db.q
      .selectFrom('app.warehouses as w')
      .leftJoin('app_auth.users as m', 'm.id', 'w.managerId')
      .selectAll('w')
      .select(['m.id as m_id', 'm.name as m_name', 'm.role as m_role'])
      .where('w.business_id', '=', this.db.businessId)
      .where('w.deletedAt', 'is', null);
  }

  private shape({ m_id, m_name, m_role, ...w }: { m_id: string | null; m_name: string | null; m_role: string | null }) {
    return { ...camelRow(w), manager: m_id ? { id: m_id, name: m_name, role: m_role } : null };
  }

  async findAll(): Promise<unknown> {
    const rows = await this.withManager().orderBy('w.isDefault', 'desc').orderBy('w.name').execute();
    return rows.map((r) => this.shape(r));
  }

  async findDetail(id: string): Promise<unknown | null> {
    const row = await this.withManager().where('w.id', '=', id).executeTakeFirst();
    if (!row) return null;
    const users = await this.db.q
      .selectFrom('app_auth.user_warehouses')
      .select('userId')
      .where('business_id', '=', this.db.businessId)
      .where('warehouseId', '=', id)
      .execute();
    return { ...this.shape(row), users };
  }

  async countActive(): Promise<number> {
    const r = await this.db.q
      .selectFrom('app.warehouses')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('business_id', '=', this.db.businessId)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async countNonZeroStock(id: string): Promise<number> {
    const r = await this.db.q
      .selectFrom('app.stock_levels')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('businessId', '=', this.db.businessId)
      .where('warehouseId', '=', id)
      .where('qty', '>', 0)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async exists(id: string): Promise<boolean> {
    const wh = await this.db.q
      .selectFrom('app.warehouses')
      .select('id')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return wh !== undefined;
  }

  async isMultiWarehouse(): Promise<boolean | undefined> {
    const b = await this.db.q
      .selectFrom('app.businesses')
      .select('multi_warehouse')
      .where('id', '=', this.db.businessId)
      .executeTakeFirst();
    return b?.multi_warehouse;
  }

  create(data: CreateWarehouseData): Promise<unknown> {
    const businessId = this.db.businessId;
    return this.db.tx(async (q) => {
      if (data.isDefault) {
        await q
          .updateTable('app.warehouses')
          .set({ isDefault: false })
          .where('business_id', '=', businessId)
          .where('isDefault', '=', true)
          .execute();
      }
      const row = await q
        .insertInto('app.warehouses')
        .values({ id: newId(), business_id: businessId, updatedAt: new Date(), ...defined(data) } as never)
        .returningAll()
        .executeTakeFirstOrThrow();
      return camelRow(row);
    });
  }

  update(id: string, data: UpdateWarehouseData): Promise<unknown> {
    const businessId = this.db.businessId;
    return this.db.tx(async (q) => {
      if (data.isDefault === true) {
        await q
          .updateTable('app.warehouses')
          .set({ isDefault: false })
          .where('business_id', '=', businessId)
          .where('isDefault', '=', true)
          .where('id', '!=', id)
          .execute();
      }
      const row = await q
        .updateTable('app.warehouses')
        .set({ ...defined(data), updatedAt: new Date() })
        .where('business_id', '=', businessId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return camelRow(row);
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.db.q
      .updateTable('app.warehouses')
      .set({ deletedAt: new Date(), active: false, isDefault: false, updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }
}
