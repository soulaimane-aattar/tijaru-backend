import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { CAPABILITY_IDS } from '../src/domain/permissions';

import { api, bearer, bootTestApp, DEMO, DEMO_PASSWORD, login, seedFresh } from './helpers/test-app';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    it.each(Object.entries(DEMO))('logs in as %s', async (_role, email) => {
      const res = await api(app)
        .post('/api/v1/auth/login')
        .send({ email, password: DEMO_PASSWORD })
        .expect(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user.email).toBe(email);
      expect(Array.isArray(res.body.capabilities)).toBe(true);
    });

    it('rejects bad password with 401', async () => {
      await api(app)
        .post('/api/v1/auth/login')
        .send({ email: DEMO.owner, password: 'wrong' })
        .expect(401);
    });

    it('rejects unknown email with 401', async () => {
      await api(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nope@example.com', password: 'demo1234' })
        .expect(401);
    });

    it('rejects invalid body with 400', async () => {
      await api(app)
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '' })
        .expect(400);
    });
  });

  describe('GET /auth/permissions (public)', () => {
    it('returns roles + capabilities + matrix', async () => {
      const res = await api(app).get('/api/v1/auth/permissions').expect(200);
      expect(res.body.roles).toHaveLength(6);
      // Derived from the capability registry, not a magic number — adding a
      // capability must not break this test.
      expect(res.body.capabilities).toHaveLength(CAPABILITY_IDS.length);
      expect(res.body.matrix.owner).toHaveLength(CAPABILITY_IDS.length);
      expect(res.body.matrix.viewer).toEqual(
        expect.arrayContaining(['dashboard.view', 'products.view', 'reports.view']),
      );
    });
  });

  describe('GET /auth/me', () => {
    it('requires bearer token (401)', async () => {
      await api(app).get('/api/v1/auth/me').expect(401);
    });

    it('returns user + capabilities for owner', async () => {
      const { accessToken } = await login(app, 'owner');
      const res = await api(app).get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
      expect(res.body.email).toBe(DEMO.owner);
      expect(res.body.role).toBe('owner');
      expect(res.body.capabilities).toContain('billing.manage');
    });

    it('cashier does not have users.manage', async () => {
      const { accessToken } = await login(app, 'cashier');
      const res = await api(app).get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
      expect(res.body.role).toBe('cashier');
      expect(res.body.capabilities).not.toContain('users.manage');
      expect(res.body.capabilities).toContain('stock.out');
    });
  });

  describe('POST /auth/refresh + /auth/logout', () => {
    it('rotates refresh token and revokes old', async () => {
      const { refreshToken } = await login(app, 'admin');
      const r1 = await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      expect(r1.body.refreshToken).not.toBe(refreshToken);
      // old refresh no longer accepted
      await api(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('logout revokes the current refresh', async () => {
      const { accessToken, refreshToken } = await login(app, 'manager');
      await api(app)
        .post('/api/v1/auth/logout')
        .set(bearer(accessToken))
        .send({ refreshToken })
        .expect(204);
      await api(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    });
  });
});
