import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, Injectable, Logger } from '@nestjs/common';
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

interface Store {
  trx: Kysely<DB>;
  after: Array<() => Promise<unknown> | unknown>;
}

/**
 * Kysely handle for repositories. Inside `scope()` every query shares ONE transaction
 * whose RLS session vars are set with `set_config(..., true)` (transaction-local), so
 * pooled connections never leak a tenant. Outside a scope it is the plain pool.
 *
 * `afterCommit(fn)` defers side effects that run on their own connection (`db.admin`: notifications,
 * webhook outbox) until the ambient transaction has committed; a rollback drops them.
 */
@Injectable()
export class Db {
  private readonly als = new AsyncLocalStorage<Store>();
  private readonly log = new Logger(Db.name);

  constructor(
    @Inject(KYSELY) private readonly root: Kysely<DB>,
    @Inject(KYSELY_ADMIN) readonly admin: Kysely<DB>,
    private readonly tenant: TenantContext,
  ) {}

  get q(): Kysely<DB> {
    return this.als.getStore()?.trx ?? this.root;
  }

  /** Tenant of the current request (set by TenantInterceptor). */
  get businessId(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new ForbiddenError('No tenant in scope');
    return id;
  }

  /** Atomic block: reuses the request transaction if one is open (Kysely can't nest), else opens one. */
  tx<T>(fn: (q: Kysely<DB>) => Promise<T>): Promise<T> {
    const cur = this.als.getStore();
    return cur ? fn(cur.trx) : this.open((trx) => fn(trx));
  }

  /**
   * Run `fn` once the ambient transaction commits (dropped on rollback). With no transaction open it
   * runs immediately. Never throws: a failing callback is logged, it must not fail the request.
   */
  afterCommit(fn: () => Promise<unknown> | unknown): Promise<void> {
    const cur = this.als.getStore();
    if (cur) {
      cur.after.push(fn);
      return Promise.resolve();
    }
    return this.safely(fn);
  }

  private async safely(fn: () => Promise<unknown> | unknown): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.log.error(`afterCommit callback failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Open a transaction with its own callback list; flush the list only after a successful commit. */
  private async open<T>(fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
    const after: Store['after'] = [];
    const result = await this.root.transaction().execute((trx) => this.als.run({ trx, after }, () => fn(trx)));
    for (const cb of after) await this.safely(cb);
    return result;
  }

  /** Run `fn` in the ambient request txn, or open a short tenant txn (for `@SkipTenantTx()` routes). */
  scoped<T>(fn: () => Promise<T>): Promise<T> {
    return this.als.getStore() ? fn() : this.scope({ businessId: this.businessId }, fn);
  }

  scope<T>(s: DbScope, fn: () => Promise<T>): Promise<T> {
    return this.open(async (trx) => {
      await sql`select set_config('app.current_business_id', ${s.businessId}, true),
        set_config('app.current_user_id', ${s.userId ?? ''}, true),
        set_config('app.current_user_role', ${s.role ?? 'user'}, true)`.execute(trx);
      return fn();
    });
  }
}
