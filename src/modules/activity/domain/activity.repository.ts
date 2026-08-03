/**
 * Port: persistence contract for the activity business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export interface ActivitySearchCriteria {
  userId?: string | undefined;
  action?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  skip: number;
  take: number;
}

export abstract class ActivityRepository {
  /** One page of activity entries (with user summary), newest first, plus the unpaged total. */
  abstract findPage(
    criteria: ActivitySearchCriteria,
  ): Promise<{ items: unknown[]; total: number }>;
}
