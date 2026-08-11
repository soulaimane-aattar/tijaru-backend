import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import { PosRepository, type TicketLineData } from '../domain/pos.repository';
import type { CreateTicketInput, OpenSessionInput, PaymentInput } from '../dto/pos.dto';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const sessionIdFor = (d = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `S-${y}${m}${day}`;
};

const TICKET_PREFIX = 'TKT-';

@Injectable()
export class PosService {
  constructor(private readonly pos: PosRepository) {}

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async openSession(input: OpenSessionInput): Promise<unknown> {
    return this.pos.ensureSession(sessionIdFor(), input.openingFloat);
  }

  async currentSession(): Promise<unknown> {
    return this.pos.ensureSession(sessionIdFor(), 0);
  }

  // ─── Tickets ──────────────────────────────────────────────────────────────

  private async nextTicketNumber(): Promise<string> {
    const { ticketNumber, movementRef } = await this.pos.findLastTicketRefs(TICKET_PREFIX);
    const parseN = (s?: string | null): number =>
      s ? parseInt(s.slice(TICKET_PREFIX.length), 10) || 0 : 0;
    const n = Math.max(parseN(ticketNumber), parseN(movementRef)) + 1;
    return `${TICKET_PREFIX}${String(n).padStart(4, '0')}`;
  }

  /**
   * Checkout — atomic.
   *
   * Business rules decided here:
   *  1. Compute totals (HT, TVA, TTC) from current product prices + VAT.
   *  2. Validate stock at warehouse for each line; reject if any insufficient.
   *  3. Validate payment covers total (cash/split) — skipped when parked.
   *
   * The adapter then persists everything (stock decrements, `Movement{out,
   * vente, ref:TKT-####}` per line, ticket + lines, session counters,
   * customer purchases, activity) in one transaction — any failure rolls the
   * whole checkout back.
   */
  async checkout(input: CreateTicketInput, actor: AuthUser): Promise<unknown> {
    return this.performCheckout(input, actor);
  }

  private async performCheckout(
    input: CreateTicketInput,
    actor: AuthUser,
    replaceTicketId?: string,
  ): Promise<unknown> {
    const uniqueProductIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await this.pos.findSaleProducts(uniqueProductIds);
    if (products.length !== uniqueProductIds.length) {
      const found = new Set(products.map((p) => p.id));
      const missing = uniqueProductIds.filter((id) => !found.has(id));
      throw new NotFoundError('Product', missing.join(','));
    }
    const productById = new Map(products.map((p) => [p.id, p]));

    // Compute totals (per line: TTC = price × qty; HT/TVA derived from VAT rate).
    let ht = 0;
    let tva = 0;
    let ttc = 0;
    const lineData: TicketLineData[] = input.lines.map((l) => {
      const p = productById.get(l.productId)!;
      const lineHt = p.sale * l.qty;
      const lineTva = (lineHt * p.vat) / 100;
      const lineTtc = lineHt + lineTva;
      ht += lineHt;
      tva += lineTva;
      ttc += lineTtc;
      return {
        productId: l.productId,
        qty: l.qty,
        priceTtc: round2(lineTtc / l.qty),
        vat: p.vat,
      };
    });
    ht = round2(ht);
    tva = round2(tva);
    ttc = round2(ttc);
    const discount = round2(input.discount);
    if (discount > ttc) {
      throw new DomainError('invalid_discount', 'Discount exceeds total', 422);
    }
    const total = round2(ttc - discount);

    // Validate payment covers total (cash/card/split) — skip when parked (deferred payment).
    if (!input.parked) {
      if (input.payment.method === 'cash' && round2(input.payment.tendered) < total) {
        throw new DomainError('insufficient_payment', 'Tendered amount below total', 422);
      }
      if (input.payment.method === 'split') {
        const sum = round2(input.payment.cash + input.payment.card);
        if (sum !== total) {
          throw new DomainError(
            'invalid_split',
            `Split (${sum}) does not equal total (${total})`,
            422,
          );
        }
      }

      // Validate stock at warehouse for each line before touching it.
      for (const l of input.lines) {
        const avail = await this.pos.getStockQty(l.productId, input.warehouseId);
        if (avail < l.qty) {
          const p = productById.get(l.productId)!;
          throw new DomainError(
            'insufficient_stock',
            `Insufficient stock for "${p.name}" (${avail} < ${l.qty})`,
            422,
          );
        }
      }
    }

    const due = input.payment.method === 'credit' ? total : 0;
    const ticketNumber = await this.nextTicketNumber();

    return this.pos.executeCheckout(
      {
        businessId: actor.businessId,
        number: ticketNumber,
        cashierId: actor.id,
        warehouseId: input.warehouseId,
        customerId: input.customerId,
        sessionId: sessionIdFor(),
        ht,
        tva,
        total,
        discount,
        due,
        payment: input.payment,
        parked: input.parked,
        lines: lineData,
      },
      input.parked
        ? undefined
        : {
            userId: actor.id,
            action: 'stock.out',
            desc: `Vente ${ticketNumber} — ${input.lines.length} ligne(s) · ${total.toFixed(2)} MAD`,
            device: actor.device,
          },
      replaceTicketId,
    );
  }

  async park(id: string): Promise<unknown> {
    const existing = await this.pos.findTicketForResume(id);
    if (!existing) throw new NotFoundError('Ticket', id);
    return this.pos.markParked(id);
  }

  /** Resume a parked ticket — turns it into a live ticket and applies its stock/payment effects. */
  async resume(id: string, payment: PaymentInput, actor: AuthUser): Promise<unknown> {
    const existing = await this.pos.findTicketForResume(id);
    if (!existing) throw new NotFoundError('Ticket', id);
    if (!existing.parked) {
      throw new DomainError('not_parked', 'Ticket is not parked', 422);
    }
    // Re-checkout under a fresh number — the parked record is deleted in the
    // same transaction that persists the new ticket, so a failed resume keeps it.
    return this.performCheckout(
      {
        warehouseId: existing.warehouseId,
        ...(existing.customerId ? { customerId: existing.customerId } : {}),
        lines: existing.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        discount: existing.discount,
        payment,
        parked: false,
      },
      actor,
      existing.id,
    );
  }

  async receipt(id: string): Promise<unknown> {
    const data = await this.pos.findReceiptData(id);
    if (!data) throw new NotFoundError('Ticket', id);
    const { ticket, cashier, customer, warehouse, business } = data;

    const qrPayload = {
      n: ticket.number,
      ice: business?.ice ?? null,
      total: ticket.total,
      date: ticket.date.toISOString(),
    };
    const qrBase64 = Buffer.from(JSON.stringify(qrPayload), 'utf-8').toString('base64');

    return {
      ticket,
      cashier,
      customer,
      warehouse,
      business,
      qr: { base64: qrBase64, payload: qrPayload },
      footer: 'Merci de votre visite · شكرا لزيارتكم',
    };
  }
}
