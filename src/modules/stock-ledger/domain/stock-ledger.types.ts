import type { MovementReason, MovementType } from '@prisma/client';

export type LedgerLine = {
  productId: string;
  warehouseId: string;
  /**
   * Signed quantity delta.
   *   - Positive (`+n`) → stock increment on `warehouseId`.
   *   - Negative (`-n`) → stock decrement on `warehouseId`.
   *   - For `type: 'transfer'`, `delta` MUST be negative (representing the outflow from source);
   *     the ledger flips sign to credit `toWarehouseId`. A positive delta on a transfer
   *     would silently invert source and destination.
   */
  delta: number;
  unitCost?: number; // optional, for WAC on positive deltas
  batch?: string | null;
  expiry?: Date | null;
};

export type LedgerPost = {
  businessId: string;
  userId: string;
  type: MovementType;
  reason: MovementReason;
  ref?: string | null;
  date?: Date;
  lines: LedgerLine[];
  toWarehouseId?: string; // required when type === 'transfer'
};
