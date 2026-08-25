import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

/**
 * Physical inventory counts — écart (variance) handling:
 * losses and gains reported through ajustement ledger entries, the
 * realtime case where sales happen between start and apply (only the gap
 * vs live stock is corrected), idempotency, and the reporting shape.
 */
describe('Inventory counts — écarts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: Record<'owner' | 'stockkeeper' | 'cashier', string>;
  let sucId: string;
  let theId: string;
  let businessId: string;
  let casaId: string;

  const stockAt = async (pid: string, whId: string): Promise<number> => {
    const sl = await prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: pid, warehouseId: whId } },
    });
    return sl?.qty ?? 0;
  };

  const setStock = async (pid: string, qty: number): Promise<void> => {
    await prisma.stockLevel.upsert({
      where: { productId_warehouseId: { productId: pid, warehouseId: casaId } },
      create: { productId: pid, warehouseId: casaId, businessId, qty },
      update: { qty },
    });
  };

  const startCount = () =>
    api(app).post('/api/v1/inventory').set(bearer(tokens.owner)).send({ warehouseId: casaId });

  const applyCount = (
    countId: string,
    lines: { productId: string; counted: number }[],
    token = tokens.owner,
  ) => api(app).post(`/api/v1/inventory/${countId}/apply`).set(bearer(token)).send({ lines });

  const movementsByRef = async (countId: string) => {
    const ref = `INV-${countId.slice(-6).toUpperCase()}`;
    return prisma.movement.findMany({ where: { ref } });
  };

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();

    const casa = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    casaId = casa.id;
    const suc = await prisma.product.findFirstOrThrow({ where: { sku: 'SUC-1KG' } });
    const the = await prisma.product.findFirstOrThrow({ where: { sku: 'THE-200' } });
    sucId = suc.id;
    theId = the.id;
    businessId = suc.businessId;

    tokens = {
      owner: (await login(app, 'owner')).accessToken,
      stockkeeper: (await login(app, 'stockkeeper')).accessToken,
      cashier: (await login(app, 'cashier')).accessToken,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('start snapshots expected = live qty per product and stays unapplied', async () => {
    await setStock(sucId, 42);

    const started = await startCount().expect(201);
    const countId = started.body.id as string;

    const detail = await api(app)
      .get(`/api/v1/inventory/${countId}`)
      .set(bearer(tokens.owner))
      .expect(200);

    expect(detail.body.appliedAt).toBeNull();
    expect(detail.body.warehouseId).toBe(casaId);
    const sucLine = detail.body.lines.find((l: { product: { sku: string } }) => l.product.sku === 'SUC-1KG');
    expect(sucLine).toBeDefined();
    expect(sucLine.expected).toBe(42);
    expect(sucLine.counted).toBe(42); // defaults to expected until adjusted
  });

  it('écart perte (counted < live) decrements stock and posts an ajustement out', async () => {
    await setStock(sucId, 42);
    const started = await startCount().expect(201);
    const countId = started.body.id as string;

    await applyCount(countId, [{ productId: sucId, counted: 40 }]).expect(201);

    expect(await stockAt(sucId, casaId)).toBe(40);
    const adjustments = await movementsByRef(countId);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      type: 'out',
      reason: 'ajustement',
      warehouseId: casaId,
      toWarehouseId: null,
      qty: 2,
    });

    const detail = await api(app)
      .get(`/api/v1/inventory/${countId}`)
      .set(bearer(tokens.owner))
      .expect(200);
    expect(detail.body.appliedAt).not.toBeNull();
    const sucLine = detail.body.lines.find((l: { productId: string }) => l.productId === sucId);
    // Reported écart = counted − expected snapshot.
    expect(sucLine.counted - sucLine.expected).toBe(-2);
  });

  it('écart gain (counted > live) increments stock and posts an ajustement in', async () => {
    await setStock(sucId, 42);
    const started = await startCount().expect(201);
    const countId = started.body.id as string;

    await applyCount(countId, [{ productId: sucId, counted: 45 }]).expect(201);

    expect(await stockAt(sucId, casaId)).toBe(45);
    const adjustments = await movementsByRef(countId);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ type: 'in', reason: 'ajustement', qty: 3 });
  });

  it('mixed gain + perte in one apply posts exactly one in and one out entry', async () => {
    await setStock(sucId, 30);
    await setStock(theId, 100);
    const started = await startCount().expect(201);
    const countId = started.body.id as string;

    await applyCount(countId, [
      { productId: sucId, counted: 27 }, // perte −3
      { productId: theId, counted: 105 }, // gain +5
    ]).expect(201);

    expect(await stockAt(sucId, casaId)).toBe(27);
    expect(await stockAt(theId, casaId)).toBe(105);

    const adjustments = await movementsByRef(countId);
    expect(adjustments).toHaveLength(2);
    const byProduct = new Map(adjustments.map((m) => [m.productId, m]));
    expect(byProduct.get(sucId)).toMatchObject({ type: 'out', qty: 3 });
    expect(byProduct.get(theId)).toMatchObject({ type: 'in', qty: 5 });
  });

  it('realtime: sale between start and apply corrects only the gap vs live stock', async () => {
    await setStock(sucId, 50);
    const started = await startCount().expect(201);
    const countId = started.body.id as string;

    // A sale lands while counting is underway — live stock drops 50 → 42.
    await api(app)
      .post('/api/v1/movements')
      .set(bearer(tokens.cashier))
      .send({
        type: 'out',
        productId: sucId,
        warehouseId: casaId,
        qty: 8,
        reason: 'vente',
        ref: 'TKT-DURING-COUNT',
      })
      .expect(201);
    expect(await stockAt(sucId, casaId)).toBe(42);

    // Counter tallies 45 physical units. The adjustment must be computed
    // against LIVE stock (+3), not the stale snapshot (−5).
    await applyCount(countId, [{ productId: sucId, counted: 45 }]).expect(201);

    expect(await stockAt(sucId, casaId)).toBe(45);
    const adjustments = await movementsByRef(countId);
    const sucAdjustment = adjustments.find((m) => m.productId === sucId);
    expect(sucAdjustment).toMatchObject({ type: 'in', qty: 3 });
  });

  it('re-applying an applied count → 409 count_already_applied, stock untouched', async () => {
    await setStock(sucId, 45);
    const started = await startCount().expect(201);
    const countId = started.body.id as string;
    await applyCount(countId, [{ productId: sucId, counted: 45 }]).expect(201);
    const before = await stockAt(sucId, casaId);

    const res = await applyCount(countId, [{ productId: sucId, counted: 999 }]).expect(409);
    expect(res.body.code).toBe('conflict');
    expect(res.body.title).toBe('count_already_applied');
    expect(await stockAt(sucId, casaId)).toBe(before);
  });

  it('counted == live posts no adjustment movement at all', async () => {
    await setStock(sucId, 33);
    const started = await startCount().expect(201);
    const countId = started.body.id as string;

    await applyCount(countId, [{ productId: sucId, counted: 33 }]).expect(201);

    expect(await stockAt(sucId, casaId)).toBe(33);
    expect(await movementsByRef(countId)).toHaveLength(0);
  });

  it('stockkeeper can run a count; cashier is blocked (403)', async () => {
    await setStock(theId, 10);
    await api(app)
      .post('/api/v1/inventory')
      .set(bearer(tokens.stockkeeper))
      .send({ warehouseId: casaId })
      .expect(201);

    await api(app)
      .post('/api/v1/inventory')
      .set(bearer(tokens.cashier))
      .send({ warehouseId: casaId })
      .expect(403);
  });

  it('unknown warehouse on start (404) and unknown count id on apply (404)', async () => {
    await api(app)
      .post('/api/v1/inventory')
      .set(bearer(tokens.owner))
      .send({ warehouseId: 'cmphd00000000000000000000' })
      .expect(404);

    await api(app)
      .post('/api/v1/inventory/cmphd00000000000000000000/apply')
      .set(bearer(tokens.owner))
      .send({ lines: [{ productId: sucId, counted: 1 }] })
      .expect(404);
  });
});
