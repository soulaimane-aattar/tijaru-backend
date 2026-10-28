import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow } from '../../row-case';
import { generateApiKey } from '../domain/webhook-signature';
import { assertPublicWebhookUrl } from '../domain/webhook-url';
import type { CreateApiKeyInput, CreateWebhookInput, UpdateWebhookInput } from '../dto/integrations.dto';

export type WebhookView = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: Date;
  /** Shown once at creation so the tenant can configure its receiver. */
  secret?: string;
};

@Injectable()
export class IntegrationsService {
  constructor(private readonly db: Db) {}

  // ─── webhooks ──────────────────────────────────────────────────────────────

  async listWebhooks(businessId: string): Promise<WebhookView[]> {
    const rows = await this.db.q
      .selectFrom('app.webhooks')
      .select(['id', 'url', 'events', 'active', 'createdAt'])
      .where('business_id', '=', businessId)
      .orderBy('createdAt', 'desc')
      .execute();
    return rows.map((r) => ({ ...r, events: r.events ?? [] }));
  }

  async createWebhook(businessId: string, input: CreateWebhookInput): Promise<WebhookView> {
    assertPublicWebhookUrl(input.url);
    const secret = input.secret ?? randomBytes(24).toString('hex');
    const row = await this.db.q
      .insertInto('app.webhooks')
      .values({ id: newId(), business_id: businessId, url: input.url, events: input.events, secret, updatedAt: new Date() })
      .returning(['id', 'url', 'events', 'active', 'createdAt'])
      .executeTakeFirstOrThrow();
    return { ...row, events: row.events ?? [], secret };
  }

  async updateWebhook(
    businessId: string,
    id: string,
    input: UpdateWebhookInput,
  ): Promise<WebhookView> {
    if (input.url !== undefined) assertPublicWebhookUrl(input.url);
    const r = await this.db.q
      .updateTable('app.webhooks')
      .set({
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.events === undefined ? {} : { events: input.events }),
        ...(input.active === undefined ? {} : { active: input.active }),
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new NotFoundError('Webhook', id);
    const [row] = await this.listWebhooks(businessId).then((rows) =>
      rows.filter((r) => r.id === id),
    );
    return row as WebhookView;
  }

  async deleteWebhook(businessId: string, id: string): Promise<void> {
    const r = await this.db.q
      .deleteFrom('app.webhooks')
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) throw new NotFoundError('Webhook', id);
  }

  /** Recent deliveries for one hook — the tenant's debugging view. */
  async deliveries(businessId: string, id: string): Promise<unknown[]> {
    const hook = await this.db.q
      .selectFrom('app.webhooks')
      .select('id')
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!hook) throw new NotFoundError('Webhook', id);
    const rows = await this.db.q
      .selectFrom('app.webhook_deliveries')
      .select(['id', 'event', 'status', 'attempts', 'next_at', 'last_error', 'createdAt'])
      .where('webhook_id', '=', id)
      .where('business_id', '=', businessId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .execute();
    return rows.map(camelRow);
  }

  // ─── api keys ──────────────────────────────────────────────────────────────

  async listApiKeys(businessId: string): Promise<unknown[]> {
    const rows = await this.db.q
      .selectFrom('app.api_keys')
      .select(['id', 'name', 'prefix', 'last_used_at', 'revoked_at', 'createdAt'])
      .where('business_id', '=', businessId)
      .orderBy('createdAt', 'desc')
      .execute();
    return rows.map(camelRow);
  }

  /** The full token exists only in this response — only its hash is stored. */
  async createApiKey(
    businessId: string,
    input: CreateApiKeyInput,
  ): Promise<{ id: string; name: string; prefix: string; token: string }> {
    const { token, prefix, hash } = generateApiKey();
    const row = await this.db.q
      .insertInto('app.api_keys')
      .values({ id: newId(), business_id: businessId, name: input.name, prefix, hash })
      .returning(['id', 'name', 'prefix'])
      .executeTakeFirstOrThrow();
    return { ...row, token };
  }

  async revokeApiKey(businessId: string, id: string): Promise<void> {
    const r = await this.db.q
      .updateTable('app.api_keys')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new NotFoundError('ApiKey', id);
  }
}
