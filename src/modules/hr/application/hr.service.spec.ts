import type { AuthUser } from '../../../common/auth/auth-user.type';
import { ConflictError, DomainError } from '../../../common/errors';
import type { AttendanceRow } from '../domain/hr.repository';

import { HrService } from './hr.service';

const actor: AuthUser = {
  id: 'user1',
  businessId: 'biz1',
  roleId: 'admin',
  roleCaps: ['hr.view', 'hr.manage'],
} as unknown as AuthUser;

const row = (over: Partial<AttendanceRow> = {}): AttendanceRow => ({
  id: 'att1',
  userId: 'user1',
  userName: 'Test User',
  checkIn: new Date('2026-09-18T08:00:00Z'),
  checkOut: null,
  workedHours: null,
  latIn: 33.59,
  lngIn: -7.61,
  latOut: null,
  lngOut: null,
  note: null,
  pauses: [],
  ...over,
});

const repo = () =>
  ({
    findOpenByUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve(row({ ...d, id: 'att1' }))),
    checkOut: jest.fn().mockImplementation((_id, d) => Promise.resolve(row({ checkOut: new Date(), ...d }))),
    addPause: jest.fn().mockResolvedValue(undefined),
    endPause: jest.fn().mockResolvedValue(undefined),
    findActivePause: jest.fn().mockResolvedValue(null),
    sumPauseMinutes: jest.fn().mockResolvedValue(0),
    listHistory: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    findOpenOlderThan: jest.fn().mockResolvedValue([]),
    forceCheckOut: jest.fn().mockResolvedValue(undefined),
  }) as any;

describe('HrService.checkIn', () => {
  it('creates attendance when no open record exists', async () => {
    const r = repo();
    await new HrService(r).checkIn({ lat: 33.59, lng: -7.61 }, actor);
    expect(r.create).toHaveBeenCalledWith({ userId: 'user1', latIn: 33.59, lngIn: -7.61, note: undefined });
  });

  it('rejects when already checked in', async () => {
    const r = repo();
    r.findOpenByUser.mockResolvedValue(row());
    await expect(new HrService(r).checkIn({ lat: 33.59, lng: -7.61 }, actor)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('HrService.checkOut', () => {
  it('closes open attendance and computes worked hours', async () => {
    const r = repo();
    r.findOpenByUser.mockResolvedValue(row({ checkIn: new Date(Date.now() - 3600_000 * 2) }));
    r.sumPauseMinutes.mockResolvedValue(0);
    await new HrService(r).checkOut({ lat: 33.59, lng: -7.61 }, actor);
    expect(r.checkOut).toHaveBeenCalled();
    const callArgs = r.checkOut.mock.calls[0][1];
    expect(callArgs.workedHours).toBeCloseTo(2, 0);
  });

  it('rejects when not checked in', async () => {
    const r = repo();
    await expect(new HrService(r).checkOut({ lat: 33.59, lng: -7.61 }, actor)).rejects.toBeInstanceOf(DomainError);
  });

  it('subtracts pause time from worked hours', async () => {
    const r = repo();
    r.findOpenByUser.mockResolvedValue(row({ checkIn: new Date(Date.now() - 3600_000 * 4) }));
    r.sumPauseMinutes.mockResolvedValue(60);
    await new HrService(r).checkOut({ lat: 33.59, lng: -7.61 }, actor);
    const callArgs = r.checkOut.mock.calls[0][1];
    expect(callArgs.workedHours).toBeCloseTo(3, 0);
  });

  it('ends active pause before checkout', async () => {
    const r = repo();
    r.findOpenByUser.mockResolvedValue(row({ checkIn: new Date(Date.now() - 3600_000) }));
    r.findActivePause.mockResolvedValue({ id: 'p1', startedAt: new Date() });
    r.sumPauseMinutes.mockResolvedValue(0);
    await new HrService(r).checkOut({ lat: 33.59, lng: -7.61 }, actor);
    expect(r.endPause).toHaveBeenCalledWith('att1');
  });
});

describe('HrService.togglePause', () => {
  it('starts pause when none active', async () => {
    const r = repo();
    r.findOpenByUser.mockResolvedValue(row());
    r.findActivePause.mockResolvedValue(null);
    const result = await new HrService(r).togglePause(actor);
    expect(r.addPause).toHaveBeenCalledWith('att1');
    expect(result.paused).toBe(true);
  });

  it('ends pause when one is active', async () => {
    const r = repo();
    r.findOpenByUser.mockResolvedValue(row());
    r.findActivePause.mockResolvedValue({ id: 'p1', startedAt: new Date() });
    const result = await new HrService(r).togglePause(actor);
    expect(r.endPause).toHaveBeenCalledWith('att1');
    expect(result.paused).toBe(false);
  });

  it('rejects when not checked in', async () => {
    const r = repo();
    await expect(new HrService(r).togglePause(actor)).rejects.toBeInstanceOf(DomainError);
  });
});

describe('HrService.today', () => {
  it('returns out when no open attendance', async () => {
    const r = repo();
    const result = await new HrService(r).today(actor);
    expect(result.status).toBe('out');
    expect(result.attendance).toBeNull();
  });

  it('returns present when checked in without pause', async () => {
    const r = repo();
    r.findOpenByUser.mockResolvedValue(row());
    r.findActivePause.mockResolvedValue(null);
    const result = await new HrService(r).today(actor);
    expect(result.status).toBe('present');
  });

  it('returns paused when active pause exists', async () => {
    const r = repo();
    r.findOpenByUser.mockResolvedValue(row());
    r.findActivePause.mockResolvedValue({ id: 'p1', startedAt: new Date() });
    const result = await new HrService(r).today(actor);
    expect(result.status).toBe('paused');
  });
});

describe('HrService.autoCheckout', () => {
  it('force-closes records open > 16h', async () => {
    const r = repo();
    r.findOpenOlderThan.mockResolvedValue([
      { id: 'att1', checkIn: new Date(), userId: 'u1' },
    ]);
    await new HrService(r).autoCheckout();
    expect(r.forceCheckOut).toHaveBeenCalledWith('att1', 16);
  });
});
