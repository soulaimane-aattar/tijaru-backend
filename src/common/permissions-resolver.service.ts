import { Injectable } from '@nestjs/common';

import {
  CAPABILITY_IDS,
  type CapabilityId,
  ROLE_IDS,
  type RoleId,
  ROLE_PERMS,
} from '../domain/permissions';

import { PrismaService } from './prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async effectiveMatrix(): Promise<Record<RoleId, CapabilityId[]>> {
    const customizations = await this.prisma.roleCustomization.findMany();
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

  async effectiveCapsForRole(role: RoleId): Promise<CapabilityId[]> {
    const matrix = await this.effectiveMatrix();
    return matrix[role];
  }
}
