import { newId } from '../../src/database/ids';

import { testDb } from './db';

/**
 * Second tenant with one active module and an owner login. Written through the owner
 * pool (bypasses RLS). The seeded owner's password hash is reused so the demo password works.
 * Without the module row, ModuleGuard would 403 before tenant isolation is exercised.
 */
export async function createTenant(o: {
  name: string;
  ice: string;
  moduleId: string;
  email: string;
  ownerName?: string;
}): Promise<string> {
  const seeded = await testDb
    .selectFrom('app_auth.users')
    .select('passwordHash')
    .where('email', '=', 'youssef@elamrani.ma')
    .executeTakeFirstOrThrow();
  const now = new Date();
  const businessId = newId();
  await testDb
    .insertInto('app.businesses')
    .values({ id: businessId, name: o.name, ice: o.ice, updatedAt: now })
    .execute();
  await testDb
    .insertInto('app.business_modules')
    .values({ business_id: businessId, module_id: o.moduleId, active: true, updatedAt: now })
    .execute();
  await testDb
    .insertInto('app_auth.users')
    .values({
      id: newId(),
      business_id: businessId,
      name: o.ownerName ?? `${o.name} Owner`,
      email: o.email,
      passwordHash: seeded.passwordHash,
      role: 'owner',
      updatedAt: now,
    })
    .execute();
  return businessId;
}
