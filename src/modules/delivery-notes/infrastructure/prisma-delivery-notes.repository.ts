import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import {
  DeliveryNotesRepository,
  type DeliveryCreateData,
  type DeliveryDetail,
  type DeliveryRow,
  type ListParams,
  type ListResult,
} from '../domain/delivery-notes.repository';
import type { DeliveryNoteStatus, DeliveryNoteType } from '../dto/delivery-notes.dto';

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

  async markSigned(id: string, when: Date): Promise<void> {
    await this.prisma.deliveryNote.update({
      where: { id },
      data: { signed: true, signedAt: when },
    });
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
