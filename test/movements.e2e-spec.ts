import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { closeTestDb, testDb } from './helpers/db';
import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Movements (e2e)', () => {
  let app: INestApplication;
  let tokens: Record<'owner' | 'stockkeeper' | 'cashier' | 'manager', string>;
  let productId: string;
  let casaId: string;
  let marrakechId: string;

  const stockAt = async (pid: string, whId: string): Promise<number> => {
    const sl = await testDb
      .selectFrom('app.stock_levels')
      .select('qty')
      .where('productId', '=', pid)
      .where('warehouseId', '=', whId)
      .executeTakeFirst();
    return sl?.qty ?? 0;
  };

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    const casa = await testDb.selectFrom('app.warehouses').select('id').where('isDefault', '=', true).executeTakeFirstOrThrow();
    const marrakech = await testDb.selectFrom('app.warehouses').select('id').where('city', '=', 'Marrakech').executeTakeFirstOrThrow();
    const product = await testDb.selectFrom('app.products').select('id').where('sku', '=', 'SUC-1KG').executeTakeFirstOrThrow();
    casaId = casa.id;
    marrakechId = marrakech.id;
    productId = product.id;

    tokens = {
      owner: (await login(app, 'owner')).accessToken,
      stockkeeper: (await login(app, 'stockkeeper')).accessToken,
      cashier: (await login(app, 'cashier')).accessToken,
      manager: (await login(app, 'manager')).accessToken,
    };
  });

  afterAll(async () => {
    await closeTestDb();
    await app.close();
  });

  describe('POST /movements — type "in"', () => {
    it('increments stock atomically', async () => {
      const before = await stockAt(productId, casaId);
      const res = await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.stockkeeper))
        .send({
          type: 'in',
          productId,
          warehouseId: casaId,
          qty: 50,
          reason: 'achat',
          ref: 'TEST-IN-1',
        })
        .expect(201);
      expect(res.body.type).toBe('in');
      expect(await stockAt(productId, casaId)).toBe(before + 50);
    });

    it('cashier blocked from stock.in (403)', async () => {
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.cashier))
        .send({ type: 'in', productId, warehouseId: casaId, qty: 1, reason: 'achat' })
        .expect(403);
    });
  });

  describe('POST /movements — type "out"', () => {
    it('decrements stock', async () => {
      const before = await stockAt(productId, casaId);
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.cashier))
        .send({
          type: 'out',
          productId,
          warehouseId: casaId,
          qty: 5,
          reason: 'vente',
          ref: 'TKT-TEST-1',
        })
        .expect(201);
      expect(await stockAt(productId, casaId)).toBe(before - 5);
    });

    it('rejects when stock insufficient (409) and does NOT mutate', async () => {
      const before = await stockAt(productId, casaId);
      const res = await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.cashier))
        .send({
          type: 'out',
          productId,
          warehouseId: casaId,
          qty: before + 9999,
          reason: 'vente',
        })
        .expect(409);
      expect(res.body.code).toBe('conflict');
      expect(res.body.title).toBe('insufficient_stock');
      expect(await stockAt(productId, casaId)).toBe(before);
    });
  });

  describe('POST /movements — type "transfer"', () => {
    it('moves qty source → dest atomically', async () => {
      const beforeSrc = await stockAt(productId, casaId);
      const beforeDst = await stockAt(productId, marrakechId);
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.stockkeeper))
        .send({
          type: 'transfer',
          productId,
          warehouseId: casaId,
          toWarehouseId: marrakechId,
          qty: 10,
          reason: 'transfert',
        })
        .expect(201);
      expect(await stockAt(productId, casaId)).toBe(beforeSrc - 10);
      expect(await stockAt(productId, marrakechId)).toBe(beforeDst + 10);
    });

    it('rejects transfer to same warehouse (400)', async () => {
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.stockkeeper))
        .send({
          type: 'transfer',
          productId,
          warehouseId: casaId,
          toWarehouseId: casaId,
          qty: 1,
          reason: 'transfert',
        })
        .expect(400);
    });

    it('rejects transfer without destination (400)', async () => {
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.stockkeeper))
        .send({
          type: 'transfer',
          productId,
          warehouseId: casaId,
          qty: 1,
          reason: 'transfert',
        })
        .expect(400);
    });

    it('cashier cannot transfer (403)', async () => {
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.cashier))
        .send({
          type: 'transfer',
          productId,
          warehouseId: casaId,
          toWarehouseId: marrakechId,
          qty: 1,
          reason: 'transfert',
        })
        .expect(403);
    });
  });

  describe('Validation', () => {
    it('rejects negative qty (400)', async () => {
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.owner))
        .send({ type: 'in', productId, warehouseId: casaId, qty: -3, reason: 'achat' })
        .expect(400);
    });

    it('rejects unknown product (404)', async () => {
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.owner))
        .send({
          type: 'in',
          productId: 'cmphd00000000000000000000',
          warehouseId: casaId,
          qty: 1,
          reason: 'achat',
        })
        .expect(404);
    });

    it('rejects unknown warehouse (404)', async () => {
      await api(app)
        .post('/api/v1/movements')
        .set(bearer(tokens.owner))
        .send({
          type: 'in',
          productId,
          warehouseId: 'cmphd00000000000000000000',
          qty: 1,
          reason: 'achat',
        })
        .expect(404);
    });
  });

  describe('GET /movements', () => {
    it('lists with default pagination', async () => {
      const res = await api(app)
        .get('/api/v1/movements')
        .set(bearer(tokens.owner))
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(10);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('filters by type=transfer', async () => {
      const res = await api(app)
        .get('/api/v1/movements?type=transfer')
        .set(bearer(tokens.owner))
        .expect(200);
      for (const m of res.body.items) expect(m.type).toBe('transfer');
    });

    it('filters by warehouseId (matches source OR dest)', async () => {
      const res = await api(app)
        .get(`/api/v1/movements?warehouseId=${marrakechId}`)
        .set(bearer(tokens.owner))
        .expect(200);
      for (const m of res.body.items) {
        const matches = m.warehouseId === marrakechId || m.toWarehouseId === marrakechId;
        expect(matches).toBe(true);
      }
    });
  });
});
