/**
 * Port: persistence contract for the users business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export interface CreateUserData {
  name: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  role: string;
  warehouseIds: string[];
}

export interface UpdateUserData {
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  role?: string | undefined;
  active?: boolean | undefined;
}

export abstract class UsersRepository {
  /** All non-deleted users (safe fields only, no password hash), oldest first. */
  abstract findAllSafe(): Promise<unknown>;

  /** Safe detail payload (overrides included) or null. */
  abstract findDetail(id: string): Promise<unknown | null>;

  /** True when a non-deleted user with this id exists. */
  abstract exists(id: string): Promise<boolean>;

  /** True when a non-deleted user already uses this (normalized) email. */
  abstract emailInUse(email: string): Promise<boolean>;

  /** Create the user and its warehouse assignments; returns safe fields only. */
  abstract create(data: CreateUserData): Promise<unknown>;

  /** Update atomically; when `warehouseIds` is provided the assignments are replaced. */
  abstract update(
    id: string,
    data: UpdateUserData,
    warehouseIds?: string[],
  ): Promise<unknown>;

  /** Soft-delete: marks deleted, inactive and invalidates outstanding tokens. */
  abstract softDelete(id: string): Promise<void>;
}
