import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

/**
 * Multistock transfer — the realtime cases a shop actually hits:
 * destination bins that never held the product, chained hops across the
 * warehouse network, racing transfers draining one source, and a sale
 * landing at the destination while the transfer is in flight.
 */
describe('Stock transfer — multistock (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokens: Record<'owner' | 'stockkeeper' | 'cashier', string>;
  let productId: string;
  let businessId: string;
  let casaId: string;
  let marrakechId: string;
  let rabatId: string;

  const stockAt = async (pid: string, whId: string): Promise<number> => {
    const sl = await prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: pid, warehouseId: whId } },
    });
    return sl?.qty ?? 0;
  };

  const setStock = async (whId: string, qty: number): Promise<void> => {
    await prisma.stockLevel.upsert({
      where: { productId_warehouseId: { productId, warehouseId: whId } },
      create: { productId, warehouseId: whId, businessId, qty },
      update: { qty },
    });
  };

  const transfer = (
    token: string,
    body: { warehouseId: string; toWarehouseId?: string; qty?: number; ref?: string },
  ) =>
    api(app)
      .post('/api/v1/movements')
      .set(bearer(token))
      .send({ type: 'transfer', reason: 'transfert', productId, ...body });

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();

    const casa = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    const marrakech = await prisma.warehouse.findFirstOrThrow({ where: { city: 'Marrakech' } });
    const third = await prisma.warehouse.findFirstOrThrow({
      where: { id: { notIn: [casa.id, marrakech.id] }, deletedAt: null },
    });
    casaId = casa.id;
    marrakechId = marrakech.id;
    rabatId = third.id;

    const product = await prisma.product.findFirstOrThrow({ where: { sku: 'SUC-1KG' } });
    productId = product.id;
    businessId = product.businessId;

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

  it('creates the destination stock level when that bin never held the product', async () => {
    await setStock(casaId, 12);
    await prisma.stockLevel.deleteMany({ where: { productId, warehouseId: rabatId } });
    expect(await stockAt(productId, rabatId)).toBe(0);

    const res = await transfer(tokens.stockkeeper, {
      warehouseId: casaId,
      toWarehouseId: rabatId,
      qty: 7,
      ref: 'TRF-E2E-1',
    }).expect(201);

    expect(res.body.type).toBe('transfer');
    expect(res.body.warehouseId).toBe(casaId);
    expect(res.body.toWarehouseId).toBe(rabatId);
    expect(res.body.qty).toBe(7);
    expect(res.body.ref).toBe('TRF-E2E-1');
    expect(await stockAt(productId, casaId)).toBe(5);
    expect(await stockAt(productId, rabatId)).toBe(7);
  });

  it('insufficient source stock → 409 insufficient_stock, neither side mutated', async () => {
    await setStock(casaId, 3);
    await setStock(rabatId, 100);

    const res = await transfer(tokens.stockkeeper, {
      warehouseId: casaId,
      toWarehouseId: rabatId,
      qty: 5,
    }).expect(409);

    expect(res.body.code).toBe('conflict');
    expect(res.body.title).toBe('insufficient_stock');
    expect(await stockAt(productId, casaId)).toBe(3);
    expect(await stockAt(productId, rabatId)).toBe(100);
  });

  it('chained hops casa → marrakech → rabat → casa keep the network total constant', async () => {
    await setStock(casaId, 50);
    await setStock(marrakechId, 0);
    await setStock(rabatId, 0);
    const total = () =>
      Promise.all([stockAt(productId, casaId), stockAt(productId, marrakechId), stockAt(productId, rabatId)]);

    await transfer(tokens.stockkeeper, {
      warehouseId: casaId,
      toWarehouseId: marrakechId,
      qty: 20,
    }).expect(201);
    expect(await total()).toEqual([30, 20, 0]);

    await transfer(tokens.stockkeeper, {
      warehouseId: marrakechId,
      toWarehouseId: rabatId,
      qty: 8,
    }).expect(201);
    expect(await total()).toEqual([30, 12, 8]);

    await transfer(tokens.stockkeeper, {
      warehouseId: rabatId,
      toWarehouseId: casaId,
      qty: 5,
    }).expect(201);
    expect(await total()).toEqual([35, 12, 3]);
    expect((await total()).reduce((a, b) => a + b, 0)).toBe(50);
  });

  it('racing transfers drain the source without ever going negative', async () => {
    await setStock(casaId, 10);
    await setStock(marrakechId, 0);

    const fire = () =>
      transfer(tokens.stockkeeper, {
        warehouseId: casaId,
        toWarehouseId: marrakechId,
        qty: 4,
      });

    const results = await Promise.allSettled([fire(), fire(), fire()]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const responses = results.map(
      (r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof fire>>>).value,
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(2);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await stockAt(productId, casaId)).toBe(2);
    expect(await stockAt(productId, marrakechId)).toBe(8);
  });

  it('sale at the destination while the transfer is in flight — total conserved, no negative', async () => {
    await setStock(casaId, 10);
    await setStock(marrakechId, 5);

    const inbound = transfer(tokens.stockkeeper, {
      warehouseId: casaId,
      toWarehouseId: marrakechId,
      qty: 6,
    });
    const sale = api(app)
      .post('/api/v1/movements')
      .set(bearer(tokens.cashier))
      .send({
        type: 'out',
        productId,
        warehouseId: marrakechId,
        qty: 4,
        reason: 'vente',
        ref: 'TKT-RACE-1',
      });

    // Both orders are valid: sale-then-transfer or transfer-then-sale must
    // converge to the same state thanks to the transactional guard.
    const [inboundRes, saleRes] = await Promise.all([inbound, sale]);
    expect(inboundRes.status).toBe(201);
    expect(saleRes.status).toBe(201);

    expect(await stockAt(productId, casaId)).toBe(4);
    expect(await stockAt(productId, marrakechId)).toBe(7);
    const networkTotal =
      (await stockAt(productId, casaId)) + (await stockAt(productId, marrakechId));
    expect(networkTotal).toBe(11); // 15 initial − 4 sold
  });

  it('rejects zero qty (400) and unknown destination warehouse (404)', async () => {
    await setStock(casaId, 10);

    await transfer(tokens.owner, {
      warehouseId: casaId,
      toWarehouseId: marrakechId,
      qty: 0,
    }).expect(400);

    await transfer(tokens.owner, {
      warehouseId: casaId,
      toWarehouseId: 'cmphd00000000000000000000',
      qty: 1,
    }).expect(404);
  });
});
