import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { type CapabilityId, hasPermission } from '../../../domain/permissions';
import type { CreateMovementInput, ListMovementsQuery } from '../dto/movement.dto';

const REQUIRED_CAP: Record<CreateMovementInput['type'], CapabilityId> = {
  in: 'stock.in',
  out: 'stock.out',
  transfer: 'stock.transfer',
};

@Injectable()
export class MovementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMovementsQuery): Promise<{
    items: unknown[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const where: Prisma.MovementWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.productId) where.productId = query.productId;
    if (query.warehouseId) {
      where.OR = [{ warehouseId: query.warehouseId }, { toWarehouseId: query.warehouseId }];
    }
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.date = {};
      if (query.from) (where.date as { gte?: Date }).gte = query.from;
      if (query.to) (where.date as { lte?: Date }).lte = query.to;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.movement.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, tone: true } },
          warehouse: { select: { id: true, name: true, city: true } },
          toWarehouse: { select: { id: true, name: true, city: true } },
          user: { select: { id: true, name: true, role: true } },
        },
        orderBy: { date: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.movement.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Record a stock movement atomically.
   *
   * Rules (spec §10):
   *  - in       → +qty at warehouse
   *  - out      → -qty at warehouse, reject if would go negative
   *  - transfer → -qty at source + +qty at destination, distinct warehouses
   *
   * All effects + the Movement row are written in a single $transaction.
   * StockLevel updates use Prisma's atomic `{ increment }` to avoid lost-update
   * races; existence is ensured via upsert.
   */
  async record(input: CreateMovementInput, actor: AuthUser): Promise<unknown> {
    if (!hasPermission(actor, REQUIRED_CAP[input.type])) {
      throw new DomainError('forbidden', `Missing capability: ${REQUIRED_CAP[input.type]}`, 403);
    }

    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
    });
    if (!product) throw new NotFoundError('Product', input.productId);

    const sourceWh = await this.prisma.warehouse.findFirst({
      where: { id: input.warehouseId, deletedAt: null },
    });
    if (!sourceWh) throw new NotFoundError('Warehouse', input.warehouseId);

    if (input.type === 'transfer' && input.toWarehouseId) {
      const destWh = await this.prisma.warehouse.findFirst({
        where: { id: input.toWarehouseId, deletedAt: null },
      });
      if (!destWh) throw new NotFoundError('Warehouse', input.toWarehouseId);
    }

    return this.prisma.$transaction(async (tx) => {
      // Out / Transfer: verify available stock at source.
      if (input.type === 'out' || input.type === 'transfer') {
        const src = await tx.stockLevel.findUnique({
          where: {
            productId_warehouseId: {
              productId: input.productId,
              warehouseId: input.warehouseId,
            },
          },
        });
        const available = src?.qty ?? 0;
        if (available < input.qty) {
          throw new DomainError(
            'insufficient_stock',
            `Insufficient stock at source (${available} < ${input.qty})`,
            422,
          );
        }
      }

      // Apply source delta.
      const sourceDelta = input.type === 'in' ? input.qty : -input.qty;
      await tx.stockLevel.upsert({
        where: {
          productId_warehouseId: {
            productId: input.productId,
            warehouseId: input.warehouseId,
          },
        },
        create: {
          productId: input.productId,
          warehouseId: input.warehouseId,
          qty: sourceDelta,
        },
        update: { qty: { increment: sourceDelta } },
      });

      // Transfer: apply destination delta.
      if (input.type === 'transfer' && input.toWarehouseId) {
        await tx.stockLevel.upsert({
          where: {
            productId_warehouseId: {
              productId: input.productId,
              warehouseId: input.toWarehouseId,
            },
          },
          create: {
            productId: input.productId,
            warehouseId: input.toWarehouseId,
            qty: input.qty,
          },
          update: { qty: { increment: input.qty } },
        });
      }

      const movement = await tx.movement.create({
        data: {
          type: input.type,
          productId: input.productId,
          qty: input.qty,
          warehouseId: input.warehouseId,
          ...(input.toWarehouseId ? { toWarehouseId: input.toWarehouseId } : {}),
          userId: actor.id,
          ...(input.date ? { date: input.date } : {}),
          reason: input.reason,
          ...(input.ref ? { ref: input.ref } : {}),
          ...(input.batch ? { batch: input.batch } : {}),
          ...(input.expiry ? { expiry: input.expiry } : {}),
        },
      });

      await tx.activity.create({
        data: {
          userId: actor.id,
          action: input.type === 'transfer' ? 'transfer' : `stock.${input.type}`,
          desc: `${input.type === 'in' ? 'Entrée' : input.type === 'out' ? 'Sortie' : 'Transfert'} ${input.qty} × ${product.name}`,
          ...(actor.device ? { device: actor.device } : {}),
        },
      });

      return movement;
    });
  }
}
