import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

describe('Marketplace — listings, price groups, catalog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  /** Seller = the seeded demo tenant. Buyer = a second tenant created here. */
  let sellerToken: string;
  let sellerBusinessId: string;
  let buyerToken: string;
  let buyerBusinessId: string;
  let cashierToken: string;

  let productId: string;
  let listingId: string;
  let grosGroupId: string;

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();

    sellerToken = (await login(app, 'owner')).accessToken;
    cashierToken = (await login(app, 'cashier')).accessToken;

    const seededOwner = await prisma.user.findFirstOrThrow({
      where: { email: 'youssef@elamrani.ma' },
    });
    sellerBusinessId = seededOwner.businessId;

    const buyer = await prisma.business.create({
      data: { name: 'Acheteur SARL', city: 'Rabat', ice: '888888888888888' },
    });
    buyerBusinessId = buyer.id;
    await prisma.businessModule.create({
      data: { businessId: buyer.id, moduleId: 'marketplace', active: true },
    });
    await prisma.user.create({
      data: {
        businessId: buyer.id,
        name: 'Buyer Owner',
        email: 'buyer@example.ma',
        passwordHash: seededOwner.passwordHash,
        role: 'owner',
      },
    });
    buyerToken = (await login(app, 'buyer@example.ma')).accessToken;

    const product = await prisma.product.findFirstOrThrow({
      where: { businessId: sellerBusinessId, deletedAt: null },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
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
        .expect(500); // unique violation surfaces as a Prisma error, not a domain 409
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
      const foreign = await prisma.priceGroup.create({
        data: { businessId: buyerBusinessId, name: 'Foreign' },
      });
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
      await prisma.customer.create({
        data: {
          businessId: sellerBusinessId,
          name: 'Acheteur SARL',
          buyerBusinessId,
          priceGroupId: grosGroupId,
        },
      });

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
      await prisma.business.update({
        where: { id: sellerBusinessId },
        data: { plan: 'expired' },
      });
      const res = await api(app)
        .get('/api/v1/marketplace/catalog')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body.items).toEqual([]);

      await prisma.business.update({
        where: { id: sellerBusinessId },
        data: { plan: 'active' },
      });
    });

    it('hides a seller that switched the marketplace module off', async () => {
      await prisma.businessModule.update({
        where: {
          businessId_moduleId: { businessId: sellerBusinessId, moduleId: 'marketplace' },
        },
        data: { active: false },
      });
      const res = await api(app)
        .get('/api/v1/marketplace/catalog')
        .set(bearer(buyerToken))
        .expect(200);
      expect(res.body.items).toEqual([]);

      await prisma.businessModule.update({
        where: {
          businessId_moduleId: { businessId: sellerBusinessId, moduleId: 'marketplace' },
        },
        data: { active: true },
      });
    });

    it('403s when the module is disabled for the tenant', async () => {
      await prisma.businessModule.update({
        where: { businessId_moduleId: { businessId: buyerBusinessId, moduleId: 'marketplace' } },
        data: { active: false },
      });
      await api(app).get('/api/v1/marketplace/catalog').set(bearer(buyerToken)).expect(403);
      await prisma.businessModule.update({
        where: { businessId_moduleId: { businessId: buyerBusinessId, moduleId: 'marketplace' } },
        data: { active: true },
      });
    });
  });
});
