import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { EAN13 } from '../src/domain/value-objects/ean13';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Products (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: Record<'owner' | 'manager' | 'stockkeeper' | 'cashier' | 'admin', string>;
  let categoryId: string;
  let warehouseId: string;

  const ean = (p12: string) => p12 + EAN13.checksum(p12);

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();
    const cat = await prisma.category.findFirstOrThrow();
    const wh = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    categoryId = cat.id;
    warehouseId = wh.id;
    tokens = {
      owner: (await login(app, 'owner')).accessToken,
      admin: (await login(app, 'admin')).accessToken,
      manager: (await login(app, 'manager')).accessToken,
      stockkeeper: (await login(app, 'stockkeeper')).accessToken,
      cashier: (await login(app, 'cashier')).accessToken,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /products', () => {
    it('owner lists 17 seeded products', async () => {
      const res = await api(app).get('/api/v1/products').set(bearer(tokens.owner)).expect(200);
      expect(res.body.total).toBe(17);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('every role with products.view can list (5 demo roles)', async () => {
      for (const role of ['owner', 'admin', 'manager', 'stockkeeper', 'cashier'] as const) {
        await api(app).get('/api/v1/products').set(bearer(tokens[role])).expect(200);
      }
    });

    it('returns 401 without token', async () => {
      await api(app).get('/api/v1/products').expect(401);
    });

    it('owner sees purchase price', async () => {
      const res = await api(app)
        .get('/api/v1/products?pageSize=1')
        .set(bearer(tokens.owner))
        .expect(200);
      expect(res.body.items[0].purchase).toBeDefined();
    });

    it('cashier does not see purchase price (interceptor strips it)', async () => {
      const res = await api(app)
        .get('/api/v1/products?pageSize=1')
        .set(bearer(tokens.cashier))
        .expect(200);
      expect(res.body.items[0].purchase).toBeUndefined();
      expect(res.body.items[0].sale).toBeDefined();
    });

    it('stockkeeper does not see purchase price', async () => {
      const res = await api(app)
        .get('/api/v1/products?pageSize=1')
        .set(bearer(tokens.stockkeeper))
        .expect(200);
      expect(res.body.items[0].purchase).toBeUndefined();
    });

    it('lowStock filter returns only low items', async () => {
      const res = await api(app)
        .get('/api/v1/products?lowStock=true')
        .set(bearer(tokens.owner))
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      for (const p of res.body.items) {
        const sum = p.stockLevels.reduce((s: number, l: { qty: number }) => s + l.qty, 0);
        expect(sum).toBeLessThanOrEqual(p.minStock);
        expect(sum).toBeGreaterThan(0);
      }
    });

    it('search by SKU returns the right product', async () => {
      const res = await api(app)
        .get('/api/v1/products?search=HOL-1L')
        .set(bearer(tokens.owner))
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0].name).toContain("Huile d'olive");
    });
  });

  describe('GET /products/:id', () => {
    it('returns 404 for unknown id', async () => {
      await api(app)
        .get('/api/v1/products/cmphd00000000000000000000')
        .set(bearer(tokens.owner))
        .expect(404);
    });
  });

  describe('POST /products', () => {
    const makeBody = (suffix: string) => ({
      name: `Test ${suffix}`,
      barcode: ean('612000000' + suffix.padStart(3, '0')),
      sku: `TEST-${suffix}`,
      categoryId,
      purchase: 10,
      sale: 15,
      vat: 20,
      unit: 'piece',
      stock: [{ warehouseId, qty: 5 }],
    });

    it('owner creates a product (201)', async () => {
      const res = await api(app)
        .post('/api/v1/products')
        .set(bearer(tokens.owner))
        .send(makeBody('001'))
        .expect(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.stockLevels).toHaveLength(1);
    });

    it('manager can create (products.create granted)', async () => {
      await api(app)
        .post('/api/v1/products')
        .set(bearer(tokens.manager))
        .send(makeBody('002'))
        .expect(201);
    });

    it('stockkeeper gets 403 (no products.create)', async () => {
      await api(app)
        .post('/api/v1/products')
        .set(bearer(tokens.stockkeeper))
        .send(makeBody('003'))
        .expect(403);
    });

    it('cashier gets 403', async () => {
      await api(app)
        .post('/api/v1/products')
        .set(bearer(tokens.cashier))
        .send(makeBody('004'))
        .expect(403);
    });

    it('rejects invalid EAN-13 checksum (400)', async () => {
      await api(app)
        .post('/api/v1/products')
        .set(bearer(tokens.owner))
        .send({ ...makeBody('005'), barcode: '6120000000010' })
        .expect(400);
    });

    it('rejects duplicate barcode (409)', async () => {
      const body = makeBody('006');
      await api(app).post('/api/v1/products').set(bearer(tokens.owner)).send(body).expect(201);
      await api(app)
        .post('/api/v1/products')
        .set(bearer(tokens.owner))
        .send({ ...body, sku: 'OTHER-SKU' })
        .expect(409);
    });

    it('rejects invalid VAT rate (400)', async () => {
      await api(app)
        .post('/api/v1/products')
        .set(bearer(tokens.owner))
        .send({ ...makeBody('007'), vat: 19 })
        .expect(400);
    });
  });

  describe('PATCH + DELETE /products', () => {
    let productId: string;

    beforeAll(async () => {
      const created = await api(app)
        .post('/api/v1/products')
        .set(bearer(tokens.owner))
        .send({
          name: 'Patchable',
          barcode: ean('612999000100'),
          sku: 'PATCH-1',
          categoryId,
          purchase: 5,
          sale: 8,
          vat: 20,
          unit: 'piece',
          stock: [],
        })
        .expect(201);
      productId = created.body.id;
    });

    it('owner patches name', async () => {
      const res = await api(app)
        .patch(`/api/v1/products/${productId}`)
        .set(bearer(tokens.owner))
        .send({ name: 'Patched name' })
        .expect(200);
      expect(res.body.name).toBe('Patched name');
    });

    it('manager cannot delete (products.delete denied)', async () => {
      await api(app)
        .delete(`/api/v1/products/${productId}`)
        .set(bearer(tokens.manager))
        .expect(403);
    });

    it('owner soft-deletes (204) and product disappears from list', async () => {
      await api(app)
        .delete(`/api/v1/products/${productId}`)
        .set(bearer(tokens.owner))
        .expect(204);

      const res = await api(app)
        .get(`/api/v1/products/${productId}`)
        .set(bearer(tokens.owner))
        .expect(404);
      expect(res.body.code).toBe('not_found');
    });
  });
});
