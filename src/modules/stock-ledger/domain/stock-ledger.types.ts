import type { MovementReason, MovementType } from '@prisma/client';

export type LedgerLine = {
  productId: string;
  warehouseId: string;
  delta: number; // +in, -out
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
