import * as bcrypt from 'bcrypt';

import { NotFoundError, UnauthorizedError } from '../../common/errors';

import { PlatformAdminService } from './platform-admin.service';

type MockPrisma = {
  platformAdmin: { findUnique: jest.Mock };
  business: { findMany: jest.Mock; update: jest.Mock; findUnique: jest.Mock; count: jest.Mock };
  businessModule: { upsert: jest.Mock };
  user: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  securityPolicy: { findUnique: jest.Mock };
  session: { updateMany: jest.Mock };
  platformAuditLog: { create: jest.Mock; findMany: jest.Mock };
  $transaction: jest.Mock;
};

const mockPrisma = (): MockPrisma => ({
  platformAdmin: {
    findUnique: jest.fn(),
  },
  business: {
    findMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  businessModule: {
    upsert: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  securityPolicy: {
    findUnique: jest.fn(),
  },
  session: {
    updateMany: jest.fn(),
  },
  platformAuditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
});

const mockJwt = () => ({ signAsync: jest.fn().mockResolvedValue('pa-token') }) as never;

const mockEnv = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  BCRYPT_COST: 4,
} as never;

describe('PlatformAdminService', () => {
  it('returns accessToken on valid credentials', async () => {
    const prisma = mockPrisma();
    const hash = await bcrypt.hash('admin123', 4);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'pa1',
      email: 'admin@tijaru.com',
      passwordHash: hash,
      tokenVersion: 0,
    });
    const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
    const result = await svc.login('admin@tijaru.com', 'admin123');
    expect(result.accessToken).toBe('pa-token');
  });

  it('throws UnauthorizedError on wrong password', async () => {
    const prisma = mockPrisma();
    const hash = await bcrypt.hash('admin123', 4);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'pa1',
      email: 'admin@tijaru.com',
      passwordHash: hash,
      tokenVersion: 0,
    });
    const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
    await expect(svc.login('admin@tijaru.com', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('throws UnauthorizedError when admin not found', async () => {
    const prisma = mockPrisma();
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
    await expect(svc.login('ghost@tijaru.com', 'pass')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  describe('getBusinessDetail', () => {
    it('returns business with owner and modules', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1', users: [], modules: [] });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const result = await svc.getBusinessDetail('b1');
      expect(result).toEqual({ id: 'b1', users: [], modules: [] });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(null);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.getBusinessDetail('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateBusiness', () => {
    it('updates limits when business exists', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1' });
      prisma.business.update.mockResolvedValue({ id: 'b1', maxUsers: 10 });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const result = await svc.updateBusiness('b1', { maxUsers: 10 });
      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { maxUsers: 10 },
      });
      expect(result).toEqual({ id: 'b1', maxUsers: 10 });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(null);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.updateBusiness('missing', { maxUsers: 10 })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('extendSubscription', () => {
    it('sets plan active and computes subscription end from duration', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1' });
      prisma.business.update.mockImplementation(({ data }: { data: unknown }) => ({
        id: 'b1',
        ...(data as object),
      }));
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const before = Date.now();
      const result = (await svc.extendSubscription('b1', '1mo')) as {
        plan: string;
        subscriptionStart: Date;
        subscriptionEnd: Date;
      };
      expect(result.plan).toBe('active');
      const deltaDays =
        (result.subscriptionEnd.getTime() - result.subscriptionStart.getTime()) / 86_400_000;
      expect(deltaDays).toBeCloseTo(30, 5);
      expect(result.subscriptionStart.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('throws NotFoundError when business does not exist', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(null);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.extendSubscription('missing', '1yr')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('suspendBusiness', () => {
    it('sets status and plan to suspended', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1' });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.suspendBusiness('b1');
      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { status: 'suspended', plan: 'suspended' },
      });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(null);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.suspendBusiness('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('audit journal', () => {
    it('writes an err-toned entry when suspending', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1', name: 'Pharmacie Yasmine' });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.suspendBusiness('b1');
      expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'suspend',
          tone: 'err',
          targetId: 'b1',
          targetName: 'Pharmacie Yasmine',
        }),
      });
    });

    it('records extension duration in the detail', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1', name: 'Café Riad Nomad' });
      prisma.business.update.mockResolvedValue({ id: 'b1' });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.extendSubscription('b1', '1yr');
      expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'extend', detail: '+12 mois' }),
      });
    });

    it('never fails the action when journaling throws', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1', name: 'X' });
      prisma.platformAuditLog.create.mockRejectedValue(new Error('db down'));
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.suspendBusiness('b1')).resolves.toBeUndefined();
    });

    it('listAudit returns newest entries first with a limit', async () => {
      const prisma = mockPrisma();
      prisma.platformAuditLog.findMany.mockResolvedValue([{ id: 'a1' }]);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.listAudit(20)).resolves.toEqual([{ id: 'a1' }]);
      expect(prisma.platformAuditLog.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    });
  });

  describe('activateBusiness', () => {
    it('sets status and plan to active', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1' });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.activateBusiness('b1');
      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { status: 'active', plan: 'active' },
      });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(null);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.activateBusiness('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateModules', () => {
    it('upserts each module within a transaction', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue({ id: 'b1' });
      prisma.businessModule.upsert.mockResolvedValue({});
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.updateModules('b1', { pos: true, invoicing: false });
      expect(prisma.businessModule.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.businessModule.upsert).toHaveBeenCalledWith({
        where: { businessId_moduleId: { businessId: 'b1', moduleId: 'pos' } },
        update: { active: true },
        create: { businessId: 'b1', moduleId: 'pos', active: true },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('throws NotFoundError when business does not exist', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(null);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.updateModules('missing', { pos: true })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('listBusinesses', () => {
    it('filters by both status and plan when both provided', async () => {
      const prisma = mockPrisma();
      prisma.business.findMany.mockResolvedValue([]);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.listBusinesses('active', 'trial');
      expect(prisma.business.findMany.mock.calls[0]![0].where).toEqual({
        status: 'active',
        plan: 'trial',
      });
    });

    it('applies no filter when both are undefined', async () => {
      const prisma = mockPrisma();
      prisma.business.findMany.mockResolvedValue([]);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.listBusinesses();
      expect(prisma.business.findMany.mock.calls[0]![0].where).toEqual({});
    });
  });

  describe('listUsers', () => {
    it('returns paginated cross-business users', async () => {
      const prisma = mockPrisma();
      prisma.user.count.mockResolvedValue(42);
      prisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ali', business: { id: 'b1', name: 'Biz' } }]);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const out = await svc.listUsers({ page: 2, pageSize: 10 });
      expect(out).toMatchObject({ total: 42, page: 2, pageSize: 10 });
      expect(prisma.user.findMany.mock.calls[0]![0]).toMatchObject({ skip: 10, take: 10 });
    });

    it('narrows by businessId when provided', async () => {
      const prisma = mockPrisma();
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.listUsers({ businessId: 'b1', page: 1, pageSize: 25 });
      expect(prisma.user.findMany.mock.calls[0]![0].where.businessId).toBe('b1');
    });

    it('searches name + email case-insensitively', async () => {
      const prisma = mockPrisma();
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.listUsers({ search: 'ali', page: 1, pageSize: 25 });
      const where = prisma.user.findMany.mock.calls[0]![0].where;
      expect(where.OR).toEqual([
        { name: { contains: 'ali', mode: 'insensitive' } },
        { email: { contains: 'ali', mode: 'insensitive' } },
      ]);
    });

    it('never returns soft-deleted users', async () => {
      const prisma = mockPrisma();
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.listUsers({ page: 1, pageSize: 25 });
      expect(prisma.user.findMany.mock.calls[0]![0].where.deletedAt).toBeNull();
    });
  });

  describe('resetUserPassword', () => {
    const activeUser = { id: 'u1', businessId: 'b1', deletedAt: null };

    it('returns a temp password of length >= 10 from the unambiguous alphabet', async () => {
      const prisma = mockPrisma();
      prisma.user.findFirst.mockResolvedValue(activeUser);
      prisma.securityPolicy.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({});
      prisma.session.updateMany.mockResolvedValue({ count: 0 });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const { tempPassword } = await svc.resetUserPassword('u1');
      expect(tempPassword.length).toBeGreaterThanOrEqual(10);
      expect(tempPassword).toMatch(/^[A-HJ-NP-Za-hj-np-z2-9]+$/);
    });

    it('persists a bcrypt hash that verifies against the returned temp password', async () => {
      const prisma = mockPrisma();
      prisma.user.findFirst.mockResolvedValue(activeUser);
      prisma.securityPolicy.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({});
      prisma.session.updateMany.mockResolvedValue({ count: 0 });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const { tempPassword } = await svc.resetUserPassword('u1');
      const data = prisma.user.update.mock.calls[0]![0].data;
      expect(await bcrypt.compare(tempPassword, data.passwordHash)).toBe(true);
    });

    it('increments tokenVersion and revokes active sessions', async () => {
      const prisma = mockPrisma();
      prisma.user.findFirst.mockResolvedValue(activeUser);
      prisma.securityPolicy.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({});
      prisma.session.updateMany.mockResolvedValue({ count: 3 });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.resetUserPassword('u1');
      expect(prisma.user.update.mock.calls[0]![0]).toMatchObject({
        where: { id: 'u1' },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('honors a larger passwordMinLen from the business policy', async () => {
      const prisma = mockPrisma();
      prisma.user.findFirst.mockResolvedValue(activeUser);
      prisma.securityPolicy.findUnique.mockResolvedValue({ passwordMinLen: 16 });
      prisma.user.update.mockResolvedValue({});
      prisma.session.updateMany.mockResolvedValue({ count: 0 });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const { tempPassword } = await svc.resetUserPassword('u1');
      expect(tempPassword.length).toBeGreaterThanOrEqual(16);
    });

    it('throws NotFoundError for an unknown or soft-deleted user', async () => {
      const prisma = mockPrisma();
      prisma.user.findFirst.mockResolvedValue(null);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.resetUserPassword('ghost')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getStats', () => {
    it('aggregates counts by plan and status', async () => {
      const prisma = mockPrisma();
      prisma.business.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(6) // active
        .mockResolvedValueOnce(1) // expired
        .mockResolvedValueOnce(2) // pending
        .mockResolvedValueOnce(1); // suspended
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const result = await svc.getStats();
      expect(result).toEqual({ total: 10, active: 6, expired: 1, pending: 2, suspended: 1 });
    });
  });
});
