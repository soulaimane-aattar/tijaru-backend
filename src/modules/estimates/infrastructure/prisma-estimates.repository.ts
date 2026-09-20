import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import type {
  EstimateCreateData,
  EstimateDetail,
  EstimateRow,
  ListParams,
  ListResult,
} from '../domain/estimates.repository';
import { EstimatesRepository } from '../domain/estimates.repository';
import type { EstimateStatus } from '../dto/estimates.dto';

const dec = (n: number | Prisma.Decimal): number =>
  typeof n === 'number' ? n : Number(n.toString());

const INCLUDE = {
  customer: { select: { name: true } },
  issuedBy: { select: { name: true } },
  lines: true,
} as const;

@Injectable()
export class PrismaEstimatesRepository extends EstimatesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findLastNumber(businessId: string, prefix: string): Promise<string | null> {
    const row = await this.prisma.estimate.findFirst({
      where: { businessId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  async create(data: EstimateCreateData): Promise<EstimateDetail> {
    const est = await this.prisma.estimate.create({
      data: {
        businessId: data.businessId,
        number: data.number,
        date: data.date,
        validUntil: data.validUntil,
        customerId: data.customerId,
        issuedById: data.issuedById,
        ht: data.ht,
        tva: data.tva,
        discount: data.discount,
        total: data.total,
        notes: data.notes,
        terms: data.terms,
        lines: {
          create: data.lines.map((l) => ({
            productId: l.productId,
            label: l.label,
            qty: l.qty,
            priceHt: l.priceHt,
            vat: l.vat,
            discount: l.discount,
          })),
        },
      },
      include: INCLUDE,
    });
    return this.toDetail(est);
  }

  async findDetail(businessId: string, id: string): Promise<EstimateDetail | null> {
    const est = await this.prisma.estimate.findFirst({
      where: { id, businessId },
      include: INCLUDE,
    });
    return est ? this.toDetail(est) : null;
  }

  async list(p: ListParams): Promise<ListResult> {
    const where: Prisma.EstimateWhereInput = {
      businessId: p.businessId,
      ...(p.status ? { status: p.status } : {}),
      ...(p.customerId ? { customerId: p.customerId } : {}),
      ...(p.search
        ? {
            OR: [
              { number: { contains: p.search, mode: 'insensitive' } },
              { customer: { name: { contains: p.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.estimate.count({ where }),
      this.prisma.estimate.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        include: { customer: { select: { name: true } } },
      }),
    ]);
    return {
      total,
      page: p.page,
      pageSize: p.pageSize,
      items: rows.map(
        (r): EstimateRow => ({
          id: r.id,
          number: r.number,
          date: r.date,
          validUntil: r.validUntil,
          customerId: r.customerId,
          customerName: r.customer.name,
          status: r.status as EstimateStatus,
          total: dec(r.total),
        }),
      ),
    };
  }

  async update(
    id: string,
    data: Partial<EstimateCreateData> & { status?: EstimateStatus },
  ): Promise<EstimateDetail> {
    const { lines, ...rest } = data;
    const updateData: Prisma.EstimateUpdateInput = {};

    if (rest.date !== undefined) updateData.date = rest.date;
    if (rest.validUntil !== undefined) updateData.validUntil = rest.validUntil;
    if (rest.customerId !== undefined) updateData.customer = { connect: { id: rest.customerId } };
    if (rest.status !== undefined) updateData.status = rest.status;
    if (rest.ht !== undefined) updateData.ht = rest.ht;
    if (rest.tva !== undefined) updateData.tva = rest.tva;
    if (rest.discount !== undefined) updateData.discount = rest.discount;
    if (rest.total !== undefined) updateData.total = rest.total;
    if (rest.notes !== undefined) updateData.notes = rest.notes;
    if (rest.terms !== undefined) updateData.terms = rest.terms;

    if (lines) {
      updateData.lines = {
        deleteMany: {},
        create: lines.map((l) => ({
          productId: l.productId,
          label: l.label,
          qty: l.qty,
          priceHt: l.priceHt,
          vat: l.vat,
          discount: l.discount,
        })),
      };
    }

    const est = await this.prisma.estimate.update({
      where: { id },
      data: updateData,
      include: INCLUDE,
    });
    return this.toDetail(est);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.estimate.delete({ where: { id } });
  }

  private toDetail(est: {
    id: string;
    number: string;
    date: Date;
    validUntil: Date;
    customerId: string;
    customer: { name: string };
    issuedById: string;
    issuedBy: { name: string };
    status: string;
    ht: Prisma.Decimal;
    tva: Prisma.Decimal;
    discount: Prisma.Decimal;
    total: Prisma.Decimal;
    notes: string | null;
    terms: string | null;
    lines: {
      id: string;
      productId: string;
      label: string;
      qty: Prisma.Decimal;
      priceHt: Prisma.Decimal;
      vat: number;
      discount: Prisma.Decimal;
    }[];
  }): EstimateDetail {
    return {
      id: est.id,
      number: est.number,
      date: est.date,
      validUntil: est.validUntil,
      customerId: est.customerId,
      customerName: est.customer.name,
      issuedById: est.issuedById,
      issuedByName: est.issuedBy.name,
      status: est.status as EstimateStatus,
      ht: dec(est.ht),
      tva: dec(est.tva),
      discount: dec(est.discount),
      total: dec(est.total),
      notes: est.notes,
      terms: est.terms,
      lines: est.lines.map((l) => {
        const priceHt = dec(l.priceHt);
        const qty = dec(l.qty);
        const discount = dec(l.discount);
        const subtotal = Math.round((priceHt * qty - discount) * 100) / 100;
        return {
          id: l.id,
          productId: l.productId,
          label: l.label,
          qty,
          priceHt,
          vat: l.vat,
          discount,
          subtotal: Math.max(0, subtotal),
        };
      }),
    };
  }
}
