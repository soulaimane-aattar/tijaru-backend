import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  PurchaseOrdersRepository,
  type ActivityLog,
  type CreatePOData,
  type PatchPOData,
  type POListFilters,
  type POLineTotals,
  type POStatus,
  type POView,
} from '../domain/po.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaPurchaseOrdersRepository extends PurchaseOrdersRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findAll(filters: POListFilters): Promise<unknown[]> {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.supplierId) where.supplierId = filters.supplierId;
    if (filters.warehouseId) where.warehouseId = filters.warehouseId;
    return this.prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, city: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  findDetail(id: string): Promise<unknown | null> {
    return this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        warehouse: true,
        lines: { include: { product: { select: { id: true, name: true, sku: true, tone: true } } } },
      },
    });
  }

  async findLastNumber(prefix: string): Promise<string | null> {
    const last = await this.prisma.purchaseOrder.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return last ? last.number : null;
  }

  create(data: CreatePOData): Promise<unknown> {
    return this.prisma.purchaseOrder.create({
      data: scoped<Prisma.PurchaseOrderUncheckedCreateInput>({
        number: data.number,
        supplierId: data.supplierId,
        warehouseId: data.warehouseId,
        status: data.status,
        ...(data.notes ? { notes: data.notes } : {}),
        lines: { create: data.lines.map((l) => ({ ...l, received: 0 })) },
      }),
      include: { lines: true },
    });
  }

  async findStatus(id: string): Promise<POStatus | null> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: { status: true },
    });
    return po ? po.status : null;
  }

  update(id: string, data: PatchPOData): Promise<unknown> {
    const { lines, ...scalar } = data;
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        ...compact(scalar),
        ...(lines
          ? {
              lines: {
                deleteMany: {},
                create: lines.map((l) => ({ ...l, received: 0 })),
              },
            }
          : {}),
      },
      include: { lines: true },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.purchaseOrder.delete({ where: { id } });
  }

  async findWithLines(id: string): Promise<POView | null> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        status: true,
        warehouseId: true,
        lines: { select: { id: true, productId: true, qty: true, received: true, price: true } },
      },
    });
    if (!po) return null;
    return {
      ...po,
      lines: po.lines.map((l) => ({ ...l, price: Number(l.price) })),
    };
  }

  async incrementLineReceived(
    lineId: string,
    qty: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.purchaseOrderLine.update({
      where: { id: lineId },
      data: { received: { increment: qty } },
    });
  }

  async findLineTotals(poId: string, tx: Prisma.TransactionClient): Promise<POLineTotals[]> {
    return tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: poId },
      select: { qty: true, received: true },
    });
  }

  async updateStatus(poId: string, status: POStatus, tx: Prisma.TransactionClient): Promise<void> {
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
  }

  async logActivity(activity: ActivityLog, tx: Prisma.TransactionClient): Promise<void> {
    await tx.activity.create({
      data: scoped<Prisma.ActivityUncheckedCreateInput>({
        userId: activity.userId,
        action: activity.action,
        desc: activity.desc,
        ...(activity.device ? { device: activity.device } : {}),
      }),
    });
  }
}
