import { Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { DB } from '../../../database/types';
import { camelRow } from '../../row-case';
import { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import {
  PosRepository,
  type ActivityLog,
  type CheckoutTicketData,
  type ParkedTicketView,
  type ReceiptData,
  type SaleProduct,
} from '../domain/pos.repository';

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class KyselyPosRepository extends PosRepository {
  constructor(
    private readonly db: Db,
    private readonly stockLedger: StockLedgerService,
  ) {
    super();
  }

  private async upsertSession(q: Kysely<DB>, id: string, openingFloat: number) {
    const businessId = this.db.businessId;
    await q
      .insertInto('app.po_sessions')
      .values({ id, business_id: businessId, openingFloat })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    return q
      .selectFrom('app.po_sessions')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  async ensureSession(id: string, openingFloat: number): Promise<unknown> {
    return camelRow(await this.upsertSession(this.db.q, id, openingFloat));
  }

  async findSaleProducts(ids: string[]): Promise<SaleProduct[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.q
      .selectFrom('app.products')
      .select(['id', 'name', 'sale', 'vat'])
      .where('business_id', '=', this.db.businessId)
      .where('deletedAt', 'is', null)
      .where('id', 'in', ids)
      .execute();
    return rows.map((p) => ({ id: p.id, name: p.name, sale: Number(p.sale), vat: p.vat }));
  }

  async getStockQty(productId: string, warehouseId: string): Promise<number> {
    const level = await this.db.q
      .selectFrom('app.stock_levels')
      .select('qty')
      .where('businessId', '=', this.db.businessId)
      .where('productId', '=', productId)
      .where('warehouseId', '=', warehouseId)
      .executeTakeFirst();
    return level?.qty ?? 0;
  }

  executeCheckout(
    data: CheckoutTicketData,
    activity?: ActivityLog,
    replaceTicketId?: string,
  ): Promise<unknown> {
    const businessId = this.db.businessId;
    return this.db.tx(async (q) => {
      // Per-business advisory lock serializes concurrent checkouts until commit, so the
      // MAX+1 below can't hand two tickets the same number. Movement refs are included
      // because the sale's stock movement reuses the ticket number as its ref.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${data.businessId}))`.execute(q);
      const { rows } = await sql<{ next_num: number }>`
        SELECT COALESCE(MAX(n), 0) + 1 AS next_num FROM (
          SELECT SUBSTRING(number FROM 5)::int AS n FROM app.po_tickets
          WHERE business_id = ${data.businessId} AND number ~ '^TKT-[0-9]+$'
          UNION ALL
          SELECT SUBSTRING(ref FROM 5)::int FROM app.movements
          WHERE business_id = ${data.businessId} AND ref ~ '^TKT-[0-9]+$'
        ) t
      `.execute(q);
      data.number = `TKT-${String(Number(rows[0]!.next_num)).padStart(4, '0')}`;

      const session = await this.upsertSession(q, data.sessionId, 0);

      if (replaceTicketId) {
        await q
          .deleteFrom('app.po_ticket_lines')
          .where('business_id', '=', businessId)
          .where('ticketId', '=', replaceTicketId)
          .execute();
        await q
          .deleteFrom('app.po_tickets')
          .where('business_id', '=', businessId)
          .where('id', '=', replaceTicketId)
          .execute();
      }

      if (!data.parked) {
        await this.stockLedger.post({
          businessId: data.businessId,
          userId: data.cashierId,
          type: 'out',
          reason: 'vente',
          ref: data.number,
          lines: data.lines.map((l) => ({
            productId: l.productId,
            warehouseId: data.warehouseId,
            delta: -l.qty,
          })),
        });
      }

      const ticketId = newId();
      await q
        .insertInto('app.po_tickets')
        .values({
          id: ticketId,
          business_id: businessId,
          number: data.number,
          cashierId: data.cashierId,
          warehouseId: data.warehouseId,
          customerId: data.customerId ?? null,
          sessionId: session.id,
          ht: data.ht,
          tva: data.tva,
          total: data.total,
          discount: data.discount,
          due: data.due,
          payment: JSON.stringify(data.payment),
          parked: data.parked,
        })
        .execute();
      if (data.lines.length > 0) {
        await q
          .insertInto('app.po_ticket_lines')
          .values(
            data.lines.map((l) => ({
              id: newId(),
              business_id: businessId,
              ticketId,
              ...l,
            })),
          )
          .execute();
      }

      if (!data.parked) {
        await q
          .updateTable('app.po_sessions')
          .set((eb) => ({ sales: eb('sales', '+', 1), revenue: sql`revenue + ${data.total}` }))
          .where('business_id', '=', businessId)
          .where('id', '=', session.id)
          .execute();
        if (data.customerId) {
          await q
            .updateTable('app.customers')
            .set({ purchases: sql`purchases + ${data.total}`, updatedAt: new Date() })
            .where('business_id', '=', businessId)
            .where('id', '=', data.customerId)
            .execute();
        }
        if (activity) {
          await q
            .insertInto('app.activities')
            .values({
              id: newId(),
              business_id: businessId,
              userId: activity.userId,
              action: activity.action,
              desc: `${data.number} ${activity.desc}`,
              device: activity.device || null,
            })
            .execute();
        }
      }

      const ticket = await q
        .selectFrom('app.po_tickets')
        .selectAll()
        .where('business_id', '=', businessId)
        .where('id', '=', ticketId)
        .executeTakeFirstOrThrow();
      const lines = await q
        .selectFrom('app.po_ticket_lines as l')
        .leftJoin('app.products as p', 'p.id', 'l.productId')
        .selectAll('l')
        .select(['p.id as p_id', 'p.name as p_name', 'p.sku as p_sku', 'p.tone as p_tone'])
        .where('l.business_id', '=', businessId)
        .where('l.ticketId', '=', ticketId)
        .execute();
      return {
        ...camelRow(ticket),
        lines: lines.map(({ p_id, p_name, p_sku, p_tone, ...l }) => ({
          ...camelRow(l),
          product: { id: p_id, name: p_name, sku: p_sku, tone: p_tone },
        })),
      };
    });
  }

  async findTicketForResume(id: string): Promise<ParkedTicketView | null> {
    const t = await this.db.q
      .selectFrom('app.po_tickets')
      .select(['id', 'warehouseId', 'customerId', 'discount', 'parked'])
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!t) return null;
    const lines = await this.db.q
      .selectFrom('app.po_ticket_lines')
      .select(['productId', 'qty'])
      .where('business_id', '=', this.db.businessId)
      .where('ticketId', '=', id)
      .execute();
    return { ...t, discount: Number(t.discount), lines };
  }

  async markParked(id: string): Promise<unknown> {
    const r = await this.db.q
      .updateTable('app.po_tickets')
      .set({ parked: true })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return camelRow(r);
  }

  async findReceiptData(id: string): Promise<ReceiptData | null> {
    const businessId = this.db.businessId;
    const t = await this.db.q
      .selectFrom('app.po_tickets')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!t) return null;

    const [lines, cashier, customer, business, warehouse] = await Promise.all([
      this.db.q
        .selectFrom('app.po_ticket_lines as l')
        .innerJoin('app.products as p', 'p.id', 'l.productId')
        .select(['l.productId', 'l.qty', 'l.priceTtc', 'l.vat', 'p.name', 'p.sku', 'p.barcode'])
        .where('l.business_id', '=', businessId)
        .where('l.ticketId', '=', id)
        .execute(),
      this.db.q
        .selectFrom('app_auth.users')
        .select(['id', 'name', 'role'])
        .where('id', '=', t.cashierId)
        .executeTakeFirst(),
      t.customerId
        ? this.db.q
            .selectFrom('app.customers')
            .select(['id', 'name', 'ice', 'phone'])
            .where('id', '=', t.customerId)
            .executeTakeFirst()
        : undefined,
      this.db.q
        .selectFrom('app.businesses')
        .select(['name', 'ice', 'address', 'city', 'phone'])
        .where('id', '=', businessId)
        .executeTakeFirst(),
      this.db.q
        .selectFrom('app.warehouses')
        .select(['id', 'name', 'city', 'address', 'phone'])
        .where('id', '=', t.warehouseId)
        .executeTakeFirst(),
    ]);

    return {
      ticket: {
        id: t.id,
        number: t.number,
        date: t.date,
        ht: Number(t.ht),
        tva: Number(t.tva),
        total: Number(t.total),
        discount: Number(t.discount),
        due: Number(t.due),
        payment: t.payment,
        parked: t.parked,
        lines: lines.map((l) => ({
          productId: l.productId,
          name: l.name,
          sku: l.sku,
          barcode: l.barcode,
          qty: l.qty,
          priceTtc: Number(l.priceTtc),
          vat: l.vat,
          lineTotal: round2(Number(l.priceTtc) * l.qty),
        })),
      },
      cashier: cashier ?? null,
      customer: customer ?? null,
      warehouse: warehouse ?? null,
      business: business ?? null,
    };
  }
}
