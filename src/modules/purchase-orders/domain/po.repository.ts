/**
 * Port: persistence contract for the purchase-orders business logic.
 *
 * The application service depends on this abstraction only; the Prisma
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
};

/** Minimal shape the receive business rules read. */
export interface POLineView {
  id: string;
  productId: string;
  qty: number;
  received: number;
}

export interface POView {
  id: string;
  number: string;
  status: POStatus;
  warehouseId: string;
  lines: POLineView[];
}

export interface ReceiptLine {
  lineId: string;
  productId: string;
  qty: number;
}

export interface ReceivePOData {
  poId: string;
  warehouseId: string;
  /** Movement ref shared by every receipt movement (the PO number). */
  movementRef: string;
  receipts: ReceiptLine[];
  actorId: string;
  actorDevice?: string | undefined;
  activityDesc: string;
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

  /**
   * Atomically apply validated receipts: increment stock, emit movements,
   * increment received per line, recompute the PO status from the fresh
   * in-transaction totals, and log the activity entry. Returns the refreshed PO.
   */
  abstract receive(data: ReceivePOData): Promise<unknown>;
}
