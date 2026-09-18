import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import {
  EstimatesRepository,
  type EstimateCreateData,
  type EstimateDetail,
  type EstimateLineData,
  type EstimateRow,
} from '../domain/estimates.repository';
import type {
  CreateEstimateInput,
  EstimateStatus,
  ListEstimatesQuery,
  UpdateEstimateInput,
} from '../dto/estimates.dto';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const PREFIX = (year: number): string => `DV-${year}-`;

export function computeLineTotals(l: EstimateLineData): {
  lineHt: number;
  lineTva: number;
} {
  const gross = l.priceHt * l.qty;
  const lineHt = Math.max(0, gross - l.discount);
  const lineTva = (lineHt * l.vat) / 100;
  return { lineHt: round2(lineHt), lineTva: round2(lineTva) };
}

@Injectable()
export class EstimatesService {
  constructor(private readonly repo: EstimatesRepository) {}

  async list(businessId: string, query: ListEstimatesQuery): Promise<{
    items: EstimateRow[];
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

  async get(businessId: string, id: string): Promise<EstimateDetail> {
    const found = await this.repo.findDetail(businessId, id);
    if (!found) throw new NotFoundError('Estimate', id);
    return found;
  }

  async create(input: CreateEstimateInput, actor: AuthUser): Promise<EstimateDetail> {
    const date = input.date ?? new Date();

    let ht = 0;
    let tva = 0;
    const lines: EstimateLineData[] = input.lines.map((l) => {
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
      throw new DomainError('invalid_discount', 'Discount exceeds estimate total', 422);
    }
    const total = round2(gross - discount);

    const number = await this.nextNumber(actor.businessId, date.getFullYear());

    const data: EstimateCreateData = {
      businessId: actor.businessId,
      number,
      date,
      validUntil: input.validUntil,
      customerId: input.customerId,
      issuedById: actor.id,
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

  async update(
    businessId: string,
    id: string,
    input: UpdateEstimateInput,
    actor: AuthUser,
  ): Promise<EstimateDetail> {
    const existing = await this.repo.findDetail(businessId, id);
    if (!existing) throw new NotFoundError('Estimate', id);

    const updateData: Partial<EstimateCreateData> & { status?: EstimateStatus } = {};

    if (input.status !== undefined) updateData.status = input.status;
    if (input.date !== undefined) updateData.date = input.date;
    if (input.validUntil !== undefined) updateData.validUntil = input.validUntil;
    if (input.customerId !== undefined) updateData.customerId = input.customerId;
    if (input.notes !== undefined) updateData.notes = input.notes ?? null;
    if (input.terms !== undefined) updateData.terms = input.terms ?? null;

    if (input.lines) {
      let ht = 0;
      let tva = 0;
      const lines: EstimateLineData[] = input.lines.map((l) => {
        const t = computeLineTotals(l);
        ht += t.lineHt;
        tva += t.lineTva;
        return { ...l, discount: round2(l.discount) };
      });
      ht = round2(ht);
      tva = round2(tva);
      const discount = round2(input.discount ?? existing.discount);
      const gross = round2(ht + tva);
      if (discount > gross) {
        throw new DomainError('invalid_discount', 'Discount exceeds estimate total', 422);
      }
      updateData.ht = ht;
      updateData.tva = tva;
      updateData.discount = discount;
      updateData.total = round2(gross - discount);
      updateData.lines = lines;
    } else if (input.discount !== undefined) {
      const discount = round2(input.discount);
      const gross = round2(existing.ht + existing.tva);
      if (discount > gross) {
        throw new DomainError('invalid_discount', 'Discount exceeds estimate total', 422);
      }
      updateData.discount = discount;
      updateData.total = round2(gross - discount);
    }

    return this.repo.update(id, updateData);
  }

  async remove(businessId: string, id: string): Promise<void> {
    const existing = await this.repo.findDetail(businessId, id);
    if (!existing) throw new NotFoundError('Estimate', id);
    if (existing.status !== 'draft') {
      throw new DomainError('cannot_delete', 'Only draft estimates can be deleted', 422);
    }
    await this.repo.remove(id);
  }

  private async nextNumber(businessId: string, year: number): Promise<string> {
    const prefix = PREFIX(year);
    const last = await this.repo.findLastNumber(businessId, prefix);
    const n = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(4, '0')}`;
  }
}
