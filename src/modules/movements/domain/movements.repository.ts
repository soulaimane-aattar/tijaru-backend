/**
 * Port: persistence contract for the stock-movements business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export type MovementType = 'in' | 'out' | 'transfer';

export type MovementReason =
  | 'achat'
  | 'vente'
  | 'transfert'
  | 'peremption'
  | 'ajustement'
  | 'casse';

export interface MovementSearchCriteria {
  type?: MovementType | undefined;
  productId?: string | undefined;
  /** Matches movements where the warehouse is either source or destination. */
  warehouseId?: string | undefined;
  userId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  skip: number;
  take: number;
}

export interface ProductRef {
  id: string;
  name: string;
}

/** Signed quantity change to apply to one warehouse's stock level. */
export interface StockDelta {
  warehouseId: string;
  delta: number;
}

export interface MovementRecordData {
  type: MovementType;
  productId: string;
  qty: number;
  warehouseId: string;
  toWarehouseId?: string | undefined;
  userId: string;
  date?: Date | undefined;
  reason: MovementReason;
  ref?: string | undefined;
  batch?: string | undefined;
  expiry?: Date | undefined;
}

export interface ActivityLog {
  userId: string;
  action: string;
  desc: string;
  device?: string | undefined;
}

export abstract class MovementsRepository {
  /** One page of movements (relations included), newest first. */
  abstract findPage(
    criteria: MovementSearchCriteria,
  ): Promise<{ items: unknown[]; total: number }>;

  /** Identity of a non-deleted product, or null. */
  abstract findProductRef(id: string): Promise<ProductRef | null>;

  /** True when a non-deleted warehouse with this id exists. */
  abstract warehouseExists(id: string): Promise<boolean>;

  /** Current quantity at the warehouse (0 when no stock level exists). */
  abstract getStockQty(productId: string, warehouseId: string): Promise<number>;

  /**
   * Apply the stock deltas, record the movement and the activity — all in a
   * single atomic write. Returns the created movement.
   */
  abstract executeStockMovement(
    deltas: StockDelta[],
    movement: MovementRecordData,
    activity: ActivityLog,
  ): Promise<unknown>;
}
