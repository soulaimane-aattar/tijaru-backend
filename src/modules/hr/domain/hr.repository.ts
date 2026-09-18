export type AttendanceRow = {
  id: string;
  userId: string;
  userName: string;
  checkIn: Date;
  checkOut: Date | null;
  workedHours: number | null;
  latIn: number;
  lngIn: number;
  latOut: number | null;
  lngOut: number | null;
  note: string | null;
  pauses: { id: string; startedAt: Date; endedAt: Date | null }[];
};

export type AttendanceListResult = {
  items: AttendanceRow[];
  total: number;
};

export abstract class HrRepository {
  abstract findOpenByUser(userId: string): Promise<AttendanceRow | null>;
  abstract create(data: {
    userId: string;
    latIn: number;
    lngIn: number;
    note?: string | undefined;
  }): Promise<AttendanceRow>;
  abstract checkOut(
    id: string,
    data: { latOut: number; lngOut: number; workedHours: number; note?: string | undefined },
  ): Promise<AttendanceRow>;
  abstract addPause(attendanceId: string): Promise<void>;
  abstract endPause(attendanceId: string): Promise<void>;
  abstract findActivePause(attendanceId: string): Promise<{ id: string; startedAt: Date } | null>;
  abstract sumPauseMinutes(attendanceId: string): Promise<number>;
  abstract listHistory(
    filters: { userId?: string | undefined; from?: Date | undefined; to?: Date | undefined },
    page: number,
    limit: number,
  ): Promise<AttendanceListResult>;
  abstract findOpenOlderThan(hours: number): Promise<{ id: string; checkIn: Date; userId: string }[]>;
  abstract forceCheckOut(id: string, workedHours: number): Promise<void>;
}
