
import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { defined } from '../../row-case';
import {
  AdminPolicyRepository,
  type SecurityPolicyPatch,
} from '../domain/admin-policy.repository';

@Injectable()
export class KyselyAdminPolicyRepository extends AdminPolicyRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findPolicyDetail(): Promise<unknown | null> {
    const policy = await this.db.q
      .selectFrom('app_auth.security_policies')
      .selectAll()
      .where('businessId', '=', this.db.businessId)
      .executeTakeFirst();
    if (!policy) return null;
    const business = await this.db.q
      .selectFrom('app.businesses')
      .select(['id', 'name'])
      .where('id', '=', policy.businessId)
      .executeTakeFirstOrThrow();
    return { ...policy, business };
  }

  async findPolicyId(): Promise<string | null> {
    const policy = await this.db.q
      .selectFrom('app_auth.security_policies')
      .select('id')
      .where('businessId', '=', this.db.businessId)
      .executeTakeFirst();
    return policy?.id ?? null;
  }

  async createDefault(): Promise<void> {
    await this.db.q
      .insertInto('app_auth.security_policies')
      .values({ id: newId(), businessId: this.db.businessId, updatedAt: new Date() })
      .execute();
  }

  updatePolicy(id: string, patch: SecurityPolicyPatch): Promise<unknown> {
    return this.db.q
      .updateTable('app_auth.security_policies')
      .set({ ...defined(patch), updatedAt: new Date() })
      .where('businessId', '=', this.db.businessId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
