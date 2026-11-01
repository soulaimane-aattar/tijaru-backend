import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Customer categories e2e', () => {
  let app: INestApplication;
  let owner: string;
  let cashier: string;
  let catId: string;
  const CUID_MISSING = 'cmissing000000000000000000';

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    owner = (await login(app, 'owner')).accessToken;
    cashier = (await login(app, 'cashier')).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /customers/categories hits the list route, not :id', async () => {
    const res = await api(app).get('/api/v1/customers/categories').set(bearer(cashier)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('cashier cannot create (403); invalid color/label/credit rejected (400)', async () => {
    const body = { label: 'VIP', color: '#112233' };
    await api(app).post('/api/v1/customers/categories').set(bearer(cashier)).send(body).expect(403);
    for (const bad of [
      { ...body, color: 'red' },
      { ...body, label: '  ' },
      { ...body, creditLimit: -1 },
    ]) {
      await api(app).post('/api/v1/customers/categories').set(bearer(owner)).send(bad).expect(400);
    }
  });

  it('owner creates, then it appears in the list', async () => {
    const res = await api(app)
      .post('/api/v1/customers/categories')
      .set(bearer(owner))
      .send({ label: '  Gros client ', color: '#A1B2C3', creditLimit: 5000 })
      .expect(201);
    expect(res.body.label).toBe('Gros client');
    catId = res.body.id;
    const list = await api(app).get('/api/v1/customers/categories').set(bearer(owner)).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toContain(catId);
  });

  it('PATCH updates and returns the refreshed row; 404 when missing', async () => {
    const res = await api(app)
      .patch(`/api/v1/customers/categories/${catId}`)
      .set(bearer(owner))
      .send({ creditLimit: null })
      .expect(200);
    expect(res.body.id).toBe(catId);
    expect(res.body.creditLimit).toBeNull();
    await api(app)
      .patch(`/api/v1/customers/categories/${CUID_MISSING}`)
      .set(bearer(owner))
      .send({ label: 'x' })
      .expect(404);
  });

  it('customer can be assigned a category and falls back to null after category delete', async () => {
    const c = await api(app)
      .post('/api/v1/customers')
      .set(bearer(owner))
      .send({ name: 'Cat Customer', categoryId: catId })
      .expect(201);
    expect(c.body.categoryId).toBe(catId);

    await api(app).delete(`/api/v1/customers/categories/${catId}`).set(bearer(cashier)).expect(403);
    await api(app).delete(`/api/v1/customers/categories/${catId}`).set(bearer(owner)).expect(204);
    await api(app).delete(`/api/v1/customers/categories/${catId}`).set(bearer(owner)).expect(404);

    const after = await api(app).get(`/api/v1/customers/${c.body.id}`).set(bearer(owner)).expect(200);
    expect(after.body.categoryId).toBeNull();
  });

  it('duplicate label (case-insensitive) is 409 on create and rename, not 500', async () => {
    const a = await api(app).post('/api/v1/customers/categories').set(bearer(owner)).send({ label: 'Dup A', color: '#112233' }).expect(201);
    const b = await api(app).post('/api/v1/customers/categories').set(bearer(owner)).send({ label: 'Dup B', color: '#112233' }).expect(201);
    await api(app).post('/api/v1/customers/categories').set(bearer(owner)).send({ label: 'dup a', color: '#112233' }).expect(409);
    await api(app).patch(`/api/v1/customers/categories/${b.body.id}`).set(bearer(owner)).send({ label: 'DUP A' }).expect(409);
    // renaming to itself is not a conflict
    await api(app).patch(`/api/v1/customers/categories/${a.body.id}`).set(bearer(owner)).send({ label: 'Dup A' }).expect(200);
  });

  it('assigning a category id not visible to the tenant is 404, on create and update', async () => {
    await api(app).post('/api/v1/customers').set(bearer(owner)).send({ name: 'X', categoryId: CUID_MISSING }).expect(404);
    const c = await api(app).post('/api/v1/customers').set(bearer(owner)).send({ name: 'Y' }).expect(201);
    await api(app).patch(`/api/v1/customers/${c.body.id}`).set(bearer(owner)).send({ categoryId: CUID_MISSING }).expect(404);
  });
});
