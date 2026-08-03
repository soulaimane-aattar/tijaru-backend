/**
 * Port: persistence contract for the sessions admin logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export abstract class AdminSessionsRepository {
  /** All live (non-revoked, non-expired) sessions with their user, most recently seen first. */
  abstract findActiveSessions(): Promise<unknown>;

  /** True when a session with this id exists (revoked or not). */
  abstract exists(id: string): Promise<boolean>;

  abstract revoke(id: string): Promise<void>;

  /** Revoke every non-revoked session; returns how many were revoked. */
  abstract revokeAllActive(): Promise<number>;
}
