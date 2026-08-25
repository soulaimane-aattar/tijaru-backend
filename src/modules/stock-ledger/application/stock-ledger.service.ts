import { Injectable } from '@nestjs/common';
import type { Movement, Prisma } from '@prisma/client';

import { ConflictError, ValidationError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import type { LedgerLine, LedgerPost } from '../domain/stock-ledger.types';

@Injectable()
export class StockLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(input: LedgerPost, tx?: Prisma.TransactionClient): Promise<Movement[]> {
    if (input.type === 'transfer' && !input.toWarehouseId) {
      throw new ValidationError('transfer_missing_destination');
    }
    const run = async (client: Prisma.TransactionClient) => {
      const movements: Movement[] = [];
      for (const line of input.lines) {
        await this.applyDelta(client, input.businessId, line);
        if (input.type === 'transfer') {
          await this.applyDelta(client, input.businessId, {
            ...line,
            warehouseId: input.toWarehouseId as string,
            delta: -line.delta, // sign flip so positive = increment dest
          });
        }
        movements.push(
          await client.movement.create({
            data: {
              businessId: input.businessId,
              userId: input.userId,
              type: input.type,
              reason: input.reason,
              ref: input.ref ?? null,
              date: input.date ?? new Date(),
              productId: line.productId,
              warehouseId: line.warehouseId,
              qty: Math.abs(line.delta),
              toWarehouseId: input.type === 'transfer' ? (input.toWarehouseId ?? null) : null,
              batch: line.batch ?? null,
              expiry: line.expiry ?? null,
            },
          }),
        );
      }
      return movements;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  private async applyDelta(
    client: Prisma.TransactionClient,
    businessId: string,
    line: LedgerLine,
  ): Promise<void> {
    if (line.delta === 0) return;
    if (line.delta > 0) {
      const existing = await client.stockLevel.findUnique({
        where: {
          productId_warehouseId: { productId: line.productId, warehouseId: line.warehouseId },
        },
      });
      const newQty = (existing?.qty ?? 0) + line.delta;
      const newAvg =
        line.unitCost != null && existing
          ? (Number(existing.avgCost) * existing.qty + line.unitCost * line.delta) / newQty
          : (line.unitCost ?? Number(existing?.avgCost ?? 0));
      // Increment must be atomic: a read-modify-write here loses updates
      // when a concurrent out/transfer touches the same bin between the
      // read above and the write below.
      await client.stockLevel.upsert({
        where: {
          productId_warehouseId: { productId: line.productId, warehouseId: line.warehouseId },
        },
        create: {
          productId: line.productId,
          warehouseId: line.warehouseId,
          businessId,
          qty: line.delta,
          avgCost: newAvg,
        },
        update: {
          qty: { increment: line.delta },
          ...(line.unitCost != null ? { avgCost: newAvg } : {}),
        },
      });
    } else {
      const needed = Math.abs(line.delta);
      const result = await client.stockLevel.updateMany({
        where: {
          productId: line.productId,
          warehouseId: line.warehouseId,
          qty: { gte: needed },
        },
        data: { qty: { decrement: needed } },
      });
      if (result.count === 0) throw new ConflictError('insufficient_stock');
    }
  }
}
