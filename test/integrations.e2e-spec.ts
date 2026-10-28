import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

import { WebhookDispatcher } from '../src/modules/integrations/application/webhook-dispatcher.service';
import { verifySignature } from '../src/modules/integrations/domain/webhook-signature';

import { closeTestDb, testDb } from './helpers/db';
import { createTenant } from './helpers/tenant';
import { api, bearer, bootTestApp, login, seedFresh } from './helpers/test-app';

type Received = { headers: Record<string, string>; raw: string };

describe('Integrations — webhooks + API keys (e2e)', () => {
  let app: INestApplication;
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
    sellerBusinessId = (
      await testDb
        .selectFrom('app_auth.users')
        .select('business_id')
        .where('email', '=', 'youssef@elamrani.ma')
        .executeTakeFirstOrThrow()
    ).business_id;

    await createTenant({
      name: 'Acheteur SARL',
      ice: '555555555555555',
      moduleId: 'marketplace',
      email: 'buyer@example.ma',
      ownerName: 'Buyer Owner',
    });
    buyerToken = (await login(app, 'buyer@example.ma')).accessToken;

    const product = await testDb
      .selectFrom('app.products')
      .select('id')
      .where('business_id', '=', sellerBusinessId)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    const listing = await api(app)
      .post('/api/v1/marketplace/listings')
      .set(bearer(sellerToken))
      .send({ productId: product.id, unitPrice: 50, vat: 20 })
      .expect(201);
    listingId = listing.body.id;
  });

  afterAll(async () => {
    await new Promise<void>((r) => receiver.close(() => r()));
    await closeTestDb();
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

    it('rejects a non-https target in production mode', async () => {
      // The guard relaxes under NODE_ENV=test so the local receiver works;
      // flip it to prove the production rule (SSRF: no internal targets).
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        for (const url of [
          'http://hooks.example.com/h',
          'https://127.0.0.1/h',
          'https://169.254.169.254/latest/meta-data',
          'https://localhost/h',
        ]) {
          await api(app)
            .post('/api/v1/integrations/webhooks')
            .set(bearer(sellerToken))
            .send({ url, events: ['order.created'] })
            .expect(400);
        }
      } finally {
        process.env.NODE_ENV = previous;
      }
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

      const pending = Number(
        (
          await testDb
            .selectFrom('app.webhook_deliveries')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('status', '=', 'pending')
            .executeTakeFirstOrThrow()
        ).n,
      );
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
      const rows = await testDb.selectFrom('app.webhook_deliveries').select('status').execute();
      expect(rows.every((r) => r.status === 'ok')).toBe(true);
    });

    it('retries a failing receiver with a backoff instead of dropping it', async () => {
      receiverStatus = 500;
      const before = received.length;

      const order = await testDb.selectFrom('app.orders').select('id').executeTakeFirstOrThrow();
      await api(app)
        .post(`/api/v1/orders/received/${order.id}/status`)
        .set(bearer(sellerToken))
        .send({ status: 'confirmed' })
        .expect(201);

      const result = await dispatcher.drain();
      expect(result.failed).toBe(1);
      expect(received.length).toBe(before + 1);

      const delivery = await testDb
        .selectFrom('app.webhook_deliveries')
        .selectAll()
        .where('event', '=', 'order.status_changed')
        .executeTakeFirstOrThrow();
      expect(delivery.status).toBe('pending');
      expect(delivery.attempts).toBe(1);
      expect(delivery.last_error).toContain('500');
      expect(delivery.next_at.getTime()).toBeGreaterThan(Date.now()); // backed off

      receiverStatus = 200;
    });

    it('does not deliver to another tenant’s hook', async () => {
      const foreign = Number(
        (
          await testDb
            .selectFrom('app.webhooks')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('business_id', '<>', sellerBusinessId)
            .executeTakeFirstOrThrow()
        ).n,
      );
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

      const stored = await testDb
        .selectFrom('app.api_keys')
        .selectAll()
        .where('id', '=', keyId)
        .executeTakeFirstOrThrow();
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

      const stored = await testDb
        .selectFrom('app.api_keys')
        .selectAll()
        .where('id', '=', keyId)
        .executeTakeFirstOrThrow();
      expect(stored.last_used_at).not.toBeNull();
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
