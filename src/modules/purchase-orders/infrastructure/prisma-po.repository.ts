import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  PurchaseOrdersRepository,
  type CreatePOData,
  type PatchPOData,
  type POListFilters,
  type POStatus,
  type POView,
  type ReceivePOData,
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
    return this.prisma.purchaseOrder.update({ where: { id }, data: compact(data) });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.purchaseOrder.delete({ where: { id } });
  }

  findWithLines(id: string): Promise<POView | null> {
    return this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        status: true,
        warehouseId: true,
        lines: { select: { id: true, productId: true, qty: true, received: true } },
      },
    });
  }

  receive(data: ReceivePOData): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      for (const r of data.receipts) {
        await tx.stockLevel.upsert({
          where: {
            productId_warehouseId: { productId: r.productId, warehouseId: data.warehouseId },
          },
          create: { productId: r.productId, warehouseId: data.warehouseId, qty: r.qty },
          update: { qty: { increment: r.qty } },
        });
        await tx.movement.create({
          data: scoped<Prisma.MovementUncheckedCreateInput>({
            type: 'in',
            productId: r.productId,
            qty: r.qty,
            warehouseId: data.warehouseId,
            userId: data.actorId,
            reason: 'achat',
            ref: data.movementRef,
          }),
        });
        await tx.purchaseOrderLine.update({
          where: { id: r.lineId },
          data: { received: { increment: r.qty } },
        });
      }

      // Status recompute uses the fresh in-transaction totals — intertwined
      // with the atomic write, so it stays here rather than in the service.
      const fresh = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: data.poId },
        include: { lines: true },
      });
      const totalQty = fresh.lines.reduce((s, l) => s + l.qty, 0);
      const totalRcvd = fresh.lines.reduce((s, l) => s + l.received, 0);

      await tx.purchaseOrder.update({
        where: { id: data.poId },
        data: { status: totalRcvd >= totalQty ? 'received' : 'partiallyReceived' },
      });
      await tx.activity.create({
        data: scoped<Prisma.ActivityUncheckedCreateInput>({
          userId: data.actorId,
          action: 'po.received',
          desc: data.activityDesc,
          ...(data.actorDevice ? { device: data.actorDevice } : {}),
        }),
      });
      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id: data.poId },
        include: {
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          lines: true,
        },
      });
    });
  }
}
