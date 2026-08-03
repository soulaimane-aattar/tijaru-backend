import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import { type CapabilityId, hasPermission } from '../../../domain/permissions';
import { MovementsRepository, type StockDelta } from '../domain/movements.repository';
import type { CreateMovementInput, ListMovementsQuery } from '../dto/movement.dto';

const REQUIRED_CAP: Record<CreateMovementInput['type'], CapabilityId> = {
  in: 'stock.in',
  out: 'stock.out',
  transfer: 'stock.transfer',
};

@Injectable()
export class MovementsService {
  constructor(private readonly movements: MovementsRepository) {}

  async list(query: ListMovementsQuery): Promise<{
    items: unknown[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const { items, total } = await this.movements.findPage({
      type: query.type,
      productId: query.productId,
      warehouseId: query.warehouseId,
      userId: query.userId,
      from: query.from,
      to: query.to,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
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
   * Existence + available-stock rules are decided here; all stock deltas, the
   * Movement row and the activity log are then persisted in one atomic write
   * (the adapter uses atomic increments to avoid lost-update races).
   */
  async record(input: CreateMovementInput, actor: AuthUser): Promise<unknown> {
    if (!hasPermission(actor, REQUIRED_CAP[input.type])) {
      throw new DomainError('forbidden', `Missing capability: ${REQUIRED_CAP[input.type]}`, 403);
    }

    const product = await this.movements.findProductRef(input.productId);
    if (!product) throw new NotFoundError('Product', input.productId);

    if (!(await this.movements.warehouseExists(input.warehouseId))) {
      throw new NotFoundError('Warehouse', input.warehouseId);
    }
    if (input.type === 'transfer' && input.toWarehouseId) {
      if (!(await this.movements.warehouseExists(input.toWarehouseId))) {
        throw new NotFoundError('Warehouse', input.toWarehouseId);
      }
    }

    // Out / Transfer: verify available stock at source.
    if (input.type === 'out' || input.type === 'transfer') {
      const available = await this.movements.getStockQty(input.productId, input.warehouseId);
      if (available < input.qty) {
        throw new DomainError(
          'insufficient_stock',
          `Insufficient stock at source (${available} < ${input.qty})`,
          422,
        );
      }
    }

    const deltas: StockDelta[] = [
      {
        warehouseId: input.warehouseId,
        delta: input.type === 'in' ? input.qty : -input.qty,
      },
    ];
    if (input.type === 'transfer' && input.toWarehouseId) {
      deltas.push({ warehouseId: input.toWarehouseId, delta: input.qty });
    }

    return this.movements.executeStockMovement(
      deltas,
      {
        type: input.type,
        productId: input.productId,
        qty: input.qty,
        warehouseId: input.warehouseId,
        toWarehouseId: input.toWarehouseId,
        userId: actor.id,
        date: input.date,
        reason: input.reason,
        ref: input.ref,
        batch: input.batch,
        expiry: input.expiry,
      },
      {
        userId: actor.id,
        action: input.type === 'transfer' ? 'transfer' : `stock.${input.type}`,
        desc: `${input.type === 'in' ? 'Entrée' : input.type === 'out' ? 'Sortie' : 'Transfert'} ${input.qty} × ${product.name}`,
        device: actor.device,
      },
    );
  }
}
