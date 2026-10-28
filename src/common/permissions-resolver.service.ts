import { Injectable } from '@nestjs/common';

import { Db } from '../database';
import {
  CAPABILITY_IDS,
  type CapabilityId,
  ROLE_IDS,
  type RoleId,
  ROLE_PERMS,
} from '../domain/permissions';


import { TenantContext } from './tenant/tenant-context';

/**
 * Resolves the *effective* role × capability matrix at runtime.
 *
 * Layers (priority order, highest wins):
 *  1. Default `ROLE_PERMS` from src/domain/permissions.ts
 *  2. `RoleCustomization` rows (admin role editor)
 *  3. `UserOverride` rows — applied per-user at JWT issue time, not here
 *
 * `owner` is never customizable (UI + admin service enforce this).
 */
@Injectable()
export class PermissionsResolver {
  constructor(
    private readonly db: Db,
    private readonly tenant: TenantContext,
  ) {}

  /**
   * Customizations of one business. Inside that business's request we read through the request
   * transaction (sees uncommitted admin edits); pre-auth callers (login/refresh) pass `businessId`
   * and read through the owner pool. No business at all (public /auth/permissions) ⇒ role defaults.
   */
  private async customizations(businessId?: string) {
    const id = businessId ?? this.tenant.getBusinessId();
    if (!id) return [];
    const q = this.tenant.getBusinessId() === id ? this.db.q : this.db.admin;
    return q
      .selectFrom('app_auth.role_customizations')
      .select(['role', 'capId', 'granted'])
      .where('business_id', '=', id)
      .execute();
  }

  async effectiveMatrix(businessId?: string): Promise<Record<RoleId, CapabilityId[]>> {
    const customizations = await this.customizations(businessId);
    const byRole = new Map<RoleId, Map<CapabilityId, boolean>>();
    for (const c of customizations) {
      const role = c.role as RoleId;
      let m = byRole.get(role);
      if (!m) {
        m = new Map();
        byRole.set(role, m);
      }
      m.set(c.capId as CapabilityId, c.granted);
    }

    const result = {} as Record<RoleId, CapabilityId[]>;
    for (const role of ROLE_IDS) {
      if (role === 'owner') {
        result[role] = [...CAPABILITY_IDS];
        continue;
      }
      const overrides = byRole.get(role);
      const caps: CapabilityId[] = [];
      for (const cap of CAPABILITY_IDS) {
        const def = ROLE_PERMS[role].has(cap);
        const ov = overrides?.get(cap);
        const allowed = ov !== undefined ? ov : def;
        if (allowed) caps.push(cap);
      }
      result[role] = caps;
    }
    return result;
  }

  async effectiveCapsForRole(role: RoleId, businessId?: string): Promise<CapabilityId[]> {
    const matrix = await this.effectiveMatrix(businessId);
    return matrix[role];
  }
}
