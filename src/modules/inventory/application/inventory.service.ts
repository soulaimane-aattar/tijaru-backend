import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import {
  InventoryRepository,
  type LineCorrection,
  type StockAdjustment,
} from '../domain/inventory.repository';
import type { ApplyCountInput, StartCountInput } from '../dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly inventory: InventoryRepository) {}

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
   * Apply a count: for each line where counted !== expected, emit a Movement
   * with reason 'ajustement', and overwrite StockLevel to the counted value.
   * Atomic transaction. Sets appliedAt.
   */
  async apply(id: string, input: ApplyCountInput, actor: AuthUser): Promise<unknown> {
    const count = await this.inventory.findWithLines(id);
    if (!count) throw new NotFoundError('InventoryCount', id);
    if (count.appliedAt) {
      throw new DomainError('already_applied', 'Inventory count already applied', 422);
    }

    const inputByProduct = new Map(input.lines.map((l) => [l.productId, l.counted]));

    const adjustments: StockAdjustment[] = [];
    const corrections: LineCorrection[] = [];
    for (const line of count.lines) {
      const counted = inputByProduct.get(line.productId) ?? line.counted;
      const diff = counted - line.expected;
      if (diff !== 0) adjustments.push({ productId: line.productId, counted, diff });
      if (counted !== line.counted) corrections.push({ lineId: line.id, counted });
    }

    return this.inventory.applyCount({
      countId: id,
      warehouseId: count.warehouseId,
      movementRef: `INV-${count.id.slice(-6).toUpperCase()}`,
      adjustments,
      corrections,
      actorId: actor.id,
      actorDevice: actor.device,
      activityDesc: `Inventaire appliqué — ${count.lines.length} lignes`,
    });
  }
}
