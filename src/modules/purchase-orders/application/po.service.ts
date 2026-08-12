import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type { LedgerLine } from '../../stock-ledger/domain/stock-ledger.types';
import { PurchaseOrdersRepository } from '../domain/po.repository';
import type { CreatePOInput, ListPOQuery, PatchPOInput, ReceivePOInput } from '../dto/po.dto';

@Injectable()
export class POService {
  constructor(
    private readonly purchaseOrders: PurchaseOrdersRepository,
    private readonly ledger: StockLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  list(q: ListPOQuery): Promise<unknown> {
    return this.purchaseOrders.findAll(q);
  }

  async get(id: string): Promise<unknown> {
    const po = await this.purchaseOrders.findDetail(id);
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    return po;
  }

  async create(input: CreatePOInput): Promise<unknown> {
    const year = new Date().getFullYear();
    const last = await this.purchaseOrders.findLastNumber(`BC-${year}-`);
    const n = last ? parseInt(last.slice(8), 10) + 1 : 1;
    const number = `BC-${year}-${String(n).padStart(4, '0')}`;
    return this.purchaseOrders.create({ ...input, number });
  }

  async patch(id: string, input: PatchPOInput): Promise<unknown> {
    const status = await this.purchaseOrders.findStatus(id);
    if (!status) throw new NotFoundError('PurchaseOrder', id);
    if (status === 'received' || status === 'partiallyReceived') {
      throw new DomainError('immutable', 'Cannot edit a received PO', 422);
    }
    return this.purchaseOrders.update(id, input);
  }

  async remove(id: string): Promise<void> {
    const status = await this.purchaseOrders.findStatus(id);
    if (!status) throw new NotFoundError('PurchaseOrder', id);
    if (status === 'received' || status === 'partiallyReceived') {
      throw new DomainError('immutable', 'Cannot delete a received PO', 422);
    }
    await this.purchaseOrders.delete(id);
  }

  /**
   * Receive PO lines. For each {lineId, qty} input:
   *  - Reject qty above (line.qty - line.received).
   *  - Post an `achat` ledger entry (+qty at po.warehouseId, unitCost = line
   *    price) so the stock delta, Movement row and WAC `avgCost` update all
   *    happen atomically via `StockLedgerService.post(input, tx)`.
   *  - Increment line.received.
   * Then the PO status is recomputed (received / partiallyReceived) from
   * fresh in-transaction totals, and the activity log entry is written in
   * the same transaction. Supports partial receipts across multiple calls —
   * each call only posts the ledger delta for that call's lines.
   */
  async receive(id: string, input: ReceivePOInput, actor: AuthUser): Promise<unknown> {
    const po = await this.purchaseOrders.findWithLines(id);
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    if (po.status === 'cancelled') {
      throw new DomainError('cancelled_po', 'Cannot receive a cancelled PO', 422);
    }

    const lineById = new Map(po.lines.map((l) => [l.id, l]));
    const ledgerLines: LedgerLine[] = [];
    for (const r of input.lines) {
      const line = lineById.get(r.lineId);
      if (!line) throw new NotFoundError('POLine', r.lineId);
      if (r.qty + line.received > line.qty) {
        throw new DomainError(
          'over_receive',
          `Line ${line.id}: receive qty exceeds remaining (${r.qty} > ${line.qty - line.received})`,
          422,
        );
      }
      ledgerLines.push({
        productId: line.productId,
        warehouseId: po.warehouseId,
        delta: r.qty,
        unitCost: line.price,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.ledger.post(
        {
          businessId: actor.businessId,
          userId: actor.id,
          type: 'in',
          reason: 'achat',
          ref: po.number,
          lines: ledgerLines,
        },
        tx,
      );

      for (const r of input.lines) {
        await this.purchaseOrders.incrementLineReceived(r.lineId, r.qty, tx);
      }

      const totals = await this.purchaseOrders.findLineTotals(id, tx);
      const totalQty = totals.reduce((s, l) => s + l.qty, 0);
      const totalRcvd = totals.reduce((s, l) => s + l.received, 0);
      await this.purchaseOrders.updateStatus(
        id,
        totalRcvd >= totalQty ? 'received' : 'partiallyReceived',
        tx,
      );

      await this.purchaseOrders.logActivity(
        {
          userId: actor.id,
          action: 'po.received',
          desc: `Réception ${po.number} — ${input.lines.reduce((s, l) => s + l.qty, 0)} unité(s)`,
          ...(actor.device !== undefined ? { device: actor.device } : {}),
        },
        tx,
      );
    });

    return this.purchaseOrders.findDetail(id);
  }
}
