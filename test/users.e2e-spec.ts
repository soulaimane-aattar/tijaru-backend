import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let cashierToken: string;
  let managerToken: string;

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    ownerToken = (await login(app, 'owner')).accessToken;
    cashierToken = (await login(app, 'cashier')).accessToken;
    managerToken = (await login(app, 'manager')).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users', () => {
    it('owner can list (5 users from seed)', async () => {
      const res = await api(app).get('/api/v1/users').set(bearer(ownerToken)).expect(200);
      expect(res.body).toHaveLength(5);
      expect(res.body[0].passwordHash).toBeUndefined();
    });

    it('cashier gets 403', async () => {
      await api(app).get('/api/v1/users').set(bearer(cashierToken)).expect(403);
    });

    it('manager gets 403 (users.manage not granted)', async () => {
      await api(app).get('/api/v1/users').set(bearer(managerToken)).expect(403);
    });

    it('no token gets 401', async () => {
      await api(app).get('/api/v1/users').expect(401);
    });
  });

  describe('POST /users', () => {
    it('owner creates a new user', async () => {
      const res = await api(app)
        .post('/api/v1/users')
        .set(bearer(ownerToken))
        .send({
          name: 'Test User',
          email: `test-${Date.now()}@elamrani.ma`,
          password: 'pass1234',
          role: 'viewer',
          warehouseIds: [],
        })
        .expect(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('rejects duplicate email with 409', async () => {
      await api(app)
        .post('/api/v1/users')
        .set(bearer(ownerToken))
        .send({
          name: 'Dup',
          email: 'youssef@elamrani.ma',
          password: 'pass1234',
          role: 'viewer',
          warehouseIds: [],
        })
        .expect(409);
    });

    it('rejects invalid email with 400', async () => {
      await api(app)
        .post('/api/v1/users')
        .set(bearer(ownerToken))
        .send({ name: 'Bad', email: 'nope', password: 'short', role: 'viewer' })
        .expect(400);
    });
  });

  describe('DELETE /users/:id', () => {
    it('returns 404 for unknown id', async () => {
      await api(app)
        .delete('/api/v1/users/cmphd00000000000000000000')
        .set(bearer(ownerToken))
        .expect(404);
    });
  });
});
