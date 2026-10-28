import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow, defined } from '../../row-case';
import {
  PurchaseOrdersRepository,
  type ActivityLog,
  type CreatePOData,
  type CreatePOLineData,
  type PatchPOData,
  type POListFilters,
  type POLineTotals,
  type POStatus,
  type POView,
} from '../domain/po.repository';

@Injectable()
export class KyselyPurchaseOrdersRepository extends PurchaseOrdersRepository {
  constructor(private readonly db: Db) {
    super();
  }

  private pos() {
    return this.db.q
      .selectFrom('app.purchase_orders as po')
      .where('po.business_id', '=', this.db.businessId);
  }

  private lineRows(poId: string, businessId: string, lines: CreatePOLineData[]) {
    return lines.map((l) => ({
      id: newId(),
      business_id: businessId,
      purchaseOrderId: poId,
      received: 0,
      ...l,
    }));
  }

  private rawLines(poId: string) {
    return this.db.q
      .selectFrom('app.purchase_order_lines')
      .selectAll()
      .where('business_id', '=', this.db.businessId)
      .where('purchaseOrderId', '=', poId)
      .execute();
  }

  async findAll(filters: POListFilters): Promise<unknown[]> {
    const rows = await this.pos()
      .leftJoin('app.suppliers as s', 's.id', 'po.supplierId')
      .leftJoin('app.warehouses as w', 'w.id', 'po.warehouseId')
      .selectAll('po')
      .select([
        's.id as s_id',
        's.name as s_name',
        'w.id as w_id',
        'w.name as w_name',
        'w.city as w_city',
        (eb) =>
          eb
            .selectFrom('app.purchase_order_lines as l')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('l.purchaseOrderId', '=', 'po.id')
            .as('lines_n'),
      ])
      .$if(!!filters.status, (q) => q.where('po.status', '=', filters.status!))
      .$if(!!filters.supplierId, (q) => q.where('po.supplierId', '=', filters.supplierId!))
      .$if(!!filters.warehouseId, (q) => q.where('po.warehouseId', '=', filters.warehouseId!))
      .orderBy('po.date', 'desc')
      .execute();
    return rows.map(({ s_id, s_name, w_id, w_name, w_city, lines_n, ...po }) => ({
      ...camelRow(po),
      supplier: { id: s_id, name: s_name },
      warehouse: { id: w_id, name: w_name, city: w_city },
      _count: { lines: Number(lines_n) },
    }));
  }

  async findDetail(id: string): Promise<unknown | null> {
    const po = await this.pos().selectAll('po').where('po.id', '=', id).executeTakeFirst();
    if (!po) return null;
    const [supplier, warehouse, lines] = await Promise.all([
      this.db.q
        .selectFrom('app.suppliers')
        .selectAll()
        .where('id', '=', po.supplierId)
        .executeTakeFirst(),
      this.db.q
        .selectFrom('app.warehouses')
        .selectAll()
        .where('id', '=', po.warehouseId)
        .executeTakeFirst(),
      this.db.q
        .selectFrom('app.purchase_order_lines as l')
        .leftJoin('app.products as p', 'p.id', 'l.productId')
        .selectAll('l')
        .select(['p.id as p_id', 'p.name as p_name', 'p.sku as p_sku', 'p.tone as p_tone'])
        .where('l.business_id', '=', this.db.businessId)
        .where('l.purchaseOrderId', '=', id)
        .execute(),
    ]);
    return {
      ...camelRow(po),
      supplier: supplier ? camelRow(supplier) : null,
      warehouse: warehouse ? camelRow(warehouse) : null,
      lines: lines.map(({ p_id, p_name, p_sku, p_tone, ...l }) => ({
        ...camelRow(l),
        product: { id: p_id, name: p_name, sku: p_sku, tone: p_tone },
      })),
    };
  }

  async findLastNumber(prefix: string): Promise<string | null> {
    const last = await this.pos()
      .select('po.number')
      .where('po.number', 'like', `${prefix}%`)
      .orderBy('po.number', 'desc')
      .limit(1)
      .executeTakeFirst();
    return last?.number ?? null;
  }

  async create(data: CreatePOData): Promise<unknown> {
    const businessId = this.db.businessId;
    const id = newId();
    await this.db.tx(async (q) => {
      await q
        .insertInto('app.purchase_orders')
        .values({
          id,
          business_id: businessId,
          number: data.number,
          supplierId: data.supplierId,
          warehouseId: data.warehouseId,
          status: data.status,
          notes: data.notes || null,
          updatedAt: new Date(),
        })
        .execute();
      if (data.lines.length > 0) {
        await q
          .insertInto('app.purchase_order_lines')
          .values(this.lineRows(id, businessId, data.lines))
          .execute();
      }
    });
    const po = await this.pos().selectAll('po').where('po.id', '=', id).executeTakeFirstOrThrow();
    return { ...camelRow(po), lines: (await this.rawLines(id)).map(camelRow) };
  }

  async findStatus(id: string): Promise<POStatus | null> {
    const po = await this.pos().select('po.status').where('po.id', '=', id).executeTakeFirst();
    return po ? po.status : null;
  }

  async update(id: string, data: PatchPOData): Promise<unknown> {
    const businessId = this.db.businessId;
    const { lines, ...scalar } = data;
    await this.db.tx(async (q) => {
      await q
        .updateTable('app.purchase_orders')
        .set({ ...defined(scalar), updatedAt: new Date() })
        .where('business_id', '=', businessId)
        .where('id', '=', id)
        .execute();
      if (lines) {
        await q
          .deleteFrom('app.purchase_order_lines')
          .where('business_id', '=', businessId)
          .where('purchaseOrderId', '=', id)
          .execute();
        if (lines.length > 0) {
          await q
            .insertInto('app.purchase_order_lines')
            .values(this.lineRows(id, businessId, lines))
            .execute();
        }
      }
    });
    const po = await this.pos().selectAll('po').where('po.id', '=', id).executeTakeFirstOrThrow();
    return { ...camelRow(po), lines: (await this.rawLines(id)).map(camelRow) };
  }

  async delete(id: string): Promise<void> {
    await this.db.q
      .deleteFrom('app.purchase_orders')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }

  async findWithLines(id: string): Promise<POView | null> {
    const po = await this.pos()
      .select(['po.id', 'po.number', 'po.status', 'po.warehouseId'])
      .where('po.id', '=', id)
      .executeTakeFirst();
    if (!po) return null;
    const lines = await this.db.q
      .selectFrom('app.purchase_order_lines')
      .select(['id', 'productId', 'qty', 'received', 'price'])
      .where('business_id', '=', this.db.businessId)
      .where('purchaseOrderId', '=', id)
      .execute();
    return { ...po, lines: lines.map((l) => ({ ...l, price: Number(l.price) })) };
  }

  async incrementLineReceived(lineId: string, qty: number): Promise<void> {
    await this.db.q
      .updateTable('app.purchase_order_lines')
      .set((eb) => ({ received: eb('received', '+', qty) }))
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', lineId)
      .execute();
  }

  findLineTotals(poId: string): Promise<POLineTotals[]> {
    return this.db.q
      .selectFrom('app.purchase_order_lines')
      .select(['qty', 'received'])
      .where('business_id', '=', this.db.businessId)
      .where('purchaseOrderId', '=', poId)
      .execute();
  }

  async updateStatus(poId: string, status: POStatus): Promise<void> {
    await this.db.q
      .updateTable('app.purchase_orders')
      .set({ status, updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', poId)
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
        device: activity.device || null,
      })
      .execute();
  }
}
