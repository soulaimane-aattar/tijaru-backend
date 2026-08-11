/**
 * Port: persistence contract for the stock-movements business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export type MovementType = 'in' | 'out' | 'transfer';

export type MovementReason =
  | 'achat'
  | 'vente'
  | 'transfert'
  | 'peremption'
  | 'ajustement'
  | 'casse';

export interface MovementSearchCriteria {
  type?: MovementType | undefined;
  productId?: string | undefined;
  /** Matches movements where the warehouse is either source or destination. */
  warehouseId?: string | undefined;
  userId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  skip: number;
  take: number;
}

export interface ProductRef {
  id: string;
  name: string;
}

export interface ActivityLog {
  userId: string;
  action: string;
  desc: string;
  device?: string | undefined;
}

export abstract class MovementsRepository {
  /** One page of movements (relations included), newest first. */
  abstract findPage(
    criteria: MovementSearchCriteria,
  ): Promise<{ items: unknown[]; total: number }>;

  /** Identity of a non-deleted product, or null. */
  abstract findProductRef(id: string): Promise<ProductRef | null>;

  /** True when a non-deleted warehouse with this id exists. */
  abstract warehouseExists(id: string): Promise<boolean>;

  /** Record an audit-trail entry for a movement (best-effort, outside the stock write). */
  abstract logActivity(activity: ActivityLog): Promise<void>;
}
