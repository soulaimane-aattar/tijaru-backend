
import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { AppUnit, DB } from '../../../database/types';
import type {
  CatalogParams,
  CatalogResult,
  CatalogRow,
  ListingCreateData,
  ListingRow,
  PriceGroupRow,
  ProductForListing,
} from '../domain/marketplace.repository';
import { MarketplaceRepository } from '../domain/marketplace.repository';
import { resolveUnitPrice, type Tier } from '../domain/pricing';

import { sellableSeller } from './sellable-seller';

type TierRow = { id: string; listing_id: string; price_group_id: string | null; min_qty: number; unit_price: string };

type ListingDbRow = {
  id: string;
  product_id: string;
  title: string;
  description: string | null;
  unit_price: string;
  vat: number;
  unit: string;
  min_order_qty: number;
  active: boolean;
};

const LISTING_COLS = ['id', 'product_id', 'title', 'description', 'unit_price', 'vat', 'unit', 'min_order_qty', 'active'] as const;

async function tiersOf(q: Kysely<DB>, listingIds: string[]): Promise<Map<string, TierRow[]>> {
  const map = new Map<string, TierRow[]>();
  if (listingIds.length === 0) return map;
  const rows = await q
    .selectFrom('app.listing_tiers')
    .select(['id', 'listing_id', 'price_group_id', 'min_qty', 'unit_price'])
    .where('listing_id', 'in', listingIds)
    .orderBy('min_qty')
    .execute();
  for (const r of rows) map.set(r.listing_id, [...(map.get(r.listing_id) ?? []), r]);
  return map;
}

const toTier = (t: TierRow): Tier & { id: string } => ({
  id: t.id,
  priceGroupId: t.price_group_id,
  minQty: t.min_qty,
  unitPrice: Number(t.unit_price),
});

const toListingRow = (l: ListingDbRow, tiers: TierRow[] = []): ListingRow => ({
  id: l.id,
  productId: l.product_id,
  title: l.title,
  description: l.description,
  unitPrice: Number(l.unit_price),
  vat: l.vat,
  unit: l.unit,
  minOrderQty: l.min_order_qty,
  active: l.active,
  tiers: tiers.map(toTier),
});

async function loadListings(
  q: Kysely<DB>,
  businessId: string,
  where: { id?: string; productId?: string },
): Promise<ListingRow[]> {
  let qb = q.selectFrom('app.listings').select(LISTING_COLS).where('business_id', '=', businessId);
  if (where.id) qb = qb.where('id', '=', where.id);
  if (where.productId) qb = qb.where('product_id', '=', where.productId);
  const rows = await qb.orderBy('createdAt', 'desc').execute();
  const tiers = await tiersOf(q, rows.map((r) => r.id));
  return rows.map((r) => toListingRow(r, tiers.get(r.id)));
}

const listingCols = (d: Partial<Omit<ListingCreateData, 'businessId' | 'productId' | 'tiers'>>) => ({
  ...(d.title === undefined ? {} : { title: d.title }),
  ...(d.description === undefined ? {} : { description: d.description }),
  ...(d.unitPrice === undefined ? {} : { unit_price: d.unitPrice }),
  ...(d.vat === undefined ? {} : { vat: d.vat }),
  ...(d.unit === undefined ? {} : { unit: d.unit as AppUnit }),
  ...(d.minOrderQty === undefined ? {} : { min_order_qty: d.minOrderQty }),
  ...(d.active === undefined ? {} : { active: d.active }),
});

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/**
 * In-tenant work (price groups, own listings) goes through `db.q` — the RLS-scoped request
 * transaction. The buyer-side catalog is deliberately cross-tenant (D-030): it reads other
 * tenants' rows, so it uses `db.admin` (owner role) with explicit filters.
 */
@Injectable()
export class KyselyMarketplaceRepository extends MarketplaceRepository {
  constructor(private readonly db: Db) {
    super();
  }

  // ─── price groups ──────────────────────────────────────────────────────────

  async listPriceGroups(businessId: string): Promise<PriceGroupRow[]> {
    const rows = await this.db.q
      .selectFrom('app.price_groups as g')
      .select([
        'g.id',
        'g.name',
        'g.is_default',
        sql<string>`(select count(*) from app.customers c where c.price_group_id = g.id)`.as('customer_count'),
      ])
      .where('g.business_id', '=', businessId)
      .orderBy('g.name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isDefault: r.is_default,
      customerCount: Number(r.customer_count),
    }));
  }

  async createPriceGroup(
    businessId: string,
    data: { name: string; isDefault: boolean },
  ): Promise<PriceGroupRow> {
    const row = await this.db.tx(async (q) => {
      if (data.isDefault) {
        await q.updateTable('app.price_groups').set({ is_default: false }).where('business_id', '=', businessId).execute();
      }
      return q
        .insertInto('app.price_groups')
        .values({ id: newId(), business_id: businessId, name: data.name, is_default: data.isDefault, updatedAt: new Date() })
        .returning(['id', 'name', 'is_default'])
        .executeTakeFirstOrThrow();
    });
    return { id: row.id, name: row.name, isDefault: row.is_default, customerCount: 0 };
  }

  async deletePriceGroup(businessId: string, id: string): Promise<boolean> {
    const r = await this.db.q
      .deleteFrom('app.price_groups')
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  // ─── listings ──────────────────────────────────────────────────────────────

  async findProduct(businessId: string, productId: string): Promise<ProductForListing | null> {
    const p = await this.db.q
      .selectFrom('app.products')
      .select(['id', 'name', 'sale', 'vat', 'unit'])
      .where('id', '=', productId)
      .where('business_id', '=', businessId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return p ? { ...p, sale: Number(p.sale) } : null;
  }

  listListings(businessId: string): Promise<ListingRow[]> {
    return loadListings(this.db.q, businessId, {});
  }

  async findListing(businessId: string, id: string): Promise<ListingRow | null> {
    return (await loadListings(this.db.q, businessId, { id }))[0] ?? null;
  }

  async findListingByProduct(businessId: string, productId: string): Promise<ListingRow | null> {
    return (await loadListings(this.db.q, businessId, { productId }))[0] ?? null;
  }

  async createListing(data: ListingCreateData): Promise<ListingRow> {
    return this.db.tx(async (q) => {
      const id = newId();
      await q
        .insertInto('app.listings')
        .values({
          id,
          business_id: data.businessId,
          product_id: data.productId,
          title: data.title,
          description: data.description,
          unit_price: data.unitPrice,
          vat: data.vat,
          unit: data.unit as AppUnit,
          min_order_qty: data.minOrderQty,
          active: data.active,
          updatedAt: new Date(),
        })
        .execute();
      await this.insertTiers(q, data.businessId, id, data.tiers);
      return (await loadListings(q, data.businessId, { id }))[0] as ListingRow;
    });
  }

  private async insertTiers(q: Kysely<DB>, businessId: string, listingId: string, tiers: Tier[]): Promise<void> {
    if (tiers.length === 0) return;
    await q
      .insertInto('app.listing_tiers')
      .values(
        tiers.map((t) => ({
          id: newId(),
          business_id: businessId,
          listing_id: listingId,
          price_group_id: t.priceGroupId,
          min_qty: t.minQty,
          unit_price: t.unitPrice,
        })),
      )
      .execute();
  }

  async updateListing(
    businessId: string,
    id: string,
    data: Partial<Omit<ListingCreateData, 'businessId' | 'productId'>>,
  ): Promise<ListingRow | null> {
    if (!(await this.findListing(businessId, id))) return null;
    const { tiers, ...rest } = data;
    return this.db.tx(async (q) => {
      if (tiers) {
        await q.deleteFrom('app.listing_tiers').where('listing_id', '=', id).execute();
        await this.insertTiers(q, businessId, id, tiers);
      }
      await q
        .updateTable('app.listings')
        .set({ ...listingCols(rest), updatedAt: new Date() })
        .where('id', '=', id)
        .where('business_id', '=', businessId)
        .execute();
      return (await loadListings(q, businessId, { id }))[0] as ListingRow;
    });
  }

  async deleteListing(businessId: string, id: string): Promise<boolean> {
    const r = await this.db.q
      .deleteFrom('app.listings')
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  /** Seller-side lookup executed from inside the buyer's request: cross-tenant read (D-030). */
  async findBuyerPriceGroup(sellerBusinessId: string, buyerBusinessId: string): Promise<string | null> {
    const row = await this.db.admin
      .selectFrom('app.customers')
      .select('price_group_id')
      .where('business_id', '=', sellerBusinessId)
      .where('buyer_business_id', '=', buyerBusinessId)
      .executeTakeFirst();
    return row?.price_group_id ?? null;
  }

  // ─── catalog ───────────────────────────────────────────────────────────────

  private async priceGroupsFor(buyerBusinessId: string, sellerIds: string[]): Promise<Map<string, string | null>> {
    if (sellerIds.length === 0) return new Map();
    // Customer rows belong to the sellers, not the buyer (D-030).
    const rows = await this.db.admin
      .selectFrom('app.customers')
      .select(['business_id', 'price_group_id'])
      .where('buyer_business_id', '=', buyerBusinessId)
      .where('business_id', 'in', sellerIds)
      .execute();
    return new Map(rows.map((r) => [r.business_id, r.price_group_id]));
  }

  async catalog(params: CatalogParams): Promise<CatalogResult> {
    const base = () => {
      let qb = this.db.admin
        .selectFrom('app.listings as l')
        .innerJoin('app.businesses as b', 'b.id', 'l.business_id')
        .where('l.active', '=', true)
        .where('l.business_id', '<>', params.buyerBusinessId)
        // A seller who is suspended, expired or has switched the module off
        // cannot act on an order, so its listings must not be orderable either.
        .where(sellableSeller('b'));
      if (params.sellerId) qb = qb.where('l.business_id', '=', params.sellerId);
      if (params.q) {
        const like = `%${escapeLike(params.q)}%`;
        qb = qb.where((eb) => eb.or([eb('l.title', 'ilike', like), eb('l.description', 'ilike', like)]));
      }
      return qb;
    };

    const [rows, total] = await Promise.all([
      base()
        .select([
          'l.id',
          'l.business_id',
          'l.product_id',
          'l.title',
          'l.description',
          'l.unit_price',
          'l.vat',
          'l.unit',
          'l.min_order_qty',
          'b.name as seller_name',
          'b.city as seller_city',
          sql<string>`(select coalesce(sum(sl.qty), 0) from app.stock_levels sl where sl."productId" = l.product_id)`.as('stock'),
        ])
        .orderBy('l.createdAt', 'desc')
        .offset((params.page - 1) * params.pageSize)
        .limit(params.pageSize)
        .execute(),
      base()
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
        .then((r) => Number(r.n)),
    ]);

    const [groups, tiers] = await Promise.all([
      this.priceGroupsFor(params.buyerBusinessId, [...new Set(rows.map((r) => r.business_id))]),
      tiersOf(this.db.admin, rows.map((r) => r.id)),
    ]);

    const items: CatalogRow[] = rows.map((r) => {
      const t: Tier[] = (tiers.get(r.id) ?? []).map((x) => ({
        priceGroupId: x.price_group_id,
        minQty: x.min_qty,
        unitPrice: Number(x.unit_price),
      }));
      const listPrice = Number(r.unit_price);
      return {
        id: r.id,
        sellerId: r.business_id,
        sellerName: r.seller_name,
        sellerCity: r.seller_city,
        productId: r.product_id,
        title: r.title,
        description: r.description,
        unit: r.unit,
        vat: r.vat,
        minOrderQty: r.min_order_qty,
        listPrice,
        yourPrice: resolveUnitPrice(listPrice, t, groups.get(r.business_id) ?? null, params.qty),
        inStock: Number(r.stock) > 0,
      };
    });

    return { items, total, page: params.page, pageSize: params.pageSize };
  }

  async listSellers(
    buyerBusinessId: string,
  ): Promise<{ id: string; name: string; city: string | null; listings: number }[]> {
    const rows = await this.db.admin
      .selectFrom('app.businesses as b')
      .select([
        'b.id',
        'b.name',
        'b.city',
        sql<string>`(select count(*) from app.listings l where l.business_id = b.id and l.active)`.as('listings'),
      ])
      .where('b.id', '<>', buyerBusinessId)
      .where(sellableSeller('b'))
      .where(sql<boolean>`exists (select 1 from app.listings l where l.business_id = b.id and l.active)`)
      .orderBy('b.name')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, city: r.city, listings: Number(r.listings) }));
  }
}
