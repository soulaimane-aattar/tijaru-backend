import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  SuppliersRepository,
  type CreateSupplierData,
  type UpdateSupplierData,
} from '../domain/suppliers.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaSuppliersRepository extends SuppliersRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findAll(): Promise<unknown[]> {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true, purchaseOrders: true } } },
    });
  }

  findDetail(id: string): Promise<unknown | null> {
    return this.prisma.supplier.findUnique({
      where: { id },
      include: {
        products: { select: { id: true, name: true, sku: true } },
        purchaseOrders: {
          select: { id: true, number: true, status: true, date: true },
          orderBy: { date: 'desc' },
          take: 20,
        },
      },
    });
  }

  findById(id: string): Promise<unknown | null> {
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  create(data: CreateSupplierData): Promise<unknown> {
    return this.prisma.supplier.create({
      data: scoped<Prisma.SupplierUncheckedCreateInput>(compact(data)),
    });
  }

  async update(id: string, data: UpdateSupplierData): Promise<number> {
    const r = await this.prisma.supplier.updateMany({ where: { id }, data: compact(data) });
    return r.count;
  }

  async delete(id: string): Promise<number> {
    const r = await this.prisma.supplier.deleteMany({ where: { id } });
    return r.count;
  }
}
