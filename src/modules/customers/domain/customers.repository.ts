/**
 * Port: persistence contract for the customers business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export type CreateCustomerData = {
  name: string;
  phone?: string | undefined;
  city?: string | undefined;
  ice?: string | undefined;
  creditLimit?: number | null | undefined;
};

export type UpdateCustomerData = {
  [K in keyof CreateCustomerData]?: CreateCustomerData[K] | undefined;
};

export abstract class CustomersRepository {
  /** All customers ordered by name; `search` matches name/phone/ICE. */
  abstract findAll(search: string | undefined): Promise<unknown[]>;

  abstract findById(id: string): Promise<unknown | null>;

  abstract create(data: CreateCustomerData): Promise<unknown>;

  /** Rows updated (0 when the customer does not exist). */
  abstract update(id: string, data: UpdateCustomerData): Promise<number>;

  /** Rows deleted (0 when the customer does not exist). */
  abstract delete(id: string): Promise<number>;
}
