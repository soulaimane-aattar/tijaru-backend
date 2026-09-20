import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { ConflictError, DomainError } from '../../../common/errors';
import { HrRepository } from '../domain/hr.repository';
import type { CheckInInput, CheckOutInput, HistoryQuery } from '../dto/hr.dto';

@Injectable()
export class HrService {
  private readonly logger = new Logger(HrService.name);

  constructor(private readonly repo: HrRepository) {}

  async checkIn(input: CheckInInput, user: AuthUser) {
    const open = await this.repo.findOpenByUser(user.id);
    if (open) throw new ConflictError('already_checked_in');
    return this.repo.create({ userId: user.id, latIn: input.lat, lngIn: input.lng, note: input.note });
  }

  async checkOut(input: CheckOutInput, user: AuthUser) {
    const open = await this.repo.findOpenByUser(user.id);
    if (!open) throw new DomainError('not_checked_in', 'No open attendance to close', 400);

    const activePause = await this.repo.findActivePause(open.id);
    if (activePause) await this.repo.endPause(open.id);

    const totalMinutes = (Date.now() - open.checkIn.getTime()) / 60_000;
    const pauseMinutes = await this.repo.sumPauseMinutes(open.id);
    const workedHours = Math.max(0, (totalMinutes - pauseMinutes) / 60);

    return this.repo.checkOut(open.id, {
      latOut: input.lat,
      lngOut: input.lng,
      workedHours: Math.round(workedHours * 100) / 100,
      note: input.note,
    });
  }

  async togglePause(user: AuthUser) {
    const open = await this.repo.findOpenByUser(user.id);
    if (!open) throw new DomainError('not_checked_in', 'No open attendance', 400);

    const activePause = await this.repo.findActivePause(open.id);
    if (activePause) {
      await this.repo.endPause(open.id);
      return { paused: false };
    } else {
      await this.repo.addPause(open.id);
      return { paused: true };
    }
  }

  async today(user: AuthUser) {
    const open = await this.repo.findOpenByUser(user.id);
    if (!open) return { status: 'out' as const, attendance: null };

    const activePause = await this.repo.findActivePause(open.id);
    return {
      status: activePause ? ('paused' as const) : ('present' as const),
      attendance: open,
    };
  }

  async history(query: HistoryQuery, user: AuthUser) {
    return this.repo.listHistory(
      { userId: query.userId ?? user.id, from: query.from, to: query.to },
      query.page,
      query.limit,
    );
  }

  async team(query: HistoryQuery) {
    return this.repo.listHistory(
      { from: query.from, to: query.to },
      query.page,
      query.limit,
    );
  }

  @Cron('0 2 * * *')
  async autoCheckout() {
    const stale = await this.repo.findOpenOlderThan(16);
    for (const record of stale) {
      const workedHours = 16;
      await this.repo.forceCheckOut(record.id, workedHours);
      this.logger.warn(`Auto-checkout: ${record.userId} (open since ${record.checkIn.toISOString()})`);
    }
    if (stale.length) this.logger.log(`Auto-checkout: closed ${stale.length} stale records`);
  }
}
