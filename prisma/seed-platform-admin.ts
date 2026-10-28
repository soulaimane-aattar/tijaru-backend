/**
 * Platform-admin seed — creates/updates the super admin from env.
 *
 * Idempotent (upsert by email), does NOT touch tenant data — safe to run
 * against production. Distinct from `seed.ts` (demo dataset, wipes everything).
 *
 * Run: `npm run seed:platform-admin`
 */
import * as bcrypt from 'bcrypt';

import { loadEnv } from '../src/config/env';
import { newId } from '../src/database/ids';

import { makeSeedDb } from './db';

export async function seedPlatformAdmin(): Promise<void> {
  const env = loadEnv();
  if (!env.PLATFORM_ADMIN_EMAIL || !env.PLATFORM_ADMIN_PASSWORD) {
    throw new Error(
      'PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are required to run this seed script.',
    );
  }
  const passwordHash = await bcrypt.hash(env.PLATFORM_ADMIN_PASSWORD, env.BCRYPT_COST);

  const db = makeSeedDb();
  try {
    const admin = await db
      .insertInto('platform_admins')
      .values({ id: newId(), email: env.PLATFORM_ADMIN_EMAIL, name: 'Platform Admin', passwordHash, updatedAt: new Date() })
      .onConflict((oc) => oc.column('email').doUpdateSet({ passwordHash, updatedAt: new Date() }))
      .returning('email')
      .executeTakeFirstOrThrow();
    console.log(`✅ Platform admin ready: ${admin.email}`);
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  seedPlatformAdmin().catch((e) => {
    console.error('❌ Platform admin seed failed:', e);
    process.exit(1);
  });
}
