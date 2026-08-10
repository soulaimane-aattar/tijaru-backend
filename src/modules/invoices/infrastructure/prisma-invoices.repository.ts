import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import type {
  InvoiceCreateData,
  InvoiceDetail,
  InvoiceRow,
  ListParams,
  ListResult,
} from '../domain/invoices.repository';
import { InvoicesRepository } from '../domain/invoices.repository';
import type { InvoiceStatus } from '../dto/invoices.dto';

const dec = (n: number | Prisma.Decimal): number =>
  typeof n === 'number' ? n : Number(n.toString());

@Injectable()
export class PrismaInvoicesRepository extends InvoicesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findLastNumber(businessId: string, prefix: string): Promise<string | null> {
    const row = await this.prisma.invoice.findFirst({
      where: { businessId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  async create(data: InvoiceCreateData): Promise<InvoiceDetail> {
    const inv = await this.prisma.invoice.create({
      data: {
        businessId: data.businessId,
        number: data.number,
        date: data.date,
        dueDate: data.dueDate,
        customerId: data.customerId,
        issuedById: data.issuedById,
        status: data.status,
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
      include: {
        customer: { select: { name: true } },
        issuedBy: { select: { name: true } },
        lines: true,
      },
    });
    return this.toDetail(inv);
  }

  async findDetail(businessId: string, id: string): Promise<InvoiceDetail | null> {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, businessId },
      include: {
        customer: { select: { name: true } },
        issuedBy: { select: { name: true } },
        lines: true,
      },
    });
    return inv ? this.toDetail(inv) : null;
  }

  async list(p: ListParams): Promise<ListResult> {
    const where: Prisma.InvoiceWhereInput = {
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
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
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
        (r): InvoiceRow => ({
          id: r.id,
          number: r.number,
          date: r.date,
          dueDate: r.dueDate,
          customerId: r.customerId,
          customerName: r.customer.name,
          status: r.status as InvoiceStatus,
          ht: dec(r.ht),
          tva: dec(r.tva),
          discount: dec(r.discount),
          total: dec(r.total),
          paid: dec(r.paid),
        }),
      ),
    };
  }

  async updateStatus(id: string, status: InvoiceStatus): Promise<void> {
    await this.prisma.invoice.update({ where: { id }, data: { status } });
  }

  async addPayment(id: string, amount: number): Promise<InvoiceDetail> {
    const inv = await this.prisma.invoice.update({
      where: { id },
      data: { paid: { increment: amount } },
      include: {
        customer: { select: { name: true } },
        issuedBy: { select: { name: true } },
        lines: true,
      },
    });
    return this.toDetail(inv);
  }

  private toDetail(inv: {
    id: string;
    number: string;
    date: Date;
    dueDate: Date;
    customerId: string;
    customer: { name: string };
    issuedById: string;
    issuedBy: { name: string };
    status: string;
    ht: Prisma.Decimal;
    tva: Prisma.Decimal;
    discount: Prisma.Decimal;
    total: Prisma.Decimal;
    paid: Prisma.Decimal;
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
  }): InvoiceDetail {
    return {
      id: inv.id,
      number: inv.number,
      date: inv.date,
      dueDate: inv.dueDate,
      customerId: inv.customerId,
      customerName: inv.customer.name,
      issuedById: inv.issuedById,
      issuedByName: inv.issuedBy.name,
      status: inv.status as InvoiceStatus,
      ht: dec(inv.ht),
      tva: dec(inv.tva),
      discount: dec(inv.discount),
      total: dec(inv.total),
      paid: dec(inv.paid),
      notes: inv.notes,
      terms: inv.terms,
      lines: inv.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        label: l.label,
        qty: dec(l.qty),
        priceHt: dec(l.priceHt),
        vat: l.vat,
        discount: dec(l.discount),
      })),
    };
  }
}
