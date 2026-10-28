import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

type Store = { businessId: string };

@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<Store>();

  run<T>(businessId: string, fn: () => T): T {
    return this.als.run({ businessId }, fn);
  }

  getBusinessId(): string | undefined {
    return this.als.getStore()?.businessId;
  }
}
