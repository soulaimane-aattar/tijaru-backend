import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow, defined } from '../../row-case';
import {
  MovementsRepository,
  type ActivityLog,
  type MovementSearchCriteria,
  type ProductRef,
} from '../domain/movements.repository';

@Injectable()
export class KyselyMovementsRepository extends MovementsRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findPage(criteria: MovementSearchCriteria): Promise<{ items: unknown[]; total: number }> {
    const filtered = this.db.q
      .selectFrom('app.movements as m')
      .where('m.business_id', '=', this.db.businessId)
      .$if(!!criteria.type, (q) => q.where('m.type', '=', criteria.type!))
      .$if(!!criteria.productId, (q) => q.where('m.productId', '=', criteria.productId!))
      .$if(!!criteria.warehouseId, (q) =>
        q.where((eb) =>
          eb.or([
            eb('m.warehouseId', '=', criteria.warehouseId!),
            eb('m.toWarehouseId', '=', criteria.warehouseId!),
          ]),
        ),
      )
      .$if(!!criteria.userId, (q) => q.where('m.userId', '=', criteria.userId!))
      .$if(!!criteria.from, (q) => q.where('m.date', '>=', criteria.from!))
      .$if(!!criteria.to, (q) => q.where('m.date', '<=', criteria.to!));

    const [rows, count] = await Promise.all([
      filtered
        .leftJoin('app.products as p', 'p.id', 'm.productId')
        .leftJoin('app.warehouses as w', 'w.id', 'm.warehouseId')
        .leftJoin('app.warehouses as tw', 'tw.id', 'm.toWarehouseId')
        .leftJoin('app_auth.users as u', 'u.id', 'm.userId')
        .selectAll('m')
        .select([
          'p.id as p_id',
          'p.name as p_name',
          'p.sku as p_sku',
          'p.tone as p_tone',
          'w.id as w_id',
          'w.name as w_name',
          'w.city as w_city',
          'tw.id as tw_id',
          'tw.name as tw_name',
          'tw.city as tw_city',
          'u.id as u_id',
          'u.name as u_name',
          'u.role as u_role',
        ])
        .orderBy('m.date', 'desc')
        .offset(criteria.skip)
        .limit(criteria.take)
        .execute(),
      filtered.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
    ]);

    const items = rows.map((r) => {
      const {
        p_id,
        p_name,
        p_sku,
        p_tone,
        w_id,
        w_name,
        w_city,
        tw_id,
        tw_name,
        tw_city,
        u_id,
        u_name,
        u_role,
        ...m
      } = r;
      return {
        ...camelRow(m),
        product: { id: p_id, name: p_name, sku: p_sku, tone: p_tone },
        warehouse: { id: w_id, name: w_name, city: w_city },
        toWarehouse: tw_id ? { id: tw_id, name: tw_name, city: tw_city } : null,
        user: { id: u_id, name: u_name, role: u_role },
      };
    });
    return { items, total: Number(count.n) };
  }

  async findProductRef(id: string): Promise<ProductRef | null> {
    const p = await this.db.q
      .selectFrom('app.products')
      .select(['id', 'name'])
      .where('business_id', '=', this.db.businessId)
      .where('deletedAt', 'is', null)
      .where('id', '=', id)
      .executeTakeFirst();
    return p ?? null;
  }

  async warehouseExists(id: string): Promise<boolean> {
    const w = await this.db.q
      .selectFrom('app.warehouses')
      .select('id')
      .where('business_id', '=', this.db.businessId)
      .where('deletedAt', 'is', null)
      .where('id', '=', id)
      .executeTakeFirst();
    return w !== undefined;
  }

  async logActivity(activity: ActivityLog): Promise<void> {
    await this.db.q
      .insertInto('app.activities')
      .values({
        id: newId(),
        business_id: this.db.businessId,
        ...defined(activity),
      } as never)
      .execute();
  }
}
