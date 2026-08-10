import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import type {
  InvoiceCreateData,
  InvoiceDetail,
  InvoiceLineData,
  InvoiceRow,
  InvoicesRepository,
} from '../domain/invoices.repository';
import type {
  CreateInvoiceInput,
  InvoiceStatus,
  ListInvoicesQuery,
  RecordPaymentInput,
} from '../dto/invoices.dto';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const PREFIX = (year: number): string => `FA-${year}-`;

/**
 * Line total (HT after per-line discount) then TTC via VAT.
 * Kept as a free function so it's unit-testable without a repository.
 */
export function computeLineTotals(l: InvoiceLineData): {
  lineHt: number;
  lineTva: number;
  lineTtc: number;
} {
  const gross = l.priceHt * l.qty;
  const lineHt = Math.max(0, gross - l.discount);
  const lineTva = (lineHt * l.vat) / 100;
  return { lineHt: round2(lineHt), lineTva: round2(lineTva), lineTtc: round2(lineHt + lineTva) };
}

@Injectable()
export class InvoicesService {
  constructor(private readonly repo: InvoicesRepository) {}

  async list(businessId: string, query: ListInvoicesQuery): Promise<{
    items: InvoiceRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.repo.list({
      businessId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search ? { search: query.search } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async get(businessId: string, id: string): Promise<InvoiceDetail> {
    const found = await this.repo.findDetail(businessId, id);
    if (!found) throw new NotFoundError('Invoice', id);
    return found;
  }

  async create(input: CreateInvoiceInput, actor: AuthUser): Promise<InvoiceDetail> {
    const date = input.date ?? new Date();
    if (input.dueDate.getTime() < date.getTime()) {
      throw new DomainError('invalid_due_date', 'Due date cannot be before invoice date', 422);
    }

    let ht = 0;
    let tva = 0;
    const lines: InvoiceLineData[] = input.lines.map((l) => {
      const t = computeLineTotals(l);
      ht += t.lineHt;
      tva += t.lineTva;
      return { ...l, discount: round2(l.discount) };
    });
    ht = round2(ht);
    tva = round2(tva);

    const discount = round2(input.discount);
    const gross = round2(ht + tva);
    if (discount > gross) {
      throw new DomainError('invalid_discount', 'Discount exceeds invoice total', 422);
    }
    const total = round2(gross - discount);

    const number = await this.nextNumber(actor.businessId, date.getFullYear());

    const data: InvoiceCreateData = {
      businessId: actor.businessId,
      number,
      date,
      dueDate: input.dueDate,
      customerId: input.customerId,
      issuedById: actor.id,
      status: input.status,
      ht,
      tva,
      discount,
      total,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      lines,
    };
    return this.repo.create(data);
  }

  /** Sequential per-business, per-year: FA-2026-0001, FA-2026-0002, … */
  private async nextNumber(businessId: string, year: number): Promise<string> {
    const prefix = PREFIX(year);
    const last = await this.repo.findLastNumber(businessId, prefix);
    const n = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(4, '0')}`;
  }

  async recordPayment(
    businessId: string,
    id: string,
    input: RecordPaymentInput,
  ): Promise<InvoiceDetail> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('Invoice', id);
    if (inv.status === 'cancelled') {
      throw new DomainError('cancelled_invoice', 'Cannot pay a cancelled invoice', 422);
    }
    const remaining = round2(inv.total - inv.paid);
    if (input.amount > remaining + 0.005) {
      throw new DomainError(
        'overpayment',
        `Payment ${input.amount} exceeds remaining ${remaining}`,
        422,
      );
    }
    const updated = await this.repo.addPayment(id, input.amount);
    const newStatus: InvoiceStatus =
      round2(updated.paid) >= round2(updated.total) ? 'paid' : 'partial';
    if (updated.status !== newStatus) await this.repo.updateStatus(id, newStatus);
    return { ...updated, status: newStatus };
  }

  async cancel(businessId: string, id: string): Promise<void> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('Invoice', id);
    if (inv.status === 'paid') {
      throw new DomainError('cannot_cancel_paid', 'Paid invoices cannot be cancelled', 422);
    }
    if (inv.paid > 0) {
      throw new DomainError(
        'cannot_cancel_with_payments',
        'Cancel is blocked while a partial payment exists',
        422,
      );
    }
    await this.repo.updateStatus(id, 'cancelled');
  }

  async setStatus(businessId: string, id: string, status: InvoiceStatus): Promise<void> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('Invoice', id);
    await this.repo.updateStatus(id, status);
  }
}
