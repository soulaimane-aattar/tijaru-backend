/**
 * Port: persistence contract for the roles / overrides admin logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

/** Minimal shape the override business rules read. */
export interface UserOverridesView {
  id: string;
  role: string;
  overrides: { capId: string; granted: boolean }[];
}

export interface CapabilityGrant {
  capId: string;
  granted: boolean;
}

export abstract class AdminRolesRepository {
  /** Non-deleted user with capability overrides, or null. */
  abstract findUserWithOverrides(userId: string): Promise<UserOverridesView | null>;

  /** True when a non-deleted user with this id exists. */
  abstract userExists(userId: string): Promise<boolean>;

  /**
   * Atomically remove/upsert role customizations, then bump the tokenVersion
   * of every user with that role (invalidates their outstanding access tokens).
   */
  abstract applyRoleCustomizations(
    businessId: string,
    role: string,
    changes: { remove: string[]; set: CapabilityGrant[] },
  ): Promise<void>;

  /**
   * Atomically remove/upsert per-user overrides, then bump that user's
   * tokenVersion (invalidates their outstanding access tokens).
   */
  abstract applyUserOverrides(
    userId: string,
    changes: { remove: string[]; set: CapabilityGrant[] },
  ): Promise<void>;
}
