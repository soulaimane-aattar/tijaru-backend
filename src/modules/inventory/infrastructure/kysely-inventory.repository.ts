import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow } from '../../row-case';
import {
  InventoryRepository,
  type ActivityLog,
  type CountLineInput,
  type InventoryCountView,
  type StockSnapshotLine,
} from '../domain/inventory.repository';

@Injectable()
export class KyselyInventoryRepository extends InventoryRepository {
  constructor(private readonly db: Db) {
    super();
  }

  private counts() {
    return this.db.q
      .selectFrom('app.inventory_counts as c')
      .where('c.business_id', '=', this.db.businessId);
  }

  private async linesWithProduct(countIds: string[]) {
    if (countIds.length === 0) return [];
    const rows = await this.db.q
      .selectFrom('app.inventory_count_lines as l')
      .leftJoin('app.products as p', 'p.id', 'l.productId')
      .selectAll('l')
      .select(['p.id as p_id', 'p.name as p_name', 'p.sku as p_sku'])
      .where('l.business_id', '=', this.db.businessId)
      .where('l.countId', 'in', countIds)
      .execute();
    return rows.map(({ p_id, p_name, p_sku, ...l }) => ({
      ...camelRow(l),
      product: { id: p_id, name: p_name, sku: p_sku },
    }));
  }

  async findAll(): Promise<unknown[]> {
    const rows = await this.counts()
      .leftJoin('app.warehouses as w', 'w.id', 'c.warehouseId')
      .selectAll('c')
      .select([
        'w.id as w_id',
        'w.name as w_name',
        'w.city as w_city',
        (eb) =>
          eb
            .selectFrom('app.inventory_count_lines as l')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('l.countId', '=', 'c.id')
            .as('lines_n'),
      ])
      .orderBy('c.date', 'desc')
      .execute();
    return rows.map(({ w_id, w_name, w_city, lines_n, ...c }) => ({
      ...camelRow(c),
      warehouse: { id: w_id, name: w_name, city: w_city },
      _count: { lines: Number(lines_n) },
    }));
  }

  async findDetail(id: string): Promise<unknown | null> {
    const c = await this.counts().selectAll('c').where('c.id', '=', id).executeTakeFirst();
    if (!c) return null;
    const warehouse = await this.db.q
      .selectFrom('app.warehouses')
      .selectAll()
      .where('id', '=', c.warehouseId)
      .executeTakeFirst();
    return {
      ...camelRow(c),
      warehouse: warehouse ? camelRow(warehouse) : null,
      lines: await this.linesWithProduct([id]),
    };
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

  findActiveStockLevels(warehouseId: string): Promise<StockSnapshotLine[]> {
    return this.db.q
      .selectFrom('app.stock_levels as s')
      .innerJoin('app.products as p', 'p.id', 's.productId')
      .select(['s.productId', 's.qty'])
      .where('s.businessId', '=', this.db.businessId)
      .where('s.warehouseId', '=', warehouseId)
      .where('p.deletedAt', 'is', null)
      .execute();
  }

  async createCount(
    warehouseId: string,
    lines: CountLineInput[],
    notes?: string | undefined,
  ): Promise<unknown> {
    const businessId = this.db.businessId;
    const id = newId();
    await this.db.tx(async (q) => {
      await q
        .insertInto('app.inventory_counts')
        .values({ id, business_id: businessId, warehouseId, notes: notes ?? null })
        .execute();
      if (lines.length > 0) {
        await q
          .insertInto('app.inventory_count_lines')
          .values(
            lines.map((l) => ({
              id: newId(),
              business_id: businessId,
              countId: id,
              ...l,
            })),
          )
          .execute();
      }
    });
    const c = await this.counts().selectAll('c').where('c.id', '=', id).executeTakeFirstOrThrow();
    return { ...camelRow(c), lines: await this.linesWithProduct([id]) };
  }

  async findWithLines(id: string): Promise<InventoryCountView | null> {
    const c = await this.counts()
      .select(['c.id', 'c.warehouseId', 'c.appliedAt'])
      .where('c.id', '=', id)
      .executeTakeFirst();
    if (!c) return null;
    const lines = await this.db.q
      .selectFrom('app.inventory_count_lines')
      .select(['id', 'productId', 'expected', 'counted'])
      .where('business_id', '=', this.db.businessId)
      .where('countId', '=', id)
      .execute();
    return { ...c, lines };
  }

  async findLiveStockLevels(
    warehouseId: string,
    productIds: string[],
  ): Promise<StockSnapshotLine[]> {
    if (productIds.length === 0) return [];
    return this.db.q
      .selectFrom('app.stock_levels')
      .select(['productId', 'qty'])
      .where('businessId', '=', this.db.businessId)
      .where('warehouseId', '=', warehouseId)
      .where('productId', 'in', productIds)
      .execute();
  }

  async updateLineCounted(lineId: string, counted: number): Promise<void> {
    await this.db.q
      .updateTable('app.inventory_count_lines')
      .set({ counted })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', lineId)
      .execute();
  }

  async markApplied(countId: string): Promise<void> {
    await this.db.q
      .updateTable('app.inventory_counts')
      .set({ appliedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', countId)
      .execute();
  }

  async logActivity(activity: ActivityLog): Promise<void> {
    await this.db.q
      .insertInto('app.activities')
      .values({
        id: newId(),
        business_id: this.db.businessId,
        userId: activity.userId,
        action: activity.action,
        desc: activity.desc,
        device: activity.device ?? null,
      })
      .execute();
  }
}
