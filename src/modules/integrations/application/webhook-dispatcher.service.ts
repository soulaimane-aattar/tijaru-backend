
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'kysely';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import {
  MAX_ATTEMPTS,
  nextAttemptAt,
  signPayload,
} from '../domain/webhook-signature';
import { webhookUrlRefusalReason } from '../domain/webhook-url';

/** Events a tenant can subscribe to. Kept flat and stable for consumers. */
export const WEBHOOK_EVENTS = ['order.created', 'order.status_changed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const TIMEOUT_MS = 10_000;

/**
 * Outbox dispatcher, modelled on Saleor's `EventDelivery` /
 * `EventDeliveryAttempt` pair: `enqueue` only writes rows, a poller does the
 * HTTP. No queue library — @nestjs/schedule is already a dependency.
 *
 * ponytail: one cron worker, whole-table scan per minute. Move to BullMQ if a
 * tenant ever needs sub-minute delivery or parallel workers.
 */
@Injectable()
export class WebhookDispatcher {
  private readonly log = new Logger(WebhookDispatcher.name);

  constructor(private readonly db: Db) {}

  /**
   * Outbox rows are written for another tenant's hooks (the buyer's request enqueues for the
   * seller), and the poller has no tenant — so all of this runs on `db.admin` with explicit
   * business filters.
   */
  async enqueue(businessId: string, event: WebhookEvent, payload: unknown): Promise<number> {
    const hooks = await this.db.admin
      .selectFrom('app.webhooks')
      .select('id')
      .where('business_id', '=', businessId)
      .where('active', '=', true)
      .where(sql<boolean>`${event} = any(events)`)
      .execute();
    if (hooks.length === 0) return 0;

    const now = new Date();
    await this.db.admin
      .insertInto('app.webhook_deliveries')
      .values(
        hooks.map((h) => ({
          id: newId(),
          webhook_id: h.id,
          business_id: businessId,
          event,
          payload: JSON.stringify(payload),
          updatedAt: now,
        })),
      )
      .execute();
    return hooks.length;
  }

  /**
   * Skipped under NODE_ENV=test: every e2e suite boots its own app, and a
   * minute-ticking poller firing across unrelated suites makes them flaky.
   * Tests call `drain()` directly.
   */
  @Cron('*/1 * * * *')
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.drain();
  }

  async drain(limit = 50): Promise<{ sent: number; failed: number }> {
    const due = await this.db.admin
      .selectFrom('app.webhook_deliveries as d')
      .innerJoin('app.webhooks as w', 'w.id', 'd.webhook_id')
      .select(['d.id', 'd.event', 'd.payload', 'd.createdAt', 'w.url', 'w.secret'])
      .where('d.status', '=', 'pending')
      .where('d.next_at', '<=', new Date())
      .orderBy('d.next_at', 'asc')
      .limit(limit)
      .execute();

    let sent = 0;
    let failed = 0;
    for (const delivery of due) {
      const ok = await this.deliver(delivery.id, delivery.url, delivery.secret, {
        event: delivery.event,
        id: delivery.id,
        occurredAt: delivery.createdAt.toISOString(),
        data: delivery.payload,
      });
      if (ok) sent += 1;
      else failed += 1;
    }
    return { sent, failed };
  }

  private async deliver(
    id: string,
    url: string,
    secret: string,
    envelope: Record<string, unknown>,
  ): Promise<boolean> {
    // Re-check the target on every attempt: a name that was public at
    // registration can be re-pointed at the internal network afterwards.
    const refusal = await webhookUrlRefusalReason(url);
    if (refusal) {
      await this.bumpAttempts(id, refusal);
      this.log.warn(`webhook ${id} ${refusal}`);
      return false;
    }

    const body = JSON.stringify(envelope);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Tijaru-Event': String(envelope.event),
          'Tijaru-Delivery-Id': id,
          'Tijaru-Signature': signPayload(secret, body),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`responded ${res.status}`);

      await this.db.admin
        .updateTable('app.webhook_deliveries')
        .set({ status: 'ok', attempts: sql<number>`attempts + 1`, last_error: null })
        .where('id', '=', id)
        .execute();
      return true;
    } catch (e) {
      const attempts = (await this.bumpAttempts(id, e instanceof Error ? e.message : 'failed'));
      this.log.warn(`webhook ${id} attempt ${attempts} failed`);
      return false;
    }
  }

  private async bumpAttempts(id: string, error: string): Promise<number> {
    const current = await this.db.admin
      .updateTable('app.webhook_deliveries')
      .set({ attempts: sql<number>`attempts + 1`, last_error: error })
      .where('id', '=', id)
      .returning('attempts')
      .executeTakeFirstOrThrow();
    await this.db.admin
      .updateTable('app.webhook_deliveries')
      .set(
        current.attempts >= MAX_ATTEMPTS
          ? { status: 'failed' }
          : { next_at: nextAttemptAt(current.attempts) },
      )
      .where('id', '=', id)
      .execute();
    return current.attempts;
  }
}
