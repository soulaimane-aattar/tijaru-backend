/**
 * Port: persistence contract for the inventory business logic.
 *
 * The application service depends on this abstraction only; the Prisma
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

export interface StockAdjustment {
  productId: string;
  /** Final counted quantity the stock level is overwritten to. */
  counted: number;
  /** `counted - expected`; the sign selects the movement direction. */
  diff: number;
}

export interface LineCorrection {
  lineId: string;
  counted: number;
}

export interface ApplyCountData {
  countId: string;
  warehouseId: string;
  /** Movement ref shared by every adjustment movement. */
  movementRef: string;
  adjustments: StockAdjustment[];
  corrections: LineCorrection[];
  actorId: string;
  actorDevice?: string | undefined;
  activityDesc: string;
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
   * Atomically emit an adjustment movement and overwrite the stock level for
   * each adjustment, persist line corrections, stamp `appliedAt` and log the
   * activity entry. Returns the refreshed count with lines.
   */
  abstract applyCount(data: ApplyCountData): Promise<unknown>;
}
