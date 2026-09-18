import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import type { AttendanceListResult, AttendanceRow } from '../domain/hr.repository';
import { HrRepository } from '../domain/hr.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const includePayload = {
  pauses: { select: { id: true, startedAt: true, endedAt: true } },
  user: { select: { name: true } },
} as const;

function toRow(r: any): AttendanceRow {
  return {
    id: r.id,
    userId: r.userId,
    userName: r.user?.name ?? '',
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    workedHours: r.workedHours,
    latIn: r.latIn,
    lngIn: r.lngIn,
    latOut: r.latOut,
    lngOut: r.lngOut,
    note: r.note,
    pauses: r.pauses ?? [],
  };
}

@Injectable()
export class PrismaHrRepository extends HrRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findOpenByUser(userId: string): Promise<AttendanceRow | null> {
    const r = await this.prisma.attendance.findFirst({
      where: scoped<Prisma.AttendanceWhereInput>({ userId, checkOut: null }),
      include: includePayload,
    });
    return r ? toRow(r) : null;
  }

  async create(data: {
    userId: string;
    latIn: number;
    lngIn: number;
    note?: string | undefined;
  }): Promise<AttendanceRow> {
    const r = await this.prisma.attendance.create({
      data: scoped<Prisma.AttendanceUncheckedCreateInput>(
        compact({
          userId: data.userId,
          latIn: data.latIn,
          lngIn: data.lngIn,
          note: data.note,
        }) as Omit<Prisma.AttendanceUncheckedCreateInput, 'businessId'>,
      ),
      include: includePayload,
    });
    return toRow(r);
  }

  async checkOut(
    id: string,
    data: { latOut: number; lngOut: number; workedHours: number; note?: string | undefined },
  ): Promise<AttendanceRow> {
    const r = await this.prisma.attendance.update({
      where: { id },
      data: compact({
        checkOut: new Date(),
        latOut: data.latOut,
        lngOut: data.lngOut,
        workedHours: data.workedHours,
        note: data.note,
      }) as Prisma.AttendanceUpdateInput,
      include: includePayload,
    });
    return toRow(r);
  }

  async addPause(attendanceId: string): Promise<void> {
    await this.prisma.attendancePause.create({
      data: { attendanceId },
    });
  }

  async endPause(attendanceId: string): Promise<void> {
    const active = await this.prisma.attendancePause.findFirst({
      where: { attendanceId, endedAt: null },
    });
    if (active) {
      await this.prisma.attendancePause.update({
        where: { id: active.id },
        data: { endedAt: new Date() },
      });
    }
  }

  async findActivePause(attendanceId: string): Promise<{ id: string; startedAt: Date } | null> {
    return this.prisma.attendancePause.findFirst({
      where: { attendanceId, endedAt: null },
      select: { id: true, startedAt: true },
    });
  }

  async sumPauseMinutes(attendanceId: string): Promise<number> {
    const pauses = await this.prisma.attendancePause.findMany({
      where: { attendanceId, endedAt: { not: null } },
      select: { startedAt: true, endedAt: true },
    });
    return pauses.reduce((sum, p) => {
      const ms = p.endedAt!.getTime() - p.startedAt.getTime();
      return sum + ms / 60_000;
    }, 0);
  }

  async listHistory(
    filters: { userId?: string | undefined; from?: Date | undefined; to?: Date | undefined },
    page: number,
    limit: number,
  ): Promise<AttendanceListResult> {
    const where: Prisma.AttendanceWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.from || filters.to) {
      where.checkIn = compact({ gte: filters.from, lte: filters.to });
    }

    const [items, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: includePayload,
        orderBy: { checkIn: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return { items: items.map(toRow), total };
  }

  async findOpenOlderThan(hours: number): Promise<{ id: string; checkIn: Date; userId: string }[]> {
    const cutoff = new Date(Date.now() - hours * 3600_000);
    return this.prisma.attendance.findMany({
      where: { checkOut: null, checkIn: { lt: cutoff } },
      select: { id: true, checkIn: true, userId: true },
    });
  }

  async forceCheckOut(id: string, workedHours: number): Promise<void> {
    await this.prisma.attendance.update({
      where: { id },
      data: { checkOut: new Date(), workedHours },
    });
  }
}
