import * as dotenv from 'dotenv';
import { Kysely, PostgresDialect } from 'kysely';
import { defaults, Pool, types } from 'pg';

import type { DB } from '../src/database/types';

// PrismaClient used to load `.env` as a side effect; do it explicitly (never overrides real env vars).
dotenv.config();

// Same UTC handling as KyselyModule (columns are `timestamp without time zone` holding UTC).
defaults.parseInputDatesAsUTC = true;
types.setTypeParser(1114, (s) => new Date(`${s.replace(' ', 'T')}Z`));

/** Owner-role Kysely for seeds (bypasses RLS). A fresh pool per call; callers `destroy()` it. */
export const makeSeedDb = (): Kysely<DB> =>
  new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: process.env.DATABASE_URL?.replace(/\?schema=.*$/, '') }),
    }),
  });
