import type { NotificationType } from '@prisma/client';

/** A product whose total stock across warehouses is at/below its minStock threshold. */
export type LowStockCandidate = {
  businessId: string;
  productId: string;
  productName: string;
  totalQty: number;
  minStock: number;
};

/** A product with a tracked expiry date landing inside the scan window. */
export type ExpiringCandidate = {
  businessId: string;
  id: string;
  name: string;
  expiry: Date;
};

export type CreateNotificationInput = {
  businessId: string;
  type: NotificationType;
  title: string;
  body: string;
};

/**
 * Port: persistence contract for the notifications business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export abstract class NotificationsRepository {
  /** Latest 100 notifications, newest first. */
  abstract findRecent(): Promise<unknown[]>;

  abstract countUnread(): Promise<number>;

  abstract markRead(id: string): Promise<unknown>;

  /** Rows flipped from unread to read. */
  abstract markAllUnreadRead(): Promise<number>;

  /** Products (grouped by business) whose summed stock is below minStock (minStock > 0). */
  abstract findLowStockCandidates(): Promise<LowStockCandidate[]>;

  /** Products with a tracked expiry date within `daysWindow` days from now. */
  abstract findExpiringCandidates(daysWindow: number): Promise<ExpiringCandidate[]>;

  /** True if an unread notification with this exact (businessId, type, body) already exists. */
  abstract existsUnread(businessId: string, type: NotificationType, body: string): Promise<boolean>;

  abstract create(input: CreateNotificationInput): Promise<unknown>;
}
