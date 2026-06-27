import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { TenantContext } from './tenant/tenant-context';
import { makeTenantMiddleware } from './tenant/tenant.middleware';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly tenant: TenantContext) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.$use(makeTenantMiddleware(this.tenant));
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
