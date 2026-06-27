import { Global, Module } from '@nestjs/common';

import { PermissionsResolver } from '../common/permissions-resolver.service';
import { PrismaService } from '../common/prisma.service';
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
    PrismaService,
    PermissionsResolver,
    TenantContext,
  ],
  exports: [ENV_TOKEN, PrismaService, PermissionsResolver, TenantContext],
})
export class ConfigModule {}
