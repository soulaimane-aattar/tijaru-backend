import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError, ValidationError } from '../../../common/errors';
import { type CapabilityId, hasPermission } from '../../../domain/permissions';
import { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import { MovementsRepository } from '../domain/movements.repository';
import type { CreateMovementInput, ListMovementsQuery } from '../dto/movement.dto';

const REQUIRED_CAP: Record<CreateMovementInput['type'], CapabilityId> = {
  in: 'stock.in',
  out: 'stock.out',
  transfer: 'stock.transfer',
};

@Injectable()
export class MovementsService {
  constructor(
    private readonly movements: MovementsRepository,
    private readonly ledger: StockLedgerService,
  ) {}

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
   * Record a stock movement.
   *
   * Rules (spec §10):
   *  - in       → +qty at warehouse
   *  - out      → -qty at warehouse, reject if would go negative
   *  - transfer → -qty at source + +qty at destination, distinct warehouses
   *
   * Existence checks happen here; the stock delta + Movement row are written
   * atomically by `StockLedgerService.post` (conditional decrement guards
   * against the negative-stock race — no separate pre-check needed here).
   * The activity-log entry is written best-effort after the ledger commits.
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
    let toWarehouseId: string | undefined;
    if (input.type === 'transfer') {
      if (!input.toWarehouseId) throw new ValidationError('transfer_missing_destination');
      toWarehouseId = input.toWarehouseId;
      if (!(await this.movements.warehouseExists(toWarehouseId))) {
        throw new NotFoundError('Warehouse', toWarehouseId);
      }
    }

    // Insufficient-stock checks happen atomically inside StockLedgerService.post
    // (conditional decrement), closing the TOCTOU window a pre-check would leave open.
    const delta = input.type === 'in' ? input.qty : -input.qty;
    const movements = await this.ledger.post({
      businessId: actor.businessId,
      userId: actor.id,
      type: input.type,
      reason: input.reason,
      ...(input.ref !== undefined ? { ref: input.ref } : {}),
      ...(input.date !== undefined ? { date: input.date } : {}),
      lines: [
        {
          productId: input.productId,
          warehouseId: input.warehouseId,
          delta,
          ...(input.batch !== undefined ? { batch: input.batch } : {}),
          ...(input.expiry !== undefined ? { expiry: input.expiry } : {}),
        },
      ],
      ...(toWarehouseId !== undefined ? { toWarehouseId } : {}),
    });

    await this.movements.logActivity({
      userId: actor.id,
      action: input.type === 'transfer' ? 'transfer' : `stock.${input.type}`,
      desc: `${input.type === 'in' ? 'Entrée' : input.type === 'out' ? 'Sortie' : 'Transfert'} ${input.qty} × ${product.name}`,
      ...(actor.device !== undefined ? { device: actor.device } : {}),
    });

    return movements[0];
  }
}
