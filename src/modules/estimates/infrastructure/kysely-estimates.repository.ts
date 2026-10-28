import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type {
  EstimateCreateData,
  EstimateDetail,
  EstimateLineData,
  EstimateRow,
  ListParams,
  ListResult,
} from '../domain/estimates.repository';
import { EstimatesRepository } from '../domain/estimates.repository';
import type { EstimateStatus } from '../dto/estimates.dto';

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class KyselyEstimatesRepository extends EstimatesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findLastNumber(businessId: string, prefix: string): Promise<string | null> {
    const row = await this.db.q
      .selectFrom('app.estimates')
      .select('number')
      .where('business_id', '=', businessId)
      .where('number', 'like', `${escapeLike(prefix)}%`)
      .orderBy('number', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.number ?? null;
  }

  async create(data: EstimateCreateData): Promise<EstimateDetail> {
    const id = newId();
    await this.db.tx(async (q) => {
      await q
        .insertInto('app.estimates')
        .values({
          id,
          business_id: data.businessId,
          number: data.number,
          date: data.date,
          valid_until: data.validUntil,
          customer_id: data.customerId,
          issued_by_id: data.issuedById,
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

  private async insertLines(
    q: Db['q'],
    businessId: string,
    estimateId: string,
    lines: EstimateLineData[],
  ): Promise<void> {
    if (lines.length === 0) return;
    await q
      .insertInto('app.estimate_lines')
      .values(
        lines.map((l) => ({
          id: newId(),
          business_id: businessId,
          estimate_id: estimateId,
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

  async findDetail(businessId: string, id: string): Promise<EstimateDetail | null> {
    const r = await this.db.q
      .selectFrom('app.estimates as e')
      .innerJoin('app.customers as c', 'c.id', 'e.customer_id')
      .innerJoin('app_auth.users as u', 'u.id', 'e.issued_by_id')
      .select([
        'e.id',
        'e.number',
        'e.date',
        'e.valid_until',
        'e.customer_id',
        'c.name as customer_name',
        'e.issued_by_id',
        'u.name as issued_by_name',
        'e.status',
        'e.ht',
        'e.tva',
        'e.discount',
        'e.total',
        'e.notes',
        'e.terms',
      ])
      .where('e.business_id', '=', businessId)
      .where('e.id', '=', id)
      .executeTakeFirst();
    if (!r) return null;
    const lines = await this.db.q
      .selectFrom('app.estimate_lines')
      .select(['id', 'product_id', 'label', 'qty', 'price_ht', 'vat', 'discount'])
      .where('estimate_id', '=', id)
      .execute();
    return {
      ...this.toRow(r),
      issuedById: r.issued_by_id,
      issuedByName: r.issued_by_name,
      ht: Number(r.ht),
      tva: Number(r.tva),
      discount: Number(r.discount),
      notes: r.notes,
      terms: r.terms,
      lines: lines.map((l) => {
        const priceHt = Number(l.price_ht);
        const qty = Number(l.qty);
        const discount = Number(l.discount);
        const subtotal = Math.round((priceHt * qty - discount) * 100) / 100;
        return {
          id: l.id,
          productId: l.product_id,
          label: l.label,
          qty,
          priceHt,
          vat: l.vat,
          discount,
          subtotal: Math.max(0, subtotal),
        };
      }),
    };
  }

  async list(p: ListParams): Promise<ListResult> {
    const base = this.db.q
      .selectFrom('app.estimates as e')
      .innerJoin('app.customers as c', 'c.id', 'e.customer_id')
      .where('e.business_id', '=', p.businessId)
      .$if(!!p.status, (qb) => qb.where('e.status', '=', p.status!))
      .$if(!!p.customerId, (qb) => qb.where('e.customer_id', '=', p.customerId!))
      .$if(!!p.search, (qb) => {
        const like = `%${escapeLike(p.search!)}%`;
        return qb.where((eb) => eb.or([eb('e.number', 'ilike', like), eb('c.name', 'ilike', like)]));
      });
    const [{ n }, rows] = await Promise.all([
      base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      base
        .select([
          'e.id',
          'e.number',
          'e.date',
          'e.valid_until',
          'e.customer_id',
          'c.name as customer_name',
          'e.status',
          'e.total',
        ])
        .orderBy('e.date', 'desc')
        .limit(p.pageSize)
        .offset((p.page - 1) * p.pageSize)
        .execute(),
    ]);
    return { total: Number(n), page: p.page, pageSize: p.pageSize, items: rows.map((r) => this.toRow(r)) };
  }

  async update(
    id: string,
    data: Partial<EstimateCreateData> & { status?: EstimateStatus },
  ): Promise<EstimateDetail> {
    const businessId = this.db.businessId;
    const { lines, ...rest } = data;
    await this.db.tx(async (q) => {
      if (lines) {
        await q.deleteFrom('app.estimate_lines').where('business_id', '=', businessId).where('estimate_id', '=', id).execute();
        await this.insertLines(q, businessId, id, lines);
      }
      await q
        .updateTable('app.estimates')
        .set({
          updatedAt: new Date(),
          ...(rest.date !== undefined ? { date: rest.date } : {}),
          ...(rest.validUntil !== undefined ? { valid_until: rest.validUntil } : {}),
          ...(rest.customerId !== undefined ? { customer_id: rest.customerId } : {}),
          ...(rest.status !== undefined ? { status: rest.status } : {}),
          ...(rest.ht !== undefined ? { ht: rest.ht } : {}),
          ...(rest.tva !== undefined ? { tva: rest.tva } : {}),
          ...(rest.discount !== undefined ? { discount: rest.discount } : {}),
          ...(rest.total !== undefined ? { total: rest.total } : {}),
          ...(rest.notes !== undefined ? { notes: rest.notes } : {}),
          ...(rest.terms !== undefined ? { terms: rest.terms } : {}),
        })
        .where('business_id', '=', businessId)
        .where('id', '=', id)
        .execute();
    });
    return (await this.findDetail(businessId, id))!;
  }

  async remove(id: string): Promise<void> {
    const businessId = this.db.businessId;
    await this.db.tx(async (q) => {
      await q.deleteFrom('app.estimate_lines').where('business_id', '=', businessId).where('estimate_id', '=', id).execute();
      await q
        .deleteFrom('app.estimates')
        .where('business_id', '=', this.db.businessId)
        .where('id', '=', id)
        .execute();
    });
  }

  private toRow(r: {
    id: string;
    number: string;
    date: Date;
    valid_until: Date;
    customer_id: string;
    customer_name: string;
    status: string;
    total: string;
  }): EstimateRow {
    return {
      id: r.id,
      number: r.number,
      date: r.date,
      validUntil: r.valid_until,
      customerId: r.customer_id,
      customerName: r.customer_name,
      status: r.status as EstimateStatus,
      total: Number(r.total),
    };
  }
}
