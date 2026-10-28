import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type {
  InvoiceCreateData,
  InvoiceDetail,
  InvoiceLineData,
  InvoiceRow,
  InvoiceUpdateData,
  ListParams,
  ListResult,
} from '../domain/invoices.repository';
import { InvoicesRepository } from '../domain/invoices.repository';
import type { InvoiceStatus } from '../dto/invoices.dto';

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class KyselyInvoicesRepository extends InvoicesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findLastNumber(businessId: string, prefix: string): Promise<string | null> {
    const row = await this.db.q
      .selectFrom('app.invoices')
      .select('number')
      .where('business_id', '=', businessId)
      .where('number', 'like', `${escapeLike(prefix)}%`)
      .orderBy('number', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.number ?? null;
  }

  async create(data: InvoiceCreateData): Promise<InvoiceDetail> {
    const id = newId();
    await this.db.tx(async (q) => {
      await q
        .insertInto('app.invoices')
        .values({
          id,
          business_id: data.businessId,
          number: data.number,
          date: data.date,
          due_date: data.dueDate,
          customer_id: data.customerId,
          issued_by_id: data.issuedById,
          status: data.status,
          ht: data.ht,
          tva: data.tva,
          discount: data.discount,
          total: data.total,
          notes: data.notes,
          terms: data.terms,
          updatedAt: new Date(),
        })
        .execute();
      await this.insertLines(q, data.businessId, id, data.lines);
    });
    return (await this.findDetail(data.businessId, id))!;
  }

  async update(id: string, data: InvoiceUpdateData): Promise<InvoiceDetail> {
    const businessId = this.db.businessId;
    await this.db.tx(async (q) => {
      if (data.lines) {
        await q.deleteFrom('app.invoice_lines').where('business_id', '=', businessId).where('invoice_id', '=', id).execute();
        await this.insertLines(q, businessId, id, data.lines);
      }
      await q
        .updateTable('app.invoices')
        .set({
          updatedAt: new Date(),
          ...(data.date !== undefined ? { date: data.date } : {}),
          ...(data.dueDate !== undefined ? { due_date: data.dueDate } : {}),
          ...(data.customerId !== undefined ? { customer_id: data.customerId } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.ht !== undefined ? { ht: data.ht } : {}),
          ...(data.tva !== undefined ? { tva: data.tva } : {}),
          ...(data.discount !== undefined ? { discount: data.discount } : {}),
          ...(data.total !== undefined ? { total: data.total } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.terms !== undefined ? { terms: data.terms } : {}),
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
    invoiceId: string,
    lines: InvoiceLineData[],
  ): Promise<void> {
    if (lines.length === 0) return;
    await q
      .insertInto('app.invoice_lines')
      .values(
        lines.map((l) => ({
          id: newId(),
          business_id: businessId,
          invoice_id: invoiceId,
          product_id: l.productId,
          label: l.label,
          qty: l.qty,
          price_ht: l.priceHt,
          vat: l.vat,
          discount: l.discount,
        })),
      )
      .execute();
  }

  async findDetail(businessId: string, id: string): Promise<InvoiceDetail | null> {
    const r = await this.db.q
      .selectFrom('app.invoices as i')
      .innerJoin('app.customers as c', 'c.id', 'i.customer_id')
      .innerJoin('app_auth.users as u', 'u.id', 'i.issued_by_id')
      .select([
        'i.id',
        'i.number',
        'i.date',
        'i.due_date',
        'i.customer_id',
        'c.name as customer_name',
        'i.issued_by_id',
        'u.name as issued_by_name',
        'i.status',
        'i.ht',
        'i.tva',
        'i.discount',
        'i.total',
        'i.paid',
        'i.notes',
        'i.terms',
      ])
      .where('i.business_id', '=', businessId)
      .where('i.id', '=', id)
      .executeTakeFirst();
    if (!r) return null;
    const lines = await this.db.q
      .selectFrom('app.invoice_lines')
      .select(['id', 'product_id', 'label', 'qty', 'price_ht', 'vat', 'discount'])
      .where('invoice_id', '=', id)
      .execute();
    return {
      ...this.toRow(r),
      issuedById: r.issued_by_id,
      issuedByName: r.issued_by_name,
      notes: r.notes,
      terms: r.terms,
      lines: lines.map((l) => ({
        id: l.id,
        productId: l.product_id,
        label: l.label,
        qty: Number(l.qty),
        priceHt: Number(l.price_ht),
        vat: l.vat,
        discount: Number(l.discount),
      })),
    };
  }

  async list(p: ListParams): Promise<ListResult> {
    const base = this.db.q
      .selectFrom('app.invoices as i')
      .innerJoin('app.customers as c', 'c.id', 'i.customer_id')
      .where('i.business_id', '=', p.businessId)
      .$if(!!p.status, (qb) => qb.where('i.status', '=', p.status!))
      .$if(!!p.customerId, (qb) => qb.where('i.customer_id', '=', p.customerId!))
      .$if(!!p.search, (qb) => {
        const like = `%${escapeLike(p.search!)}%`;
        return qb.where((eb) => eb.or([eb('i.number', 'ilike', like), eb('c.name', 'ilike', like)]));
      });
    const [{ n }, rows] = await Promise.all([
      base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      base
        .select([
          'i.id',
          'i.number',
          'i.date',
          'i.due_date',
          'i.customer_id',
          'c.name as customer_name',
          'i.status',
          'i.ht',
          'i.tva',
          'i.discount',
          'i.total',
          'i.paid',
        ])
        .orderBy('i.date', 'desc')
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize)
        .execute(),
    ]);
    return { total: Number(n), page: p.page, pageSize: p.pageSize, items: rows.map((r) => this.toRow(r)) };
  }

  async updateStatus(id: string, status: InvoiceStatus): Promise<void> {
    await this.db.q
      .updateTable('app.invoices')
      .set({ status, updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }

  async addPayment(id: string, amount: number): Promise<InvoiceDetail> {
    const businessId = this.db.businessId;
    await this.db.q
      .updateTable('app.invoices')
      .set((eb) => ({ paid: eb('paid', '+', String(amount)), updatedAt: new Date() }))
      .where('business_id', '=', businessId)
      .where('id', '=', id)
      .execute();
    return (await this.findDetail(businessId, id))!;
  }

  private toRow(r: {
    id: string;
    number: string;
    date: Date;
    due_date: Date;
    customer_id: string;
    customer_name: string;
    status: string;
    ht: string;
    tva: string;
    discount: string;
    total: string;
    paid: string;
  }): InvoiceRow {
    return {
      id: r.id,
      number: r.number,
      date: r.date,
      dueDate: r.due_date,
      customerId: r.customer_id,
      customerName: r.customer_name,
      status: r.status as InvoiceStatus,
      ht: Number(r.ht),
      tva: Number(r.tva),
      discount: Number(r.discount),
      total: Number(r.total),
      paid: Number(r.paid),
    };
  }
}
