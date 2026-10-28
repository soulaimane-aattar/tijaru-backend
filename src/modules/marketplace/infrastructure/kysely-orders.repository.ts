
import { Injectable } from '@nestjs/common';

import { ValidationError } from '../../../common/errors';
import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { AppNotificationtype, AppOrderstatus } from '../../../database/types';
import { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type {
  ListOrdersParams,
  ListOrdersResult,
  OrderCreateData,
  OrderDetail,
  OrderRow,
  OrderableListing,
} from '../domain/orders.repository';
import { OrdersRepository } from '../domain/orders.repository';

import { sellableSeller } from './sellable-seller';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Orders span two tenants (seller + buyer) and `order_lines` belong to the seller under RLS,
 * so reads and the cross-tenant writes (create, notify, customer upsert) use `db.admin`
 * (owner role, explicit filters). The one write that must be atomic with the stock ledger —
 * the status flip on `shipped` — goes through `db.tx` (the request transaction) so
 * `ledger.post` and the order update commit or roll back together.
 */
@Injectable()
export class KyselyOrdersRepository extends OrdersRepository {
  constructor(
    private readonly db: Db,
    private readonly ledger: StockLedgerService,
  ) {
    super();
  }

  async findListings(ids: string[]): Promise<OrderableListing[]> {
    if (ids.length === 0) return [];
    // Same seller-state gate as the catalog: a listing whose owner is
    // suspended, expired or has the module off is not orderable.
    const rows = await this.db.admin
      .selectFrom('app.listings as l')
      .innerJoin('app.businesses as b', 'b.id', 'l.business_id')
      .select(['l.id', 'l.business_id', 'l.product_id', 'l.title', 'l.unit_price', 'l.vat', 'l.min_order_qty', 'l.active'])
      .where('l.id', 'in', ids)
      .where(sellableSeller('b'))
      .execute();
    const tiers =
      rows.length === 0
        ? []
        : await this.db.admin
            .selectFrom('app.listing_tiers')
            .select(['listing_id', 'price_group_id', 'min_qty', 'unit_price'])
            .where('listing_id', 'in', rows.map((r) => r.id))
            .execute();
    return rows.map((l) => ({
      id: l.id,
      sellerBusinessId: l.business_id,
      productId: l.product_id,
      title: l.title,
      unitPrice: Number(l.unit_price),
      vat: l.vat,
      minOrderQty: l.min_order_qty,
      active: l.active,
      tiers: tiers
        .filter((t) => t.listing_id === l.id)
        .map((t) => ({ priceGroupId: t.price_group_id, minQty: t.min_qty, unitPrice: Number(t.unit_price) })),
    }));
  }

  async ensureCustomer(
    sellerBusinessId: string,
    buyerBusinessId: string,
    buyerName: string,
  ): Promise<{ id: string; priceGroupId: string | null }> {
    const existing = await this.db.admin
      .selectFrom('app.customers')
      .select(['id', 'price_group_id'])
      .where('business_id', '=', sellerBusinessId)
      .where('buyer_business_id', '=', buyerBusinessId)
      .executeTakeFirst();
    if (existing) return { id: existing.id, priceGroupId: existing.price_group_id };

    const fallback = await this.db.admin
      .selectFrom('app.price_groups')
      .select('id')
      .where('business_id', '=', sellerBusinessId)
      .where('is_default', '=', true)
      .executeTakeFirst();
    const created = await this.db.admin
      .insertInto('app.customers')
      .values({
        id: newId(),
        business_id: sellerBusinessId,
        name: buyerName,
        buyer_business_id: buyerBusinessId,
        price_group_id: fallback?.id ?? null,
        updatedAt: new Date(),
      })
      .returning(['id', 'price_group_id'])
      .executeTakeFirstOrThrow();
    return { id: created.id, priceGroupId: created.price_group_id };
  }

  async nextNumber(sellerBusinessId: string, prefix: string): Promise<string> {
    const last = await this.db.admin
      .selectFrom('app.orders')
      .select('number')
      .where('seller_business_id', '=', sellerBusinessId)
      .where('number', 'like', `${prefix}%`)
      .orderBy('number', 'desc')
      .limit(1)
      .executeTakeFirst();
    const n = last ? parseInt(last.number.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(4, '0')}`;
  }

  /**
   * `nextNumber` reads the highest number and adds one, so two orders placed
   * with the same seller at the same instant pick the same one and the second
   * trips the unique (seller, number) index. Retry on that collision with
   * a freshly-read number rather than surfacing a 500. Each attempt is its own
   * transaction: a failed insert aborts the one it ran in.
   */
  async create(data: OrderCreateData): Promise<OrderDetail> {
    const { lines, ...header } = data;
    let number = header.number;

    for (let attempt = 0; ; attempt += 1) {
      try {
        const id = await this.db.admin.transaction().execute(async (trx) => {
          const order = await trx
            .insertInto('app.orders')
            .values({
              id: newId(),
              number,
              seller_business_id: header.sellerBusinessId,
              buyer_business_id: header.buyerBusinessId,
              customer_id: header.customerId,
              subtotal_ht: header.subtotalHt,
              vat_total: header.vatTotal,
              total_ttc: header.totalTtc,
              buyer_note: header.buyerNote,
              created_by_user_id: header.createdByUserId,
              updatedAt: new Date(),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await trx
            .insertInto('app.order_lines')
            .values(
              lines.map((l) => ({
                id: newId(),
                order_id: order.id,
                business_id: header.sellerBusinessId,
                listing_id: l.listingId,
                product_id: l.productId,
                name: l.name,
                qty: l.qty,
                unit_price: l.unitPrice,
                vat: l.vat,
                total_ht: l.totalHt,
              })),
            )
            .execute();
          return order.id;
        });
        return (await this.findDetail(id)) as OrderDetail;
      } catch (e) {
        const collided = (e as { code?: string }).code === PG_UNIQUE_VIOLATION && attempt < 5;
        if (!collided) throw e;
        number = await this.nextNumber(header.sellerBusinessId, number.slice(0, -4));
      }
    }
  }

  private headers() {
    return this.db.admin
      .selectFrom('app.orders as o')
      .innerJoin('app.businesses as s', 's.id', 'o.seller_business_id')
      .innerJoin('app.businesses as b', 'b.id', 'o.buyer_business_id')
      .select([
        'o.id',
        'o.number',
        'o.status',
        'o.seller_business_id',
        'o.buyer_business_id',
        'o.subtotal_ht',
        'o.vat_total',
        'o.total_ttc',
        'o.buyer_note',
        'o.seller_note',
        'o.external_ref',
        'o.createdAt',
        'o.status_changed_at',
        's.name as seller_name',
        'b.name as buyer_name',
      ]);
  }

  private static toRow(o: Awaited<ReturnType<ReturnType<KyselyOrdersRepository['headers']>['execute']>>[number]): OrderRow {
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      sellerBusinessId: o.seller_business_id,
      sellerName: o.seller_name,
      buyerBusinessId: o.buyer_business_id,
      buyerName: o.buyer_name,
      subtotalHt: Number(o.subtotal_ht),
      vatTotal: Number(o.vat_total),
      totalTtc: Number(o.total_ttc),
      createdAt: o.createdAt,
      statusChangedAt: o.status_changed_at,
    };
  }

  async findDetail(id: string): Promise<OrderDetail | null> {
    const o = await this.headers().where('o.id', '=', id).executeTakeFirst();
    if (!o) return null;
    const lines = await this.db.admin
      .selectFrom('app.order_lines')
      .select(['id', 'listing_id', 'product_id', 'name', 'qty', 'unit_price', 'vat', 'total_ht'])
      .where('order_id', '=', id)
      .execute();
    return {
      ...KyselyOrdersRepository.toRow(o),
      buyerNote: o.buyer_note,
      sellerNote: o.seller_note,
      externalRef: o.external_ref,
      lines: lines.map((l) => ({
        id: l.id,
        listingId: l.listing_id,
        productId: l.product_id,
        name: l.name,
        qty: l.qty,
        unitPrice: Number(l.unit_price),
        vat: l.vat,
        totalHt: Number(l.total_ht),
      })),
    };
  }

  async list(params: ListOrdersParams): Promise<ListOrdersResult> {
    const col = params.side === 'seller' ? 'o.seller_business_id' : 'o.buyer_business_id';
    let qb = this.headers().where(col, '=', params.businessId);
    let cq = this.db.admin.selectFrom('app.orders as o').where(col, '=', params.businessId);
    if (params.status) {
      qb = qb.where('o.status', '=', params.status);
      cq = cq.where('o.status', '=', params.status);
    }
    const [rows, total] = await Promise.all([
      qb
        .orderBy('o.createdAt', 'desc')
        .offset((params.page - 1) * params.pageSize)
        .limit(params.pageSize)
        .execute(),
      cq.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return {
      items: rows.map(KyselyOrdersRepository.toRow),
      total: Number(total.n),
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async transition(
    id: string,
    to: AppOrderstatus,
    actorUserId: string,
    opts: { postStock: boolean; note?: string | undefined },
  ): Promise<OrderDetail> {
    const order = await this.findDetail(id);
    if (!order) throw new Error(`No Order found: ${id}`);

    const now = new Date();
    await this.db.tx(async (q) => {
      if (opts.postStock) {
        const warehouse = await q
          .selectFrom('app.warehouses')
          .select('id')
          .where('business_id', '=', order.sellerBusinessId)
          .where('active', '=', true)
          .where('deletedAt', 'is', null)
          .orderBy('isDefault', 'desc')
          .orderBy('createdAt', 'asc')
          .limit(1)
          .executeTakeFirst();
        if (!warehouse) throw new ValidationError('no_default_warehouse');

        // D-017: the ledger is the only writer of StockLevel/Movement. It also
        // enforces the stock floor, throwing ConflictError('insufficient_stock').
        // Joins this transaction, so the stock post and the status flip are atomic.
        await this.ledger.post({
          businessId: order.sellerBusinessId,
          userId: actorUserId,
          type: 'out',
          reason: 'vente',
          ref: order.number,
          lines: order.lines.map((l) => ({
            productId: l.productId,
            warehouseId: warehouse.id,
            delta: -l.qty,
          })),
        });
      }

      await q
        .updateTable('app.orders')
        .set({
          status: to,
          status_changed_at: now,
          updatedAt: now,
          ...(opts.note === undefined ? {} : { seller_note: opts.note }),
        })
        .where('id', '=', id)
        .execute();
    });

    // Not re-read: inside the request transaction the flip is uncommitted and the owner
    // connection (db.admin) would still see the old status.
    return {
      ...order,
      status: to,
      statusChangedAt: now,
      sellerNote: opts.note === undefined ? order.sellerNote : opts.note,
    };
  }

  async notify(businessId: string, type: AppNotificationtype, title: string, body: string): Promise<void> {
    // The recipient is the *other* tenant — cross-tenant write.
    await this.db.admin
      .insertInto('app.notifications')
      .values({ id: newId(), business_id: businessId, type, title, body })
      .execute();
  }

  async businessName(id: string): Promise<string> {
    const b = await this.db.admin.selectFrom('app.businesses').select('name').where('id', '=', id).executeTakeFirstOrThrow();
    return b.name;
  }
}
