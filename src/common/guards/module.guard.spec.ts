import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { ForbiddenError } from '../errors';
import type { PrismaService } from '../prisma.service';

import { ModuleGuard } from './module.guard';

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

describe('ModuleGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { businessModule: { findUnique: jest.Mock } };
  let guard: ModuleGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    prisma = {
      businessModule: {
        findUnique: jest.fn(),
      },
    };
    guard = new ModuleGuard(reflector as unknown as Reflector, prisma as unknown as PrismaService);
  });

  it('allows routes with no @RequiresModule metadata', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
    expect(prisma.businessModule.findUnique).not.toHaveBeenCalled();
  });

  it('allows super admins without checking the module', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    const user = makeUser({ isSuperAdmin: true });

    const result = await guard.canActivate(makeContext(user));

    expect(result).toBe(true);
    expect(prisma.businessModule.findUnique).not.toHaveBeenCalled();
  });

  it('allows requests with no user on the request', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');

    const result = await guard.canActivate(makeContext(undefined));

    expect(result).toBe(true);
    expect(prisma.businessModule.findUnique).not.toHaveBeenCalled();
  });

  it('allows when the module is active for the business', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    prisma.businessModule.findUnique.mockResolvedValue({
      businessId: 'biz-1',
      moduleId: 'pos',
      active: true,
    });

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
    expect(prisma.businessModule.findUnique).toHaveBeenCalledWith({
      where: { businessId_moduleId: { businessId: 'biz-1', moduleId: 'pos' } },
    });
  });

  it('throws module_disabled when the BusinessModule row is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    prisma.businessModule.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toMatchObject({
      response: expect.objectContaining({ title: 'module_disabled:pos' }),
    });
  });

  it('throws module_disabled when the module is explicitly inactive', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    prisma.businessModule.findUnique.mockResolvedValue({
      businessId: 'biz-1',
      moduleId: 'pos',
      active: false,
    });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
  });
});
