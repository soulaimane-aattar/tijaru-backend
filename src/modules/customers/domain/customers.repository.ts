/**
 * Port: persistence contract for the customers business logic.
 *
 * The application service depends on this abstraction only; the Kysely
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export type CreateCustomerData = {
  name: string;
  phone?: string | undefined;
  city?: string | undefined;
  ice?: string | undefined;
  creditLimit?: number | null | undefined;
  categoryId?: string | null | undefined;
};

export type UpdateCustomerData = {
  [K in keyof CreateCustomerData]?: CreateCustomerData[K] | undefined;
};

export abstract class CustomersRepository {
  /** All customers ordered by name; `search` matches name/phone/ICE. */
  abstract findAll(search: string | undefined): Promise<unknown[]>;

  abstract findById(id: string): Promise<unknown | null>;

  abstract create(data: CreateCustomerData): Promise<unknown>;

  /** Updated row, or null when the customer does not exist. */
  abstract update(id: string, data: UpdateCustomerData): Promise<unknown | null>;

  /** Rows deleted (0 when the customer does not exist). */
  abstract delete(id: string): Promise<number>;
}

export type CategoryData = {
  label?: string | undefined;
  color?: string | undefined;
  creditLimit?: number | null | undefined;
};

export abstract class CustomerCategoriesRepository {
  abstract findAll(): Promise<unknown[]>;
  /** Throws ConflictError on a duplicate label (case-insensitive, per business). */
  abstract create(data: CategoryData & { label: string; color: string }): Promise<unknown>;
  /** Updated row, or null when missing. Throws ConflictError on a duplicate label. */
  abstract update(id: string, data: CategoryData): Promise<unknown | null>;
  /** Rows deleted (0 when missing); customers fall back to uncategorised. */
  abstract delete(id: string): Promise<number>;
  abstract findById(id: string): Promise<unknown | null>;
}
