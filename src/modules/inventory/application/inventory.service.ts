import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { ConflictError, NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type { LedgerLine } from '../../stock-ledger/domain/stock-ledger.types';
import { InventoryRepository } from '../domain/inventory.repository';
import type { ApplyCountInput, StartCountInput } from '../dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly ledger: StockLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  list(): Promise<unknown> {
    return this.inventory.findAll();
  }

  async get(id: string): Promise<unknown> {
    const count = await this.inventory.findDetail(id);
    if (!count) throw new NotFoundError('InventoryCount', id);
    return count;
  }

  /** Start a count: snapshot expected qty per product at the chosen warehouse. */
  async start(input: StartCountInput): Promise<unknown> {
    if (!(await this.inventory.warehouseExists(input.warehouseId))) {
      throw new NotFoundError('Warehouse', input.warehouseId);
    }
    const levels = await this.inventory.findActiveStockLevels(input.warehouseId);
    return this.inventory.createCount(
      input.warehouseId,
      levels.map((s) => ({
        productId: s.productId,
        expected: s.qty,
        counted: s.qty, // default = expected; user adjusts before apply
      })),
      input.notes,
    );
  }

  /**
   * Apply a count: for each line, compute `delta = counted - liveQty`
   * (live stock read inside the transaction, not the count's original
   * snapshot) and post it through the stock ledger. This preserves any
   * sales/movements that happened concurrently between the count's start
   * and its apply — only the gap between the physical count and current
   * live stock is adjusted. Atomic transaction. Sets `appliedAt`.
   *
   * Idempotent: re-applying an already-applied count throws ConflictError.
   */
  async apply(id: string, input: ApplyCountInput, actor: AuthUser): Promise<unknown> {
    const count = await this.inventory.findWithLines(id);
    if (!count) throw new NotFoundError('InventoryCount', id);
    if (count.appliedAt) throw new ConflictError('count_already_applied');

    const inputByProduct = new Map(input.lines.map((l) => [l.productId, l.counted]));
    const ref = `INV-${count.id.slice(-6).toUpperCase()}`;

    await this.prisma.$transaction(async (tx) => {
      const live = await this.inventory.findLiveStockLevels(
        count.warehouseId,
        count.lines.map((l) => l.productId),
        tx,
      );
      const liveMap = new Map(live.map((s) => [s.productId, s.qty]));

      const positiveLines: LedgerLine[] = [];
      const negativeLines: LedgerLine[] = [];
      for (const line of count.lines) {
        const counted = inputByProduct.get(line.productId) ?? line.counted;
        const liveQty = liveMap.get(line.productId) ?? 0;
        const delta = counted - liveQty;
        if (delta > 0) {
          positiveLines.push({ productId: line.productId, warehouseId: count.warehouseId, delta });
        } else if (delta < 0) {
          negativeLines.push({ productId: line.productId, warehouseId: count.warehouseId, delta });
        }
        if (counted !== line.counted) {
          await this.inventory.updateLineCounted(line.id, counted, tx);
        }
      }

      if (positiveLines.length > 0) {
        await this.ledger.post(
          {
            businessId: actor.businessId,
            userId: actor.id,
            type: 'in',
            reason: 'ajustement',
            ref,
            lines: positiveLines,
          },
          tx,
        );
      }
      if (negativeLines.length > 0) {
        await this.ledger.post(
          {
            businessId: actor.businessId,
            userId: actor.id,
            type: 'out',
            reason: 'ajustement',
            ref,
            lines: negativeLines,
          },
          tx,
        );
      }

      await this.inventory.markApplied(id, tx);
      await this.inventory.logActivity(
        {
          userId: actor.id,
          action: 'inventory.applied',
          desc: `Inventaire appliqué — ${count.lines.length} lignes`,
          device: actor.device,
        },
        tx,
      );
    });

    return this.inventory.findDetail(id);
  }
}
