/**
 * Port: persistence contract for the auth business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

/** Minimal shape the credential / token business rules read. */
export interface AuthUserView {
  id: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  passwordHash: string;
  tokenVersion: number;
  overrides: { capId: string; granted: boolean }[];
  businessStatus: string;
}

/** Active (non-revoked) session row; expiry is a business rule, checked by the service. */
export interface SessionView {
  id: string;
  expiresAt: Date;
  user: AuthUserView;
}

export interface CreateSessionData {
  userId: string;
  refreshTokenHash: string;
  device: string | null;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
}

/** Profile payload for the `me` endpoint. */
export interface UserProfileView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  active: boolean;
  lastLogin: Date | null;
  warehouses: { warehouseId: string }[];
  warehouseIds: string[];
}

export interface CreateBusinessWithOwnerData {
  businessName: string;
  phone?: string;
  status: string;
  ownerName: string;
  email: string;
  passwordHash: string;
}

export interface CreateBusinessWithOwnerResult {
  businessId: string;
  userId: string;
}

export abstract class AuthRepository {
  /** Non-deleted user by (normalized) email, with capability overrides, or null. */
  abstract findUserByEmail(email: string): Promise<AuthUserView | null>;

  /** Current profile of the user (id, contact, role, assigned warehouses), or null. */
  abstract findProfile(userId: string): Promise<UserProfileView | null>;

  /** True when a non-deleted user already uses this (normalized) email. */
  abstract emailInUse(email: string): Promise<boolean>;

  /** Stamp the user's last successful login. */
  abstract recordLogin(userId: string): Promise<void>;

  /** Non-revoked session matching the refresh-token hash, with its user, or null. */
  abstract findSessionByTokenHash(hash: string): Promise<SessionView | null>;

  abstract createSession(data: CreateSessionData): Promise<void>;

  abstract revokeSession(sessionId: string): Promise<void>;

  /** Revoke the user's non-revoked session(s) matching the refresh-token hash. */
  abstract revokeSessionByTokenHash(userId: string, hash: string): Promise<void>;

  /** Revoke every non-revoked session of the user. */
  abstract revokeAllSessions(userId: string): Promise<void>;

  /** Bump the user's token version → invalidates any outstanding access tokens. */
  abstract bumpTokenVersion(userId: string): Promise<void>;

  /** Create a new Business (typically `pending`) with its owner User, atomically. */
  abstract createBusinessWithOwner(
    data: CreateBusinessWithOwnerData,
  ): Promise<CreateBusinessWithOwnerResult>;
}
