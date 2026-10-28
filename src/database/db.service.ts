import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';

import { ForbiddenError } from '../common/errors';
import { TenantContext } from '../common/tenant/tenant-context';

import { KYSELY, KYSELY_ADMIN } from './tokens';
import type { DB } from './types';

export interface DbScope {
  businessId: string;
  userId?: string | undefined;
  role?: string | undefined;
}

/**
 * Kysely handle for repositories. Inside `scope()` every query shares ONE transaction
 * whose RLS session vars are set with `set_config(..., true)` (transaction-local), so
 * pooled connections never leak a tenant. Outside a scope it is the plain pool.
 */
@Injectable()
export class Db {
  private readonly als = new AsyncLocalStorage<Kysely<DB>>();

  constructor(
    @Inject(KYSELY) private readonly root: Kysely<DB>,
    @Inject(KYSELY_ADMIN) readonly admin: Kysely<DB>,
    private readonly tenant: TenantContext,
  ) {}

  get q(): Kysely<DB> {
    return this.als.getStore() ?? this.root;
  }

  /** Tenant of the current request (same ALS the Prisma middleware uses). */
  get businessId(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new ForbiddenError('No tenant in scope');
    return id;
  }

  /** Atomic block: reuses the request transaction if one is open (Kysely can't nest), else opens one. */
  tx<T>(fn: (q: Kysely<DB>) => Promise<T>): Promise<T> {
    const cur = this.als.getStore();
    return cur ? fn(cur) : this.root.transaction().execute((trx) => this.als.run(trx, () => fn(trx)));
  }

  /** Run `fn` in the ambient request txn, or open a short tenant txn (for `@SkipTenantTx()` routes). */
  scoped<T>(fn: () => Promise<T>): Promise<T> {
    return this.als.getStore() ? fn() : this.scope({ businessId: this.businessId }, fn);
  }

  scope<T>(s: DbScope, fn: () => Promise<T>): Promise<T> {
    return this.root.transaction().execute(async (trx) => {
      await sql`select set_config('app.current_business_id', ${s.businessId}, true),
        set_config('app.current_user_id', ${s.userId ?? ''}, true),
        set_config('app.current_user_role', ${s.role ?? 'user'}, true)`.execute(trx);
      return this.als.run(trx, fn);
    });
  }
}
