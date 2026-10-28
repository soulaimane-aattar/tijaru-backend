/**
 * Port: persistence contract for the purchase-orders business logic.
 *
 * The application service depends on this abstraction only; the Kysely
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

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
  supplierId?: string | undefined;
  warehouseId?: string | undefined;
  /** Full replacement of the line set (draft POs only — enforced by the service). */
  lines?: CreatePOLineData[] | undefined;
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

  /** Increment a single line's received qty. Joins the ambient transaction. */
  abstract incrementLineReceived(lineId: string, qty: number): Promise<void>;

  /**
   * Fresh per-line (qty, received) totals read inside the caller's
   * transaction, used to recompute PO status after a receipt.
   */
  abstract findLineTotals(poId: string): Promise<POLineTotals[]>;

  /** Persist the recomputed PO status. Joins the ambient transaction. */
  abstract updateStatus(poId: string, status: POStatus): Promise<void>;

  /** Record an audit-trail entry. Joins the ambient transaction. */
  abstract logActivity(activity: ActivityLog): Promise<void>;
}
