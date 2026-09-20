import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  // ─── webhooks ──────────────────────────────────────────────────────────────

  async listWebhooks(businessId: string): Promise<WebhookView[]> {
    const rows = await this.prisma.webhook.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    });
    return rows;
  }

  async createWebhook(businessId: string, input: CreateWebhookInput): Promise<WebhookView> {
    assertPublicWebhookUrl(input.url);
    const secret = input.secret ?? randomBytes(24).toString('hex');
    const row = await this.prisma.webhook.create({
      data: { businessId, url: input.url, events: input.events, secret },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    });
    return { ...row, secret };
  }

  async updateWebhook(
    businessId: string,
    id: string,
    input: UpdateWebhookInput,
  ): Promise<WebhookView> {
    if (input.url !== undefined) assertPublicWebhookUrl(input.url);
    const { count } = await this.prisma.webhook.updateMany({
      where: { id, businessId },
      data: {
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.events === undefined ? {} : { events: input.events }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
    });
    if (count === 0) throw new NotFoundError('Webhook', id);
    const [row] = await this.listWebhooks(businessId).then((rows) =>
      rows.filter((r) => r.id === id),
    );
    return row as WebhookView;
  }

  async deleteWebhook(businessId: string, id: string): Promise<void> {
    const { count } = await this.prisma.webhook.deleteMany({ where: { id, businessId } });
    if (count === 0) throw new NotFoundError('Webhook', id);
  }

  /** Recent deliveries for one hook — the tenant's debugging view. */
  async deliveries(businessId: string, id: string): Promise<unknown[]> {
    const hook = await this.prisma.webhook.findFirst({ where: { id, businessId } });
    if (!hook) throw new NotFoundError('Webhook', id);
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        nextAt: true,
        lastError: true,
        createdAt: true,
      },
    });
  }

  // ─── api keys ──────────────────────────────────────────────────────────────

  listApiKeys(businessId: string): Promise<unknown[]> {
    return this.prisma.apiKey.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  /** The full token exists only in this response — only its hash is stored. */
  async createApiKey(
    businessId: string,
    input: CreateApiKeyInput,
  ): Promise<{ id: string; name: string; prefix: string; token: string }> {
    const { token, prefix, hash } = generateApiKey();
    const row = await this.prisma.apiKey.create({
      data: { businessId, name: input.name, prefix, hash },
      select: { id: true, name: true, prefix: true },
    });
    return { ...row, token };
  }

  async revokeApiKey(businessId: string, id: string): Promise<void> {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id, businessId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundError('ApiKey', id);
  }
}
