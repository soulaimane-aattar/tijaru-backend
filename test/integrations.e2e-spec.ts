import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { WebhookDispatcher } from '../src/modules/integrations/application/webhook-dispatcher.service';
import { verifySignature } from '../src/modules/integrations/domain/webhook-signature';

import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

type Received = { headers: Record<string, string>; raw: string };

describe('Integrations — webhooks + API keys (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let dispatcher: WebhookDispatcher;

  let sellerToken: string;
  let sellerBusinessId: string;
  let buyerToken: string;

  let receiver: Server;
  let receiverUrl: string;
  const received: Received[] = [];
  /** Status the stub receiver answers with; flipped to test retries. */
  let receiverStatus = 200;

  let listingId: string;
  let webhookSecret: string;

  beforeAll(async () => {
    await seedFresh();
    app = await bootTestApp();
    prisma = new PrismaClient();
    dispatcher = app.get(WebhookDispatcher);

    receiver = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        received.push({ headers: req.headers as Record<string, string>, raw });
        res.writeHead(receiverStatus).end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

    sellerToken = (await login(app, 'owner')).accessToken;
    const sellerOwner = await prisma.user.findFirstOrThrow({
      where: { email: 'youssef@elamrani.ma' },
    });
    sellerBusinessId = sellerOwner.businessId;

    const buyerBiz = await prisma.business.create({
      data: { name: 'Acheteur SARL', ice: '555555555555555' },
    });
    await prisma.businessModule.create({
      data: { businessId: buyerBiz.id, moduleId: 'marketplace', active: true },
    });
    await prisma.user.create({
      data: {
        businessId: buyerBiz.id,
        name: 'Buyer Owner',
        email: 'buyer@example.ma',
        passwordHash: sellerOwner.passwordHash,
        role: 'owner',
      },
    });
    buyerToken = (await login(app, 'buyer@example.ma')).accessToken;

    const product = await prisma.product.findFirstOrThrow({
      where: { businessId: sellerBusinessId, deletedAt: null },
    });
    const listing = await api(app)
      .post('/api/v1/marketplace/listings')
      .set(bearer(sellerToken))
      .send({ productId: product.id, unitPrice: 50, vat: 20 })
      .expect(201);
    listingId = listing.body.id;
  });

  afterAll(async () => {
    await new Promise<void>((r) => receiver.close(() => r()));
    await prisma.$disconnect();
    await app.close();
  });

  describe('webhook registration', () => {
    it('returns the secret exactly once, at creation', async () => {
      const res = await api(app)
        .post('/api/v1/integrations/webhooks')
        .set(bearer(sellerToken))
        .send({ url: receiverUrl, events: ['order.created', 'order.status_changed'] })
        .expect(201);

      webhookSecret = res.body.secret;
      expect(webhookSecret).toHaveLength(48);

      const list = await api(app)
        .get('/api/v1/integrations/webhooks')
        .set(bearer(sellerToken))
        .expect(200);
      expect(list.body[0].secret).toBeUndefined();
    });

    it('rejects an unknown event name', async () => {
      await api(app)
        .post('/api/v1/integrations/webhooks')
        .set(bearer(sellerToken))
        .send({ url: receiverUrl, events: ['order.exploded'] })
        .expect(400);
    });
  });

  describe('delivery', () => {
    it('queues order.created and delivers it signed', async () => {
      await api(app)
        .post('/api/v1/orders')
        .set(bearer(buyerToken))
        .send({ lines: [{ listingId, qty: 4 }] })
        .expect(201);

      const pending = await prisma.webhookDelivery.count({ where: { status: 'pending' } });
      expect(pending).toBe(1);

      const result = await dispatcher.drain();
      expect(result).toEqual({ sent: 1, failed: 0 });

      const hit = received.at(-1);
      expect(hit?.headers['tijaru-event']).toBe('order.created');
      expect(verifySignature(webhookSecret, hit!.raw, hit!.headers['tijaru-signature']!)).toBe(
        true,
      );
      expect(verifySignature('wrong-secret', hit!.raw, hit!.headers['tijaru-signature']!)).toBe(
        false,
      );

      const body = JSON.parse(hit!.raw);
      expect(body.event).toBe('order.created');
      expect(body.data.totalTtc).toBe(240);
      // Odoo-shaped mirror for connectors.
      expect(body.data.odoo.order_line[0]).toMatchObject({
        product_uom_qty: 4,
        price_unit: 50,
        tax_rate: 20,
      });
    });

    it('marks a delivery ok and leaves nothing pending', async () => {
      const rows = await prisma.webhookDelivery.findMany();
      expect(rows.every((r) => r.status === 'ok')).toBe(true);
    });

    it('retries a failing receiver with a backoff instead of dropping it', async () => {
      receiverStatus = 500;
      const before = received.length;

      const order = await prisma.order.findFirstOrThrow();
      await api(app)
        .post(`/api/v1/orders/received/${order.id}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'confirmed' })
        .expect(201);

      const result = await dispatcher.drain();
      expect(result.failed).toBe(1);
      expect(received.length).toBe(before + 1);

      const delivery = await prisma.webhookDelivery.findFirstOrThrow({
        where: { event: 'order.status_changed' },
      });
      expect(delivery.status).toBe('pending');
      expect(delivery.attempts).toBe(1);
      expect(delivery.lastError).toContain('500');
      expect(delivery.nextAt.getTime()).toBeGreaterThan(Date.now()); // backed off

      receiverStatus = 200;
    });

    it('does not deliver to another tenant’s hook', async () => {
      const foreign = await prisma.webhook.count({ where: { businessId: { not: sellerBusinessId } } });
      expect(foreign).toBe(0);
      await api(app)
        .get('/api/v1/integrations/webhooks')
        .set(bearer(buyerToken))
        .expect(200)
        .expect((r) => expect(r.body).toEqual([]));
    });
  });

  describe('api keys', () => {
    let token: string;
    let keyId: string;

    it('issues a token once and stores only its hash', async () => {
      const res = await api(app)
        .post('/api/v1/integrations/api-keys')
        .set(bearer(sellerToken))
        .send({ name: 'Odoo connector' })
        .expect(201);

      token = res.body.token;
      keyId = res.body.id;
      expect(token.startsWith(res.body.prefix)).toBe(true);

      const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
      expect(stored.hash).not.toContain(token);

      const list = await api(app)
        .get('/api/v1/integrations/api-keys')
        .set(bearer(sellerToken))
        .expect(200);
      expect(list.body[0].hash).toBeUndefined();
    });

    it('authenticates a normal endpoint as that tenant', async () => {
      const res = await api(app)
        .get('/api/v1/orders/received')
        .set(bearer(token))
        .expect(200);
      expect(res.body.items).toHaveLength(1);

      const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
      expect(stored.lastUsedAt).not.toBeNull();
    });

    it('rejects a tampered token', async () => {
      await api(app)
        .get('/api/v1/orders/received')
        .set(bearer(`${token}00`))
        .expect(401);
    });

    it('rejects a revoked key', async () => {
      await api(app)
        .delete(`/api/v1/integrations/api-keys/${keyId}`)
        .set(bearer(sellerToken))
        .expect(204);
      await api(app).get('/api/v1/orders/received').set(bearer(token)).expect(401);
    });
  });
});
