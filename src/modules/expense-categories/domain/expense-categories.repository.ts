/**
 * Port: persistence contract for per-tenant expense categories.
 *
 * The tenant middleware injects `businessId` on writes and filters it on reads,
 * so it never appears in these types.
 */

export type ExpenseCategoryView = {
  id: string;
  key: string;
  label: string;
  taxRate: number;
  sortOrder: number;
  archived: boolean;
};

export type CreateExpenseCategoryData = {
  key: string;
  label: string;
  taxRate: number;
  sortOrder: number;
};

export type UpdateExpenseCategoryData = {
  label?: string | undefined;
  taxRate?: number | undefined;
  sortOrder?: number | undefined;
  archived?: boolean | undefined;
};

export abstract class ExpenseCategoriesRepository {
  /** Ordered by sortOrder ascending, then key. */
  abstract findAll(includeArchived: boolean): Promise<ExpenseCategoryView[]>;

  abstract findById(id: string): Promise<ExpenseCategoryView | null>;

  abstract findByKey(key: string): Promise<ExpenseCategoryView | null>;

  abstract create(data: CreateExpenseCategoryData): Promise<ExpenseCategoryView>;

  /** Rows updated (0 when the category does not exist for this tenant). */
  abstract update(id: string, data: UpdateExpenseCategoryData): Promise<number>;

  /** Number of expenses that reference this category key in the current tenant. */
  abstract countUses(key: string): Promise<number>;

  /** Hard delete. Callers must first ensure the category has no uses. */
  abstract delete(id: string): Promise<number>;
}
