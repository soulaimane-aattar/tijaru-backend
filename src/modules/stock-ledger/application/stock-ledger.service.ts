import { Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';

import { ConflictError, ValidationError } from '../../../common/errors';
import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { DB } from '../../../database/types';
import { camelRow } from '../../row-case';
import type { LedgerLine, LedgerMovement, LedgerPost } from '../domain/stock-ledger.types';

@Injectable()
export class StockLedgerService {
  constructor(private readonly db: Db) {}

  /** Joins the ambient request transaction (or opens one), so stock + movement rows stay atomic with the caller's work. */
  async post(input: LedgerPost): Promise<LedgerMovement[]> {
    if (input.type === 'transfer' && !input.toWarehouseId) {
      throw new ValidationError('transfer_missing_destination');
    }
    return this.db.tx(async (q) => {
      const movements: LedgerMovement[] = [];
      for (const line of input.lines) {
        await this.applyDelta(q, input.businessId, line);
        if (input.type === 'transfer') {
          await this.applyDelta(q, input.businessId, {
            ...line,
            warehouseId: input.toWarehouseId as string,
            delta: -line.delta, // sign flip so positive = increment dest
          });
        }
        const row = await q
          .insertInto('app.movements')
          .values({
            id: newId(),
            business_id: input.businessId,
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
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        movements.push(camelRow(row));
      }
      return movements;
    });
  }

  private async applyDelta(q: Kysely<DB>, businessId: string, line: LedgerLine): Promise<void> {
    if (line.delta === 0) return;
    if (line.delta > 0) {
      // Lock row with FOR UPDATE to prevent concurrent avgCost corruption.
      const existing = await q
        .selectFrom('app.stock_levels')
        .select(['qty', sql<number>`"avgCost"::float8`.as('avgCost')])
        .where('productId', '=', line.productId)
        .where('warehouseId', '=', line.warehouseId)
        .where('businessId', '=', businessId)
        .forUpdate()
        .executeTakeFirst();
      const newQty = (existing?.qty ?? 0) + line.delta;
      const newAvg =
        line.unitCost != null && existing
          ? (Number(existing.avgCost) * existing.qty + line.unitCost * line.delta) / newQty
          : (line.unitCost ?? Number(existing?.avgCost ?? 0));
      await q
        .insertInto('app.stock_levels')
        .values({
          productId: line.productId,
          warehouseId: line.warehouseId,
          businessId,
          qty: line.delta,
          avgCost: newAvg,
          updatedAt: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['productId', 'warehouseId']).doUpdateSet((eb) => ({
            qty: eb('app.stock_levels.qty', '+', line.delta),
            ...(line.unitCost != null ? { avgCost: newAvg } : {}),
            updatedAt: new Date(),
          })),
        )
        .execute();
    } else {
      const needed = Math.abs(line.delta);
      const r = await q
        .updateTable('app.stock_levels')
        .set((eb) => ({ qty: eb('qty', '-', needed), updatedAt: new Date() }))
        .where('productId', '=', line.productId)
        .where('warehouseId', '=', line.warehouseId)
        .where('businessId', '=', businessId)
        .where('qty', '>=', needed)
        .executeTakeFirst();
      if (r.numUpdatedRows === 0n) throw new ConflictError('insufficient_stock');
    }
  }
}
