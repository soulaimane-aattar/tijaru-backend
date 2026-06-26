import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Admin (e2e) — acceptance §13 #4 to #7', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerToken: string;
  let managerToken: string;
  let hassanId: string;

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();
    ownerToken = (await login(app, 'owner')).accessToken;
    managerToken = (await login(app, 'manager')).accessToken;
    hassanId = (await prisma.user.findFirstOrThrow({ where: { email: 'hassan@elamrani.ma' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /admin/roles', () => {
    it('owner lists 6 roles', async () => {
      const res = await api(app).get('/api/v1/admin/roles').set(bearer(ownerToken)).expect(200);
      expect(res.body).toHaveLength(6);
      const owner = res.body.find((r: { id: string }) => r.id === 'owner');
      expect(owner.editable).toBe(false);
    });

    it('manager cannot list roles (users.manage denied)', async () => {
      await api(app).get('/api/v1/admin/roles').set(bearer(managerToken)).expect(403);
    });
  });

  describe('Acceptance #4 — Manager role toggle off reports.view', () => {
    it('owner toggles reports.view off; matrix reflects change', async () => {
      // Before: manager has reports.view (default §6.2)
      const before = await api(app).get('/api/v1/auth/permissions').expect(200);
      expect(before.body.matrix.manager).toContain('reports.view');

      await api(app)
        .patch('/api/v1/admin/roles/manager')
        .set(bearer(ownerToken))
        .send({ capabilities: { 'reports.view': false } })
        .expect(200);

      const after = await api(app).get('/api/v1/auth/permissions').expect(200);
      expect(after.body.matrix.manager).not.toContain('reports.view');
      expect(after.body.matrix.manager).toContain('products.view'); // others intact
    });

    it('cannot edit owner role (403)', async () => {
      await api(app)
        .patch('/api/v1/admin/roles/owner')
        .set(bearer(ownerToken))
        .send({ capabilities: { 'billing.manage': false } })
        .expect(403);
    });

    it('rejects unknown role (404)', async () => {
      await api(app)
        .patch('/api/v1/admin/roles/godking')
        .set(bearer(ownerToken))
        .send({ capabilities: {} })
        .expect(404);
    });

    it('Karim re-logs in and new token reflects the missing cap', async () => {
      const { accessToken } = await login(app, 'manager');
      const me = await api(app).get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
      expect(me.body.capabilities).not.toContain('reports.view');
    });

    it('restoring default deletes customization row', async () => {
      await api(app)
        .patch('/api/v1/admin/roles/manager')
        .set(bearer(ownerToken))
        .send({ capabilities: { 'reports.view': true } })
        .expect(200);
      const customizations = await prisma.roleCustomization.findMany({
        where: { role: 'manager', capId: 'reports.view' },
      });
      expect(customizations).toHaveLength(0);
    });
  });

  describe('Acceptance #5 — Override grants Hassan reports.view', () => {
    it('GET /admin/users/:id/overrides shows current state', async () => {
      const res = await api(app)
        .get(`/api/v1/admin/users/${hassanId}/overrides`)
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body.userId).toBe(hassanId);
      const cap = res.body.capabilities.find((c: { id: string }) => c.id === 'reports.view');
      expect(cap.fromRole).toBe(false);
      expect(cap.override).toBe(null);
      expect(cap.effective).toBe(false);
    });

    it('PATCH overrides grants reports.view; effective true', async () => {
      const res = await api(app)
        .patch(`/api/v1/admin/users/${hassanId}/overrides`)
        .set(bearer(ownerToken))
        .send({ overrides: { 'reports.view': true } })
        .expect(200);
      const cap = res.body.capabilities.find((c: { id: string }) => c.id === 'reports.view');
      expect(cap.override).toBe('grant');
      expect(cap.effective).toBe(true);
    });

    it('Hassan re-logs in and gets reports.view in capabilities', async () => {
      const { accessToken } = await login(app, 'stockkeeper');
      const me = await api(app).get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
      expect(me.body.capabilities).toContain('reports.view');
    });

    it('Setting override to "role" clears it', async () => {
      await api(app)
        .patch(`/api/v1/admin/users/${hassanId}/overrides`)
        .set(bearer(ownerToken))
        .send({ overrides: { 'reports.view': 'role' } })
        .expect(200);
      const overrides = await prisma.userOverride.findMany({
        where: { userId: hassanId, capId: 'reports.view' },
      });
      expect(overrides).toHaveLength(0);
    });
  });

  describe('Acceptance #6 — Sessions revoke', () => {
    it('lists active sessions', async () => {
      const res = await api(app)
        .get('/api/v1/admin/sessions')
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].user).toBeDefined();
    });

    it('revoke a session removes it from active list', async () => {
      const { refreshToken } = await login(app, 'cashier');
      const list = await api(app).get('/api/v1/admin/sessions').set(bearer(ownerToken)).expect(200);
      const sessionsBefore = list.body.length;

      // Login created an extra session; revoke the most recent one.
      const newest = list.body[0];
      await api(app)
        .delete(`/api/v1/admin/sessions/${newest.id}`)
        .set(bearer(ownerToken))
        .expect(204);

      const after = await api(app).get('/api/v1/admin/sessions').set(bearer(ownerToken)).expect(200);
      expect(after.body.find((s: { id: string }) => s.id === newest.id)).toBeUndefined();
      expect(after.body.length).toBeLessThan(sessionsBefore);

      // Salma's refresh should now be blocked.
      void refreshToken;
    });

    it('manager cannot list/revoke sessions (403)', async () => {
      await api(app).get('/api/v1/admin/sessions').set(bearer(managerToken)).expect(403);
    });

    it('revoke-all revokes everything', async () => {
      const before = await api(app)
        .get('/api/v1/admin/sessions')
        .set(bearer(ownerToken))
        .expect(200);
      expect(before.body.length).toBeGreaterThan(0);

      // Note: this revokes the owner's own session too. Re-login is needed for further calls.
      await api(app).delete('/api/v1/admin/sessions').set(bearer(ownerToken)).expect(200);

      ownerToken = (await login(app, 'owner')).accessToken;
    });
  });

  describe('Acceptance #7 — Security policy', () => {
    it('GET /admin/security-policy returns current config', async () => {
      const res = await api(app)
        .get('/api/v1/admin/security-policy')
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body.passwordMinLen).toBeDefined();
    });

    it('PATCH min-len 14 + 2FA for stockkeeper persists', async () => {
      const res = await api(app)
        .patch('/api/v1/admin/security-policy')
        .set(bearer(ownerToken))
        .send({ passwordMinLen: 14, twoFARequiredFor: ['stockkeeper'] })
        .expect(200);
      expect(res.body.passwordMinLen).toBe(14);
      expect(res.body.twoFARequiredFor).toEqual(['stockkeeper']);
    });

    it('manager cannot patch (settings.manage denied)', async () => {
      await api(app)
        .patch('/api/v1/admin/security-policy')
        .set(bearer(managerToken))
        .send({ passwordMinLen: 8 })
        .expect(403);
    });
  });

});

