/**
 * Port: persistence contract for the security-policy admin logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export interface SecurityPolicyPatch {
  passwordMinLen?: number | undefined;
  requireUpper?: boolean | undefined;
  requireDigit?: boolean | undefined;
  requireSymbol?: boolean | undefined;
  passwordExpiryDays?: number | undefined;
  passwordHistoryCount?: number | undefined;
  twoFARequiredFor?: string[] | undefined;
  lockAfterFailures?: number | undefined;
  sessionTimeoutMin?: number | undefined;
  ipAllowlist?: string[] | undefined;
  auditRetentionDays?: number | undefined;
}

export abstract class AdminPolicyRepository {
  /** Full policy payload (business included) or null when not configured. */
  abstract findPolicyDetail(): Promise<unknown | null>;

  /** Id of the configured policy, or null. */
  abstract findPolicyId(): Promise<string | null>;

  /** Create the tenant's policy row with schema defaults (no-op payload). */
  abstract createDefault(): Promise<void>;

  abstract updatePolicy(id: string, patch: SecurityPolicyPatch): Promise<unknown>;
}
