import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { closeTestDb, testDb } from './helpers/db';
import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Stock concurrency (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let productId: string;
  let warehouseId: string;
  let businessId: string;

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

    const warehouse = await testDb.selectFrom('app.warehouses').select('id').where('isDefault', '=', true).executeTakeFirstOrThrow();
    const product = await testDb.selectFrom('app.products').select(['id', 'business_id']).where('sku', '=', 'SUC-1KG').executeTakeFirstOrThrow();
    warehouseId = warehouse.id;
    productId = product.id;
    businessId = product.business_id;

    ownerToken = (await login(app, 'owner')).accessToken;
  });

  afterAll(async () => {
    await closeTestDb();
    await app.close();
  });

  it('two concurrent outs of 5 against qty=8 → exactly one succeeds, one rejects insufficient_stock, final qty=3', async () => {
    // Arrange: deterministic starting stock, independent of whatever the seed produced.
    await testDb
      .insertInto('app.stock_levels')
      .values({ productId, warehouseId, businessId, qty: 8, updatedAt: new Date() })
      .onConflict((oc) => oc.columns(['productId', 'warehouseId']).doUpdateSet({ qty: 8 }))
      .execute();
    expect(await stockAt(productId, warehouseId)).toBe(8);

    const fireOut = () =>
      api(app)
        .post('/api/v1/movements')
        .set(bearer(ownerToken))
        .send({
          type: 'out',
          productId,
          warehouseId,
          qty: 5,
          reason: 'ajustement',
        });

    // Act: fire both requests concurrently — no await between them.
    const results = await Promise.allSettled([fireOut(), fireOut()]);

    // Both HTTP calls resolve (supertest doesn't reject on non-2xx without .expect());
    // the outcome we care about is encoded in each response's status/body.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const responses = results.map(
      (r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof fireOut>>>).value,
    );

    const succeeded = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.body.code).toBe('conflict');
    expect(rejected[0]!.body.title).toBe('insufficient_stock');

    const final = await stockAt(productId, warehouseId);
    expect(final).toBe(3);
  });
});
