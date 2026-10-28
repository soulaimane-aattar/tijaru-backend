import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { newId } from '../src/database/ids';

import { closeTestDb, testDb } from './helpers/db';
import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Marketplace — listings, price groups, catalog (e2e)', () => {
  let app: INestApplication;

  /** Seller = the seeded demo tenant. Buyer = a second tenant created here. */
  let sellerToken: string;
  let sellerBusinessId: string;
  let buyerToken: string;
  let buyerBusinessId: string;
  let cashierToken: string;

  let productId: string;
  let listingId: string;
  let grosGroupId: string;

  const setModule = (businessId: string, active: boolean) =>
    testDb
      .updateTable('app.business_modules')
      .set({ active, updatedAt: new Date() })
      .where('business_id', '=', businessId)
      .where('module_id', '=', 'marketplace')
      .execute();
  const setPlan = (businessId: string, plan: 'active' | 'expired') =>
    testDb.updateTable('app.businesses').set({ plan, updatedAt: new Date() }).where('id', '=', businessId).execute();

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();

    sellerToken = (await login(app, 'owner')).accessToken;
    cashierToken = (await login(app, 'cashier')).accessToken;

    const seededOwner = await testDb
      .selectFrom('app_auth.users')
      .select(['business_id', 'passwordHash'])
      .where('email', '=', 'youssef@elamrani.ma')
      .executeTakeFirstOrThrow();
    sellerBusinessId = seededOwner.business_id;

    const buyer = await testDb
      .insertInto('app.businesses')
      .values({ id: newId(), name: 'Acheteur SARL', city: 'Rabat', ice: '888888888888888', updatedAt: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    buyerBusinessId = buyer.id;
    await testDb
      .insertInto('app.business_modules')
      .values({ business_id: buyer.id, module_id: 'marketplace', active: true, updatedAt: new Date() })
      .execute();
    await testDb
      .insertInto('app_auth.users')
      .values({
        id: newId(),
        business_id: buyer.id,
        name: 'Buyer Owner',
        email: 'buyer@example.ma',
        passwordHash: seededOwner.passwordHash,
        role: 'owner',
        updatedAt: new Date(),
      })
      .execute();
    buyerToken = (await login(app, 'buyer@example.ma')).accessToken;

    const product = await testDb
      .selectFrom('app.products')
      .select('id')
      .where('business_id', '=', sellerBusinessId)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    productId = product.id;
  });

  afterAll(async () => {
    await closeTestDb();
    await app.close();
  });

  describe('price groups', () => {
    it('creates a price group', async () => {
      const res = await api(app)
        .post('/api/v1/marketplace/price-groups')
        .set(bearer(sellerToken))
        .send({ name: 'Gros', isDefault: false })
        .expect(201);

      grosGroupId = res.body.id;
      expect(res.body).toMatchObject({ name: 'Gros', isDefault: false, customerCount: 0 });
    });

    it('rejects a duplicate name for the same tenant', async () => {
      await api(app)
        .post('/api/v1/marketplace/price-groups')
        .set(bearer(sellerToken))
        .send({ name: 'Gros' })
        .expect(500); // unique violation surfaces as a raw DB error, not a domain 409
    });

    it('denies a cashier (no marketplace.manage)', async () => {
      await api(app)
        .get('/api/v1/marketplace/price-groups')
        .set(bearer(cashierToken))
        .expect(403);
    });

    it('does not leak the seller group to the buyer tenant', async () => {
      const res = await api(app)
        .get('/api/v1/marketplace/price-groups')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('listings', () => {
    it('lists a product with a tier ladder, defaulting title/price from the product', async () => {
      const res = await api(app)
        .post('/api/v1/marketplace/listings')
        .set(bearer(sellerToken))
        .send({
          productId,
          unitPrice: 100,
          minOrderQty: 5,
          tiers: [
            { priceGroupId: null, minQty: 100, unitPrice: 90 },
            { priceGroupId: null, minQty: 1000, unitPrice: 80 },
            { priceGroupId: grosGroupId, minQty: 100, unitPrice: 85 },
          ],
        })
        .expect(201);

      listingId = res.body.id;
      expect(res.body.unitPrice).toBe(100);
      expect(res.body.title).toBeTruthy();
      expect(res.body.tiers).toHaveLength(3);
    });

    it('refuses to list the same product twice', async () => {
      await api(app)
        .post('/api/v1/marketplace/listings')
        .set(bearer(sellerToken))
        .send({ productId })
        .expect(409);
    });

    it('refuses a product owned by another tenant', async () => {
      await api(app)
        .post('/api/v1/marketplace/listings')
        .set(bearer(buyerToken))
        .send({ productId })
        .expect(404);
    });

    it('refuses a tier pointing at a foreign price group', async () => {
      const foreign = await testDb
        .insertInto('app.price_groups')
        .values({ id: newId(), business_id: buyerBusinessId, name: 'Foreign', updatedAt: new Date() })
        .returning('id')
        .executeTakeFirstOrThrow();
      await api(app)
        .put(`/api/v1/marketplace/listings/${listingId}/tiers`)
        .set(bearer(sellerToken))
        .send({ tiers: [{ priceGroupId: foreign.id, minQty: 10, unitPrice: 5 }] })
        .expect(404);
    });

    it('refuses duplicate steps in a ladder', async () => {
      await api(app)
        .put(`/api/v1/marketplace/listings/${listingId}/tiers`)
        .set(bearer(sellerToken))
        .send({
          tiers: [
            { priceGroupId: null, minQty: 10, unitPrice: 9 },
            { priceGroupId: null, minQty: 10, unitPrice: 8 },
          ],
        })
        .expect(422);
    });

    it('404s when another tenant tries to edit the listing', async () => {
      await api(app)
        .patch(`/api/v1/marketplace/listings/${listingId}`)
        .set(bearer(buyerToken))
        .send({ active: false })
        .expect(404);
    });
  });

  describe('catalog (buyer side)', () => {
    it('shows the seller listing with the public tier price at qty', async () => {
      const res = await api(app)
        .get('/api/v1/marketplace/catalog?qty=150')
        .set(bearer(buyerToken))
        .expect(200);

      expect(res.body.total).toBe(1);
      const row = res.body.items[0];
      expect(row).toMatchObject({
        id: listingId,
        sellerId: sellerBusinessId,
        listPrice: 100,
        yourPrice: 90,
        minOrderQty: 5,
      });
    });

    it('applies the buyer’s price group once the seller assigns one', async () => {
      await testDb
        .insertInto('app.customers')
        .values({
          id: newId(),
          business_id: sellerBusinessId,
          name: 'Acheteur SARL',
          buyer_business_id: buyerBusinessId,
          price_group_id: grosGroupId,
          updatedAt: new Date(),
        })
        .execute();

      const res = await api(app)
        .get('/api/v1/marketplace/catalog?qty=150')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body.items[0].yourPrice).toBe(85);
    });

    it('never charges the group more than the public ladder', async () => {
      const res = await api(app)
        .get('/api/v1/marketplace/catalog?qty=2000')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body.items[0].yourPrice).toBe(80);
    });

    it('hides the tenant’s own listings from its catalog', async () => {
      const res = await api(app)
        .get('/api/v1/marketplace/catalog')
        .set(bearer(sellerToken))
        .expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('hides deactivated listings', async () => {
      await api(app)
        .patch(`/api/v1/marketplace/listings/${listingId}`)
        .set(bearer(sellerToken))
        .send({ active: false })
        .expect(200);

      const res = await api(app)
        .get('/api/v1/marketplace/catalog')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body.items).toEqual([]);

      await api(app)
        .patch(`/api/v1/marketplace/listings/${listingId}`)
        .set(bearer(sellerToken))
        .send({ active: true })
        .expect(200);
    });

    it('lists sellers with an active listing count', async () => {
      const res = await api(app)
        .get('/api/v1/marketplace/sellers')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({ id: sellerBusinessId, listings: 1 }),
      ]);
    });

    it('hides a seller whose subscription expired', async () => {
      await setPlan(sellerBusinessId, 'expired');
      const res = await api(app)
        .get('/api/v1/marketplace/catalog')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body.items).toEqual([]);

      await setPlan(sellerBusinessId, 'active');
    });

    it('hides a seller that switched the marketplace module off', async () => {
      await setModule(sellerBusinessId, false);
      const res = await api(app)
        .get('/api/v1/marketplace/catalog')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body.items).toEqual([]);

      await setModule(sellerBusinessId, true);
    });

    it('403s when the module is disabled for the tenant', async () => {
      await setModule(buyerBusinessId, false);
      await api(app).get('/api/v1/marketplace/catalog').set(bearer(buyerToken)).expect(403);
      await setModule(buyerBusinessId, true);
    });
  });
});
