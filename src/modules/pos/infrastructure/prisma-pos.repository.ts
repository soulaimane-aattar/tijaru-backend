import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  PosRepository,
  type ActivityLog,
  type CheckoutTicketData,
  type ParkedTicketView,
  type ReceiptData,
  type SaleProduct,
} from '../domain/pos.repository';

const dec = (n: number | Prisma.Decimal): number =>
  typeof n === 'number' ? n : Number(n.toString());

@Injectable()
export class PrismaPosRepository extends PosRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  ensureSession(id: string, openingFloat: number): Promise<unknown> {
    return this.prisma.pOSession.upsert({
      where: { id },
      create: scoped<Prisma.POSessionUncheckedCreateInput>({ id, openingFloat }),
      update: {},
    });
  }

  async findSaleProducts(ids: string[]): Promise<SaleProduct[]> {
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true, sale: true, vat: true },
    });
    return products.map((p) => ({ id: p.id, name: p.name, sale: dec(p.sale), vat: p.vat }));
  }

  async findLastTicketRefs(
    prefix: string,
  ): Promise<{ ticketNumber: string | null; movementRef: string | null }> {
    const [lastTicket, lastMvt] = await Promise.all([
      this.prisma.pOTicket.findFirst({
        where: { number: { startsWith: prefix } },
        orderBy: { number: 'desc' },
        select: { number: true },
      }),
      this.prisma.movement.findFirst({
        where: { ref: { startsWith: prefix } },
        orderBy: { ref: 'desc' },
        select: { ref: true },
      }),
    ]);
    return { ticketNumber: lastTicket?.number ?? null, movementRef: lastMvt?.ref ?? null };
  }

  async getStockQty(productId: string, warehouseId: string): Promise<number> {
    const level = await this.prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { qty: true },
    });
    return level?.qty ?? 0;
  }

  executeCheckout(
    data: CheckoutTicketData,
    activity?: ActivityLog,
    replaceTicketId?: string,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.pOSession.upsert({
        where: { id: data.sessionId },
        create: scoped<Prisma.POSessionUncheckedCreateInput>({
          id: data.sessionId,
          openingFloat: 0,
        }),
        update: {},
      });

      if (replaceTicketId) {
        await tx.pOTicketLine.deleteMany({ where: { ticketId: replaceTicketId } });
        await tx.pOTicket.delete({ where: { id: replaceTicketId } });
      }

      if (!data.parked) {
        for (const l of data.lines) {
          await tx.stockLevel.update({
            where: {
              productId_warehouseId: { productId: l.productId, warehouseId: data.warehouseId },
            },
            data: { qty: { decrement: l.qty } },
          });
          await tx.movement.create({
            data: scoped<Prisma.MovementUncheckedCreateInput>({
              type: 'out',
              productId: l.productId,
              qty: l.qty,
              warehouseId: data.warehouseId,
              userId: data.cashierId,
              reason: 'vente',
              ref: data.number,
            }),
          });
        }
      }

      const ticket = await tx.pOTicket.create({
        data: scoped<Prisma.POTicketUncheckedCreateInput>({
          number: data.number,
          cashierId: data.cashierId,
          warehouseId: data.warehouseId,
          ...(data.customerId ? { customerId: data.customerId } : {}),
          sessionId: session.id,
          ht: data.ht,
          tva: data.tva,
          total: data.total,
          discount: data.discount,
          due: data.due,
          payment: data.payment as Prisma.InputJsonValue,
          parked: data.parked,
          lines: { create: data.lines },
        }),
        include: {
          lines: { include: { product: { select: { id: true, name: true, sku: true, tone: true } } } },
        },
      });

      if (!data.parked) {
        await tx.pOSession.update({
          where: { id: session.id },
          data: { sales: { increment: 1 }, revenue: { increment: data.total } },
        });
        if (data.customerId) {
          await tx.customer.update({
            where: { id: data.customerId },
            data: { purchases: { increment: data.total } },
          });
        }
        if (activity) {
          await tx.activity.create({
            data: scoped<Prisma.ActivityUncheckedCreateInput>({
              userId: activity.userId,
              action: activity.action,
              desc: activity.desc,
              ...(activity.device ? { device: activity.device } : {}),
            }),
          });
        }
      }

      return ticket;
    });
  }

  async findTicketForResume(id: string): Promise<ParkedTicketView | null> {
    const ticket = await this.prisma.pOTicket.findUnique({
      where: { id },
      include: { lines: { select: { productId: true, qty: true } } },
    });
    if (!ticket) return null;
    return {
      id: ticket.id,
      warehouseId: ticket.warehouseId,
      customerId: ticket.customerId,
      discount: dec(ticket.discount),
      parked: ticket.parked,
      lines: ticket.lines,
    };
  }

  markParked(id: string): Promise<unknown> {
    return this.prisma.pOTicket.update({ where: { id }, data: { parked: true } });
  }

  async findReceiptData(id: string): Promise<ReceiptData | null> {
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
    if (!ticket) return null;

    const business = await this.prisma.business.findFirst();
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: ticket.warehouseId },
      select: { id: true, name: true, city: true, address: true, phone: true },
    });

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
    };
  }
}
