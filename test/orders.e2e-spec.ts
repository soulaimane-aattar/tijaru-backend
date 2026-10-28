import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { newId } from '../src/database/ids';

import { closeTestDb, testDb } from './helpers/db';
import { createTenant } from './helpers/tenant';
import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Marketplace orders — lifecycle (e2e)', () => {
  let app: INestApplication;

  let sellerToken: string;
  let sellerBusinessId: string;
  let buyerToken: string;
  let buyerBusinessId: string;
  let thirdToken: string;

  let listingId: string;
  let productId: string;
  let warehouseId: string;
  let orderId: string;
  let orderNumber: string;

  const stockOf = async (): Promise<number> => {
    const levels = await testDb
      .selectFrom('app.stock_levels')
      .select('qty')
      .where('productId', '=', productId)
      .execute();
    return levels.reduce((s, l) => s + l.qty, 0);
  };

  /** Spins up a tenant with the marketplace module and an owner login. */
  const makeTenant = (name: string, ice: string, email: string): Promise<string> =>
    createTenant({ name, ice, moduleId: 'marketplace', email });

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();

    sellerToken = (await login(app, 'owner')).accessToken;
    sellerBusinessId = (
      await testDb
        .selectFrom('app_auth.users')
        .select('business_id')
        .where('email', '=', 'youssef@elamrani.ma')
        .executeTakeFirstOrThrow()
    ).business_id;

    buyerBusinessId = await makeTenant('Acheteur SARL', '777777777777777', 'buyer@example.ma');
    buyerToken = (await login(app, 'buyer@example.ma')).accessToken;

    await makeTenant('Tiers SARL', '666666666666666', 'third@example.ma');
    thirdToken = (await login(app, 'third@example.ma')).accessToken;

    // Seller inventory: a product with a known stock level in one warehouse.
    const warehouse = await testDb
      .selectFrom('app.warehouses')
      .select('id')
      .where('business_id', '=', sellerBusinessId)
      .where('active', '=', true)
      .orderBy('isDefault', 'desc')
      .orderBy('createdAt', 'asc')
      .executeTakeFirstOrThrow();
    warehouseId = warehouse.id;
    const product = await testDb
      .selectFrom('app.products')
      .select('id')
      .where('business_id', '=', sellerBusinessId)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    productId = product.id;
    await testDb.deleteFrom('app.stock_levels').where('productId', '=', productId).execute();
    await testDb
      .insertInto('app.stock_levels')
      .values({ productId, warehouseId, businessId: sellerBusinessId, qty: 500, updatedAt: new Date() })
      .execute();

    const group = await testDb
      .insertInto('app.price_groups')
      .values({ id: newId(), business_id: sellerBusinessId, name: 'Gros', updatedAt: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const listing = await api(app)
      .post('/api/v1/marketplace/listings')
      .set(bearer(sellerToken))
      .send({
        productId,
        unitPrice: 100,
        vat: 20,
        minOrderQty: 10,
        tiers: [
          { priceGroupId: null, minQty: 100, unitPrice: 90 },
          { priceGroupId: group.id, minQty: 100, unitPrice: 85 },
        ],
      })
      .expect(201);
    listingId = listing.body.id;

    // Seller files the buyer under "Gros".
    await testDb
      .insertInto('app.customers')
      .values({
        id: newId(),
        business_id: sellerBusinessId,
        name: 'Acheteur SARL',
        buyer_business_id: buyerBusinessId,
        price_group_id: group.id,
        updatedAt: new Date(),
      })
      .execute();
  });

  afterAll(async () => {
    await closeTestDb();
    await app.close();
  });

  describe('placing an order', () => {
    it('rejects a quantity under the listing minimum', async () => {
      await api(app)
        .post('/api/v1/orders')
        .set(bearer(buyerToken))
        .send({ lines: [{ listingId, qty: 5 }] })
        .expect(422);
    });

    it('rejects ordering from your own catalog', async () => {
      await api(app)
        .post('/api/v1/orders')
        .set(bearer(sellerToken))
        .send({ lines: [{ listingId, qty: 100 }] })
        .expect(422);
    });

    it('prices the order from the buyer’s group ladder', async () => {
      const res = await api(app)
        .post('/api/v1/orders')
        .set(bearer(buyerToken))
        .send({ lines: [{ listingId, qty: 150 }], note: 'Livraison rapide SVP' })
        .expect(201);

      orderId = res.body.id;
      orderNumber = res.body.number;

      expect(res.body.status).toBe('pending');
      expect(res.body.number).toMatch(/^CMD-\d{4}-0001$/);
      expect(res.body.lines[0]).toMatchObject({ qty: 150, unitPrice: 85, vat: 20 });
      expect(res.body.subtotalHt).toBe(12750);
      expect(res.body.vatTotal).toBe(2550);
      expect(res.body.totalTtc).toBe(15300);
      expect(res.body.allowedNext).toEqual(['cancelled']);
    });

    it('notifies the seller', async () => {
      const notif = await testDb
        .selectFrom('app.notifications')
        .select('title')
        .where('business_id', '=', sellerBusinessId)
        .where('type', '=', 'orderReceived')
        .orderBy('date', 'desc')
        .executeTakeFirst();
      expect(notif?.title).toContain(orderNumber);
    });

    it('does not move stock yet', async () => {
      expect(await stockOf()).toBe(500);
    });

    it('shows on both sides, hidden from everyone else', async () => {
      const seller = await api(app)
        .get('/api/v1/orders/received')
        .set(bearer(sellerToken))
        .expect(200);
      expect(seller.body.items).toHaveLength(1);

      const buyer = await api(app).get('/api/v1/orders/sent').set(bearer(buyerToken)).expect(200);
      expect(buyer.body.items).toHaveLength(1);

      const third = await api(app).get('/api/v1/orders/sent').set(bearer(thirdToken)).expect(200);
      expect(third.body.items).toEqual([]);
      await api(app)
        .get(`/api/v1/orders/sent/${orderId}`)
        .set(bearer(thirdToken))
        .expect(404);
    });
  });

  describe('transitions', () => {
    it('refuses a buyer-driven confirm', async () => {
      // The buyer is a party to this order, so it is visible — but the FSM
      // only lets a buyer cancel, never advance.
      await api(app)
        .post(`/api/v1/orders/received/${orderId}/status`)
        .set(bearer(buyerToken))
        .send({ status: 'confirmed' })
        .expect(403);
    });

    it('refuses skipping straight to delivered', async () => {
      await api(app)
        .post(`/api/v1/orders/received/${orderId}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'delivered' })
        .expect(422);
    });

    it('confirms then starts preparation', async () => {
      const confirmed = await api(app)
        .post(`/api/v1/orders/received/${orderId}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'confirmed', note: 'Stock réservé' })
        .expect(201);
      expect(confirmed.body.status).toBe('confirmed');
      expect(confirmed.body.sellerNote).toBe('Stock réservé');

      await api(app)
        .post(`/api/v1/orders/received/${orderId}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'in_progress' })
        .expect(201);
    });

    it('refuses a buyer cancel once the order left pending', async () => {
      await api(app)
        .post(`/api/v1/orders/sent/${orderId}/cancel`)
        .set(bearer(buyerToken))
        .expect(403);
    });

    it('posts the stock movement on ship', async () => {
      await api(app)
        .post(`/api/v1/orders/received/${orderId}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'shipped' })
        .expect(201);

      expect(await stockOf()).toBe(350);
      const movement = await testDb
        .selectFrom('app.movements')
        .selectAll()
        .where('business_id', '=', sellerBusinessId)
        .where('ref', '=', orderNumber)
        .executeTakeFirst();
      expect(movement).toMatchObject({ type: 'out', reason: 'vente', qty: 150 });
    });

    it('notifies the buyer of each status change', async () => {
      const notifs = await testDb
        .selectFrom('app.notifications')
        .select('id')
        .where('business_id', '=', buyerBusinessId)
        .where('type', '=', 'orderStatus')
        .execute();
      expect(notifs).toHaveLength(3); // confirmed, in_progress, shipped
    });

    it('delivers, and then refuses any further move', async () => {
      const delivered = await api(app)
        .post(`/api/v1/orders/received/${orderId}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'delivered' })
        .expect(201);
      expect(delivered.body.allowedNext).toEqual([]);

      await api(app)
        .post(`/api/v1/orders/received/${orderId}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'cancelled' })
        .expect(422);
    });
  });

  describe('stock floor and cancellation', () => {
    it('refuses to ship more than the seller holds', async () => {
      const res = await api(app)
        .post('/api/v1/orders')
        .set(bearer(buyerToken))
        .send({ lines: [{ listingId, qty: 400 }] })
        .expect(201);
      const bigId = res.body.id;

      for (const status of ['confirmed', 'in_progress']) {
        await api(app)
          .post(`/api/v1/orders/received/${bigId}/status`)
          .set(bearer(sellerToken))
          .send({ status })
          .expect(201);
      }

      await api(app)
        .post(`/api/v1/orders/received/${bigId}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'shipped' })
        .expect(409);

      // Neither the stock nor the status moved.
      expect(await stockOf()).toBe(350);
      const still = await api(app)
        .get(`/api/v1/orders/received/${bigId}`)
        .set(bearer(sellerToken))
        .expect(200);
      expect(still.body.status).toBe('in_progress');
    });

    it('refuses to order from a seller whose subscription expired', async () => {
      await testDb
        .updateTable('app.businesses')
        .set({ plan: 'expired' })
        .where('id', '=', sellerBusinessId)
        .execute();

      await api(app)
        .post('/api/v1/orders')
        .set(bearer(buyerToken))
        .send({ lines: [{ listingId, qty: 10 }] })
        .expect(404); // the listing is not orderable, so it does not resolve

      await testDb
        .updateTable('app.businesses')
        .set({ plan: 'active' })
        .where('id', '=', sellerBusinessId)
        .execute();
    });

    it('lets the buyer cancel while pending', async () => {
      const res = await api(app)
        .post('/api/v1/orders')
        .set(bearer(buyerToken))
        .send({ lines: [{ listingId, qty: 10 }] })
        .expect(201);

      const cancelled = await api(app)
        .post(`/api/v1/orders/sent/${res.body.id}/cancel`)
        .set(bearer(buyerToken))
        .expect(201);
      expect(cancelled.body.status).toBe('cancelled');

      const sellerNotif = await testDb
        .selectFrom('app.notifications')
        .select('body')
        .where('business_id', '=', sellerBusinessId)
        .where('type', '=', 'orderStatus')
        .orderBy('date', 'desc')
        .executeTakeFirst();
      expect(sellerNotif?.body).toContain('annulé');
    });

    it('numbers orders per seller', async () => {
      const list = await api(app)
        .get('/api/v1/orders/received')
        .set(bearer(sellerToken))
        .expect(200);
      const numbers = list.body.items.map((o: { number: string }) => o.number).sort();
      expect(numbers).toEqual([
        expect.stringMatching(/-0001$/),
        expect.stringMatching(/-0002$/),
        expect.stringMatching(/-0003$/),
      ]);
    });
  });
});
