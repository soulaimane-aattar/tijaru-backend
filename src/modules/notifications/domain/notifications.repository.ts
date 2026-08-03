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
}
