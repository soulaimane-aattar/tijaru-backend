/**
 * Port: persistence contract for the warehouses business logic.
 *
 * The application service depends on this abstraction only; the Kysely
 * implementation lives in `../infrastructure`. The abstract class doubles as
 * the Nest injection token (interfaces are erased at runtime).
 */

export interface CreateWarehouseData {
  name: string;
  city: string;
  address?: string | undefined;
  phone?: string | undefined;
  managerId?: string | undefined;
  active: boolean;
  isDefault: boolean;
}

export type UpdateWarehouseData = {
  [K in keyof CreateWarehouseData]?: CreateWarehouseData[K] | undefined;
};

export abstract class WarehousesRepository {
  /** All non-deleted warehouses, default first then by name. */
  abstract findAll(): Promise<unknown>;

  /** Full detail payload (manager + assigned users) or null. */
  abstract findDetail(id: string): Promise<unknown | null>;

  /** Current business's `multiWarehouse` flag; undefined when the business row is not found. */
  abstract isMultiWarehouse(): Promise<boolean | undefined>;

  /** True when a non-deleted warehouse with this id exists. */
  abstract exists(id: string): Promise<boolean>;

  /** Count non-deleted warehouses (tenant-scoped). */
  abstract countActive(): Promise<number>;

  /** Count stock levels with qty > 0 for this warehouse (tenant-scoped). */
  abstract countNonZeroStock(id: string): Promise<number>;

  /** Create atomically; when `isDefault` is true, any previous default is cleared first. */
  abstract create(data: CreateWarehouseData): Promise<unknown>;

  /** Update atomically; when `isDefault` becomes true, any other default is cleared first. */
  abstract update(id: string, data: UpdateWarehouseData): Promise<unknown>;

  /** Soft-delete: marks deleted, inactive and no longer default. */
  abstract softDelete(id: string): Promise<void>;
}
