/**
 * Port: persistence contract for the POS business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

/** Pricing fields the checkout rules read (money as plain numbers). */
export interface SaleProduct {
  id: string;
  name: string;
  sale: number;
  vat: number;
}

export interface TicketLineData {
  productId: string;
  qty: number;
  priceTtc: number;
  vat: number;
}

export interface CheckoutTicketData {
  businessId: string;
  number: string;
  cashierId: string;
  warehouseId: string;
  customerId?: string | undefined;
  sessionId: string;
  ht: number;
  tva: number;
  total: number;
  discount: number;
  due: number;
  payment: unknown;
  parked: boolean;
  lines: TicketLineData[];
}

export interface ActivityLog {
  userId: string;
  action: string;
  desc: string;
  device?: string | undefined;
}

export interface ParkedTicketView {
  id: string;
  warehouseId: string;
  customerId: string | null;
  discount: number;
  parked: boolean;
  lines: { productId: string; qty: number }[];
}

export interface ReceiptLineView {
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  qty: number;
  priceTtc: number;
  vat: number;
  lineTotal: number;
}

export interface ReceiptTicketView {
  id: string;
  number: string;
  date: Date;
  ht: number;
  tva: number;
  total: number;
  discount: number;
  due: number;
  payment: unknown;
  parked: boolean;
  lines: ReceiptLineView[];
}

export interface ReceiptBusinessView {
  name: string;
  ice: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
}

export interface ReceiptData {
  ticket: ReceiptTicketView;
  cashier: unknown;
  customer: unknown;
  warehouse: unknown;
  business: ReceiptBusinessView | null;
}

export abstract class PosRepository {
  /** Session row for this id, created with the given opening float when missing. */
  abstract ensureSession(id: string, openingFloat: number): Promise<unknown>;

  /** Non-deleted products among `ids` (money converted to numbers). */
  abstract findSaleProducts(ids: string[]): Promise<SaleProduct[]>;

  /**
   * Highest existing ticket number and movement ref starting with `prefix`
   * (seed data may reference tickets without a matching ticket row).
   */
  abstract findLastTicketRefs(
    prefix: string,
  ): Promise<{ ticketNumber: string | null; movementRef: string | null }>;

  /** Current quantity at the warehouse (0 when no stock level exists). */
  abstract getStockQty(productId: string, warehouseId: string): Promise<number>;

  /**
   * Persist a checkout atomically: ensure the session, decrement stock and
   * emit one out-movement per line (skipped for parked tickets), create the
   * ticket + lines, bump session/customer counters and log the activity.
   * When `replaceTicketId` is set, the previous (parked) ticket is deleted in
   * the same transaction. Returns the created ticket with its lines.
   */
  abstract executeCheckout(
    data: CheckoutTicketData,
    activity?: ActivityLog,
    replaceTicketId?: string,
  ): Promise<unknown>;

  /** Minimal ticket + lines view, or null. */
  abstract findTicketForResume(id: string): Promise<ParkedTicketView | null>;

  abstract markParked(id: string): Promise<unknown>;

  /** Full receipt payload (ticket, parties, warehouse, business), or null. */
  abstract findReceiptData(id: string): Promise<ReceiptData | null>;
}
