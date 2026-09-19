import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContext } from '../../common/tenant/tenant-context';

import { IntegrationsService } from './application/integrations.service';
import { WEBHOOK_EVENTS } from './application/webhook-dispatcher.service';
import {
  type CreateApiKeyInput,
  CreateApiKeySchema,
  type CreateWebhookInput,
  CreateWebhookSchema,
  type UpdateWebhookInput,
  UpdateWebhookSchema,
} from './dto/integrations.dto';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller({ path: 'integrations', version: '1' })
export class IntegrationsController {
  constructor(
    private readonly svc: IntegrationsService,
    private readonly tenant: TenantContext,
  ) {}

  private bid(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new Error('missing tenant');
    return id;
  }

  @Get('events')
  @RequireCap('settings.manage')
  events(): readonly string[] {
    return WEBHOOK_EVENTS;
  }

  @Get('webhooks')
  @RequireCap('settings.manage')
  listWebhooks(): Promise<unknown> {
    return this.svc.listWebhooks(this.bid());
  }

  @Post('webhooks')
  @RequireCap('settings.manage')
  createWebhook(
    @Body(new ZodValidationPipe(CreateWebhookSchema)) body: CreateWebhookInput,
  ): Promise<unknown> {
    return this.svc.createWebhook(this.bid(), body);
  }

  @Patch('webhooks/:id')
  @RequireCap('settings.manage')
  updateWebhook(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWebhookSchema)) body: UpdateWebhookInput,
  ): Promise<unknown> {
    return this.svc.updateWebhook(this.bid(), id, body);
  }

  @Delete('webhooks/:id')
  @RequireCap('settings.manage')
  @HttpCode(204)
  async deleteWebhook(@Param('id') id: string): Promise<void> {
    await this.svc.deleteWebhook(this.bid(), id);
  }

  @Get('webhooks/:id/deliveries')
  @RequireCap('settings.manage')
  deliveries(@Param('id') id: string): Promise<unknown> {
    return this.svc.deliveries(this.bid(), id);
  }

  @Get('api-keys')
  @RequireCap('settings.manage')
  listApiKeys(): Promise<unknown> {
    return this.svc.listApiKeys(this.bid());
  }

  @Post('api-keys')
  @RequireCap('settings.manage')
  createApiKey(
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: CreateApiKeyInput,
  ): Promise<unknown> {
    return this.svc.createApiKey(this.bid(), body);
  }

  @Delete('api-keys/:id')
  @RequireCap('settings.manage')
  @HttpCode(204)
  async revokeApiKey(@Param('id') id: string): Promise<void> {
    await this.svc.revokeApiKey(this.bid(), id);
  }
}
