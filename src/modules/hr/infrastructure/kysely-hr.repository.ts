import { Injectable } from '@nestjs/common';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

import { TenantContext } from '../../../common/tenant/tenant-context';
import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { AttendanceListResult, AttendanceRow } from '../domain/hr.repository';
import { HrRepository } from '../domain/hr.repository';

/** Pauses come back as JSON, so timestamps need re-hydrating into Dates. */
type PauseJson = { id: string; startedAt: string; endedAt: string | null };

// pg parses `timestamp` (no tz) as local time; JSON text is parsed as UTC to match Prisma.
const utc = (s: string) => new Date(s.endsWith('Z') ? s : `${s}Z`);

@Injectable()
export class KyselyHrRepository extends HrRepository {
  constructor(
    private readonly db: Db,
    private readonly tenant: TenantContext,
  ) {
    super();
  }

  /** Attendance rows + user name + pauses, tenant-scoped, camelCase like the port expects. */
  private base() {
    return this.db.q
      .selectFrom('app.attendances as a')
      .where('a.business_id', '=', this.db.businessId)
      .select((eb) => [
        'a.id',
        'a.user_id as userId',
        'a.check_in as checkIn',
        'a.check_out as checkOut',
        'a.worked_hours as workedHours',
        'a.lat_in as latIn',
        'a.lng_in as lngIn',
        'a.lat_out as latOut',
        'a.lng_out as lngOut',
        'a.note',
        eb
          .selectFrom('app_auth.users as u')
          .select('u.name')
          .whereRef('u.id', '=', 'a.user_id')
          .as('userName'),
        jsonArrayFrom(
          eb
            .selectFrom('app.attendance_pauses as p')
            .select(['p.id', 'p.started_at as startedAt', 'p.ended_at as endedAt'])
            .whereRef('p.attendance_id', '=', 'a.id'),
        ).as('pauses'),
      ]);
  }

  private toRow(r: Awaited<ReturnType<ReturnType<KyselyHrRepository['base']>['executeTakeFirstOrThrow']>>): AttendanceRow {
    return {
      ...r,
      userName: r.userName ?? '',
      pauses: (r.pauses as unknown as PauseJson[]).map((p) => ({
        id: p.id,
        startedAt: utc(p.startedAt),
        endedAt: p.endedAt ? utc(p.endedAt) : null,
      })),
    };
  }

  private async getRow(id: string): Promise<AttendanceRow> {
    return this.toRow(await this.base().where('a.id', '=', id).executeTakeFirstOrThrow());
  }

  async findOpenByUser(userId: string): Promise<AttendanceRow | null> {
    const r = await this.base().where('a.user_id', '=', userId).where('a.check_out', 'is', null).executeTakeFirst();
    return r ? this.toRow(r) : null;
  }

  async create(data: {
    userId: string;
    latIn: number;
    lngIn: number;
    note?: string | undefined;
  }): Promise<AttendanceRow> {
    const r = await this.db.q
      .insertInto('app.attendances')
      .values({
        id: newId(),
        business_id: this.db.businessId,
        user_id: data.userId,
        lat_in: data.latIn,
        lng_in: data.lngIn,
        note: data.note ?? null,
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return this.getRow(r.id);
  }

  async checkOut(
    id: string,
    data: { latOut: number; lngOut: number; workedHours: number; note?: string | undefined },
  ): Promise<AttendanceRow> {
    await this.db.q
      .updateTable('app.attendances')
      .set({
        check_out: new Date(),
        lat_out: data.latOut,
        lng_out: data.lngOut,
        worked_hours: data.workedHours,
        ...(data.note !== undefined ? { note: data.note } : {}),
        updated_at: new Date(),
      })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
    return this.getRow(id);
  }

  async addPause(attendanceId: string): Promise<void> {
    await this.db.q
      .insertInto('app.attendance_pauses')
      .values({ id: newId(), business_id: this.db.businessId, attendance_id: attendanceId })
      .execute();
  }

  async endPause(attendanceId: string): Promise<void> {
    const active = await this.findActivePause(attendanceId);
    if (!active) return;
    await this.db.q
      .updateTable('app.attendance_pauses')
      .set({ ended_at: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', active.id)
      .execute();
  }

  async findActivePause(attendanceId: string): Promise<{ id: string; startedAt: Date } | null> {
    const r = await this.db.q
      .selectFrom('app.attendance_pauses')
      .select(['id', 'started_at as startedAt'])
      .where('business_id', '=', this.db.businessId)
      .where('attendance_id', '=', attendanceId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();
    return r ?? null;
  }

  async sumPauseMinutes(attendanceId: string): Promise<number> {
    const pauses = await this.db.q
      .selectFrom('app.attendance_pauses')
      .select(['started_at', 'ended_at'])
      .where('business_id', '=', this.db.businessId)
      .where('attendance_id', '=', attendanceId)
      .where('ended_at', 'is not', null)
      .execute();
    return pauses.reduce((sum, p) => sum + (p.ended_at!.getTime() - p.started_at.getTime()) / 60_000, 0);
  }

  async listHistory(
    filters: { userId?: string | undefined; from?: Date | undefined; to?: Date | undefined },
    page: number,
    limit: number,
  ): Promise<AttendanceListResult> {
    let q = this.base();
    let c = this.db.q
      .selectFrom('app.attendances as a')
      .where('a.business_id', '=', this.db.businessId)
      .select((eb) => eb.fn.countAll<string>().as('n'));
    if (filters.userId) {
      q = q.where('a.user_id', '=', filters.userId);
      c = c.where('a.user_id', '=', filters.userId);
    }
    if (filters.from) {
      q = q.where('a.check_in', '>=', filters.from);
      c = c.where('a.check_in', '>=', filters.from);
    }
    if (filters.to) {
      q = q.where('a.check_in', '<=', filters.to);
      c = c.where('a.check_in', '<=', filters.to);
    }
    const [items, total] = await Promise.all([
      q
        .orderBy('a.check_in', 'desc')
        .limit(limit)
        .offset((page - 1) * limit)
        .execute(),
      c.executeTakeFirstOrThrow(),
    ]);
    return { items: items.map((r) => this.toRow(r)), total: Number(total.n) };
  }

  // Cron entry points run with no tenant in scope (cross-tenant sweep): filter only when one is set.
  async findOpenOlderThan(hours: number): Promise<{ id: string; checkIn: Date; userId: string }[]> {
    const cutoff = new Date(Date.now() - hours * 3600_000);
    let q = this.db.q
      .selectFrom('app.attendances')
      .select(['id', 'check_in as checkIn', 'user_id as userId'])
      .where('check_out', 'is', null)
      .where('check_in', '<', cutoff);
    const biz = this.tenant.getBusinessId();
    if (biz) q = q.where('business_id', '=', biz);
    return q.execute();
  }

  async forceCheckOut(id: string, workedHours: number): Promise<void> {
    let q = this.db.q
      .updateTable('app.attendances')
      .set({ check_out: new Date(), worked_hours: workedHours, updated_at: new Date() })
      .where('id', '=', id);
    const biz = this.tenant.getBusinessId();
    if (biz) q = q.where('business_id', '=', biz);
    await q.execute();
  }
}
