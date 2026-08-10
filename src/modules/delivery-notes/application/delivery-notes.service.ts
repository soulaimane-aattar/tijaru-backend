import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import {
  DeliveryNotesRepository,
  type DeliveryDetail,
  type DeliveryLineData,
} from '../domain/delivery-notes.repository';
import type {
  CreateDeliveryNoteInput,
  DeliveryNoteStatus,
  DeliveryNoteType,
  ListDeliveryNotesQuery,
} from '../dto/delivery-notes.dto';

const PREFIX: Record<DeliveryNoteType, string> = {
  order: 'BC',
  out: 'BL',
  in_: 'BR',
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
  constructor(private readonly repo: DeliveryNotesRepository) {}

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

  async get(businessId: string, id: string): Promise<DeliveryDetail> {
    const found = await this.repo.findDetail(businessId, id);
    if (!found) throw new NotFoundError('DeliveryNote', id);
    return found;
  }

  async create(input: CreateDeliveryNoteInput, actor: AuthUser): Promise<DeliveryDetail> {
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
    const lines: DeliveryLineData[] = input.lines.map((l) => ({
      productId: l.productId,
      label: l.label,
      ordered: l.ordered,
      sent: l.sent,
    }));
    return this.repo.create({
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
  ): Promise<DeliveryDetail> {
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
    return fresh!;
  }

  async sign(businessId: string, id: string): Promise<void> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('DeliveryNote', id);
    if (inv.type !== 'out') {
      throw new DomainError('only_out_signable', 'Only delivery notes (out) can be signed', 422);
    }
    if (inv.signed) return;
    await this.repo.markSigned(id, new Date());
  }

  async setStatus(businessId: string, id: string, status: DeliveryNoteStatus): Promise<void> {
    const inv = await this.repo.findDetail(businessId, id);
    if (!inv) throw new NotFoundError('DeliveryNote', id);
    await this.repo.updateStatus(id, status);
  }
}
