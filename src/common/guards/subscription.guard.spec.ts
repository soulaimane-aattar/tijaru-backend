import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { BusinessSuspendedError, ForbiddenError, SubscriptionExpiredError } from '../errors';
import type { PrismaService } from '../prisma.service';

import { SubscriptionGuard } from './subscription.guard';

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

describe('SubscriptionGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { business: { findUnique: jest.Mock; update: jest.Mock } };
  let guard: SubscriptionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    prisma = {
      business: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    guard = new SubscriptionGuard(reflector as unknown as Reflector, prisma as unknown as PrismaService);
  });

  it('allows public routes without checking the business', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  it('allows super admins without checking the business', async () => {
    const user = makeUser({ isSuperAdmin: true });

    const result = await guard.canActivate(makeContext(user));

    expect(result).toBe(true);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  it('allows requests with no businessId (platform-admin tokens)', async () => {
    const user = makeUser({ businessId: '' });

    const result = await guard.canActivate(makeContext(user));

    expect(result).toBe(true);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  it('allows an active subscription with a future end date', async () => {
    prisma.business.findUnique.mockResolvedValue({
      plan: 'active',
      subscriptionEnd: new Date(Date.now() + 86_400_000),
    });

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it('allows a business with no subscription end date (trial/no expiry)', async () => {
    prisma.business.findUnique.mockResolvedValue({
      plan: 'trial',
      subscriptionEnd: null,
    });

    const result = await guard.canActivate(makeContext(makeUser()));

    expect(result).toBe(true);
  });

  it('throws subscription_expired and downgrades an active plan to expired', async () => {
    prisma.business.findUnique.mockResolvedValue({
      plan: 'active',
      subscriptionEnd: new Date(Date.now() - 86_400_000),
    });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(SubscriptionExpiredError);
    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'subscription_expired' }),
    });
    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-1' },
      data: { plan: 'expired' },
    });
  });

  it('throws subscription_expired without re-updating an already-expired plan', async () => {
    prisma.business.findUnique.mockResolvedValue({
      plan: 'expired',
      subscriptionEnd: new Date(Date.now() - 86_400_000),
    });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(SubscriptionExpiredError);
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it('throws business_suspended for a suspended business', async () => {
    prisma.business.findUnique.mockResolvedValue({
      plan: 'suspended',
      subscriptionEnd: null,
    });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(BusinessSuspendedError);
    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'business_suspended' }),
    });
  });

  it('throws when the business is not found', async () => {
    prisma.business.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
  });
});
