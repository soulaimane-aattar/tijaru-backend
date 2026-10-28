import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { BusinessSuspendedError, ForbiddenError, SubscriptionExpiredError } from '../errors';
import { fakeDb } from '../testing/db-fake';

import { SubscriptionGuard } from './subscription.guard';

function makeContext(user?: AuthUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
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

  const setup = (business?: Record<string, unknown>) => {
    const f = fakeDb({ 'select:app.businesses': business });
    const guard = new SubscriptionGuard(reflector as unknown as Reflector, f.db);
    const reads = () => f.calls.filter((c) => c.op === 'select');
    const updates = () => f.calls.filter((c) => c.op === 'update');
    return { guard, reads, updates };
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
  });

  it('allows public routes without checking the business', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { guard, reads } = setup();

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(reads()).toHaveLength(0);
  });

  it('allows super admins without checking the business', async () => {
    const { guard, reads } = setup();

    expect(await guard.canActivate(makeContext(makeUser({ isSuperAdmin: true })))).toBe(true);
    expect(reads()).toHaveLength(0);
  });

  it('allows requests with no businessId (platform-admin tokens)', async () => {
    const { guard, reads } = setup();

    expect(await guard.canActivate(makeContext(makeUser({ businessId: '' })))).toBe(true);
    expect(reads()).toHaveLength(0);
  });

  it('allows an active subscription with a future end date', async () => {
    const { guard, reads, updates } = setup({ plan: 'active', subscription_end: new Date(Date.now() + 86_400_000) });

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(reads()[0]!.where).toEqual([['id', '=', 'biz-1']]);
    expect(updates()).toHaveLength(0);
  });

  it('allows a business with no subscription end date (trial/no expiry)', async () => {
    const { guard } = setup({ plan: 'trial', subscription_end: null });

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
  });

  it('throws subscription_expired and downgrades an active plan to expired', async () => {
    const { guard, updates } = setup({ plan: 'active', subscription_end: new Date(Date.now() - 86_400_000) });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(SubscriptionExpiredError);
    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'subscription_expired' }),
    });
    expect(updates()[0]!.set).toEqual({ plan: 'expired' });
    expect(updates()[0]!.where).toEqual([['id', '=', 'biz-1']]);
  });

  it('throws subscription_expired without re-updating an already-expired plan', async () => {
    const { guard, updates } = setup({ plan: 'expired', subscription_end: new Date(Date.now() - 86_400_000) });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(SubscriptionExpiredError);
    expect(updates()).toHaveLength(0);
  });

  it('throws business_suspended for a suspended business', async () => {
    const { guard } = setup({ plan: 'suspended', subscription_end: null });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(BusinessSuspendedError);
    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'business_suspended' }),
    });
  });

  it('throws when the business is not found', async () => {
    const { guard } = setup(undefined);

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
  });
});
