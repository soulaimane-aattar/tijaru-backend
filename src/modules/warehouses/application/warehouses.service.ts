import { Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../common/errors';
import { WarehousesRepository } from '../domain/warehouses.repository';
import type { CreateWarehouseInput, UpdateWarehouseInput } from '../dto/warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(private readonly warehouses: WarehousesRepository) {}

  list(): Promise<unknown> {
    return this.warehouses.findAll();
  }

  async get(id: string): Promise<unknown> {
    const wh = await this.warehouses.findDetail(id);
    if (!wh) throw new NotFoundError('Warehouse', id);
    return wh;
  }

  create(input: CreateWarehouseInput): Promise<unknown> {
    return this.warehouses.create(input);
  }

  async update(id: string, input: UpdateWarehouseInput): Promise<unknown> {
    if (!(await this.warehouses.exists(id))) throw new NotFoundError('Warehouse', id);
    return this.warehouses.update(id, input);
  }

  async remove(id: string): Promise<void> {
    if (!(await this.warehouses.exists(id))) throw new NotFoundError('Warehouse', id);
    const nonZeroStock = await this.warehouses.countNonZeroStock(id);
    if (nonZeroStock > 0) throw new ConflictError('warehouse_not_empty');
    await this.warehouses.softDelete(id);
  }
}
