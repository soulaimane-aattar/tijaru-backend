/**
 * Port: persistence contract for the categories business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export interface CreateCategoryData {
  name: string;
  icon: string;
  tone: string;
  active?: boolean;
}

export type UpdateCategoryData = {
  [K in keyof CreateCategoryData]?: CreateCategoryData[K] | undefined;
};

export abstract class CategoriesRepository {
  /** All categories with product counts, ordered by name. */
  abstract findAll(): Promise<unknown[]>;

  abstract existsByName(name: string): Promise<boolean>;

  abstract existsById(id: string): Promise<boolean>;

  /** True when at least one non-deleted product references the category. */
  abstract isInUse(id: string): Promise<boolean>;

  abstract create(data: CreateCategoryData): Promise<unknown>;

  abstract update(id: string, data: UpdateCategoryData): Promise<unknown>;

  /** Rows deleted (0 when the category does not exist). */
  abstract delete(id: string): Promise<number>;
}
