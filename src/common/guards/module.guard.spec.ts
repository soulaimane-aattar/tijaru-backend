import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { ForbiddenError } from '../errors';
import { fakeDb } from '../testing/db-fake';

import { ModuleGuard } from './module.guard';

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

describe('ModuleGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };

  const setup = (script: Record<string, unknown> = {}) => {
    const f = fakeDb({ 'select:app_auth.users': { restrict_modules: false, module_access: [] }, ...script });
    const guard = new ModuleGuard(reflector as unknown as Reflector, f.db);
    return { guard, calls: f.calls, tables: () => f.calls.map((c) => c.table) };
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
  });

  it('allows routes with no @RequiresModule metadata', async () => {
    const { guard, calls } = setup();

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('allows super admins without checking the module', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    const { guard, calls } = setup();

    expect(await guard.canActivate(makeContext(makeUser({ isSuperAdmin: true })))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('allows requests with no user on the request', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    const { guard, calls } = setup();

    expect(await guard.canActivate(makeContext(undefined))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('allows when the module is active for the business', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    const { guard, calls } = setup({ 'select:app.business_modules': { active: true } });

    expect(await guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(calls[0]!.where).toEqual([
      ['business_id', '=', 'biz-1'],
      ['module_id', '=', 'pos'],
    ]);
  });

  it('throws module_disabled when the BusinessModule row is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    const { guard } = setup({ 'select:app.business_modules': undefined });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toMatchObject({
      response: expect.objectContaining({ title: 'module_disabled:pos' }),
    });
  });

  it('throws module_disabled when the module is explicitly inactive', async () => {
    reflector.getAllAndOverride.mockReturnValue('pos');
    const { guard } = setup({ 'select:app.business_modules': { active: false } });

    await expect(guard.canActivate(makeContext(makeUser()))).rejects.toThrow(ForbiddenError);
  });

  describe('per-employee module access', () => {
    const employee = () => makeUser({ role: 'cashier' as AuthUser['role'] });
    const active = { 'select:app.business_modules': { active: true } };
    beforeEach(() => reflector.getAllAndOverride.mockReturnValue('pos'));

    it('lets an unrestricted employee through', async () => {
      const { guard } = setup(active);
      await expect(guard.canActivate(makeContext(employee()))).resolves.toBe(true);
    });

    it('lets a restricted employee use a module on their list', async () => {
      const { guard } = setup({ ...active, 'select:app_auth.users': { restrict_modules: true, module_access: ['pos'] } });
      await expect(guard.canActivate(makeContext(employee()))).resolves.toBe(true);
    });

    it('blocks a restricted employee from a module not on their list', async () => {
      const { guard } = setup({ ...active, 'select:app_auth.users': { restrict_modules: true, module_access: ['expenses'] } });
      await expect(guard.canActivate(makeContext(employee()))).rejects.toMatchObject({
        response: expect.objectContaining({ title: 'module_forbidden:pos' }),
      });
    });

    it('blocks a restricted employee with an empty list from everything', async () => {
      const { guard } = setup({ ...active, 'select:app_auth.users': { restrict_modules: true, module_access: [] } });
      await expect(guard.canActivate(makeContext(employee()))).rejects.toThrow(ForbiddenError);
    });

    it('never restricts owners (and skips the lookup)', async () => {
      const { guard, tables } = setup(active);
      await guard.canActivate(makeContext(makeUser()));
      expect(tables()).not.toContain('app_auth.users');
    });

    it('still enforces the business-level switch first', async () => {
      const { guard } = setup({
        'select:app.business_modules': { active: false },
        'select:app_auth.users': { restrict_modules: true, module_access: ['pos'] },
      });
      await expect(guard.canActivate(makeContext(employee()))).rejects.toMatchObject({
        response: expect.objectContaining({ title: 'module_disabled:pos' }),
      });
    });
  });
});
