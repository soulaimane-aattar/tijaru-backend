/**
 * Port: persistence contract for the suppliers business logic.
 *
 * The application service depends on this abstraction only; the Prisma
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export type CreateSupplierData = {
  name: string;
  contact?: string | undefined;
  phone?: string | undefined;
  city?: string | undefined;
  ice?: string | undefined;
  email?: string | undefined;
};

export type UpdateSupplierData = {
  [K in keyof CreateSupplierData]?: CreateSupplierData[K] | undefined;
};

export abstract class SuppliersRepository {
  /** All suppliers with product/PO counts, ordered by name. */
  abstract findAll(): Promise<unknown[]>;

  /** Full detail payload (products and recent POs included) or null. */
  abstract findDetail(id: string): Promise<unknown | null>;

  abstract findById(id: string): Promise<unknown | null>;

  abstract create(data: CreateSupplierData): Promise<unknown>;

  /** Rows updated (0 when the supplier does not exist). */
  abstract update(id: string, data: UpdateSupplierData): Promise<number>;

  /** Rows deleted (0 when the supplier does not exist). */
  abstract delete(id: string): Promise<number>;
}
