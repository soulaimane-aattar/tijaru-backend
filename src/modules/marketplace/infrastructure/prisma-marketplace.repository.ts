import { Injectable } from '@nestjs/common';
import { Prisma, type Unit } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { TenantContext } from '../../../common/tenant/tenant-context';
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

import { SELLABLE_SELLER } from './sellable-seller';

const dec = (n: number | Prisma.Decimal): number =>
  typeof n === 'number' ? n : Number(n.toString());

const LISTING_INCLUDE = { tiers: true } as const;

const CATALOG_INCLUDE = {
  tiers: true,
  business: { select: { id: true, name: true, city: true } },
  product: { select: { stockLevels: { select: { qty: true } } } },
} as const;

type ListingWithTiers = Prisma.ListingGetPayload<{ include: typeof LISTING_INCLUDE }>;
type CatalogListing = Prisma.ListingGetPayload<{ include: typeof CATALOG_INCLUDE }>;

function toListingRow(l: ListingWithTiers): ListingRow {
  return {
    id: l.id,
    productId: l.productId,
    title: l.title,
    description: l.description,
    unitPrice: dec(l.unitPrice),
    vat: l.vat,
    unit: l.unit,
    minOrderQty: l.minOrderQty,
    active: l.active,
    tiers: l.tiers.map((t) => ({
      id: t.id,
      priceGroupId: t.priceGroupId,
      minQty: t.minQty,
      unitPrice: dec(t.unitPrice),
    })),
  };
}

function toCatalogRow(l: CatalogListing, priceGroupId: string | null, qty: number): CatalogRow {
  const tiers: Tier[] = l.tiers.map((t) => ({
    priceGroupId: t.priceGroupId,
    minQty: t.minQty,
    unitPrice: dec(t.unitPrice),
  }));
  const listPrice = dec(l.unitPrice);
  return {
    id: l.id,
    sellerId: l.business.id,
    sellerName: l.business.name,
    sellerCity: l.business.city,
    productId: l.productId,
    title: l.title,
    description: l.description,
    unit: l.unit,
    vat: l.vat,
    minOrderQty: l.minOrderQty,
    listPrice,
    yourPrice: resolveUnitPrice(listPrice, tiers, priceGroupId, qty),
    inStock: l.product.stockLevels.reduce((s, sl) => s + sl.qty, 0) > 0,
  };
}

@Injectable()
export class PrismaMarketplaceRepository extends MarketplaceRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {
    super();
  }

  // ─── price groups ──────────────────────────────────────────────────────────

  async listPriceGroups(businessId: string): Promise<PriceGroupRow[]> {
    const rows = await this.prisma.priceGroup.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { customers: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isDefault: r.isDefault,
      customerCount: r._count.customers,
    }));
  }

  async createPriceGroup(
    businessId: string,
    data: { name: string; isDefault: boolean },
  ): Promise<PriceGroupRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.priceGroup.updateMany({ where: { businessId }, data: { isDefault: false } });
      }
      return tx.priceGroup.create({ data: { businessId, ...data } });
    });
    return { id: row.id, name: row.name, isDefault: row.isDefault, customerCount: 0 };
  }

  async deletePriceGroup(businessId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.priceGroup.deleteMany({ where: { id, businessId } });
    return count > 0;
  }

  // ─── listings ──────────────────────────────────────────────────────────────

  async findProduct(businessId: string, productId: string): Promise<ProductForListing | null> {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      select: { id: true, name: true, sale: true, vat: true, unit: true },
    });
    return p ? { ...p, sale: dec(p.sale) } : null;
  }

  async listListings(businessId: string): Promise<ListingRow[]> {
    const rows = await this.prisma.listing.findMany({
      where: { businessId },
      include: LISTING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toListingRow);
  }

  async findListing(businessId: string, id: string): Promise<ListingRow | null> {
    const row = await this.prisma.listing.findFirst({
      where: { id, businessId },
      include: LISTING_INCLUDE,
    });
    return row ? toListingRow(row) : null;
  }

  async findListingByProduct(businessId: string, productId: string): Promise<ListingRow | null> {
    const row = await this.prisma.listing.findFirst({
      where: { productId, businessId },
      include: LISTING_INCLUDE,
    });
    return row ? toListingRow(row) : null;
  }

  async createListing(data: ListingCreateData): Promise<ListingRow> {
    const { tiers, unit, ...rest } = data;
    const row = await this.prisma.listing.create({
      data: { ...rest, unit: unit as Unit, tiers: { create: tiers } },
      include: LISTING_INCLUDE,
    });
    return toListingRow(row);
  }

  async updateListing(
    businessId: string,
    id: string,
    data: Partial<Omit<ListingCreateData, 'businessId' | 'productId'>>,
  ): Promise<ListingRow | null> {
    const existing = await this.prisma.listing.findFirst({ where: { id, businessId } });
    if (!existing) return null;

    const { tiers, unit, ...rest } = data;
    const row: ListingWithTiers = await this.prisma.$transaction(async (tx) => {
      if (tiers) {
        await tx.listingTier.deleteMany({ where: { listingId: id } });
        await tx.listingTier.createMany({ data: tiers.map((t) => ({ ...t, listingId: id })) });
      }
      return tx.listing.update({
        where: { id },
        data: { ...rest, ...(unit === undefined ? {} : { unit: unit as Unit }) },
        include: LISTING_INCLUDE,
      });
    });
    return toListingRow(row);
  }

  async deleteListing(businessId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.listing.deleteMany({ where: { id, businessId } });
    return count > 0;
  }

  /**
   * Seller-side lookup executed from inside the buyer's request. `Customer` is a
   * TENANT_MODEL, so the middleware would otherwise force the buyer's own
   * businessId onto the query — run it in the seller's ALS scope (D-030).
   */
  async findBuyerPriceGroup(
    sellerBusinessId: string,
    buyerBusinessId: string,
  ): Promise<string | null> {
    // The `await` must happen INSIDE the scope: Prisma promises are lazy, so a
    // returned-but-unawaited query would dispatch after the scope is gone.
    const row = await this.tenant.run(sellerBusinessId, async () =>
      this.prisma.customer.findFirst({
        where: { businessId: sellerBusinessId, buyerBusinessId },
        select: { priceGroupId: true },
      }),
    );
    return row?.priceGroupId ?? null;
  }

  // ─── catalog ───────────────────────────────────────────────────────────────

  private async priceGroupsFor(
    buyerBusinessId: string,
    sellerIds: string[],
  ): Promise<Map<string, string | null>> {
    if (sellerIds.length === 0) return new Map();
    // Customer rows belong to the sellers, not the buyer — bypass the tenant
    // middleware by reading outside any tenant scope (D-030).
    // `async` matters: Prisma promises are lazy, and an unawaited one would
    // dispatch once the scope is restored — back under the buyer's businessId.
    const rows = await this.tenant.runUnscoped(async () =>
      this.prisma.customer.findMany({
        where: { buyerBusinessId, businessId: { in: sellerIds } },
        select: { businessId: true, priceGroupId: true },
      }),
    );
    return new Map(rows.map((r) => [r.businessId, r.priceGroupId]));
  }

  async catalog(params: CatalogParams): Promise<CatalogResult> {
    const where: Prisma.ListingWhereInput = {
      active: true,
      businessId: params.sellerId
        ? { equals: params.sellerId, not: params.buyerBusinessId }
        : { not: params.buyerBusinessId },
      // A seller who is suspended, expired or has switched the module off
      // cannot act on an order, so its listings must not be orderable either.
      business: SELLABLE_SELLER,
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: 'insensitive' } },
              { description: { contains: params.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: CATALOG_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.listing.count({ where }),
    ]);

    const groups = await this.priceGroupsFor(
      params.buyerBusinessId,
      [...new Set(rows.map((r) => r.businessId))],
    );

    return {
      items: rows.map((r) => toCatalogRow(r, groups.get(r.businessId) ?? null, params.qty)),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async listSellers(
    buyerBusinessId: string,
  ): Promise<{ id: string; name: string; city: string | null; listings: number }[]> {
    const rows = await this.prisma.business.findMany({
      where: { listings: { some: { active: true } }, id: { not: buyerBusinessId }, ...SELLABLE_SELLER },
      select: {
        id: true,
        name: true,
        city: true,
        _count: { select: { listings: { where: { active: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      listings: r._count.listings,
    }));
  }
}
