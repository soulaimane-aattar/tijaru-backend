/**
 * Port: persistence contract for the products business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */
import type { Prisma } from '@prisma/client';

export interface ActivityLog {
  userId: string;
  action: string;
  desc: string;
  device?: string | undefined;
}

/** Minimal shape the stock business rules read. Adapters may return richer rows. */
export interface ProductStockView {
  id: string;
  minStock: number;
  stockLevels: { warehouseId: string; qty: number }[];
}

/** Fields the duplicate rule needs to derive the copy's identity. */
export interface ProductIdentity {
  id: string;
  name: string;
  sku: string;
  barcode: string;
}

export interface ProductSearchCriteria {
  search?: string | undefined;
  categoryId?: string | undefined;
  supplierId?: string | undefined;
  /** Products tracking expiry with `now <= expiry <= expiringBefore`. */
  expiringBefore?: Date | undefined;
  sort: string;
  order: 'asc' | 'desc';
}

export interface StockLevelInput {
  warehouseId: string;
  qty: number;
}

export interface CreateProductData {
  name: string;
  barcode: string;
  sku: string;
  categoryId: string;
  purchase: number;
  sale: number;
  vat: number;
  unit: string;
  supplierId?: string | undefined;
  trackExpiry: boolean;
  expiry?: Date | undefined;
  batch?: string | undefined;
  minStock: number;
  maxStock: number;
  notes?: string | undefined;
  tone: string;
  stock: StockLevelInput[];
}

export type UpdateProductData = {
  [K in keyof Omit<CreateProductData, 'stock'>]?: CreateProductData[K] | undefined;
};

export abstract class ProductsRepository {
  /** All non-deleted products matching criteria (stock filters are business logic, applied by the service). */
  abstract findAllMatching(
    criteria: ProductSearchCriteria,
  ): Promise<{ items: (ProductStockView & ProductIdentity)[]; total: number }>;

  /** Full detail payload (relations included) or null. */
  abstract findDetail(id: string): Promise<unknown | null>;

  /** Full detail payload (relations included) by barcode, tenant-scoped, or null. */
  abstract findByBarcode(code: string): Promise<unknown | null>;

  /** Identity fields of a non-deleted product, or null. */
  abstract findIdentity(id: string): Promise<ProductIdentity | null>;

  /** True when another non-deleted product already uses the barcode or SKU. */
  abstract hasBarcodeOrSkuConflict(
    barcode: string | undefined,
    sku: string | undefined,
    excludeId?: string,
  ): Promise<boolean>;

  abstract create(data: CreateProductData): Promise<unknown>;

  abstract update(id: string, data: UpdateProductData): Promise<unknown>;

  abstract softDelete(id: string): Promise<void>;

  /** True when a non-deleted warehouse with this id exists (tenant-scoped). */
  abstract warehouseExists(id: string): Promise<boolean>;

  abstract logActivity(activity: ActivityLog, tx?: Prisma.TransactionClient): Promise<void>;

  /** Copy every field of `sourceId` into a new product, overriding identity fields. */
  abstract duplicateFrom(
    sourceId: string,
    identity: { name: string; sku: string; barcode: string },
  ): Promise<unknown>;

  /** Storage path of the product image, or null when unset. Tenant-scoped, null if missing. */
  abstract findImagePath(id: string): Promise<string | null>;

  /** Persist a new image path and return the previous one (for cleanup). */
  abstract setImagePath(id: string, path: string): Promise<string | null>;

  /** Unset the image path and return the previous one (for cleanup). */
  abstract clearImagePath(id: string): Promise<string | null>;
}
