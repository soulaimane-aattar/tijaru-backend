/**
 * Platform-admin seed — creates/updates the super admin from env.
 *
 * Idempotent (upsert by email), does NOT touch tenant data — safe to run
 * against production. Distinct from `seed.ts` (demo dataset, wipes everything).
 *
 * Run: `npm run seed:platform-admin`
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { loadEnv } from '../src/config/env';

const prisma = new PrismaClient();

export async function seedPlatformAdmin(): Promise<void> {
  const env = loadEnv();
  const passwordHash = await bcrypt.hash(env.PLATFORM_ADMIN_PASSWORD, env.BCRYPT_COST);

  const admin = await prisma.platformAdmin.upsert({
    where: { email: env.PLATFORM_ADMIN_EMAIL },
    update: { passwordHash },
    create: { email: env.PLATFORM_ADMIN_EMAIL, name: 'Platform Admin', passwordHash },
  });

  console.log(`✅ Platform admin ready: ${admin.email}`);
}

if (require.main === module) {
  seedPlatformAdmin()
    .catch((e) => {
      console.error('❌ Platform admin seed failed:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
