import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { defaults, Pool, types } from 'pg';

import type { Env } from '../config/env';

import { Db } from './db.service';
import { KYSELY, KYSELY_ADMIN } from './tokens';
import type { DB } from './types';

export { KYSELY };

// ConfigModule's token (not imported: config.module -> PermissionsResolver -> Db would cycle).
const ENV = 'ENV';
// Prisma-style `?schema=` is not a libpq option.
const clean = (url: string) => url.replace(/\?schema=.*$/, '');

// Columns are `timestamp without time zone` holding UTC (Prisma wrote them so); pg would parse as local time.
defaults.parseInputDatesAsUTC = true; // serialize Date params as UTC too
types.setTypeParser(1114, (s) => new Date(`${s.replace(' ', 'T')}Z`));

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      useFactory: (env: Env) => {
        if (!env.DATABASE_URL_APP && env.NODE_ENV === 'production') {
          new Logger('Db').warn(
            'DATABASE_URL_APP is unset: request queries run as the DATABASE_URL role, so RLS is NOT enforced. Set it to a tijaru_app login.',
          );
        }
        const pool = new Pool({ connectionString: clean(env.DATABASE_URL_APP ?? env.DATABASE_URL), max: env.DB_POOL_MAX });

        return new Kysely<DB>({
          dialect: new PostgresDialect({ pool }),
        });
      },
      inject: [ENV],
    },
    {
      // Owner role (bypasses RLS) — same access Prisma had. For pre-auth, cron, platform-admin and
      // deliberately cross-tenant code only; callers must filter on business themselves.
      provide: KYSELY_ADMIN,
      useFactory: (env: Env) =>
        new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: clean(env.DATABASE_URL) }) }) }),
      inject: [ENV],
    },
    Db,
  ],
  exports: [KYSELY, Db],
})
export class KyselyModule implements OnModuleDestroy {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    @Inject(KYSELY_ADMIN) private readonly admin: Kysely<DB>,
  ) {}

  async onModuleDestroy() {
    await Promise.all([this.db.destroy(), this.admin.destroy()]);
  }
}
