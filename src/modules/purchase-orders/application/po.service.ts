import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import { PurchaseOrdersRepository, type ReceiptLine } from '../domain/po.repository';
import type { CreatePOInput, ListPOQuery, PatchPOInput, ReceivePOInput } from '../dto/po.dto';

@Injectable()
export class POService {
  constructor(private readonly purchaseOrders: PurchaseOrdersRepository) {}

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
   *  - Emit Movement{in, achat, ref:po.number}.
   *  - Increment StockLevel at po.warehouseId.
   *  - Increment line.received.
   * Then the PO status is recomputed (received / partiallyReceived). Atomic transaction.
   */
  async receive(id: string, input: ReceivePOInput, actor: AuthUser): Promise<unknown> {
    const po = await this.purchaseOrders.findWithLines(id);
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    if (po.status === 'cancelled') {
      throw new DomainError('cancelled_po', 'Cannot receive a cancelled PO', 422);
    }

    const lineById = new Map(po.lines.map((l) => [l.id, l]));
    const receipts: ReceiptLine[] = [];
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
      receipts.push({ lineId: line.id, productId: line.productId, qty: r.qty });
    }

    return this.purchaseOrders.receive({
      poId: id,
      warehouseId: po.warehouseId,
      movementRef: po.number,
      receipts,
      actorId: actor.id,
      actorDevice: actor.device,
      activityDesc: `Réception ${po.number} — ${input.lines.reduce((s, l) => s + l.qty, 0)} unité(s)`,
    });
  }
}
