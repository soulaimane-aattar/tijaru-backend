import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Batch CRUD (warehouses / categories / suppliers / customers) e2e', () => {
  let app: INestApplication;
  let tokens: Record<'owner' | 'manager' | 'cashier' | 'viewer', string>;

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    tokens = {
      owner: (await login(app, 'owner')).accessToken,
      manager: (await login(app, 'manager')).accessToken,
      cashier: (await login(app, 'cashier')).accessToken,
      viewer: '',
    };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('warehouses', () => {
    it('lists 3 seeded warehouses', async () => {
      const res = await api(app).get('/api/v1/warehouses').set(bearer(tokens.owner)).expect(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.find((w: { isDefault: boolean }) => w.isDefault)).toBeDefined();
    });

    it('manager cannot create (warehouses.manage denied)', async () => {
      await api(app)
        .post('/api/v1/warehouses')
        .set(bearer(tokens.manager))
        .send({ name: 'X', city: 'Y' })
        .expect(403);
    });

    it('owner creates + sets isDefault correctly', async () => {
      const created = await api(app)
        .post('/api/v1/warehouses')
        .set(bearer(tokens.owner))
        .send({ name: 'Test WH', city: 'Tanger', isDefault: true })
        .expect(201);
      expect(created.body.isDefault).toBe(true);

      const list = await api(app).get('/api/v1/warehouses').set(bearer(tokens.owner)).expect(200);
      const defaults = list.body.filter((w: { isDefault: boolean }) => w.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(created.body.id);
    });
  });

  describe('categories', () => {
    it('cashier can list (products.view)', async () => {
      const res = await api(app).get('/api/v1/categories').set(bearer(tokens.cashier)).expect(200);
      expect(res.body).toHaveLength(6);
    });

    it('manager cannot create (settings.manage denied)', async () => {
      await api(app)
        .post('/api/v1/categories')
        .set(bearer(tokens.manager))
        .send({ name: 'X', icon: 'tag', tone: '#abcdef' })
        .expect(403);
    });

    it('owner creates a category', async () => {
      const res = await api(app)
        .post('/api/v1/categories')
        .set(bearer(tokens.owner))
        .send({ name: 'New Cat', icon: 'tag', tone: '#abcdef' })
        .expect(201);
      expect(res.body.id).toBeDefined();
    });

    it('rejects invalid tone (400)', async () => {
      await api(app)
        .post('/api/v1/categories')
        .set(bearer(tokens.owner))
        .send({ name: 'Bad', icon: 'tag', tone: 'not-hex' })
        .expect(400);
    });
  });

  describe('suppliers', () => {
    it('cashier can list (products.view)', async () => {
      const res = await api(app).get('/api/v1/suppliers').set(bearer(tokens.cashier)).expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(5);
    });

    it('manager creates supplier (suppliers.manage granted)', async () => {
      await api(app)
        .post('/api/v1/suppliers')
        .set(bearer(tokens.manager))
        .send({ name: 'New Supplier', city: 'Fès' })
        .expect(201);
    });

    it('cashier cannot create (403)', async () => {
      await api(app)
        .post('/api/v1/suppliers')
        .set(bearer(tokens.cashier))
        .send({ name: 'X' })
        .expect(403);
    });

    it('rejects invalid ICE (400)', async () => {
      await api(app)
        .post('/api/v1/suppliers')
        .set(bearer(tokens.owner))
        .send({ name: 'Bad', ice: 'not-15-digits' })
        .expect(400);
    });
  });

  describe('customers', () => {
    it('cashier can list (stock.out — POS access)', async () => {
      const res = await api(app).get('/api/v1/customers').set(bearer(tokens.cashier)).expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });

    it('cashier can create at POS', async () => {
      await api(app)
        .post('/api/v1/customers')
        .set(bearer(tokens.cashier))
        .send({ name: 'New POS Customer', phone: '+212600000001' })
        .expect(201);
    });

    it('cashier cannot delete (suppliers.manage required)', async () => {
      const created = await api(app)
        .post('/api/v1/customers')
        .set(bearer(tokens.owner))
        .send({ name: 'To Delete' })
        .expect(201);
      await api(app)
        .delete(`/api/v1/customers/${created.body.id}`)
        .set(bearer(tokens.cashier))
        .expect(403);
    });

    it('search by name filters results', async () => {
      const res = await api(app)
        .get('/api/v1/customers?search=Mounir')
        .set(bearer(tokens.owner))
        .expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].name).toContain('Mounir');
    });
  });
});
