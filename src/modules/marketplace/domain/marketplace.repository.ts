import type { Tier } from './pricing';

export interface PriceGroupRow {
  id: string;
  name: string;
  isDefault: boolean;
  customerCount: number;
}

export interface ListingRow {
  id: string;
  productId: string;
  title: string;
  description: string | null;
  unitPrice: number;
  vat: number;
  unit: string;
  minOrderQty: number;
  active: boolean;
  tiers: (Tier & { id: string })[];
}

export interface CatalogRow {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerCity: string | null;
  productId: string;
  title: string;
  description: string | null;
  unit: string;
  vat: number;
  minOrderQty: number;
  /** Public price before tiers. */
  listPrice: number;
  /** Price for the asking buyer at the requested quantity. */
  yourPrice: number;
  inStock: boolean;
}

export interface CatalogParams {
  buyerBusinessId: string;
  q?: string;
  sellerId?: string;
  qty: number;
  page: number;
  pageSize: number;
}

export interface CatalogResult {
  items: CatalogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListingCreateData {
  businessId: string;
  productId: string;
  title: string;
  description: string | null;
  unitPrice: number;
  vat: number;
  unit: string;
  minOrderQty: number;
  active: boolean;
  tiers: Tier[];
}

export interface ProductForListing {
  id: string;
  name: string;
  sale: number;
  vat: number;
  unit: string;
}

export abstract class MarketplaceRepository {
  // price groups
  abstract listPriceGroups(businessId: string): Promise<PriceGroupRow[]>;
  abstract createPriceGroup(
    businessId: string,
    data: { name: string; isDefault: boolean },
  ): Promise<PriceGroupRow>;
  abstract deletePriceGroup(businessId: string, id: string): Promise<boolean>;

  // listings (seller side)
  abstract findProduct(businessId: string, productId: string): Promise<ProductForListing | null>;
  abstract listListings(businessId: string): Promise<ListingRow[]>;
  abstract findListing(businessId: string, id: string): Promise<ListingRow | null>;
  abstract findListingByProduct(businessId: string, productId: string): Promise<ListingRow | null>;
  abstract createListing(data: ListingCreateData): Promise<ListingRow>;
  abstract updateListing(
    businessId: string,
    id: string,
    data: Partial<Omit<ListingCreateData, 'businessId' | 'productId'>>,
  ): Promise<ListingRow | null>;
  abstract deleteListing(businessId: string, id: string): Promise<boolean>;

  /** Price group assigned to `buyerBusinessId` by `sellerBusinessId`, if any. */
  abstract findBuyerPriceGroup(
    sellerBusinessId: string,
    buyerBusinessId: string,
  ): Promise<string | null>;

  // catalog (buyer side, cross-tenant)
  abstract catalog(params: CatalogParams): Promise<CatalogResult>;
  abstract listSellers(
    buyerBusinessId: string,
  ): Promise<{ id: string; name: string; city: string | null; listings: number }[]>;
}
