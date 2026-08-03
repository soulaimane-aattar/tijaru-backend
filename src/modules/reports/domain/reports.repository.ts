/**
 * Port: persistence contract for the reports business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 *
 * Repository methods return raw aggregates; thresholds, grouping and shaping
 * are business rules applied by the service.
 */

/** Minimal shape the stock threshold rules read. Adapters return richer rows. */
export type ProductStockRow = {
  minStock: number;
  stockLevels: { qty: number }[];
} & Record<string, unknown>;

export interface StockValueRow {
  warehouseId: string;
  warehouseName: string;
  warehouseCity: string;
  qty: number;
  /** Unit purchase price (HT), already converted from Decimal. */
  purchase: number;
}

export interface OutboundMovementRow {
  productId: string;
  qty: number;
  product: { id: string; name: string; sku: string; tone: string };
}

export abstract class ReportsRepository {
  /** Non-deleted products with stock levels and category summary. */
  abstract findActiveProductsWithStock(): Promise<ProductStockRow[]>;

  /** Products tracking expiry with `now <= expiry <= horizon`, soonest first. */
  abstract findExpiring(horizon: Date): Promise<unknown[]>;

  /** One row per stock level of a non-deleted product. */
  abstract findStockValueRows(): Promise<StockValueRow[]>;

  /** Outbound movements since the given date, with product summary. */
  abstract findOutboundSince(since: Date): Promise<OutboundMovementRow[]>;
}
