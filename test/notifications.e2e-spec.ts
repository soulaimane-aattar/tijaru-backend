import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { closeTestDb, testDb } from './helpers/db';
import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let tokens: Record<'owner' | 'cashier', string>;
  let businessId: string;
  let productId: string;
  let originalMinStock: number;

  const lowStockCount = async (): Promise<number> =>
    Number(
      (
        await testDb
          .selectFrom('app.notifications')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('business_id', '=', businessId)
          .where('type', '=', 'lowStock')
          .executeTakeFirstOrThrow()
      ).n,
    );

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();

    const product = await testDb
      .selectFrom('app.products')
      .select(['id', 'business_id', 'minStock'])
      .where('sku', '=', 'SUC-1KG')
      .executeTakeFirstOrThrow();
    productId = product.id;
    businessId = product.business_id;
    originalMinStock = product.minStock;

    tokens = {
      owner: (await login(app, 'owner')).accessToken,
      cashier: (await login(app, 'cashier')).accessToken,
    };
  });

  afterAll(async () => {
    await testDb.updateTable('app.products').set({ minStock: originalMinStock }).where('id', '=', productId).execute();
    await closeTestDb();
    await app.close();
  });

  describe('POST /notifications/scan', () => {
    it('cashier blocked from scan (403)', async () => {
      await api(app).post('/api/v1/notifications/scan').set(bearer(tokens.cashier)).expect(403);
    });

    it('creates lowStock notification for product below minStock', async () => {
      // Total stock across warehouses stays untouched; set minStock above it to force a low-stock hit.
      const sumQty = await testDb
        .selectFrom('app.stock_levels')
        .select((eb) => eb.fn.sum<string>('qty').as('total'))
        .where('productId', '=', productId)
        .executeTakeFirstOrThrow();
      const total = Number(sumQty.total ?? 0);
      await testDb.updateTable('app.products').set({ minStock: total + 1000 }).where('id', '=', productId).execute();

      const res = await api(app).post('/api/v1/notifications/scan').set(bearer(tokens.owner)).expect(201);
      expect(res.body.lowStock).toBeGreaterThanOrEqual(1);

      // Other seed products are also below threshold — select ours by title.
      const n = await testDb
        .selectFrom('app.notifications')
        .select('body')
        .where('business_id', '=', businessId)
        .where('type', '=', 'lowStock')
        .where('title', '=', 'Sucre Cosumar lingot')
        .orderBy('date', 'desc')
        .executeTakeFirst();
      expect(n).toBeTruthy();
      expect(n?.body).toContain('stock');
    });

    it('is idempotent (dedup on unread)', async () => {
      await api(app).post('/api/v1/notifications/scan').set(bearer(tokens.owner)).expect(201);
      const c1 = await lowStockCount();

      await api(app).post('/api/v1/notifications/scan').set(bearer(tokens.owner)).expect(201);
      const c2 = await lowStockCount();

      expect(c2).toBe(c1);
    });
  });
});
