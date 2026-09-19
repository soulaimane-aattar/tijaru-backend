import { Injectable } from '@nestjs/common';

import { ConflictError, DomainError, NotFoundError } from '../../../common/errors';
import type {
  CatalogResult,
  CatalogRow,
  ListingRow,
  PriceGroupRow,
} from '../domain/marketplace.repository';
import { MarketplaceRepository } from '../domain/marketplace.repository';
import type { Tier } from '../domain/pricing';
import type {
  CatalogQuery,
  CreateListingInput,
  PriceGroupInput,
  TierInput,
  UpdateListingInput,
  UpdatePriceGroupInput,
} from '../dto/marketplace.dto';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Reject ladders with duplicate steps or a tier pointing at a foreign group. */
function validateTiers(tiers: TierInput[], ownGroupIds: Set<string>): Tier[] {
  const seen = new Set<string>();
  return tiers.map((t) => {
    const key = `${t.priceGroupId ?? ''}:${t.minQty}`;
    if (seen.has(key)) {
      throw new DomainError('duplicate_tier', `Duplicate tier at qty ${t.minQty}`, 422);
    }
    seen.add(key);
    if (t.priceGroupId && !ownGroupIds.has(t.priceGroupId)) {
      throw new NotFoundError('PriceGroup', t.priceGroupId);
    }
    return { priceGroupId: t.priceGroupId, minQty: t.minQty, unitPrice: round2(t.unitPrice) };
  });
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly repo: MarketplaceRepository) {}

  // ─── price groups ──────────────────────────────────────────────────────────

  listPriceGroups(businessId: string): Promise<PriceGroupRow[]> {
    return this.repo.listPriceGroups(businessId);
  }

  createPriceGroup(businessId: string, input: PriceGroupInput): Promise<PriceGroupRow> {
    return this.repo.createPriceGroup(businessId, input);
  }

  async updatePriceGroup(
    businessId: string,
    id: string,
    input: UpdatePriceGroupInput,
  ): Promise<PriceGroupRow> {
    const row = await this.repo.updatePriceGroup(businessId, id, input);
    if (!row) throw new NotFoundError('PriceGroup', id);
    return row;
  }

  async deletePriceGroup(businessId: string, id: string): Promise<void> {
    const ok = await this.repo.deletePriceGroup(businessId, id);
    if (!ok) throw new NotFoundError('PriceGroup', id);
  }

  // ─── listings ──────────────────────────────────────────────────────────────

  listListings(businessId: string): Promise<ListingRow[]> {
    return this.repo.listListings(businessId);
  }

  async getListing(businessId: string, id: string): Promise<ListingRow> {
    const row = await this.repo.findListing(businessId, id);
    if (!row) throw new NotFoundError('Listing', id);
    return row;
  }

  async createListing(businessId: string, input: CreateListingInput): Promise<ListingRow> {
    const product = await this.repo.findProduct(businessId, input.productId);
    if (!product) throw new NotFoundError('Product', input.productId);

    const already = await this.repo.findListingByProduct(businessId, input.productId);
    if (already) throw new ConflictError('Product is already listed');

    const groupIds = new Set((await this.repo.listPriceGroups(businessId)).map((g) => g.id));

    return this.repo.createListing({
      businessId,
      productId: product.id,
      title: input.title ?? product.name,
      description: input.description ?? null,
      unitPrice: round2(input.unitPrice ?? product.sale),
      vat: input.vat ?? product.vat,
      unit: product.unit,
      minOrderQty: input.minOrderQty,
      active: input.active,
      tiers: validateTiers(input.tiers, groupIds),
    });
  }

  async updateListing(
    businessId: string,
    id: string,
    input: UpdateListingInput,
  ): Promise<ListingRow> {
    await this.getListing(businessId, id);

    const data: Parameters<MarketplaceRepository['updateListing']>[2] = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.unitPrice !== undefined) data.unitPrice = round2(input.unitPrice);
    if (input.vat !== undefined) data.vat = input.vat;
    if (input.minOrderQty !== undefined) data.minOrderQty = input.minOrderQty;
    if (input.active !== undefined) data.active = input.active;
    if (input.tiers !== undefined) {
      const groupIds = new Set((await this.repo.listPriceGroups(businessId)).map((g) => g.id));
      data.tiers = validateTiers(input.tiers, groupIds);
    }

    const row = await this.repo.updateListing(businessId, id, data);
    if (!row) throw new NotFoundError('Listing', id);
    return row;
  }

  async replaceTiers(businessId: string, id: string, tiers: TierInput[]): Promise<ListingRow> {
    return this.updateListing(businessId, id, { tiers });
  }

  async deleteListing(businessId: string, id: string): Promise<void> {
    const ok = await this.repo.deleteListing(businessId, id);
    if (!ok) throw new NotFoundError('Listing', id);
  }

  // ─── catalog (buyer) ───────────────────────────────────────────────────────

  catalog(buyerBusinessId: string, query: CatalogQuery): Promise<CatalogResult> {
    return this.repo.catalog({
      buyerBusinessId,
      ...(query.q ? { q: query.q } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      qty: query.qty,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async catalogItem(buyerBusinessId: string, id: string): Promise<CatalogRow> {
    const row = await this.repo.findCatalogListing(id, buyerBusinessId);
    if (!row) throw new NotFoundError('Listing', id);
    return row;
  }

  listSellers(
    buyerBusinessId: string,
  ): Promise<{ id: string; name: string; city: string | null; listings: number }[]> {
    return this.repo.listSellers(buyerBusinessId);
  }
}
