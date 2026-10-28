import { Kysely, PostgresDialect } from 'kysely';
import { defaults, Pool, types } from 'pg';

import type { DB } from '../../src/database/types';

// Same UTC handling as KyselyModule (columns are `timestamp without time zone` holding UTC).
defaults.parseInputDatesAsUTC = true;
types.setTypeParser(1114, (s) => new Date(`${s.replace(' ', 'T')}Z`));

/** Owner-role Kysely for e2e fixtures/assertions (bypasses RLS). Call `closeTestDb()` in afterAll. */
export const testDb = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL?.replace(/\?schema=.*$/, '') }),
  }),
});

export const closeTestDb = (): Promise<void> => testDb.destroy();
