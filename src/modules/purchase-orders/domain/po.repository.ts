/**
 * Port: persistence contract for the purchase-orders business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

import type { Prisma } from '@prisma/client';

export type POStatus = 'draft' | 'sent' | 'partiallyReceived' | 'received' | 'cancelled';

export interface POListFilters {
  status?: POStatus | undefined;
  supplierId?: string | undefined;
  warehouseId?: string | undefined;
}

export interface CreatePOLineData {
  productId: string;
  qty: number;
  price: number;
  vat: number;
}

export interface CreatePOData {
  number: string;
  supplierId: string;
  warehouseId: string;
  status: 'draft' | 'sent';
  notes?: string | undefined;
  lines: CreatePOLineData[];
}

export type PatchPOData = {
  status?: 'draft' | 'sent' | 'cancelled' | undefined;
  notes?: string | undefined;
};

/** Minimal shape the receive business rules read. */
export interface POLineView {
  id: string;
  productId: string;
  qty: number;
  received: number;
  /** Unit purchase price — becomes `unitCost` on the ledger line (drives WAC). */
  price: number;
}

export interface POView {
  id: string;
  number: string;
  status: POStatus;
  warehouseId: string;
  lines: POLineView[];
}

export interface ActivityLog {
  userId: string;
  action: string;
  desc: string;
  device?: string | undefined;
}

/** Aggregate totals used to recompute PO status after a receipt. */
export interface POLineTotals {
  qty: number;
  received: number;
}

export abstract class PurchaseOrdersRepository {
  /** All POs matching filters (supplier/warehouse summaries included), newest first. */
  abstract findAll(filters: POListFilters): Promise<unknown[]>;

  /** Full detail payload (relations included) or null. */
  abstract findDetail(id: string): Promise<unknown | null>;

  /** Highest PO number starting with `prefix`, or null when none exists. */
  abstract findLastNumber(prefix: string): Promise<string | null>;

  abstract create(data: CreatePOData): Promise<unknown>;

  abstract findStatus(id: string): Promise<POStatus | null>;

  abstract update(id: string, data: PatchPOData): Promise<unknown>;

  abstract delete(id: string): Promise<void>;

  abstract findWithLines(id: string): Promise<POView | null>;

  /** Increment a single line's received qty. Part of the caller's transaction. */
  abstract incrementLineReceived(
    lineId: string,
    qty: number,
    tx: Prisma.TransactionClient,
  ): Promise<void>;

  /**
   * Fresh per-line (qty, received) totals read inside the caller's
   * transaction, used to recompute PO status after a receipt.
   */
  abstract findLineTotals(poId: string, tx: Prisma.TransactionClient): Promise<POLineTotals[]>;

  /** Persist the recomputed PO status. Part of the caller's transaction. */
  abstract updateStatus(
    poId: string,
    status: POStatus,
    tx: Prisma.TransactionClient,
  ): Promise<void>;

  /** Record an audit-trail entry. Part of the caller's transaction. */
  abstract logActivity(activity: ActivityLog, tx: Prisma.TransactionClient): Promise<void>;
}
