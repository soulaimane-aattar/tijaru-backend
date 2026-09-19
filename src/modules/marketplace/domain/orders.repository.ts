import type { NotificationType, OrderStatus } from '@prisma/client';

export interface OrderLineData {
  listingId: string;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  vat: number;
  totalHt: number;
}

export interface OrderCreateData {
  number: string;
  sellerBusinessId: string;
  buyerBusinessId: string;
  customerId: string;
  subtotalHt: number;
  vatTotal: number;
  totalTtc: number;
  buyerNote: string | null;
  createdByUserId: string;
  lines: OrderLineData[];
}

export interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  sellerBusinessId: string;
  sellerName: string;
  buyerBusinessId: string;
  buyerName: string;
  subtotalHt: number;
  vatTotal: number;
  totalTtc: number;
  createdAt: Date;
  statusChangedAt: Date;
}

export interface OrderDetail extends OrderRow {
  buyerNote: string | null;
  sellerNote: string | null;
  externalRef: string | null;
  lines: (OrderLineData & { id: string })[];
}

/** A listing as the order service needs it: price ladder + seller identity. */
export interface OrderableListing {
  id: string;
  sellerBusinessId: string;
  productId: string;
  title: string;
  unitPrice: number;
  vat: number;
  minOrderQty: number;
  active: boolean;
  tiers: { priceGroupId: string | null; minQty: number; unitPrice: number }[];
}

export interface ListOrdersParams {
  businessId: string;
  side: 'seller' | 'buyer';
  status?: OrderStatus;
  page: number;
  pageSize: number;
}

export interface ListOrdersResult {
  items: OrderRow[];
  total: number;
  page: number;
  pageSize: number;
}

export abstract class OrdersRepository {
  abstract findListings(ids: string[]): Promise<OrderableListing[]>;

  /**
   * Seller-side customer row for this buyer, created on first order.
   * Runs in the seller's tenant scope (D-030).
   */
  abstract ensureCustomer(
    sellerBusinessId: string,
    buyerBusinessId: string,
    buyerName: string,
  ): Promise<{ id: string; priceGroupId: string | null }>;

  abstract nextNumber(sellerBusinessId: string, prefix: string): Promise<string>;
  abstract create(data: OrderCreateData): Promise<OrderDetail>;
  abstract findDetail(id: string): Promise<OrderDetail | null>;
  abstract list(params: ListOrdersParams): Promise<ListOrdersResult>;

  /**
   * Flip the status and run the side effects that belong in the same
   * transaction: stock movement on `shipped`, notification for the other party,
   * activity row on the acting tenant.
   */
  abstract transition(
    id: string,
    to: OrderStatus,
    actorUserId: string,
    opts: { postStock: boolean; note?: string | undefined },
  ): Promise<OrderDetail>;

  abstract notify(
    businessId: string,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void>;

  abstract businessName(id: string): Promise<string>;
}
