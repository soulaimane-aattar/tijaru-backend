import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: Record<'owner' | 'cashier', string>;
  let businessId: string;
  let productId: string;
  let originalMinStock: number;

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();

    const product = await prisma.product.findFirstOrThrow({ where: { sku: 'SUC-1KG' } });
    productId = product.id;
    businessId = product.businessId;
    originalMinStock = product.minStock;

    tokens = {
      owner: (await login(app, 'owner')).accessToken,
      cashier: (await login(app, 'cashier')).accessToken,
    };
  });

  afterAll(async () => {
    await prisma.product.update({ where: { id: productId }, data: { minStock: originalMinStock } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /notifications/scan', () => {
    it('cashier blocked from scan (403)', async () => {
      await api(app).post('/api/v1/notifications/scan').set(bearer(tokens.cashier)).expect(403);
    });

    it('creates lowStock notification for product below minStock', async () => {
      // Total stock across warehouses stays untouched; set minStock above it to force a low-stock hit.
      const sumQty = await prisma.stockLevel.aggregate({
        where: { productId },
        _sum: { qty: true },
      });
      const total = sumQty._sum.qty ?? 0;
      await prisma.product.update({ where: { id: productId }, data: { minStock: total + 1000 } });

      const res = await api(app).post('/api/v1/notifications/scan').set(bearer(tokens.owner)).expect(201);
      expect(res.body.lowStock).toBeGreaterThanOrEqual(1);

      const n = await prisma.notification.findFirst({
        where: { businessId, type: 'lowStock' },
        orderBy: { date: 'desc' },
      });
      expect(n).toBeTruthy();
      expect(n?.body).toContain('Sucre Cosumar lingot');
    });

    it('is idempotent (dedup on unread)', async () => {
      await api(app).post('/api/v1/notifications/scan').set(bearer(tokens.owner)).expect(201);
      const c1 = await prisma.notification.count({ where: { businessId, type: 'lowStock' } });

      await api(app).post('/api/v1/notifications/scan').set(bearer(tokens.owner)).expect(201);
      const c2 = await prisma.notification.count({ where: { businessId, type: 'lowStock' } });

      expect(c2).toBe(c1);
    });
  });
});
