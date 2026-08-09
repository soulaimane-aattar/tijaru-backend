import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { ForbiddenError } from '../errors';
import type { PrismaService } from '../prisma.service';

import { LimitGuard } from './limit.guard';

function makeContext(user?: AuthUser): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    businessId: 'biz-1',
    role: 'owner' as AuthUser['role'],
    tokenVersion: 1,
    roleCaps: [],
    overrides: {},
    ...overrides,
  };
}

describe('LimitGuard', () => {
  let reflector: { get: jest.Mock };
  let prisma: {
    business: { findUnique: jest.Mock };
    user: { count: jest.Mock };
    product: { count: jest.Mock };
    warehouse: { count: jest.Mock };
  };
  let guard: LimitGuard;

  beforeEach(() => {
    reflector = { get: jest.fn().mockReturnValue(undefined) };
    prisma = {
      business: { findUnique: jest.fn() },
      user: { count: jest.fn() },
      product: { count: jest.fn() },
      warehouse: { count: jest.fn() },
    };
    guard = new LimitGuard(reflector as unknown as Reflector, prisma as unknown as PrismaService);
  });

  it('allows routes with no @EnforceLimit metadata', async () => {
    reflector.get.mockReturnValue(undefined);

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  it('allows super admins without checking the limit', async () => {
    reflector.get.mockReturnValue('users');
    const user = makeUser({ isSuperAdmin: true });

    const result = await guard.canActivate(makeContext(user));

    expect(result).toBe(true);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  it('allows requests with no user on the request', async () => {
    reflector.get.mockReturnValue('users');

    const result = await guard.canActivate(makeContext(undefined));

    expect(result).toBe(true);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  it('allows when the business row is missing', async () => {
    reflector.get.mockReturnValue('users');
    prisma.business.findUnique.mockResolvedValue(null);

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('allows when current count is under the max', async () => {
    reflector.get.mockReturnValue('users');
    prisma.business.findUnique.mockResolvedValue({ maxUsers: 5 });
    prisma.user.count.mockResolvedValue(3);

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { businessId: 'biz-1', deletedAt: null },
    });
  });

  it('throws limit_reached when current count equals the max', async () => {
    reflector.get.mockReturnValue('users');
    prisma.business.findUnique.mockResolvedValue({ maxUsers: 5 });
    prisma.user.count.mockResolvedValue(5);

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toMatchObject({
      response: expect.objectContaining({ title: 'limit_reached:users' }),
    });
  });

  it('throws limit_reached when current count exceeds the max', async () => {
    reflector.get.mockReturnValue('products');
    prisma.business.findUnique.mockResolvedValue({ maxProducts: 100 });
    prisma.product.count.mockResolvedValue(101);

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
  });

  it('counts warehouses for the warehouses resource', async () => {
    reflector.get.mockReturnValue('warehouses');
    prisma.business.findUnique.mockResolvedValue({ maxWarehouses: 2 });
    prisma.warehouse.count.mockResolvedValue(1);

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
    expect(prisma.warehouse.count).toHaveBeenCalledWith({
      where: { businessId: 'biz-1', deletedAt: null },
    });
  });
});
