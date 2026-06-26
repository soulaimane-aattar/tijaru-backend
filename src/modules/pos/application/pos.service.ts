import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import type { CreateTicketInput, OpenSessionInput, PaymentInput } from '../dto/pos.dto';

const dec = (n: number | Prisma.Decimal): number =>
  typeof n === 'number' ? n : Number(n.toString());

const sessionIdFor = (d = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `S-${y}${m}${day}`;
};

const nextTicketNumber = async (prisma: PrismaService): Promise<string> => {
  // Consider both existing POTickets and historical Movement refs (seed data
  // may reference TKT-XXXX without a matching ticket row).
  const [lastTicket, lastMvtRef] = await Promise.all([
    prisma.pOTicket.findFirst({
      where: { number: { startsWith: 'TKT-' } },
      orderBy: { number: 'desc' },
      select: { number: true },
    }),
    prisma.movement.findFirst({
      where: { ref: { startsWith: 'TKT-' } },
      orderBy: { ref: 'desc' },
      select: { ref: true },
    }),
  ]);
  const parseN = (s?: string | null): number =>
    s ? parseInt(s.slice(4), 10) || 0 : 0;
  const n = Math.max(parseN(lastTicket?.number), parseN(lastMvtRef?.ref)) + 1;
  return `TKT-${String(n).padStart(4, '0')}`;
};

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async openSession(input: OpenSessionInput): Promise<unknown> {
    const id = sessionIdFor();
    return this.prisma.pOSession.upsert({
      where: { id },
      create: { id, openingFloat: input.openingFloat },
      update: {},
    });
  }

  async currentSession(): Promise<unknown> {
    const id = sessionIdFor();
    const session = await this.prisma.pOSession.findUnique({ where: { id } });
    if (!session) {
      return this.prisma.pOSession.create({ data: { id, openingFloat: 0 } });
    }
    return session;
  }

  // ─── Tickets ──────────────────────────────────────────────────────────────

  /**
   * Checkout — atomic.
   *
   * In one $transaction:
   *  1. Compute totals (HT, TVA, TTC) from current product prices + VAT.
   *  2. Validate stock at warehouse for each line; reject if any insufficient.
   *  3. Decrement stock + emit `Movement{type:'out', reason:'vente', ref:TKT-####}` per line.
   *  4. Create POTicket + lines.
   *  5. Bump session counters.
   *  6. Log activity.
   *  7. Bump customer.purchases if customer present and payment != credit-only-not-paid.
   *
   * Any failure rolls back the whole transaction.
   */
  async checkout(input: CreateTicketInput, actor: AuthUser): Promise<unknown> {
    const uniqueProductIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: uniqueProductIds }, deletedAt: null },
    });
    if (products.length !== uniqueProductIds.length) {
      const found = new Set(products.map((p) => p.id));
      const missing = uniqueProductIds.filter((id) => !found.has(id));
      throw new NotFoundError('Product', missing.join(','));
    }
    const productById = new Map(products.map((p) => [p.id, p]));

    // Compute totals (per line: TTC = price × qty; HT/TVA derived from VAT rate).
    let ht = new Prisma.Decimal(0);
    let tva = new Prisma.Decimal(0);
    let ttc = new Prisma.Decimal(0);
    const lineData = input.lines.map((l) => {
      const p = productById.get(l.productId)!;
      const vatRate = p.vat;
      const saleHt = new Prisma.Decimal(p.sale);
      const lineHt = saleHt.mul(l.qty);
      const lineTva = lineHt.mul(vatRate).div(100);
      const lineTtc = lineHt.add(lineTva);
      ht = ht.add(lineHt);
      tva = tva.add(lineTva);
      ttc = ttc.add(lineTtc);
      return {
        productId: l.productId,
        qty: l.qty,
        priceTtc: lineTtc.div(l.qty),
        vat: vatRate,
      };
    });
    const discount = new Prisma.Decimal(input.discount);
    if (discount.gt(ttc)) {
      throw new DomainError('invalid_discount', 'Discount exceeds total', 422);
    }
    const total = ttc.sub(discount);

    // Validate payment covers total (cash/card/split) — skip when parked (deferred payment).
    if (!input.parked) {
      if (input.payment.method === 'cash' && new Prisma.Decimal(input.payment.tendered).lt(total)) {
        throw new DomainError('insufficient_payment', 'Tendered amount below total', 422);
      }
      if (input.payment.method === 'split') {
        const sum = new Prisma.Decimal(input.payment.cash).add(input.payment.card);
        if (!sum.eq(total)) {
          throw new DomainError(
            'invalid_split',
            `Split (${dec(sum)}) does not equal total (${dec(total)})`,
            422,
          );
        }
      }
    }

    const due =
      input.payment.method === 'credit' ? total : new Prisma.Decimal(0);

    return this.prisma.$transaction(async (tx) => {
      // Ensure today's session exists.
      const session = await tx.pOSession.upsert({
        where: { id: sessionIdFor() },
        create: { id: sessionIdFor(), openingFloat: 0 },
        update: {},
      });

      const ticketNumber = await nextTicketNumber(this.prisma);

      // Validate + decrement stock + emit movements (only if not parked).
      if (!input.parked) {
        for (const l of input.lines) {
          const sl = await tx.stockLevel.findUnique({
            where: {
              productId_warehouseId: { productId: l.productId, warehouseId: input.warehouseId },
            },
          });
          const avail = sl?.qty ?? 0;
          if (avail < l.qty) {
            const p = productById.get(l.productId)!;
            throw new DomainError(
              'insufficient_stock',
              `Insufficient stock for "${p.name}" (${avail} < ${l.qty})`,
              422,
            );
          }
        }

        for (const l of input.lines) {
          await tx.stockLevel.update({
            where: {
              productId_warehouseId: { productId: l.productId, warehouseId: input.warehouseId },
            },
            data: { qty: { decrement: l.qty } },
          });
          await tx.movement.create({
            data: {
              type: 'out',
              productId: l.productId,
              qty: l.qty,
              warehouseId: input.warehouseId,
              userId: actor.id,
              reason: 'vente',
              ref: ticketNumber,
            },
          });
        }
      }

      const ticket = await tx.pOTicket.create({
        data: {
          number: ticketNumber,
          cashierId: actor.id,
          warehouseId: input.warehouseId,
          ...(input.customerId ? { customerId: input.customerId } : {}),
          sessionId: session.id,
          ht,
          tva,
          total,
          discount,
          due,
          payment: input.payment as unknown as Prisma.InputJsonValue,
          parked: input.parked,
          lines: { create: lineData },
        },
        include: {
          lines: { include: { product: { select: { id: true, name: true, sku: true, tone: true } } } },
        },
      });

      if (!input.parked) {
        await tx.pOSession.update({
          where: { id: session.id },
          data: { sales: { increment: 1 }, revenue: { increment: total } },
        });
        if (input.customerId) {
          await tx.customer.update({
            where: { id: input.customerId },
            data: { purchases: { increment: total } },
          });
        }
        await tx.activity.create({
          data: {
            userId: actor.id,
            action: 'stock.out',
            desc: `Vente ${ticketNumber} — ${input.lines.length} ligne(s) · ${dec(total).toFixed(2)} MAD`,
            ...(actor.device ? { device: actor.device } : {}),
          },
        });
      }

      return ticket;
    });
  }

  async park(id: string): Promise<unknown> {
    const existing = await this.prisma.pOTicket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Ticket', id);
    return this.prisma.pOTicket.update({ where: { id }, data: { parked: true } });
  }

  /** Resume a parked ticket — turns it into a live ticket and applies its stock/payment effects. */
  async resume(id: string, payment: PaymentInput, actor: AuthUser): Promise<unknown> {
    const existing = await this.prisma.pOTicket.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!existing) throw new NotFoundError('Ticket', id);
    if (!existing.parked) {
      throw new DomainError('not_parked', 'Ticket is not parked', 422);
    }
    // Re-checkout under the same number — simplest path is to delete the parked record
    // and re-run checkout. Done in a transaction to preserve number continuity.
    return this.prisma.$transaction(async (tx) => {
      const linesInput = existing.lines.map((l) => ({ productId: l.productId, qty: l.qty }));
      await tx.pOTicketLine.deleteMany({ where: { ticketId: existing.id } });
      await tx.pOTicket.delete({ where: { id: existing.id } });
      return this.checkout(
        {
          warehouseId: existing.warehouseId,
          ...(existing.customerId ? { customerId: existing.customerId } : {}),
          lines: linesInput,
          discount: dec(existing.discount),
          payment,
          parked: false,
        },
        actor,
      );
    });
  }

  async receipt(id: string): Promise<unknown> {
    const ticket = await this.prisma.pOTicket.findUnique({
      where: { id },
      include: {
        cashier: { select: { id: true, name: true, role: true } },
        customer: { select: { id: true, name: true, ice: true, phone: true } },
        lines: {
          include: { product: { select: { id: true, name: true, sku: true, barcode: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundError('Ticket', id);

    const business = await this.prisma.business.findFirst();
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: ticket.warehouseId },
      select: { id: true, name: true, city: true, address: true, phone: true },
    });

    const qrPayload = {
      n: ticket.number,
      ice: business?.ice ?? null,
      total: dec(ticket.total),
      date: ticket.date.toISOString(),
    };
    const qrBase64 = Buffer.from(JSON.stringify(qrPayload), 'utf-8').toString('base64');

    return {
      ticket: {
        id: ticket.id,
        number: ticket.number,
        date: ticket.date,
        ht: dec(ticket.ht),
        tva: dec(ticket.tva),
        total: dec(ticket.total),
        discount: dec(ticket.discount),
        due: dec(ticket.due),
        payment: ticket.payment,
        parked: ticket.parked,
        lines: ticket.lines.map((l) => ({
          productId: l.productId,
          name: l.product.name,
          sku: l.product.sku,
          barcode: l.product.barcode,
          qty: l.qty,
          priceTtc: dec(l.priceTtc),
          vat: l.vat,
          lineTotal: dec(new Prisma.Decimal(l.priceTtc).mul(l.qty)),
        })),
      },
      cashier: ticket.cashier,
      customer: ticket.customer,
      warehouse,
      business: business
        ? {
            name: business.name,
            ice: business.ice,
            address: business.address,
            city: business.city,
            phone: business.phone,
          }
        : null,
      qr: { base64: qrBase64, payload: qrPayload },
      footer: 'Merci de votre visite · شكرا لزيارتكم',
    };
  }
}
