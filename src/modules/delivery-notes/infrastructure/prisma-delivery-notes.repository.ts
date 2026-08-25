import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import {
  DeliveryNotesRepository,
  type CustomerDebt,
  type DeliveryCreateData,
  type DeliveryDetail,
  type DeliveryRow,
  type ListParams,
  type ListResult,
  type PaymentCreateData,
  type PaymentRow,
} from '../domain/delivery-notes.repository';
import type { BonPaymentMethod, DeliveryNoteStatus, DeliveryNoteType } from '../dto/delivery-notes.dto';

const dec = (n: number | Prisma.Decimal): number =>
  typeof n === 'number' ? n : Number(n.toString());

@Injectable()
export class PrismaDeliveryNotesRepository extends DeliveryNotesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findLastNumber(businessId: string, prefix: string): Promise<string | null> {
    const row = await this.prisma.deliveryNote.findFirst({
      where: { businessId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  async create(data: DeliveryCreateData): Promise<DeliveryDetail> {
    const row = await this.prisma.deliveryNote.create({
      data: {
        businessId: data.businessId,
        number: data.number,
        type: data.type,
        date: data.date,
        status: data.status,
        customerId: data.customerId,
        supplierId: data.supplierId,
        issuedById: data.issuedById,
        sourceRef: data.sourceRef,
        carrier: data.carrier,
        notes: data.notes,
        returnOfId: data.returnOfId ?? null,
        lines: {
          create: data.lines.map((l) => ({
            productId: l.productId,
            label: l.label,
            ordered: l.ordered,
            sent: l.sent,
            unitPrice: l.unitPrice,
          })),
        },
      },
      include: {
        customer: { select: { name: true } },
        supplier: { select: { name: true } },
        issuedBy: { select: { name: true } },
        lines: true,
      },
    });
    return this.toDetail(row);
  }

  async findDetail(businessId: string, id: string): Promise<DeliveryDetail | null> {
    const row = await this.prisma.deliveryNote.findFirst({
      where: { id, businessId },
      include: {
        customer: { select: { name: true } },
        supplier: { select: { name: true } },
        issuedBy: { select: { name: true } },
        lines: true,
      },
    });
    return row ? this.toDetail(row) : null;
  }

  async list(p: ListParams): Promise<ListResult> {
    const where: Prisma.DeliveryNoteWhereInput = {
      businessId: p.businessId,
      ...(p.type ? { type: p.type } : {}),
      ...(p.status ? { status: p.status } : {}),
      ...(p.partyId
        ? { OR: [{ customerId: p.partyId }, { supplierId: p.partyId }] }
        : {}),
      ...(p.search
        ? {
            OR: [
              { number: { contains: p.search, mode: 'insensitive' } },
              { customer: { name: { contains: p.search, mode: 'insensitive' } } },
              { supplier: { name: { contains: p.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.deliveryNote.count({ where }),
      this.prisma.deliveryNote.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        include: {
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
          lines: { select: { ordered: true, sent: true } },
        },
      }),
    ]);
    return {
      total,
      page: p.page,
      pageSize: p.pageSize,
      items: rows.map((r): DeliveryRow => {
        const ordered = r.lines.reduce((a, l) => a + dec(l.ordered), 0);
        const sent = r.lines.reduce((a, l) => a + dec(l.sent), 0);
        return {
          id: r.id,
          number: r.number,
          type: r.type as DeliveryNoteType,
          date: r.date,
          status: r.status as DeliveryNoteStatus,
          partyName: r.customer?.name ?? r.supplier?.name ?? '—',
          sourceRef: r.sourceRef,
          carrier: r.carrier,
          signed: r.signed,
          ordered,
          sent,
          paid: dec(r.paid),
        };
      }),
    };
  }

  async updateStatus(id: string, status: DeliveryNoteStatus): Promise<void> {
    await this.prisma.deliveryNote.update({ where: { id }, data: { status } });
  }

  async updateLineSent(lineId: string, sent: number): Promise<void> {
    await this.prisma.deliveryNoteLine.update({ where: { id: lineId }, data: { sent } });
  }

  async markSigned(id: string, when: Date, tx: Prisma.TransactionClient): Promise<void> {
    await tx.deliveryNote.update({
      where: { id },
      data: { signed: true, signedAt: when },
    });
  }

  async findDefaultWarehouseId(
    businessId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const wh = await tx.warehouse.findFirst({
      where: { businessId, isDefault: true },
      select: { id: true },
    });
    return wh?.id ?? null;
  }

  async addPayment(data: PaymentCreateData, tx?: Prisma.TransactionClient): Promise<PaymentRow> {
    const db = (tx ?? this.prisma) as Prisma.TransactionClient;
    const row = await db.deliveryNotePayment.create({
      data: {
        businessId: data.businessId,
        deliveryNoteId: data.deliveryNoteId,
        amount: data.amount,
        method: data.method,
        note: data.note,
        createdById: data.createdById,
      },
      include: {
        deliveryNote: { select: { number: true } },
        createdBy: { select: { name: true } },
      },
    });
    await db.deliveryNote.update({
      where: { id: data.deliveryNoteId },
      data: { paid: { increment: data.amount } },
    });
    return this.toPaymentRow(row);
  }

  async findPayments(businessId: string, deliveryNoteId: string): Promise<PaymentRow[]> {
    const rows = await this.prisma.deliveryNotePayment.findMany({
      where: { businessId, deliveryNoteId },
      orderBy: { createdAt: 'desc' },
      include: {
        deliveryNote: { select: { number: true } },
        createdBy: { select: { name: true } },
      },
    });
    return rows.map((r) => this.toPaymentRow(r));
  }

  async listCustomerDebts(businessId: string): Promise<CustomerDebt[]> {
    // Billed = Σ BL line totals; returned = Σ linked RT line totals. Balance is
    // what the customer still owes on delivery notes.
    const rows = await this.prisma.$queryRaw<{
      customerId: string;
      customerName: string;
      billed: Prisma.Decimal;
      paid: Prisma.Decimal;
      returned: Prisma.Decimal;
      balance: Prisma.Decimal;
    }[]>`
      SELECT
        dn.customer_id AS "customerId",
        COALESCE(c.name, '—') AS "customerName",
        SUM(L.total) AS "billed",
        SUM(dn.paid) AS "paid",
        COALESCE(SUM(RT.total), 0) AS "returned",
        SUM(L.total) - SUM(dn.paid) - COALESCE(SUM(RT.total), 0) AS "balance"
      FROM delivery_notes dn
      JOIN LATERAL (
        SELECT COALESCE(SUM(l.sent * l.unit_price), 0) AS total
        FROM delivery_note_lines l WHERE l.delivery_note_id = dn.id
      ) L ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(RL.total), 0) AS total
        FROM delivery_notes r
        JOIN LATERAL (
          SELECT COALESCE(SUM(rl.sent * rl.unit_price), 0) AS total
          FROM delivery_note_lines rl WHERE rl.delivery_note_id = r.id
        ) RL ON TRUE
        WHERE r.return_of_id = dn.id AND r.type = 'retour'
      ) RT ON TRUE
      LEFT JOIN customers c ON c.id = dn.customer_id
      WHERE dn.business_id = ${businessId} AND dn.type = 'out' AND dn.customer_id IS NOT NULL
      GROUP BY dn.customer_id, c.name
      HAVING SUM(L.total) - SUM(dn.paid) - COALESCE(SUM(RT.total), 0) > 0
      ORDER BY balance DESC
    `;
    return rows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      billed: dec(r.billed),
      paid: dec(r.paid),
      returned: dec(r.returned),
      balance: dec(r.balance),
    }));
  }

  async listCustomerPayments(businessId: string, customerId: string): Promise<PaymentRow[]> {
    const rows = await this.prisma.deliveryNotePayment.findMany({
      where: { businessId, deliveryNote: { customerId } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        deliveryNote: { select: { number: true } },
        createdBy: { select: { name: true } },
      },
    });
    return rows.map((r) => this.toPaymentRow(r));
  }

  async findReturnedQtyByProduct(businessId: string, bonId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.deliveryNoteLine.groupBy({
      by: ['productId'],
      where: { deliveryNote: { businessId, type: 'retour', returnOfId: bonId } },
      _sum: { sent: true },
    });
    return new Map(rows.map((r) => [r.productId, dec(r._sum.sent ?? 0)]));
  }

  private toPaymentRow(row: {
    id: string;
    deliveryNoteId: string;
    amount: Prisma.Decimal;
    method: string;
    note: string | null;
    createdAt: Date;
    deliveryNote: { number: string };
    createdBy: { name: string };
  }): PaymentRow {
    return {
      id: row.id,
      deliveryNoteId: row.deliveryNoteId,
      bonNumber: row.deliveryNote.number,
      amount: dec(row.amount),
      method: row.method as BonPaymentMethod,
      note: row.note,
      createdByName: row.createdBy.name,
      createdAt: row.createdAt,
    };
  }

  private toDetail(row: {
    id: string;
    number: string;
    type: string;
    date: Date;
    status: string;
    customerId: string | null;
    customer: { name: string } | null;
    supplierId: string | null;
    supplier: { name: string } | null;
    issuedById: string;
    issuedBy: { name: string };
    sourceRef: string | null;
    carrier: string | null;
    signed: boolean;
    paid: Prisma.Decimal;
    returnOfId: string | null;
    notes: string | null;
    lines: {
      id: string;
      productId: string;
      label: string;
      ordered: Prisma.Decimal;
      sent: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
    }[];
  }): DeliveryDetail {
    return {
      id: row.id,
      number: row.number,
      type: row.type as DeliveryNoteType,
      date: row.date,
      status: row.status as DeliveryNoteStatus,
      customerId: row.customerId,
      customerName: row.customer?.name ?? null,
      supplierId: row.supplierId,
      supplierName: row.supplier?.name ?? null,
      issuedById: row.issuedById,
      issuedByName: row.issuedBy.name,
      sourceRef: row.sourceRef,
      carrier: row.carrier,
      signed: row.signed,
      paid: dec(row.paid),
      returnOfId: row.returnOfId,
      notes: row.notes,
      lines: row.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        label: l.label,
        ordered: dec(l.ordered),
        sent: dec(l.sent),
        unitPrice: dec(l.unitPrice),
      })),
    };
  }
}
