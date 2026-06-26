import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('POS (e2e) — acceptance §13 #3', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let salmaToken: string;
  let viewerlikeToken: string;
  let warehouseId: string;
  let products: Array<{ id: string; name: string; sale: number; vat: number }>;
  let customerId: string;

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
    salmaToken = (await login(app, 'cashier')).accessToken;
    // Viewer-like = read-only. We use a real user with no stock.out to confirm RBAC gate.
    const viewer = await prisma.user.create({
      data: {
        name: 'Viewer Bot',
        email: `viewer-${Date.now()}@elamrani.ma`,
        passwordHash: await (await import('bcrypt')).hash('demo1234', 10),
        role: 'viewer',
      },
    });
    viewerlikeToken = (await login(app, viewer.email)).accessToken;

    const marrakech = await prisma.warehouse.findFirstOrThrow({ where: { city: 'Marrakech' } });
    warehouseId = marrakech.id;
    const picked = await prisma.product.findMany({
      where: { stockLevels: { some: { warehouseId, qty: { gte: 10 } } } },
      take: 3,
    });
    products = picked.map((p) => ({ id: p.id, name: p.name, sale: Number(p.sale), vat: p.vat }));
    customerId = (await prisma.customer.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('Sessions', () => {
    it('returns current session (creates if missing)', async () => {
      const res = await api(app)
        .get('/api/v1/pos/sessions/current')
        .set(bearer(salmaToken))
        .expect(200);
      expect(res.body.id).toMatch(/^S-\d{8}$/);
    });

    it('viewer (no stock.out) gets 403', async () => {
      await api(app).get('/api/v1/pos/sessions/current').set(bearer(viewerlikeToken)).expect(403);
    });
  });

  describe('Acceptance #3 — full POS sale', () => {
    let ticketId: string;
    let ticketNumber: string;
    let stockBefore: number[];
    let total: number;

    it('adds 3 items, applies discount 10, checks out cash, decrements stock', async () => {
      stockBefore = await Promise.all(products.map((p) => stockAt(p.id, warehouseId)));

      const computedTotal = products.reduce(
        (s, p) => s + p.sale * (1 + p.vat / 100) * 2, // qty 2 per line
        0,
      );
      total = +(computedTotal - 10).toFixed(2);

      const res = await api(app)
        .post('/api/v1/pos/tickets')
        .set(bearer(salmaToken))
        .send({
          warehouseId,
          customerId,
          lines: products.map((p) => ({ productId: p.id, qty: 2 })),
          discount: 10,
          payment: { method: 'cash', tendered: 250 },
        })
        .expect(201);

      expect(res.body.number).toMatch(/^TKT-\d{4}$/);
      expect(Number(res.body.total)).toBeCloseTo(total, 1);
      ticketId = res.body.id;
      ticketNumber = res.body.number;
    });

    it('emitted one out-movement per line with ref=TKT-####', async () => {
      const mvts = await prisma.movement.findMany({
        where: { ref: ticketNumber },
      });
      expect(mvts).toHaveLength(3);
      for (const m of mvts) {
        expect(m.type).toBe('out');
        expect(m.reason).toBe('vente');
      }
    });

    it('decremented stock by 2 per line', async () => {
      for (let i = 0; i < products.length; i++) {
        const after = await stockAt(products[i]!.id, warehouseId);
        expect(after).toBe(stockBefore[i]! - 2);
      }
    });

    it('bumped session counters (sales++, revenue+=total)', async () => {
      const session = await prisma.pOSession.findFirstOrThrow({
        orderBy: { openedAt: 'desc' },
      });
      expect(session.sales).toBeGreaterThanOrEqual(1);
      expect(Number(session.revenue)).toBeGreaterThanOrEqual(total);
    });

    it('GET /pos/tickets/:id returns receipt with ICE + QR + total', async () => {
      const res = await api(app)
        .get(`/api/v1/pos/tickets/${ticketId}`)
        .set(bearer(salmaToken))
        .expect(200);
      expect(res.body.business.ice).toMatch(/^\d{15}$/);
      expect(res.body.business.name).toBe('El Amrani Distribution SARL');
      expect(res.body.ticket.lines).toHaveLength(3);
      expect(Number(res.body.ticket.total)).toBeCloseTo(total, 1);
      expect(res.body.qr.base64).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(res.body.qr.payload.ice).toMatch(/^\d{15}$/);
      expect(res.body.footer).toContain('Merci');
      expect(res.body.footer).toContain('شكرا');
    });
  });

  describe('Validation + atomicity', () => {
    it('insufficient stock rolls back entire transaction (422, no movement, no stock change)', async () => {
      const p = products[0]!;
      const before = await stockAt(p.id, warehouseId);
      const mvtCountBefore = await prisma.movement.count();
      const ticketCountBefore = await prisma.pOTicket.count();

      await api(app)
        .post('/api/v1/pos/tickets')
        .set(bearer(salmaToken))
        .send({
          warehouseId,
          lines: [
            { productId: p.id, qty: 1 },
            { productId: p.id, qty: before + 9999 },
          ],
          payment: { method: 'cash', tendered: 999999 },
        })
        .expect(422);

      expect(await stockAt(p.id, warehouseId)).toBe(before);
      expect(await prisma.movement.count()).toBe(mvtCountBefore);
      expect(await prisma.pOTicket.count()).toBe(ticketCountBefore);
    });

    it('rejects cash tendered < total (422)', async () => {
      await api(app)
        .post('/api/v1/pos/tickets')
        .set(bearer(salmaToken))
        .send({
          warehouseId,
          lines: [{ productId: products[0]!.id, qty: 1 }],
          payment: { method: 'cash', tendered: 0.01 },
        })
        .expect(422);
    });

    it('rejects split that does not equal total (422)', async () => {
      await api(app)
        .post('/api/v1/pos/tickets')
        .set(bearer(salmaToken))
        .send({
          warehouseId,
          lines: [{ productId: products[0]!.id, qty: 1 }],
          payment: { method: 'split', cash: 1, card: 1 },
        })
        .expect(422);
    });

    it('rejects credit without customer (400)', async () => {
      await api(app)
        .post('/api/v1/pos/tickets')
        .set(bearer(salmaToken))
        .send({
          warehouseId,
          lines: [{ productId: products[0]!.id, qty: 1 }],
          payment: { method: 'credit', customerId },
        })
        .expect(400);
    });
  });

  describe('Park + resume', () => {
    it('parked ticket does NOT mutate stock', async () => {
      const p = products[1]!;
      const before = await stockAt(p.id, warehouseId);
      const res = await api(app)
        .post('/api/v1/pos/tickets')
        .set(bearer(salmaToken))
        .send({
          warehouseId,
          lines: [{ productId: p.id, qty: 1 }],
          payment: { method: 'cash', tendered: 0 },
          parked: true,
        })
        .expect(201);
      expect(res.body.parked).toBe(true);
      expect(await stockAt(p.id, warehouseId)).toBe(before);

      const resumed = await api(app)
        .post(`/api/v1/pos/tickets/${res.body.id}/resume`)
        .set(bearer(salmaToken))
        .send({ method: 'cash', tendered: 999 })
        .expect(201);
      expect(resumed.body.parked).toBe(false);
      expect(await stockAt(p.id, warehouseId)).toBe(before - 1);
    });
  });

  describe('RBAC', () => {
    it('viewer cannot checkout (403)', async () => {
      await api(app)
        .post('/api/v1/pos/tickets')
        .set(bearer(viewerlikeToken))
        .send({
          warehouseId,
          lines: [{ productId: products[0]!.id, qty: 1 }],
          payment: { method: 'cash', tendered: 999 },
        })
        .expect(403);
    });

    it('unauthenticated 401', async () => {
      await api(app)
        .post('/api/v1/pos/tickets')
        .send({
          warehouseId,
          lines: [{ productId: products[0]!.id, qty: 1 }],
          payment: { method: 'cash', tendered: 999 },
        })
        .expect(401);
    });
  });
});
