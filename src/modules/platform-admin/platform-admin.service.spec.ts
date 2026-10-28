import * as bcrypt from 'bcrypt';

import { ConflictError, NotFoundError } from '../../common/errors';
import { fakeDb, type FakeCall } from '../../common/testing/db-fake';

import { PlatformAdminService } from './platform-admin.service';

const mockJwt = () => ({ signAsync: jest.fn().mockResolvedValue('pa-token') }) as never;

const mockEnv = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  BCRYPT_COST: 4,
} as never;

type Deps = { jwt?: unknown; env?: unknown; perms?: unknown; mail?: unknown };

/** Service on a fake `Db`; `script` keys are `"<op>:<table>"` (see db-fake). */
const make = (script: Record<string, unknown> = {}, deps: Deps = {}) => {
  const f = fakeDb(script);
  const svc = new PlatformAdminService(
    f.db,
    (deps.jwt ?? mockJwt()) as never,
    (deps.env ?? mockEnv) as never,
    {} as never,
    (deps.perms ?? {}) as never,
    (deps.mail ?? {}) as never,
  );
  const on = (op: FakeCall['op'], table: string) => f.calls.filter((c) => c.op === op && c.table === table);
  return { ...f, svc, on };
};

/** Scripted business lookup + update echo for the simple business actions. */
const bizScript = (biz: Record<string, unknown> = { id: 'b1', name: 'ISSA' }) => ({
  'select:app.businesses': biz,
});

describe('PlatformAdminService', () => {
  describe('impersonate', () => {
    const perms = { effectiveCapsForRole: jest.fn().mockResolvedValue(['dashboard.view']) };
    const setup = (script: Record<string, unknown> = {}) => {
      const jwt = { signAsync: jest.fn().mockResolvedValue('imp-token') };
      const m = make(
        {
          'select:app.businesses': { id: 'b1', name: 'ISSA' },
          'select:app_auth.users': { id: 'u1', name: 'Omar', role: 'owner', tokenVersion: 2 },
          'select:app_auth.user_overrides': [{ capId: 'products.view', granted: false }],
          ...script,
        },
        { jwt, perms },
      );
      return { ...m, jwt };
    };

    it("acts as the business owner by default, with that role's caps and overrides", async () => {
      const { calls, jwt, svc } = setup();
      const res = await svc.impersonate('b1', 'pa1');
      const userQuery = calls.find((c) => c.table === 'app_auth.users')!;
      expect(userQuery.where).toEqual(
        expect.arrayContaining([['business_id', '=', 'b1'], ['role', '=', 'owner']]),
      );
      expect(perms.effectiveCapsForRole).toHaveBeenCalledWith('owner', 'b1');
      expect(jwt.signAsync.mock.calls[0][0]).toMatchObject({
        sub: 'u1',
        type: 'platform-admin-impersonate',
        pa: 'pa1',
        bid: 'b1',
        role: 'owner',
        ver: 2,
        caps: ['dashboard.view'],
        overrides: { 'products.view': false },
      });
      expect(res).toMatchObject({ accessToken: 'imp-token', business: { id: 'b1' }, user: { id: 'u1', role: 'owner' } });
    });

    it('targets a specific user of the business (role switcher)', async () => {
      const { calls, svc } = setup();
      await svc.impersonate('b1', 'pa1', 'ckx9owner0000cuid');
      const userQuery = calls.find((c) => c.table === 'app_auth.users')!;
      expect(userQuery.where).toEqual(
        expect.arrayContaining([['business_id', '=', 'b1'], ['id', '=', 'ckx9owner0000cuid']]),
      );
    });

    it('404s on unknown business or user', async () => {
      await expect(setup({ 'select:app.businesses': undefined }).svc.impersonate('nope', 'pa1')).rejects.toBeInstanceOf(NotFoundError);
      await expect(setup({ 'select:app_auth.users': undefined }).svc.impersonate('b1', 'pa1', 'ghost')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getBusinessDetail', () => {
    it('returns business with owner and modules', async () => {
      const { svc } = make({ 'select:app.businesses': { id: 'b1' } });
      expect(await svc.getBusinessDetail('b1')).toEqual({ id: 'b1', users: [], modules: [] });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const { svc } = make({ 'select:app.businesses': undefined });
      await expect(svc.getBusinessDetail('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateBusiness', () => {
    it('updates limits when business exists', async () => {
      const { svc, on } = make({ ...bizScript({ id: 'b1', name: 'X' }), 'update:app.businesses': { id: 'b1', max_users: 10 } });
      const result = await svc.updateBusiness('b1', { maxUsers: 10 });
      expect(on('update', 'app.businesses')[0]!.set).toEqual({ max_users: 10 });
      expect(on('update', 'app.businesses')[0]!.where).toEqual([['id', '=', 'b1']]);
      expect(result).toEqual({ id: 'b1', maxUsers: 10 });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const { svc } = make({ 'select:app.businesses': undefined });
      await expect(svc.updateBusiness('missing', { maxUsers: 10 })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('extendSubscription', () => {
    it('sets plan active and computes subscription end from duration', async () => {
      const { svc } = make({
        ...bizScript({ id: 'b1', name: 'X' }),
        'update:app.businesses': (c: FakeCall) => ({ id: 'b1', ...(c.set as object) }),
      });
      const before = Date.now();
      const result = (await svc.extendSubscription('b1', '1mo')) as {
        plan: string;
        subscriptionStart: Date;
        subscriptionEnd: Date;
      };
      expect(result.plan).toBe('active');
      const deltaDays = (result.subscriptionEnd.getTime() - result.subscriptionStart.getTime()) / 86_400_000;
      expect(deltaDays).toBeCloseTo(30, 5);
      expect(result.subscriptionStart.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('throws NotFoundError when business does not exist', async () => {
      const { svc } = make({ 'select:app.businesses': undefined });
      await expect(svc.extendSubscription('missing', '1yr')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('suspendBusiness', () => {
    it('sets status and plan to suspended', async () => {
      const { svc, on } = make(bizScript());
      await svc.suspendBusiness('b1');
      expect(on('update', 'app.businesses')[0]!.set).toEqual({ status: 'suspended', plan: 'suspended' });
      expect(on('update', 'app.businesses')[0]!.where).toEqual([['id', '=', 'b1']]);
    });

    it('throws NotFoundError when business does not exist', async () => {
      const { svc } = make({ 'select:app.businesses': undefined });
      await expect(svc.suspendBusiness('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('audit journal', () => {
    it('writes an err-toned entry when suspending', async () => {
      const { svc, on } = make(bizScript({ id: 'b1', name: 'Pharmacie Yasmine' }));
      await svc.suspendBusiness('b1');
      expect(on('insert', 'platform_audit_logs')[0]!.values).toEqual(
        expect.objectContaining({ action: 'suspend', tone: 'err', target_id: 'b1', target_name: 'Pharmacie Yasmine' }),
      );
    });

    it('records extension duration in the detail', async () => {
      const { svc, on } = make({ ...bizScript({ id: 'b1', name: 'Café Riad Nomad' }), 'update:app.businesses': { id: 'b1' } });
      await svc.extendSubscription('b1', '1yr');
      expect(on('insert', 'platform_audit_logs')[0]!.values).toEqual(
        expect.objectContaining({ action: 'extend', detail: '+12 mois' }),
      );
    });

    it('never fails the action when journaling throws', async () => {
      const { svc } = make({
        ...bizScript({ id: 'b1', name: 'X' }),
        'insert:platform_audit_logs': () => {
          throw new Error('db down');
        },
      });
      await expect(svc.suspendBusiness('b1')).resolves.toBeUndefined();
    });

    it('listAudit returns newest entries first with a limit', async () => {
      const { svc } = make({ 'select:platform_audit_logs': [{ id: 'a1', created_at: 'd' }] });
      await expect(svc.listAudit(20)).resolves.toEqual([{ id: 'a1', createdAt: 'd' }]);
    });
  });

  describe('activateBusiness', () => {
    it('sets status and plan to active', async () => {
      const { svc, on } = make(bizScript());
      await svc.activateBusiness('b1');
      expect(on('update', 'app.businesses')[0]!.set).toEqual({ status: 'active', plan: 'active' });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const { svc } = make({ 'select:app.businesses': undefined });
      await expect(svc.activateBusiness('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateModules', () => {
    it('upserts each module within a transaction', async () => {
      const { svc, on } = make(bizScript());
      await svc.updateModules('b1', { pos: true, invoicing: false });
      const ups = on('insert', 'app.business_modules');
      expect(ups).toHaveLength(2);
      expect(ups[0]!.values).toMatchObject({ business_id: 'b1', module_id: 'pos', active: true });
      expect(ups[0]!.conflict).toMatchObject({ columns: ['business_id', 'module_id'], set: { active: true } });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const { svc } = make({ 'select:app.businesses': undefined });
      await expect(svc.updateModules('missing', { pos: true })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateSettings', () => {
    const biz = { id: 'b1', name: 'Boulangerie Atlas', city: 'Rabat', multi_warehouse: true };
    const fresh = (over: Record<string, unknown> = {}) => ({
      multi_warehouse: false,
      enabled_vat_rates: [0, 7, 10, 14, 20],
      default_vat_rate: 20,
      bons_affect_stock: true,
      ...over,
    });
    /** First business read is the pre-state; the last one is the post-update settings. */
    const bizReads = (pre: Record<string, unknown>, post: Record<string, unknown>) => {
      let n = 0;
      return () => (n++ === 0 ? pre : post);
    };

    it('disabling multi-stock renames the single warehouse to the business name', async () => {
      const { svc, on } = make({
        'select:app.businesses': bizReads(biz, fresh()),
        'select:app.warehouses': [{ id: 'w1' }],
      });
      const out = await svc.updateSettings('b1', { multiWarehouse: false });
      expect(on('update', 'app.warehouses')[0]!.set).toEqual({ name: 'Boulangerie Atlas', isDefault: true, active: true });
      expect(on('update', 'app.warehouses')[0]!.where).toEqual([['id', '=', 'w1']]);
      expect(on('update', 'app.businesses')[0]!.set).toEqual({ multi_warehouse: false });
      expect(out.multiWarehouse).toBe(false);
    });

    it('disabling multi-stock creates a default warehouse named after the business when none exists', async () => {
      const { svc, on } = make({
        'select:app.businesses': bizReads(biz, fresh({ enabled_vat_rates: [0] })),
        'select:app.warehouses': [],
      });
      await svc.updateSettings('b1', { multiWarehouse: false });
      expect(on('insert', 'app.warehouses')[0]!.values).toMatchObject({
        business_id: 'b1',
        name: 'Boulangerie Atlas',
        city: 'Rabat',
        isDefault: true,
        active: true,
      });
    });

    it('refuses to disable multi-stock with more than one active warehouse', async () => {
      const { svc, on } = make({ 'select:app.businesses': biz, 'select:app.warehouses': [{ id: 'w1' }, { id: 'w2' }] });
      await expect(svc.updateSettings('b1', { multiWarehouse: false })).rejects.toBeInstanceOf(ConflictError);
      expect(on('update', 'app.businesses')).toHaveLength(0);
    });

    it('tvaEnabled false sets enabledVatRates to [0]; true restores the full set', async () => {
      const { svc, on } = make({ 'select:app.businesses': bizReads(biz, fresh({ multi_warehouse: true, enabled_vat_rates: [0] })) });
      await svc.updateSettings('b1', { tvaEnabled: false });
      expect(on('update', 'app.businesses')[0]!.set).toEqual({ enabled_vat_rates: [0] });
      await svc.updateSettings('b1', { tvaEnabled: true });
      expect(on('update', 'app.businesses')[1]!.set).toEqual({ enabled_vat_rates: [0, 7, 10, 14, 20] });
    });

    it('throws NotFoundError when business does not exist', async () => {
      const { svc } = make({ 'select:app.businesses': undefined });
      await expect(svc.updateSettings('missing', { tvaEnabled: false })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('listBusinesses', () => {
    it('filters by both status and plan when both provided', async () => {
      const { svc, on } = make();
      await svc.listBusinesses('active', 'trial');
      expect(on('select', 'app.businesses')[0]!.where).toEqual([
        ['status', '=', 'active'],
        ['plan', '=', 'trial'],
      ]);
    });

    it('applies no filter when both are undefined', async () => {
      const { svc, on } = make();
      await svc.listBusinesses();
      expect(on('select', 'app.businesses')[0]!.where).toEqual([]);
    });

    it('attaches the oldest owner of each business', async () => {
      const { svc } = make({
        'select:app.businesses': [{ id: 'b1', name: 'A', max_users: 3 }],
        'select:app_auth.users': [{ id: 'u1', name: 'Omar', email: 'o@a.ma', phone: null, business_id: 'b1' }],
      });
      expect(await svc.listBusinesses()).toEqual([
        { id: 'b1', name: 'A', maxUsers: 3, users: [{ id: 'u1', name: 'Omar', email: 'o@a.ma', phone: null }] },
      ]);
    });
  });

  describe('listUsers', () => {
    // count query resolves first (Promise.all order), then the page rows
    const usersScript = (total: string) => ({ 'select:app_auth.users as u': { n: total } });

    it('returns paginated cross-business users', async () => {
      let call = 0;
      const m = make({
        'select:app_auth.users as u': () =>
          call++ === 0
            ? { n: '42' }
            : [{ id: 'u1', name: 'Ali', b_id: 'b1', b_name: 'Biz', b_plan: 'active', b_status: 'active' }],
      });
      const out = await m.svc.listUsers({ page: 2, pageSize: 10 });
      expect(out).toMatchObject({ total: 42, page: 2, pageSize: 10 });
      expect(out.items[0]).toMatchObject({ id: 'u1', business: { id: 'b1', name: 'Biz' } });
    });

    it('narrows by businessId when provided', async () => {
      const { svc, on } = make(usersScript('0'));
      await svc.listUsers({ businessId: 'b1', page: 1, pageSize: 25 });
      expect(on('select', 'app_auth.users as u')[0]!.where).toContainEqual(['u.business_id', '=', 'b1']);
    });

    it('searches name + email case-insensitively', async () => {
      const { svc, on } = make(usersScript('0'));
      await svc.listUsers({ search: 'ali', page: 1, pageSize: 25 });
      expect(on('select', 'app_auth.users as u')[0]!.where).toContainEqual([
        {
          or: [
            { a: 'u.name', op: 'ilike', b: '%ali%' },
            { a: 'u.email', op: 'ilike', b: '%ali%' },
          ],
        },
      ]);
    });

    it('never returns soft-deleted users', async () => {
      const { svc, on } = make(usersScript('0'));
      await svc.listUsers({ page: 1, pageSize: 25 });
      expect(on('select', 'app_auth.users as u')[0]!.where).toContainEqual(['u.deletedAt', 'is', null]);
    });
  });

  describe('resetUserPassword', () => {
    const activeUser = { id: 'u1', business_id: 'b1', name: 'Ali', business_name: 'Biz' };

    it('returns a temp password of length >= 10 from the unambiguous alphabet', async () => {
      const { svc } = make({ 'select:app_auth.users as u': activeUser });
      const { tempPassword } = await svc.resetUserPassword('u1');
      expect(tempPassword.length).toBeGreaterThanOrEqual(10);
      expect(tempPassword).toMatch(/^[A-HJ-NP-Za-hj-np-z2-9]+$/);
    });

    it('persists a bcrypt hash that verifies against the returned temp password', async () => {
      const { svc, on } = make({ 'select:app_auth.users as u': activeUser });
      const { tempPassword } = await svc.resetUserPassword('u1');
      const set = on('update', 'app_auth.users')[0]!.set as { passwordHash: string };
      expect(await bcrypt.compare(tempPassword, set.passwordHash)).toBe(true);
    });

    it('increments tokenVersion and revokes active sessions', async () => {
      const { svc, on } = make({ 'select:app_auth.users as u': activeUser });
      await svc.resetUserPassword('u1');
      const upd = on('update', 'app_auth.users')[0]!;
      expect(upd.where).toEqual([['id', '=', 'u1']]);
      expect(upd.set).toMatchObject({ tokenVersion: { a: 'tokenVersion', op: '+', b: 1 } });
      const sess = on('update', 'app_auth.sessions')[0]!;
      expect(sess.where).toEqual([
        ['userId', '=', 'u1'],
        ['revokedAt', 'is', null],
      ]);
      expect(sess.set).toEqual({ revokedAt: expect.any(Date) });
    });

    it('honors a larger passwordMinLen from the business policy', async () => {
      const { svc } = make({
        'select:app_auth.users as u': activeUser,
        'select:app_auth.security_policies': { passwordMinLen: 16 },
      });
      const { tempPassword } = await svc.resetUserPassword('u1');
      expect(tempPassword.length).toBeGreaterThanOrEqual(16);
    });

    it('throws NotFoundError for an unknown or soft-deleted user', async () => {
      const { svc } = make({ 'select:app_auth.users as u': undefined });
      await expect(svc.resetUserPassword('ghost')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getStats', () => {
    it('aggregates counts by plan and status', async () => {
      const counts = ['10', '6', '1', '2', '1']; // total, active, expired, pending, suspended
      let i = 0;
      const { svc } = make({
        'select:app.businesses': () => ({ n: counts[i++] }),
        'select:app_auth.users': { n: '0' },
      });
      expect(await svc.getStats()).toEqual({ total: 10, active: 6, expired: 1, pending: 2, suspended: 1, users: 0, newUsers7d: 0 });
    });
  });

  describe('updateSettings — fine TVA + bons stock flag', () => {
    const baseBiz = {
      id: 'b1',
      name: 'Épice Atlas',
      city: 'Casa',
      multi_warehouse: true,
      enabled_vat_rates: [0, 7, 10, 14, 20],
      default_vat_rate: 20,
      bons_affect_stock: true,
    };
    const reads = (post: Record<string, unknown>) => {
      let n = 0;
      return () => (n++ === 0 ? baseBiz : post);
    };

    it('saves an exact rate set with its default and returns the full settings', async () => {
      const post = { multi_warehouse: true, enabled_vat_rates: [0, 10], default_vat_rate: 10, bons_affect_stock: true };
      const { svc, on } = make({ 'select:app.businesses': reads(post) });
      const result = await svc.updateSettings('b1', { enabledVatRates: [0, 10], defaultVatRate: 10 });
      expect(on('update', 'app.businesses')[0]!.set).toEqual({ enabled_vat_rates: [0, 10], default_vat_rate: 10 });
      expect(result).toEqual({ multiWarehouse: true, enabledVatRates: [0, 10], defaultVatRate: 10, bonsAffectStock: true });
    });

    it('rejects a default VAT rate that is not in the final enabled set', async () => {
      const { svc, on } = make({ 'select:app.businesses': baseBiz });
      // 14 requested as default but not part of the enabled set.
      await expect(svc.updateSettings('b1', { enabledVatRates: [0, 20], defaultVatRate: 14 })).rejects.toMatchObject({
        response: { code: 'conflict' },
      });
      expect(on('update', 'app.businesses')).toHaveLength(0);
    });

    it('persists bonsAffectStock=false (bons stop consuming stock)', async () => {
      const post = { multi_warehouse: true, enabled_vat_rates: [0, 7, 10, 14, 20], default_vat_rate: 20, bons_affect_stock: false };
      const { svc, on } = make({ 'select:app.businesses': reads(post) });
      const result = await svc.updateSettings('b1', { bonsAffectStock: false });
      expect(on('update', 'app.businesses')[0]!.set).toEqual({ bons_affect_stock: false });
      expect(result.bonsAffectStock).toBe(false);
    });
  });

  describe('updateBusinessUser — employee access from the super admin', () => {
    const employee = { id: 'u2', name: 'Hicham', email: 'hicham@biz.ma', role: 'cashier', active: true };

    it('changes an employee role', async () => {
      const { svc, on } = make({
        'select:app_auth.users': employee,
        'update:app_auth.users': { ...employee, role: 'manager' },
      });
      const result = await svc.updateBusinessUser('b1', 'u2', { role: 'manager' });
      expect(on('update', 'app_auth.users')[0]!.set).toEqual({ role: 'manager' });
      expect(on('update', 'app_auth.users')[0]!.where).toEqual([['id', '=', 'u2']]);
      expect(result.role).toBe('manager');
    });

    it('blocks deactivating the last active owner', async () => {
      let n = 0;
      const { svc, on } = make({
        // 1st read: the user (an owner), 2nd: count of other active owners
        'select:app_auth.users': () => (n++ === 0 ? { ...employee, role: 'owner' } : { n: '0' }),
      });
      await expect(svc.updateBusinessUser('b1', 'u2', { active: false })).rejects.toMatchObject({
        response: { code: 'conflict' },
      });
      expect(on('update', 'app_auth.users')).toHaveLength(0);
    });

    it('404s when the user belongs to another business', async () => {
      const { svc } = make({ 'select:app_auth.users': undefined });
      await expect(svc.updateBusinessUser('b1', 'u-elsewhere', { role: 'viewer' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('approval email', () => {
    const setup = (owner: unknown) => {
      const mail = { send: jest.fn().mockResolvedValue(true) };
      const env = { ...(mockEnv as object), APP_URL: 'https://tijaru.com' };
      const m = make(
        { 'select:app.businesses': { id: 'b1', name: 'ISSA', status: 'pending' }, 'select:app_auth.users': owner },
        { env, mail },
      );
      return { mail, svc: m.svc };
    };

    it('mails the owner when a business is approved, and when it is rejected', async () => {
      const { mail, svc } = setup({ name: 'Omar', email: 'o@issa.ma' });
      await svc.approveBusiness('b1');
      expect(mail.send).toHaveBeenLastCalledWith('o@issa.ma', expect.objectContaining({ subject: expect.stringContaining('acceptée') }));
      await svc.rejectBusiness('b1');
      expect(mail.send).toHaveBeenLastCalledWith('o@issa.ma', expect.objectContaining({ subject: expect.stringContaining('pas pu être validée') }));
    });

    it('still approves when the business has no owner to mail', async () => {
      const { mail, svc } = setup(undefined);
      await expect(svc.approveBusiness('b1')).resolves.toBeUndefined();
      expect(mail.send).not.toHaveBeenCalled();
    });
  });
});
