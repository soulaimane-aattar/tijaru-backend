/**
 * Port: persistence contract for the inventory business logic.
 *
 * The application service depends on this abstraction only; the Kysely
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export interface StockSnapshotLine {
  productId: string;
  qty: number;
}

export interface CountLineInput {
  productId: string;
  expected: number;
  counted: number;
}

/** Minimal shape the apply business rules read. */
export interface CountLineView {
  id: string;
  productId: string;
  expected: number;
  counted: number;
}

export interface InventoryCountView {
  id: string;
  warehouseId: string;
  appliedAt: Date | null;
  lines: CountLineView[];
}

export interface ActivityLog {
  userId: string;
  action: string;
  desc: string;
  device?: string | undefined;
}

export abstract class InventoryRepository {
  /** All counts with warehouse summary and line counts, newest first. */
  abstract findAll(): Promise<unknown[]>;

  /** Full detail payload (warehouse and lines included) or null. */
  abstract findDetail(id: string): Promise<unknown | null>;

  /** True when a non-deleted warehouse exists with this id. */
  abstract warehouseExists(id: string): Promise<boolean>;

  /** Stock levels of non-deleted products at the warehouse. */
  abstract findActiveStockLevels(warehouseId: string): Promise<StockSnapshotLine[]>;

  abstract createCount(
    warehouseId: string,
    lines: CountLineInput[],
    notes?: string | undefined,
  ): Promise<unknown>;

  abstract findWithLines(id: string): Promise<InventoryCountView | null>;

  /**
   * Live stock quantities for the given products at the warehouse, read
   * inside the caller's `db.tx` so the apply delta reflects concurrent
   * sales/movements rather than the count's original snapshot.
   */
  abstract findLiveStockLevels(
    warehouseId: string,
    productIds: string[],
  ): Promise<StockSnapshotLine[]>;

  /** Persist a user-corrected counted value for a single count line. */
  abstract updateLineCounted(lineId: string, counted: number): Promise<void>;

  /** Stamp the count as applied (sets `appliedAt`). */
  abstract markApplied(countId: string): Promise<void>;

  /** Record an audit-trail entry. Joins the ambient transaction. */
  abstract logActivity(activity: ActivityLog): Promise<void>;
}
