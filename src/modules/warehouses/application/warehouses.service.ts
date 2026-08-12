import { Injectable } from '@nestjs/common';

import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { TenantContext } from '../../../common/tenant/tenant-context';
import { WarehousesRepository } from '../domain/warehouses.repository';
import type { CreateWarehouseInput, UpdateWarehouseInput } from '../dto/warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly warehouses: WarehousesRepository,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  list(): Promise<unknown> {
    return this.warehouses.findAll();
  }

  async get(id: string): Promise<unknown> {
    const wh = await this.warehouses.findDetail(id);
    if (!wh) throw new NotFoundError('Warehouse', id);
    return wh;
  }

  async create(input: CreateWarehouseInput): Promise<unknown> {
    const businessId = this.tenant.getBusinessId();
    if (businessId) {
      const biz = await this.prisma.business.findUnique({
        where: { id: businessId },
        select: { multiWarehouse: true },
      });
      if (biz && !biz.multiWarehouse) {
        const count = await this.warehouses.countActive();
        if (count >= 1) {
          throw new ForbiddenError('multi_warehouse_disabled');
        }
      }
    }
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
