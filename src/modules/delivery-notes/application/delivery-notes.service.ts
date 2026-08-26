import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError, ValidationError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type { LedgerLine } from '../../stock-ledger/domain/stock-ledger.types';
import {
  DeliveryNotesRepository,
  ProductPriceLookup,
  type CustomerDebt,
  type DeliveryDetail,
  type DeliveryLineData,
  type DeliveryLineRow,
  type PaymentRow,
} from '../domain/delivery-notes.repository';
import type {
  AddPaymentInput,
  CreateDeliveryNoteInput,
  CreateReturnInput,
  DeliveryNoteStatus,
  DeliveryNoteType,
  ListDeliveryNotesQuery,
} from '../dto/delivery-notes.dto';

/** Response line shape: adds the computed `subtotal` on top of the persisted row. */
export interface DeliveryNoteLineDto extends DeliveryLineRow {
  subtotal: number;
}

/** Response shape: `DeliveryDetail` with per-line subtotal and note-level totals. */
export interface DeliveryNoteDto extends Omit<DeliveryDetail, 'lines'> {
  lines: DeliveryNoteLineDto[];
  totals: { subtotal: number; paid: number; remaining: number };
}

const PREFIX: Record<DeliveryNoteType, string> = {
  order: 'BC',
  out: 'BL',
  in_: 'BR',
  retour: 'RT',
};

/**
 * Derive the auto-status from line quantities.
 *  - all sent >= ordered → delivered
 *  - some sent > 0 but not all filled → partial
 *  - none sent → keep whatever the caller set (prepared/sent/shipped/closed)
 * Pure — unit-tested without a repository.
 */
export function statusFromLines(
  lines: readonly { ordered: number; sent: number }[],
  fallback: DeliveryNoteStatus,
): DeliveryNoteStatus {
  const total = lines.reduce((a, l) => a + l.ordered, 0);
  const done = lines.reduce((a, l) => a + Math.min(l.sent, l.ordered), 0);
  if (done <= 0) return fallback;
  if (done >= total) return 'delivered';
  return 'partial';
}

@Injectable()
export class DeliveryNotesService {
  constructor(
    private readonly repo: DeliveryNotesRepository,
    private readonly products: ProductPriceLookup,
    private readonly ledger: StockLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  async list(businessId: string, query: ListDeliveryNotesQuery) {
    return this.repo.list({
      businessId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.partyId ? { partyId: query.partyId } : {}),
      ...(query.search ? { search: query.search } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async get(businessId: string, id: string): Promise<DeliveryNoteDto> {
    const found = await this.repo.findDetail(businessId, id);
    if (!found) throw new NotFoundError('DeliveryNote', id);
    return this.toResponse(found);
  }

  async create(input: CreateDeliveryNoteInput, actor: AuthUser): Promise<DeliveryNoteDto> {
    for (const l of input.lines) {
      if (l.sent > l.ordered) {
        throw new DomainError(
          'invalid_line_sent',
          `Line "${l.label}" cannot ship more than ordered`,
          422,
        );
      }
    }
    const date = input.date ?? new Date();
    const status = statusFromLines(input.lines, input.status);
    const number = await this.nextNumber(actor.businessId, input.type, date.getFullYear());
    const lines: DeliveryLineData[] = await Promise.all(
      input.lines.map(async (l) => ({
        productId: l.productId,
        label: l.label,
        ordered: l.ordered,
        sent: l.sent,
        unitPrice: await this.resolveUnitPrice(actor.businessId, l.productId, l.unitPrice),
      })),
    );
    const created = await this.repo.create({
      businessId: actor.businessId,
      number,
      type: input.type,
      date,
      status,
      customerId: input.customerId ?? null,
      supplierId: input.supplierId ?? null,
      issuedById: actor.id,
      sourceRef: input.sourceRef ?? null,
      carrier: input.carrier ?? null,
      notes: input.notes ?? null,
      lines,
    });
    return this.toResponse(created);
  }

  /** Explicit unitPrice wins; otherwise prefill from the product's current price. */
  private async resolveUnitPrice(
    businessId: string,
    productId: string,
    explicit: number | undefined,
  ): Promise<number> {
    if (explicit !== undefined) return explicit;
    const p = await this.products.findById(businessId, productId);
    return Number(p?.price ?? 0);
  }

  /**
   * Pure: sum of line quantity × unitPrice, rounded to 2dp.
   * BL (`out`) and returns (`retour`) bill what was actually sent;
   * BC/BR bill the ordered quantity.
   */
  computeTotals(note: {
    type: DeliveryNoteType;
    lines: Array<{
      sent: number | string;
      ordered: number | string;
      unitPrice: number | string;
    }>;
  }): { subtotal: number } {
    const qty = (l: { sent: number | string; ordered: number | string }) =>
      Number(note.type === 'out' || note.type === 'retour' ? l.sent : l.ordered);
    const price = (l: { unitPrice: number | string }) => Number(l.unitPrice ?? 0);
    const subtotal = note.lines.reduce((s, l) => s + qty(l) * price(l), 0);
    return { subtotal: Math.round(subtotal * 100) / 100 };
  }

  private toResponse(note: DeliveryDetail): DeliveryNoteDto {
    const totals = this.computeTotals(note);
    const qty = (l: DeliveryLineRow) =>
      note.type === 'out' || note.type === 'retour' ? l.sent : l.ordered;
    const paid = Math.min(Number(note.paid ?? 0), totals.subtotal);
    return {
      ...note,
      lines: note.lines.map((l) => ({
        ...l,
        subtotal: Math.round(qty(l) * l.unitPrice * 100) / 100,
      })),
      totals: {
        subtotal: totals.subtotal,
        paid: Math.round(paid * 100) / 100,
        remaining: Math.round((totals.subtotal - paid) * 100) / 100,
      },
    };
  }

  /** Per-tenant, per-year, per-type: BC-2026-0001, BL-2026-0001, BR-2026-0001, … */
  private async nextNumber(businessId: string, type: DeliveryNoteType, year: number): Promise<string> {
    const prefix = `${PREFIX[type]}-${year}-`;
    const last = await this.repo.findLastNumber(businessId, prefix);
    const n = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(4, '0')}`;
  }

  async updateLineSent(
    businessId: string,
    id: string,
    lineId: string,
    sent: number,
  ): Promise<DeliveryNoteDto> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('DeliveryNote', id);
    if (inv.status === 'closed') {
      throw new DomainError('closed_note', 'Closed notes cannot be modified', 422);
    }
    const line = inv.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundError('DeliveryNoteLine', lineId);
    if (sent > line.ordered) {
      throw new DomainError('invalid_line_sent', 'Sent cannot exceed ordered', 422);
    }
    await this.repo.updateLineSent(lineId, sent);
    const updatedLines = inv.lines.map((l) => (l.id === lineId ? { ...l, sent } : l));
    const nextStatus = statusFromLines(updatedLines, inv.status);
    if (nextStatus !== inv.status) await this.repo.updateStatus(id, nextStatus);
    const fresh = await this.repo.findDetail(businessId, id);
    return this.toResponse(fresh!);
  }

  /**
   * Sign a delivery note. Idempotent: an already-signed note is a no-op
   * (never re-posts to the ledger).
   *
   * Stock effect depends on type — and only applies when the business has
   * `bonsAffectStock` enabled (default):
   *  - `out` (BL, livraison) decrements stock — reason `vente`.
   *  - `in_` (BR, réception) increments stock — reason `achat`.
   *  - `retour` (RT, retour client) increments stock — reason `retour`.
   *  - `order` (BC, bon de commande) has no stock effect.
   *
   * With the feature disabled, signing is documentary only: the note flips to
   * signed and nothing touches the ledger.
   *
   * DeliveryNote carries no warehouseId of its own, so out/in_/retour signing
   * uses the business's default warehouse (mirrors POS session warehouse pick).
   * Only lines with `sent > 0` post to the ledger. The ledger's conditional
   * decrement enforces availability: an insufficient-stock BL rejects the
   * whole transaction (nothing is marked signed).
   */
  async sign(businessId: string, id: string, actor: AuthUser): Promise<void> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('DeliveryNote', id);
    if (inv.signed) return;

    const biz = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { bonsAffectStock: true },
    });
    const stockEnabled = biz?.bonsAffectStock ?? true;

    await this.prisma.$transaction(async (tx) => {
      if (stockEnabled && inv.type !== 'order') {
        const linesToPost = inv.lines.filter((l) => l.sent > 0);
        if (linesToPost.length > 0) {
          const warehouseId = await this.repo.findDefaultWarehouseId(businessId, tx);
          if (!warehouseId) throw new ValidationError('no_default_warehouse');
          const direction = inv.type === 'out' ? -1 : 1;
          const reason = inv.type === 'out' ? 'vente' : inv.type === 'in_' ? 'achat' : 'retour';
          const lines: LedgerLine[] = linesToPost.map((l) => ({
            productId: l.productId,
            warehouseId,
            delta: direction * l.sent,
          }));
          await this.ledger.post(
            {
              businessId,
              userId: actor.id,
              type: direction === -1 ? 'out' : 'in',
              reason,
              ref: inv.number,
              lines,
            },
            tx,
          );
        }
      }
      await this.repo.markSigned(id, new Date(), tx);
    });
  }

  /**
   * Record a payment against a delivery note. Only `out` notes carry client
   * debt. Rejects overpayment: amount is capped at the remaining balance.
   */
  async addPayment(
    businessId: string,
    id: string,
    input: AddPaymentInput,
    actor: AuthUser,
  ): Promise<PaymentRow> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('DeliveryNote', id);
    if (inv.type !== 'out') {
      throw new DomainError('payments_only_on_delivery', 'Only delivery notes can be paid', 422);
    }
    const total = this.computeTotals(inv).subtotal;
    const remaining = Math.round((total - Number(inv.paid)) * 100) / 100;
    if (remaining <= 0) {
      throw new DomainError('already_paid', 'This note is already fully paid', 422);
    }
    if (input.amount > remaining + 0.001) {
      throw new DomainError(
        'overpay',
        `Payment exceeds the remaining balance (${remaining.toFixed(2)})`,
        422,
      );
    }
    return this.repo.addPayment({
      businessId,
      deliveryNoteId: id,
      amount: input.amount,
      method: input.method,
      note: input.note ?? null,
      createdById: actor.id,
    });
  }

  listPayments(businessId: string, id: string): Promise<PaymentRow[]> {
    return this.repo.findPayments(businessId, id);
  }

  /**
   * Return goods against a signed BL. Creates a linked RT note that is signed
   * immediately (the goods are factually back), which restocks via the ledger
   * and reduces the customer's debt by the returned value. A product cannot be
   * returned more than was sent minus what previous returns already took back.
   */
  async createReturn(
    businessId: string,
    id: string,
    input: CreateReturnInput,
    actor: AuthUser,
  ): Promise<DeliveryNoteDto> {
    const bl = await this.repo.findDetail(businessId, id);
    if (!bl) throw new NotFoundError('DeliveryNote', id);
    if (bl.type !== 'out') {
      throw new DomainError('return_only_on_delivery', 'Only delivery notes can be returned', 422);
    }
    if (!bl.signed) {
      throw new DomainError('not_signed', 'Sign the delivery note before returning it', 422);
    }
    if (!bl.customerId) {
      throw new DomainError('missing_customer', 'The note has no customer', 422);
    }

    const alreadyReturned = await this.repo.findReturnedQtyByProduct(businessId, bl.id);
    const lineByPk = new Map(bl.lines.map((l) => [l.id, l]));

    const lines: DeliveryLineData[] = input.lines.map((rl) => {
      const src = lineByPk.get(rl.lineId);
      if (!src) throw new NotFoundError('DeliveryNoteLine', rl.lineId);
      const previouslyReturned = alreadyReturned.get(src.productId) ?? 0;
      const returnable = Math.round((src.sent - previouslyReturned) * 1000) / 1000;
      if (rl.qty > returnable + 1e-9) {
        throw new DomainError(
          'invalid_return_qty',
          `Cannot return ${rl.qty} of "${src.label}" — only ${Math.max(returnable, 0)} returnable`,
          422,
        );
      }
      return {
        productId: src.productId,
        label: src.label,
        ordered: rl.qty,
        sent: rl.qty,
        unitPrice: src.unitPrice,
      };
    });

    const date = new Date();
    const number = await this.nextNumber(actor.businessId, 'retour', date.getFullYear());
    const created = await this.repo.create({
      businessId: actor.businessId,
      number,
      type: 'retour',
      date,
      status: 'delivered',
      customerId: bl.customerId,
      supplierId: null,
      issuedById: actor.id,
      sourceRef: bl.number,
      carrier: null,
      notes: input.notes ?? null,
      returnOfId: bl.id,
      lines,
    });
    // Goods are back: post the restock right away so debt and stock stay in sync.
    await this.sign(businessId, created.id, actor);
    const fresh = await this.repo.findDetail(businessId, created.id);
    return this.toResponse(fresh!);
  }

  listCustomerDebts(businessId: string): Promise<CustomerDebt[]> {
    return this.repo.listCustomerDebts(businessId);
  }

  listCustomerPayments(businessId: string, customerId: string): Promise<PaymentRow[]> {
    return this.repo.listCustomerPayments(businessId, customerId);
  }

  async setStatus(businessId: string, id: string, status: DeliveryNoteStatus): Promise<void> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('DeliveryNote', id);
    await this.repo.updateStatus(id, status);
  }
}
