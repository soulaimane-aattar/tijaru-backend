import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(businessId: string, event: WebhookEvent, payload: unknown): Promise<number> {
    const hooks = await this.prisma.webhook.findMany({
      where: { businessId, active: true, events: { has: event } },
      select: { id: true },
    });
    if (hooks.length === 0) return 0;

    await this.prisma.webhookDelivery.createMany({
      data: hooks.map((h) => ({
        webhookId: h.id,
        event,
        payload: payload as object,
      })),
    });
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
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'pending', nextAt: { lte: new Date() } },
      include: { webhook: true },
      orderBy: { nextAt: 'asc' },
      take: limit,
    });

    let sent = 0;
    let failed = 0;
    for (const delivery of due) {
      const ok = await this.deliver(delivery.id, delivery.webhook.url, delivery.webhook.secret, {
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

      await this.prisma.webhookDelivery.update({
        where: { id },
        data: { status: 'ok', attempts: { increment: 1 }, lastError: null },
      });
      return true;
    } catch (e) {
      const attempts = (await this.bumpAttempts(id, e instanceof Error ? e.message : 'failed'));
      this.log.warn(`webhook ${id} attempt ${attempts} failed`);
      return false;
    }
  }

  private async bumpAttempts(id: string, error: string): Promise<number> {
    const current = await this.prisma.webhookDelivery.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: error },
      select: { attempts: true },
    });
    await this.prisma.webhookDelivery.update({
      where: { id },
      data:
        current.attempts >= MAX_ATTEMPTS
          ? { status: 'failed' }
          : { nextAt: nextAttemptAt(current.attempts) },
    });
    return current.attempts;
  }
}
