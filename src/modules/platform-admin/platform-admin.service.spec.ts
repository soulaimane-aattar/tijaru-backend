import * as bcrypt from 'bcrypt';

import { ConflictError, NotFoundError, UnauthorizedError } from '../../common/errors';

import { PlatformAdminService } from './platform-admin.service';

type MockPrisma = {
  platformAdmin: { findUnique: jest.Mock };
  business: {
    findMany: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    count: jest.Mock;
  };
  businessModule: { upsert: jest.Mock };
  warehouse: { findMany: jest.Mock; update: jest.Mock; create: jest.Mock };
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
    findUniqueOrThrow: jest.fn(),
    count: jest.fn(),
  },
  businessModule: {
    upsert: jest.fn(),
  },
  warehouse: {
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
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

  describe('updateSettings', () => {
    const biz = { id: 'b1', name: 'Boulangerie Atlas', city: 'Rabat', multiWarehouse: true };

    it('disabling multi-stock renames the single warehouse to the business name', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(biz);
      prisma.warehouse.findMany.mockResolvedValue([{ id: 'w1', name: 'Dépôt 1' }]);
      prisma.business.findUniqueOrThrow.mockResolvedValue({
        multiWarehouse: false,
        enabledVatRates: [0, 7, 10, 14, 20],
      });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const out = await svc.updateSettings('b1', { multiWarehouse: false });
      expect(prisma.warehouse.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { name: 'Boulangerie Atlas', isDefault: true, active: true },
      });
      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { multiWarehouse: false },
      });
      expect(out.multiWarehouse).toBe(false);
    });

    it('disabling multi-stock creates a default warehouse named after the business when none exists', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(biz);
      prisma.warehouse.findMany.mockResolvedValue([]);
      prisma.business.findUniqueOrThrow.mockResolvedValue({
        multiWarehouse: false,
        enabledVatRates: [0],
      });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.updateSettings('b1', { multiWarehouse: false });
      expect(prisma.warehouse.create).toHaveBeenCalledWith({
        data: {
          businessId: 'b1',
          name: 'Boulangerie Atlas',
          city: 'Rabat',
          isDefault: true,
          active: true,
        },
      });
    });

    it('refuses to disable multi-stock with more than one active warehouse', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(biz);
      prisma.warehouse.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.updateSettings('b1', { multiWarehouse: false })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('tvaEnabled false sets enabledVatRates to [0]; true restores the full set', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(biz);
      prisma.business.findUniqueOrThrow.mockResolvedValue({
        multiWarehouse: true,
        enabledVatRates: [0],
      });
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await svc.updateSettings('b1', { tvaEnabled: false });
      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { enabledVatRates: [0] },
      });
      await svc.updateSettings('b1', { tvaEnabled: true });
      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { enabledVatRates: [0, 7, 10, 14, 20] },
      });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(null);
      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.updateSettings('missing', { tvaEnabled: false })).rejects.toBeInstanceOf(
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

  describe('updateSettings — fine TVA + bons stock flag', () => {
    const baseBiz = {
      id: 'b1',
      name: 'Épice Atlas',
      city: 'Casa',
      multiWarehouse: true,
      enabledVatRates: [0, 7, 10, 14, 20],
      defaultVatRate: 20,
      bonsAffectStock: true,
    };

    it('saves an exact rate set with its default and returns the full settings', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(baseBiz);
      prisma.business.update.mockResolvedValue({});
      prisma.business.findUniqueOrThrow.mockResolvedValue({
        multiWarehouse: true,
        enabledVatRates: [0, 10],
        defaultVatRate: 10,
        bonsAffectStock: true,
      });

      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const result = await svc.updateSettings('b1', { enabledVatRates: [0, 10], defaultVatRate: 10 });

      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { enabledVatRates: [0, 10], defaultVatRate: 10 },
      });
      expect(result).toEqual({
        multiWarehouse: true,
        enabledVatRates: [0, 10],
        defaultVatRate: 10,
        bonsAffectStock: true,
      });
    });

    it('rejects a default VAT rate that is not in the final enabled set', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(baseBiz);

      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      // 14 requested as default but not part of the enabled set.
      await expect(
        svc.updateSettings('b1', { enabledVatRates: [0, 20], defaultVatRate: 14 }),
      ).rejects.toMatchObject({ response: { code: 'conflict' } });
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('persists bonsAffectStock=false (bons stop consuming stock)', async () => {
      const prisma = mockPrisma();
      prisma.business.findUnique.mockResolvedValue(baseBiz);
      prisma.business.update.mockResolvedValue({});
      prisma.business.findUniqueOrThrow.mockResolvedValue({
        multiWarehouse: true,
        enabledVatRates: [0, 7, 10, 14, 20],
        defaultVatRate: 20,
        bonsAffectStock: false,
      });

      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const result = await svc.updateSettings('b1', { bonsAffectStock: false });

      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { bonsAffectStock: false },
      });
      expect(result.bonsAffectStock).toBe(false);
    });
  });

  describe('updateBusinessUser — employee access from the super admin', () => {
    const employee = {
      id: 'u2',
      businessId: 'b1',
      name: 'Hicham',
      email: 'hicham@biz.ma',
      role: 'cashier',
      active: true,
    };

    it('changes an employee role', async () => {
      const prisma = mockPrisma();
      prisma.user.findFirst.mockResolvedValue(employee);
      prisma.user.update.mockResolvedValue({ ...employee, role: 'manager' });
      prisma.platformAuditLog.create.mockResolvedValue({});

      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      const result = await svc.updateBusinessUser('b1', 'u2', { role: 'manager' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u2' },
        data: { role: 'manager' },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
      expect(result.role).toBe('manager');
    });

    it('blocks deactivating the last active owner', async () => {
      const prisma = mockPrisma();
      prisma.user.findFirst.mockResolvedValue({ ...employee, role: 'owner' });
      prisma.user.count.mockResolvedValue(0); // no other active owner

      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(svc.updateBusinessUser('b1', 'u2', { active: false })).rejects.toMatchObject({
        response: { code: 'conflict' },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('404s when the user belongs to another business', async () => {
      const prisma = mockPrisma();
      prisma.user.findFirst.mockResolvedValue(null);

      const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
      await expect(
        svc.updateBusinessUser('b1', 'u-elsewhere', { role: 'viewer' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
