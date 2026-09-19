import { Module } from '@nestjs/common';

import { IntegrationsService } from './application/integrations.service';
import { WebhookDispatcher } from './application/webhook-dispatcher.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, WebhookDispatcher],
  exports: [WebhookDispatcher],
})
export class IntegrationsModule {}
