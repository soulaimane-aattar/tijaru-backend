import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { ForbiddenError } from '../errors';
import { fakeDb } from '../testing/db-fake';

import { LimitGuard } from './limit.guard';

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

describe('LimitGuard', () => {
  let reflector: { get: jest.Mock };

  const setup = (script: Record<string, unknown> = {}) => {
    const f = fakeDb(script);
    const guard = new LimitGuard(reflector as unknown as Reflector, f.db);
    return { guard, calls: f.calls };
  };

  beforeEach(() => {
    reflector = { get: jest.fn().mockReturnValue(undefined) };
  });

  it('allows routes with no @EnforceLimit metadata', async () => {
    const { guard, calls } = setup();

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('allows super admins without checking the limit', async () => {
    reflector.get.mockReturnValue('users');
    const { guard, calls } = setup();

    expect(await guard.canActivate(makeContext(makeUser({ isSuperAdmin: true })))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('allows requests with no user on the request', async () => {
    reflector.get.mockReturnValue('users');
    const { guard, calls } = setup();

    expect(await guard.canActivate(makeContext(undefined))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('allows when the business row is missing', async () => {
    reflector.get.mockReturnValue('users');
    const { guard, calls } = setup({ 'select:app.businesses': undefined });

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(calls.filter((c) => c.table === 'app_auth.users')).toHaveLength(0);
  });

  it('allows when current count is under the max', async () => {
    reflector.get.mockReturnValue('users');
    const { guard, calls } = setup({ 'select:app.businesses': { max_users: 5 }, 'select:app_auth.users': { n: '3' } });

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(calls.find((c) => c.table === 'app_auth.users')!.where).toEqual([
      ['business_id', '=', 'biz-1'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('throws limit_reached when current count equals the max', async () => {
    reflector.get.mockReturnValue('users');
    const { guard } = setup({ 'select:app.businesses': { max_users: 5 }, 'select:app_auth.users': { n: '5' } });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toMatchObject({
      response: expect.objectContaining({ title: 'limit_reached:users' }),
    });
  });

  it('throws limit_reached when current count exceeds the max', async () => {
    reflector.get.mockReturnValue('products');
    const { guard } = setup({ 'select:app.businesses': { max_products: 100 }, 'select:app.products': { n: '101' } });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
  });

  it('counts warehouses for the warehouses resource', async () => {
    reflector.get.mockReturnValue('warehouses');
    const { guard, calls } = setup({ 'select:app.businesses': { max_warehouses: 2 }, 'select:app.warehouses': { n: '1' } });

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(calls.find((c) => c.table === 'app.warehouses')!.where).toEqual([
      ['business_id', '=', 'biz-1'],
      ['deletedAt', 'is', null],
    ]);
  });
});
