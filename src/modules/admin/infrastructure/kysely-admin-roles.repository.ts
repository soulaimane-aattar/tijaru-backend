import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import type { AppBuiltinrole } from '../../../database/types';
import {
  AdminRolesRepository,
  type CapabilityGrant,
  type UserOverridesView,
} from '../domain/admin-roles.repository';

@Injectable()
export class KyselyAdminRolesRepository extends AdminRolesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  private liveUser(userId: string) {
    return this.db.q
      .selectFrom('app_auth.users')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', userId)
      .where('deletedAt', 'is', null);
  }

  async findUserWithOverrides(userId: string): Promise<UserOverridesView | null> {
    const user = await this.liveUser(userId).select(['id', 'role']).executeTakeFirst();
    if (!user) return null;
    const overrides = await this.db.q
      .selectFrom('app_auth.user_overrides')
      .select(['capId', 'granted'])
      .where('business_id', '=', this.db.businessId)
      .where('userId', '=', userId)
      .execute();
    return { ...user, overrides };
  }

  async userExists(userId: string): Promise<boolean> {
    return (await this.liveUser(userId).select('id').executeTakeFirst()) !== undefined;
  }

  async applyRoleCustomizations(
    businessId: string,
    role: string,
    changes: { remove: string[]; set: CapabilityGrant[] },
  ): Promise<void> {
    const roleValue = role as AppBuiltinrole;
    await this.db.tx(async (q) => {
      if (changes.remove.length) {
        await q
          .deleteFrom('app_auth.role_customizations')
          .where('business_id', '=', businessId)
          .where('role', '=', roleValue)
          .where('capId', 'in', changes.remove)
          .execute();
      }
      for (const w of changes.set) {
        await q
          .insertInto('app_auth.role_customizations')
          .values({ business_id: businessId, role: roleValue, capId: w.capId, granted: w.granted })
          .onConflict((oc) => oc.columns(['business_id', 'role', 'capId']).doUpdateSet({ granted: w.granted }))
          .execute();
      }
      await q
        .updateTable('app_auth.users')
        .set((eb) => ({ tokenVersion: eb('tokenVersion', '+', 1) }))
        .where('business_id', '=', businessId)
        .where('role', '=', roleValue)
        .where('deletedAt', 'is', null)
        .execute();
    });
  }

  async applyUserOverrides(
    userId: string,
    changes: { remove: string[]; set: CapabilityGrant[] },
  ): Promise<void> {
    const businessId = this.db.businessId;
    await this.db.tx(async (q) => {
      if (changes.remove.length) {
        await q
          .deleteFrom('app_auth.user_overrides')
          .where('business_id', '=', businessId)
          .where('userId', '=', userId)
          .where('capId', 'in', changes.remove)
          .execute();
      }
      for (const w of changes.set) {
        await q
          .insertInto('app_auth.user_overrides')
          .values({ business_id: businessId, userId, capId: w.capId, granted: w.granted })
          .onConflict((oc) => oc.columns(['userId', 'capId']).doUpdateSet({ granted: w.granted }))
          .execute();
      }
      await q
        .updateTable('app_auth.users')
        .set((eb) => ({ tokenVersion: eb('tokenVersion', '+', 1) }))
        .where('business_id', '=', businessId)
        .where('id', '=', userId)
        .execute();
    });
  }
}
