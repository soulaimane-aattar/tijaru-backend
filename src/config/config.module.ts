import { Global, Module } from '@nestjs/common';

import { DocumentAuditService } from '../common/audit/document-audit.service';
import { PermissionsResolver } from '../common/permissions-resolver.service';
import { TenantContext } from '../common/tenant/tenant-context';

import { loadEnv, type Env } from './env';

export const ENV_TOKEN = 'ENV';

@Global()
@Module({
  providers: [
    {
      provide: ENV_TOKEN,
      useFactory: (): Env => loadEnv(),
    },
    PermissionsResolver,
    TenantContext,
    DocumentAuditService,
  ],
  exports: [ENV_TOKEN, PermissionsResolver, TenantContext, DocumentAuditService],
})
export class ConfigModule {}
