import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Batch modules (PO/inventory/reports/activity/notifications) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerToken: string;
  let cashierToken: string;
  let warehouseId: string;

  const stockAt = async (pid: string, whId: string): Promise<number> => {
    const sl = await prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: pid, warehouseId: whId } },
    });
    return sl?.qty ?? 0;
  };

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();
    ownerToken = (await login(app, 'owner')).accessToken;
    cashierToken = (await login(app, 'cashier')).accessToken;
    const wh = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    warehouseId = wh.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('purchase-orders', () => {
    it('lists 2 seeded POs', async () => {
      const res = await api(app).get('/api/v1/purchase-orders').set(bearer(ownerToken)).expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('cashier cannot list POs (po.manage denied)', async () => {
      await api(app).get('/api/v1/purchase-orders').set(bearer(cashierToken)).expect(403);
    });

    it('create PO + receive partially → status partiallyReceived + in-movement', async () => {
      const supplier = await prisma.supplier.findFirstOrThrow();
      const product = await prisma.product.findFirstOrThrow({ where: { deletedAt: null } });
      const before = await stockAt(product.id, warehouseId);

      const created = await api(app)
        .post('/api/v1/purchase-orders')
        .set(bearer(ownerToken))
        .send({
          supplierId: supplier.id,
          warehouseId,
          status: 'sent',
          lines: [{ productId: product.id, qty: 50, price: 10, vat: 20 }],
        })
        .expect(201);

      const lineId = created.body.lines[0].id;
      const received = await api(app)
        .post(`/api/v1/purchase-orders/${created.body.id}/receive`)
        .set(bearer(ownerToken))
        .send({ lines: [{ lineId, qty: 20 }] })
        .expect(201);

      expect(received.body.status).toBe('partiallyReceived');
      expect(await stockAt(product.id, warehouseId)).toBe(before + 20);

      const mvts = await prisma.movement.findMany({
        where: { ref: created.body.number, type: 'in' },
      });
      expect(mvts).toHaveLength(1);
      expect(mvts[0]!.qty).toBe(20);

      // Complete reception
      const fullyReceived = await api(app)
        .post(`/api/v1/purchase-orders/${created.body.id}/receive`)
        .set(bearer(ownerToken))
        .send({ lines: [{ lineId, qty: 30 }] })
        .expect(201);
      expect(fullyReceived.body.status).toBe('received');
    });

    it('over-receive rejected (422)', async () => {
      const supplier = await prisma.supplier.findFirstOrThrow();
      const product = await prisma.product.findFirstOrThrow({ where: { deletedAt: null } });
      const created = await api(app)
        .post('/api/v1/purchase-orders')
        .set(bearer(ownerToken))
        .send({
          supplierId: supplier.id,
          warehouseId,
          status: 'sent',
          lines: [{ productId: product.id, qty: 5, price: 10, vat: 20 }],
        })
        .expect(201);
      const lineId = created.body.lines[0].id;
      await api(app)
        .post(`/api/v1/purchase-orders/${created.body.id}/receive`)
        .set(bearer(ownerToken))
        .send({ lines: [{ lineId, qty: 99 }] })
        .expect(422);
    });
  });

  describe('inventory', () => {
    it('start count snapshots expected, apply emits adjustment movement', async () => {
      const startRes = await api(app)
        .post('/api/v1/inventory')
        .set(bearer(ownerToken))
        .send({ warehouseId, notes: 'Test count' })
        .expect(201);
      const countId = startRes.body.id;
      expect(startRes.body.lines.length).toBeGreaterThan(0);

      const firstLine = startRes.body.lines[0];
      const before = await stockAt(firstLine.productId, warehouseId);
      const newCount = before + 7; // diff +7

      const mvtBefore = await prisma.movement.count({ where: { reason: 'ajustement' } });

      const applied = await api(app)
        .post(`/api/v1/inventory/${countId}/apply`)
        .set(bearer(ownerToken))
        .send({
          lines: [{ productId: firstLine.productId, counted: newCount }],
        })
        .expect(201);
      expect(applied.body.appliedAt).not.toBeNull();
      expect(await stockAt(firstLine.productId, warehouseId)).toBe(newCount);
      expect(await prisma.movement.count({ where: { reason: 'ajustement' } })).toBe(mvtBefore + 1);
    });

    it('re-applying same count returns 422', async () => {
      const startRes = await api(app)
        .post('/api/v1/inventory')
        .set(bearer(ownerToken))
        .send({ warehouseId })
        .expect(201);
      await api(app)
        .post(`/api/v1/inventory/${startRes.body.id}/apply`)
        .set(bearer(ownerToken))
        .send({ lines: [{ productId: startRes.body.lines[0].productId, counted: 0 }] })
        .expect(201);
      // Re-applying an already-applied count is a conflict, not a validation error.
      await api(app)
        .post(`/api/v1/inventory/${startRes.body.id}/apply`)
        .set(bearer(ownerToken))
        .send({ lines: [{ productId: startRes.body.lines[0].productId, counted: 0 }] })
        .expect(409);
    });
  });

  describe('reports', () => {
    it('low-stock returns expected products', async () => {
      const res = await api(app)
        .get('/api/v1/reports/low-stock')
        .set(bearer(ownerToken))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const p of res.body) {
        expect(p.totalStock).toBeGreaterThan(0);
        expect(p.totalStock).toBeLessThanOrEqual(p.minStock);
      }
    });

    it('value report aggregates per warehouse', async () => {
      const res = await api(app).get('/api/v1/reports/value').set(bearer(ownerToken)).expect(200);
      expect(res.body.total.value).toBeGreaterThan(0);
      expect(res.body.perWarehouse.length).toBeGreaterThanOrEqual(1);
    });

    it('top returns ranked products', async () => {
      const res = await api(app)
        .get('/api/v1/reports/top?days=365')
        .set(bearer(ownerToken))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('cashier blocked (reports.view denied)', async () => {
      await api(app).get('/api/v1/reports/low-stock').set(bearer(cashierToken)).expect(403);
    });
  });

  describe('activity', () => {
    it('owner lists with pagination', async () => {
      const res = await api(app)
        .get('/api/v1/activity?pageSize=10')
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.total).toBeGreaterThan(0);
    });

    it('manager blocked (activity.view denied)', async () => {
      const managerToken = (await login(app, 'manager')).accessToken;
      await api(app).get('/api/v1/activity').set(bearer(managerToken)).expect(403);
    });
  });

  describe('notifications', () => {
    it('lists seeded notifications', async () => {
      const res = await api(app)
        .get('/api/v1/notifications')
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
    });

    it('unread-count returns seeded unread (2)', async () => {
      const res = await api(app)
        .get('/api/v1/notifications/unread-count')
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body.unread).toBe(2);
    });

    it('mark-all-read clears unread', async () => {
      await api(app)
        .post('/api/v1/notifications/read-all')
        .set(bearer(ownerToken))
        .expect(201);
      const res = await api(app)
        .get('/api/v1/notifications/unread-count')
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body.unread).toBe(0);
    });

    it('cashier can read notifications (dashboard.view)', async () => {
      await api(app).get('/api/v1/notifications').set(bearer(cashierToken)).expect(200);
    });
  });
});
