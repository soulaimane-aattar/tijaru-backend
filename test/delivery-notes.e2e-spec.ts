import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

/**
 * End-to-end coverage for the "bon" workflow — the single most business-critical
 * path in Tijaru (stock in from suppliers, stock out to customers, plus pure
 * orders that don't move stock). One `DeliveryNotesService` handles all three
 * types, so we validate each type's lifecycle through the real HTTP stack.
 *
 * Types under test:
 *   - `in_`  → BR (bon de réception) — inbound goods → stock +
 *   - `out`  → BL (bon de livraison) — outbound to customer → stock −
 *   - `order`→ BC (bon de commande)  — no stock effect
 *
 * The suite exercises: create → number sequencing → line updates → status
 * auto-derivation → signing (with idempotency) → stock ledger impact →
 * PDF export → RBAC + tenant isolation → closed-note protection.
 */
describe('Delivery Notes / Bons (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerToken: string;
  let cashierToken: string;
  let otherTenantToken: string;

  let warehouseId: string;
  let supplierId: string;
  let customerId: string;
  // Two products so we can validate partial receipts / partial shipments.
  let productA: { id: string; label: string; price: number };
  let productB: { id: string; label: string; price: number };

  const stockAt = async (pid: string, whId: string): Promise<number> => {
    const row = await prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: pid, warehouseId: whId } },
    });
    return row?.qty ?? 0;
  };

  const currentYear = new Date().getFullYear();

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();

    ownerToken = (await login(app, 'owner')).accessToken;
    cashierToken = (await login(app, 'cashier')).accessToken;

    // Spin up a rival tenant so cross-tenant reads can be verified as 404.
    // The seed's password hash is reused so the standard demo password works.
    const seeded = await prisma.user.findFirstOrThrow({ where: { email: 'youssef@elamrani.ma' } });
    const other = await prisma.business.create({
      data: { name: 'Rival Trading', ice: '111111111111111' },
    });
    // Module gate would otherwise 403 before tenant isolation is exercised.
    await prisma.businessModule.create({
      data: { businessId: other.id, moduleId: 'delivery-notes', active: true },
    });
    await prisma.user.create({
      data: {
        businessId: other.id,
        name: 'Rival Owner',
        email: 'rival-bon@example.ma',
        passwordHash: seeded.passwordHash,
        role: 'owner',
      },
    });
    otherTenantToken = (await login(app, 'rival-bon@example.ma')).accessToken;

    // Business defaults from the seed (owner tenant).
    const wh = await prisma.warehouse.findFirstOrThrow({
      where: { isDefault: true, business: { users: { some: { email: 'youssef@elamrani.ma' } } } },
    });
    warehouseId = wh.id;

    supplierId = (await prisma.supplier.findFirstOrThrow()).id;
    customerId = (await prisma.customer.findFirstOrThrow()).id;

    const products = await prisma.product.findMany({
      where: { stockLevels: { some: { warehouseId, qty: { gte: 20 } } } },
      take: 2,
      orderBy: { name: 'asc' },
    });
    productA = { id: products[0]!.id, label: products[0]!.name, price: Number(products[0]!.sale) };
    productB = { id: products[1]!.id, label: products[1]!.name, price: Number(products[1]!.sale) };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // ─── RBAC + validation guards ────────────────────────────────────────────

  describe('Authorization', () => {
    it('cashier without po.manage cannot list bons', async () => {
      await api(app).get('/api/v1/delivery-notes').set(bearer(cashierToken)).expect(403);
    });

    it('cashier cannot create a bon', async () => {
      await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(cashierToken))
        .send({
          type: 'in_',
          supplierId,
          lines: [{ productId: productA.id, label: productA.label, ordered: 5 }],
        })
        .expect(403);
    });
  });

  describe('Validation', () => {
    it('rejects BL (out) without customer', async () => {
      await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'out',
          lines: [{ productId: productA.id, label: productA.label, ordered: 2 }],
        })
        .expect(400);
    });

    it('rejects BR (in_) without supplier', async () => {
      await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'in_',
          lines: [{ productId: productA.id, label: productA.label, ordered: 2 }],
        })
        .expect(400);
    });

    it('rejects line with sent > ordered', async () => {
      await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'in_',
          supplierId,
          lines: [{ productId: productA.id, label: productA.label, ordered: 5, sent: 10 }],
        })
        .expect(422);
    });

    it('rejects note with zero lines', async () => {
      await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({ type: 'in_', supplierId, lines: [] })
        .expect(400);
    });
  });

  // ─── BR — bon de réception ───────────────────────────────────────────────

  describe('Bon de réception (BR) — inbound receipt', () => {
    let brId: string;
    let brNumber: string;
    let stockBefore: number;

    it('creates a BR with the correct number prefix and prepared status', async () => {
      stockBefore = await stockAt(productA.id, warehouseId);

      const res = await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'in_',
          supplierId,
          lines: [
            { productId: productA.id, label: productA.label, ordered: 10, unitPrice: 12 },
            { productId: productB.id, label: productB.label, ordered: 4, unitPrice: 20 },
          ],
        })
        .expect(201);

      expect(res.body.number).toBe(`BR-${currentYear}-0001`);
      expect(res.body.type).toBe('in_');
      expect(res.body.status).toBe('prepared');
      expect(res.body.signed).toBe(false);
      expect(res.body.lines).toHaveLength(2);
      // BR bills the ordered qty (10×12 + 4×20 = 200).
      expect(res.body.totals.subtotal).toBe(200);
      brId = res.body.id;
      brNumber = res.body.number;
    });

    it('flips to partial when some units are received', async () => {
      const detail = await api(app)
        .get(`/api/v1/delivery-notes/${brId}`)
        .set(bearer(ownerToken))
        .expect(200);
      const firstLine = detail.body.lines[0];

      const res = await api(app)
        .patch(`/api/v1/delivery-notes/${brId}/lines`)
        .set(bearer(ownerToken))
        .send({ lineId: firstLine.id, sent: 4 })
        .expect(200);

      expect(res.body.status).toBe('partial');
      expect(res.body.lines.find((l: { id: string }) => l.id === firstLine.id).sent).toBe(4);
    });

    it('flips to delivered when every line is fully received', async () => {
      const detail = await api(app)
        .get(`/api/v1/delivery-notes/${brId}`)
        .set(bearer(ownerToken))
        .expect(200);

      for (const line of detail.body.lines) {
        await api(app)
          .patch(`/api/v1/delivery-notes/${brId}/lines`)
          .set(bearer(ownerToken))
          .send({ lineId: line.id, sent: line.ordered })
          .expect(200);
      }
      const after = await api(app)
        .get(`/api/v1/delivery-notes/${brId}`)
        .set(bearer(ownerToken))
        .expect(200);
      expect(after.body.status).toBe('delivered');
    });

    it('signs and increments stock by the received quantity', async () => {
      const beforeSign = await stockAt(productA.id, warehouseId);
      await api(app)
        .post(`/api/v1/delivery-notes/${brId}/sign`)
        .set(bearer(ownerToken))
        .expect(204);
      const afterSign = await stockAt(productA.id, warehouseId);
      expect(afterSign - beforeSign).toBe(10);

      const detail = await api(app)
        .get(`/api/v1/delivery-notes/${brId}`)
        .set(bearer(ownerToken))
        .expect(200);
      expect(detail.body.signed).toBe(true);
    });

    it('is idempotent — a second sign does not re-post to the ledger', async () => {
      const before = await stockAt(productA.id, warehouseId);
      await api(app)
        .post(`/api/v1/delivery-notes/${brId}/sign`)
        .set(bearer(ownerToken))
        .expect(204);
      const after = await stockAt(productA.id, warehouseId);
      expect(after).toBe(before);
    });

    it('exports a valid PDF with a Content-Disposition matching the number', async () => {
      const res = await api(app)
        .get(`/api/v1/delivery-notes/${brId}/pdf`)
        .set(bearer(ownerToken))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(brNumber);
    });
  });

  // ─── BL — bon de livraison ───────────────────────────────────────────────

  describe('Bon de livraison (BL) — outbound to customer', () => {
    let blId: string;

    it('creates a BL with the correct number prefix', async () => {
      const res = await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'out',
          customerId,
          lines: [
            { productId: productA.id, label: productA.label, ordered: 3, sent: 3, unitPrice: 15 },
            { productId: productB.id, label: productB.label, ordered: 5, sent: 2, unitPrice: 10 },
          ],
        })
        .expect(201);

      expect(res.body.number).toBe(`BL-${currentYear}-0001`);
      expect(res.body.type).toBe('out');
      // BL bills the sent qty (3×15 + 2×10 = 65) — pure business rule.
      expect(res.body.totals.subtotal).toBe(65);
      // 3 of 3 sent for line A + 2 of 5 for line B → partial overall.
      expect(res.body.status).toBe('partial');
      blId = res.body.id;
    });

    it('signs and decrements stock only for lines with sent > 0', async () => {
      const beforeA = await stockAt(productA.id, warehouseId);
      const beforeB = await stockAt(productB.id, warehouseId);

      await api(app)
        .post(`/api/v1/delivery-notes/${blId}/sign`)
        .set(bearer(ownerToken))
        .expect(204);

      const afterA = await stockAt(productA.id, warehouseId);
      const afterB = await stockAt(productB.id, warehouseId);
      expect(beforeA - afterA).toBe(3);
      expect(beforeB - afterB).toBe(2);
    });
  });

  // ─── BC — bon de commande ────────────────────────────────────────────────

  describe('Bon de commande (BC) — order without stock effect', () => {
    let bcId: string;

    it('creates a BC with the correct number prefix', async () => {
      const res = await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'order',
          supplierId,
          lines: [{ productId: productA.id, label: productA.label, ordered: 8, unitPrice: 11 }],
        })
        .expect(201);

      expect(res.body.number).toBe(`BC-${currentYear}-0001`);
      expect(res.body.type).toBe('order');
      bcId = res.body.id;
    });

    it('signing a BC leaves stock untouched', async () => {
      const before = await stockAt(productA.id, warehouseId);
      await api(app)
        .post(`/api/v1/delivery-notes/${bcId}/sign`)
        .set(bearer(ownerToken))
        .expect(204);
      const after = await stockAt(productA.id, warehouseId);
      expect(after).toBe(before);
    });
  });

  // ─── Number sequencing ───────────────────────────────────────────────────

  describe('Number sequencing per type + year', () => {
    it('BR increments independently of BL — BR-YYYY-0002 comes after 0001', async () => {
      const res = await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'in_',
          supplierId,
          lines: [{ productId: productA.id, label: productA.label, ordered: 1 }],
        })
        .expect(201);
      expect(res.body.number).toBe(`BR-${currentYear}-0002`);
    });
  });

  // ─── Listing filters ─────────────────────────────────────────────────────

  describe('Listing filters', () => {
    it('filters by type=in_ and returns only BR notes', async () => {
      const res = await api(app)
        .get('/api/v1/delivery-notes?type=in_')
        .set(bearer(ownerToken))
        .expect(200);
      const rows = (res.body.items ?? res.body) as Array<{ type: string; number: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.type).toBe('in_');
    });

    it('filters by type=out and returns only BL notes', async () => {
      const res = await api(app)
        .get('/api/v1/delivery-notes?type=out')
        .set(bearer(ownerToken))
        .expect(200);
      const rows = (res.body.items ?? res.body) as Array<{ type: string; number: string }>;
      for (const r of rows) expect(r.type).toBe('out');
    });
  });

  // ─── Tenant isolation ────────────────────────────────────────────────────

  describe('Tenant isolation', () => {
    let ownerBrId: string;

    it('setup — owner tenant creates a BR', async () => {
      const res = await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'in_',
          supplierId,
          lines: [{ productId: productA.id, label: productA.label, ordered: 1 }],
        })
        .expect(201);
      ownerBrId = res.body.id;
    });

    it('a rival tenant cannot read the note by id', async () => {
      await api(app)
        .get(`/api/v1/delivery-notes/${ownerBrId}`)
        .set(bearer(otherTenantToken))
        .expect(404);
    });

    it('a rival tenant cannot sign the note', async () => {
      await api(app)
        .post(`/api/v1/delivery-notes/${ownerBrId}/sign`)
        .set(bearer(otherTenantToken))
        .expect(404);
    });
  });

  // ─── Closed-note protection ──────────────────────────────────────────────

  describe('Closed notes are immutable', () => {
    let closedId: string;

    it('setup — create + close a BR', async () => {
      const create = await api(app)
        .post('/api/v1/delivery-notes')
        .set(bearer(ownerToken))
        .send({
          type: 'in_',
          supplierId,
          lines: [{ productId: productA.id, label: productA.label, ordered: 2 }],
        })
        .expect(201);
      closedId = create.body.id;

      await api(app)
        .patch(`/api/v1/delivery-notes/${closedId}/status`)
        .set(bearer(ownerToken))
        .send('"closed"')
        .set('Content-Type', 'application/json')
        .expect(204);
    });

    it('refuses to update lines on a closed note', async () => {
      const detail = await api(app)
        .get(`/api/v1/delivery-notes/${closedId}`)
        .set(bearer(ownerToken))
        .expect(200);
      await api(app)
        .patch(`/api/v1/delivery-notes/${closedId}/lines`)
        .set(bearer(ownerToken))
        .send({ lineId: detail.body.lines[0].id, sent: 1 })
        .expect(422);
    });
  });
});
