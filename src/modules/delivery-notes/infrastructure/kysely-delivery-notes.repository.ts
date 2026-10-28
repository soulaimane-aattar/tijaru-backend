import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import {
  DeliveryNotesRepository,
  type CustomerDebt,
  type DeliveryCreateData,
  type DeliveryDetail,
  type DeliveryLineData,
  type DeliveryRow,
  type DeliveryUpdateData,
  type ListParams,
  type ListResult,
  type PaymentCreateData,
  type PaymentRow,
} from '../domain/delivery-notes.repository';
import type { BonPaymentMethod, DeliveryNoteStatus, DeliveryNoteType } from '../dto/delivery-notes.dto';

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class KyselyDeliveryNotesRepository extends DeliveryNotesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findLastNumber(businessId: string, prefix: string): Promise<string | null> {
    const row = await this.db.q
      .selectFrom('app.delivery_notes')
      .select('number')
      .where('business_id', '=', businessId)
      .where('number', 'like', `${escapeLike(prefix)}%`)
      .orderBy('number', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.number ?? null;
  }

  async create(data: DeliveryCreateData): Promise<DeliveryDetail> {
    const id = newId();
    await this.db.tx(async (q) => {
      await q
        .insertInto('app.delivery_notes')
        .values({
          id,
          business_id: data.businessId,
          number: data.number,
          type: data.type,
          date: data.date,
          status: data.status,
          customer_id: data.customerId,
          supplier_id: data.supplierId,
          issued_by_id: data.issuedById,
          source_ref: data.sourceRef,
          carrier: data.carrier,
          notes: data.notes,
          return_of_id: data.returnOfId ?? null,
          updatedAt: new Date(),
        })
        .execute();
      await this.insertLines(q, data.businessId, id, data.lines);
    });
    return (await this.findDetail(data.businessId, id))!;
  }

  async update(id: string, data: DeliveryUpdateData): Promise<DeliveryDetail> {
    const businessId = this.db.businessId;
    await this.db.tx(async (q) => {
      if (data.lines) {
        await q
          .deleteFrom('app.delivery_note_lines')
          .where('business_id', '=', businessId)
          .where('delivery_note_id', '=', id)
          .execute();
        await this.insertLines(q, businessId, id, data.lines);
      }
      await q
        .updateTable('app.delivery_notes')
        .set({
          updatedAt: new Date(),
          ...(data.customerId !== undefined ? { customer_id: data.customerId } : {}),
          ...(data.supplierId !== undefined ? { supplier_id: data.supplierId } : {}),
          ...(data.sourceRef !== undefined ? { source_ref: data.sourceRef } : {}),
          ...(data.carrier !== undefined ? { carrier: data.carrier } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        })
        .where('business_id', '=', businessId)
        .where('id', '=', id)
        .execute();
    });
    return (await this.findDetail(businessId, id))!;
  }

  private async insertLines(
    q: Db['q'],
    businessId: string,
    deliveryNoteId: string,
    lines: DeliveryLineData[],
  ): Promise<void> {
    if (lines.length === 0) return;
    await q
      .insertInto('app.delivery_note_lines')
      .values(
        lines.map((l) => ({
          id: newId(),
          business_id: businessId,
          delivery_note_id: deliveryNoteId,
          product_id: l.productId,
          label: l.label,
          ordered: l.ordered,
          sent: l.sent,
          unit_price: l.unitPrice,
        })),
      )
      .execute();
  }

  async findDetail(businessId: string, id: string): Promise<DeliveryDetail | null> {
    const row = await this.db.q
      .selectFrom('app.delivery_notes as d')
      .leftJoin('app.customers as c', 'c.id', 'd.customer_id')
      .leftJoin('app.suppliers as s', 's.id', 'd.supplier_id')
      .innerJoin('app_auth.users as u', 'u.id', 'd.issued_by_id')
      .select([
        'd.id',
        'd.number',
        'd.type',
        'd.date',
        'd.status',
        'd.customer_id',
        'c.name as customer_name',
        'd.supplier_id',
        's.name as supplier_name',
        'd.issued_by_id',
        'u.name as issued_by_name',
        'd.source_ref',
        'd.carrier',
        'd.signed',
        'd.paid',
        'd.return_of_id',
        'd.notes',
      ])
      .where('d.business_id', '=', businessId)
      .where('d.id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    const lines = await this.db.q
      .selectFrom('app.delivery_note_lines')
      .select(['id', 'product_id', 'label', 'ordered', 'sent', 'unit_price'])
      .where('delivery_note_id', '=', id)
      .execute();
    return {
      id: row.id,
      number: row.number,
      type: row.type as DeliveryNoteType,
      date: row.date,
      status: row.status as DeliveryNoteStatus,
      customerId: row.customer_id,
      customerName: row.customer_name,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      issuedById: row.issued_by_id,
      issuedByName: row.issued_by_name,
      sourceRef: row.source_ref,
      carrier: row.carrier,
      signed: row.signed,
      paid: Number(row.paid),
      returnOfId: row.return_of_id,
      notes: row.notes,
      lines: lines.map((l) => ({
        id: l.id,
        productId: l.product_id,
        label: l.label,
        ordered: Number(l.ordered),
        sent: Number(l.sent),
        unitPrice: Number(l.unit_price),
      })),
    };
  }

  async list(p: ListParams): Promise<ListResult> {
    const base = this.db.q
      .selectFrom('app.delivery_notes as d')
      .leftJoin('app.customers as c', 'c.id', 'd.customer_id')
      .leftJoin('app.suppliers as s', 's.id', 'd.supplier_id')
      .where('d.business_id', '=', p.businessId)
      .$if(!!p.type, (qb) => qb.where('d.type', '=', p.type!))
      .$if(!!p.status, (qb) => qb.where('d.status', '=', p.status!))
      .$if(!!p.partyId, (qb) =>
        qb.where((eb) => eb.or([eb('d.customer_id', '=', p.partyId!), eb('d.supplier_id', '=', p.partyId!)])),
      )
      .$if(!!p.search, (qb) => {
        const like = `%${escapeLike(p.search!)}%`;
        return qb.where((eb) =>
          eb.or([eb('d.number', 'ilike', like), eb('c.name', 'ilike', like), eb('s.name', 'ilike', like)]),
        );
      });

    const [{ n }, rows] = await Promise.all([
      base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      base
        .select([
          'd.id',
          'd.number',
          'd.type',
          'd.date',
          'd.status',
          'd.source_ref',
          'd.carrier',
          'd.signed',
          'd.paid',
          'c.name as customer_name',
          's.name as supplier_name',
        ])
        .orderBy('d.date', 'desc')
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize)
        .execute(),
    ]);

    const sums = rows.length
      ? await this.db.q
          .selectFrom('app.delivery_note_lines')
          .select((eb) => [
            'delivery_note_id',
            eb.fn.sum<string>('ordered').as('ordered'),
            eb.fn.sum<string>('sent').as('sent'),
          ])
          .where('delivery_note_id', 'in', rows.map((r) => r.id))
          .groupBy('delivery_note_id')
          .execute()
      : [];
    const byNote = new Map(sums.map((s) => [s.delivery_note_id, s]));

    return {
      total: Number(n),
      page: p.page,
      pageSize: p.pageSize,
      items: rows.map((r): DeliveryRow => {
        const s = byNote.get(r.id);
        return {
          id: r.id,
          number: r.number,
          type: r.type as DeliveryNoteType,
          date: r.date,
          status: r.status as DeliveryNoteStatus,
          partyName: r.customer_name ?? r.supplier_name ?? '—',
          sourceRef: r.source_ref,
          carrier: r.carrier,
          signed: r.signed,
          ordered: Number(s?.ordered ?? 0),
          sent: Number(s?.sent ?? 0),
          paid: Number(r.paid),
        };
      }),
    };
  }

  async updateStatus(id: string, status: DeliveryNoteStatus): Promise<void> {
    await this.db.q
      .updateTable('app.delivery_notes')
      .set({ status, updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }

  async updateLineSent(lineId: string, sent: number): Promise<void> {
    await this.db.q
      .updateTable('app.delivery_note_lines')
      .set({ sent })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', lineId)
      .execute();
  }

  async markSigned(id: string, when: Date): Promise<void> {
    await this.db.q
      .updateTable('app.delivery_notes')
      .set({ signed: true, signed_at: when, updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }

  async findDefaultWarehouseId(businessId: string): Promise<string | null> {
    const wh = await this.db.q
      .selectFrom('app.warehouses')
      .select('id')
      .where('business_id', '=', businessId)
      .where('isDefault', '=', true)
      .limit(1)
      .executeTakeFirst();
    return wh?.id ?? null;
  }

  async addPayment(data: PaymentCreateData): Promise<PaymentRow> {
    const id = newId();
    await this.db.tx(async (q) => {
      await q
        .insertInto('app.delivery_note_payments')
        .values({
          id,
          business_id: data.businessId,
          delivery_note_id: data.deliveryNoteId,
          amount: data.amount,
          method: data.method,
          note: data.note,
          created_by_id: data.createdById,
        })
        .execute();
      await q
        .updateTable('app.delivery_notes')
        .set((eb) => ({ paid: eb('paid', '+', String(data.amount)), updatedAt: new Date() }))
        .where('business_id', '=', data.businessId)
        .where('id', '=', data.deliveryNoteId)
        .execute();
    });
    return this.toPaymentRow(await this.paymentsQuery().where('p.id', '=', id).executeTakeFirstOrThrow());
  }

  private paymentsQuery() {
    return this.db.q
      .selectFrom('app.delivery_note_payments as p')
      .innerJoin('app.delivery_notes as d', 'd.id', 'p.delivery_note_id')
      .innerJoin('app_auth.users as u', 'u.id', 'p.created_by_id')
      .select([
        'p.id',
        'p.delivery_note_id',
        'd.number as bon_number',
        'p.amount',
        'p.method',
        'p.note',
        'u.name as created_by_name',
        'p.createdAt',
      ])
      .orderBy('p.createdAt', 'desc');
  }

  async findPayments(businessId: string, deliveryNoteId: string): Promise<PaymentRow[]> {
    const rows = await this.paymentsQuery()
      .where('p.business_id', '=', businessId)
      .where('p.delivery_note_id', '=', deliveryNoteId)
      .execute();
    return rows.map((r) => this.toPaymentRow(r));
  }

  async listCustomerDebts(businessId: string): Promise<CustomerDebt[]> {
    // Billed = Σ BL line totals; returned = Σ linked RT line totals. Balance is
    // what the customer still owes on delivery notes.
    const { rows } = await sql<{
      customerId: string;
      customerName: string;
      billed: string;
      paid: string;
      returned: string;
      balance: string;
    }>`
      SELECT
        dn.customer_id AS "customerId",
        COALESCE(c.name, '—') AS "customerName",
        SUM(L.total) AS "billed",
        SUM(dn.paid) AS "paid",
        COALESCE(SUM(RT.total), 0) AS "returned",
        SUM(L.total) - SUM(dn.paid) - COALESCE(SUM(RT.total), 0) AS "balance"
      FROM app.delivery_notes dn
      JOIN LATERAL (
        SELECT COALESCE(SUM(l.sent * l.unit_price), 0) AS total
        FROM app.delivery_note_lines l WHERE l.delivery_note_id = dn.id
      ) L ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(RL.total), 0) AS total
        FROM app.delivery_notes r
        JOIN LATERAL (
          SELECT COALESCE(SUM(rl.sent * rl.unit_price), 0) AS total
          FROM app.delivery_note_lines rl WHERE rl.delivery_note_id = r.id
        ) RL ON TRUE
        WHERE r.return_of_id = dn.id AND r.type = 'retour'
      ) RT ON TRUE
      LEFT JOIN app.customers c ON c.id = dn.customer_id
      WHERE dn.business_id = ${businessId} AND dn.type = 'out' AND dn.customer_id IS NOT NULL
      GROUP BY dn.customer_id, c.name
      HAVING SUM(L.total) - SUM(dn.paid) - COALESCE(SUM(RT.total), 0) > 0
      ORDER BY balance DESC
    `.execute(this.db.q);
    return rows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      billed: Number(r.billed),
      paid: Number(r.paid),
      returned: Number(r.returned),
      balance: Number(r.balance),
    }));
  }

  async listCustomerPayments(businessId: string, customerId: string): Promise<PaymentRow[]> {
    const rows = await this.paymentsQuery()
      .where('p.business_id', '=', businessId)
      .where('d.customer_id', '=', customerId)
      .limit(200)
      .execute();
    return rows.map((r) => this.toPaymentRow(r));
  }

  async findReturnedQtyByProduct(businessId: string, bonId: string): Promise<Map<string, number>> {
    const rows = await this.db.q
      .selectFrom('app.delivery_note_lines as l')
      .innerJoin('app.delivery_notes as d', 'd.id', 'l.delivery_note_id')
      .select((eb) => ['l.product_id', eb.fn.sum<string>('l.sent').as('sent')])
      .where('d.business_id', '=', businessId)
      .where('d.type', '=', 'retour')
      .where('d.return_of_id', '=', bonId)
      .groupBy('l.product_id')
      .execute();
    return new Map(rows.map((r) => [r.product_id, Number(r.sent ?? 0)]));
  }

  private toPaymentRow(row: {
    id: string;
    delivery_note_id: string;
    bon_number: string;
    amount: string;
    method: string;
    note: string | null;
    created_by_name: string;
    createdAt: Date;
  }): PaymentRow {
    return {
      id: row.id,
      deliveryNoteId: row.delivery_note_id,
      bonNumber: row.bon_number,
      amount: Number(row.amount),
      method: row.method as BonPaymentMethod,
      note: row.note,
      createdByName: row.created_by_name,
      createdAt: row.createdAt,
    };
  }
}
