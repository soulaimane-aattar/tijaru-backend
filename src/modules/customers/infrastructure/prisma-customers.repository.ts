import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  CustomersRepository,
  type CreateCustomerData,
  type UpdateCustomerData,
} from '../domain/customers.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaCustomersRepository extends CustomersRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findAll(search: string | undefined): Promise<unknown[]> {
    const where: Prisma.CustomerWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { ice: { contains: search } },
          ],
        }
      : {};
    return this.prisma.customer.findMany({ where, orderBy: { name: 'asc' } });
  }

  findById(id: string): Promise<unknown | null> {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  create(data: CreateCustomerData): Promise<unknown> {
    return this.prisma.customer.create({
      data: scoped<Prisma.CustomerUncheckedCreateInput>(compact(data)),
    });
  }

  async update(id: string, data: UpdateCustomerData): Promise<number> {
    const r = await this.prisma.customer.updateMany({ where: { id }, data: compact(data) });
    return r.count;
  }

  async delete(id: string): Promise<number> {
    const r = await this.prisma.customer.deleteMany({ where: { id } });
    return r.count;
  }
}
