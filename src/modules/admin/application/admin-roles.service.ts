import { Injectable } from '@nestjs/common';

import { DomainError, NotFoundError } from '../../../common/errors';
import { PermissionsResolver } from '../../../common/permissions-resolver.service';
import { PrismaService } from '../../../common/prisma.service';
import {
  CAPABILITIES,
  CAPABILITY_IDS,
  type CapabilityId,
  ROLES,
  ROLE_IDS,
  type RoleId,
  ROLE_PERMS,
} from '../../../domain/permissions';
import type { PatchOverridesInput, PatchRoleInput } from '../dto/admin.dto';

@Injectable()
export class AdminRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsResolver,
  ) {}

  async listRoles(): Promise<unknown> {
    const matrix = await this.permissions.effectiveMatrix();
    return ROLE_IDS.map((id) => {
      const defaults = [...ROLE_PERMS[id]];
      const effective = matrix[id];
      return {
        ...ROLES[id],
        editable: id !== 'owner',
        defaults,
        effective,
        capabilities: CAPABILITY_IDS.map((cap) => ({
          ...CAPABILITIES[cap],
          default: ROLE_PERMS[id].has(cap),
          effective: effective.includes(cap),
        })),
      };
    });
  }

  /**
   * Persist a role's effective capabilities.
   *
   * For every cap that differs from default we write a RoleCustomization row.
   * For every cap that equals default we delete the row (clean state).
   * Owner role is locked.
   *
   * Side effect: bump tokenVersion of every user whose role matches → invalidates
   * their outstanding access tokens, forcing a re-login or token refresh that
   * picks up the new caps.
   */
  async patchRole(roleId: string, input: PatchRoleInput): Promise<unknown> {
    if (!ROLE_IDS.includes(roleId as RoleId)) {
      throw new NotFoundError('Role', roleId);
    }
    if (roleId === 'owner') {
      throw new DomainError('forbidden', 'Owner role is not editable', 403);
    }
    const role = roleId as RoleId;

    const writes = [];
    const deletes: CapabilityId[] = [];
    for (const cap of CAPABILITY_IDS) {
      const desired = input.capabilities[cap];
      if (desired === undefined) continue;
      const def = ROLE_PERMS[role].has(cap);
      if (desired === def) {
        deletes.push(cap);
      } else {
        writes.push({ role, capId: cap, granted: desired });
      }
    }

    await this.prisma.$transaction([
      ...deletes.map((capId) =>
        this.prisma.roleCustomization.deleteMany({ where: { role, capId } }),
      ),
      ...writes.map((w) =>
        this.prisma.roleCustomization.upsert({
          where: { role_capId: { role: w.role, capId: w.capId } },
          create: w,
          update: { granted: w.granted },
        }),
      ),
      this.prisma.user.updateMany({
        where: { role, deletedAt: null },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);

    return this.listRoles();
  }

  async getOverrides(userId: string): Promise<unknown> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { overrides: true },
    });
    if (!user) throw new NotFoundError('User', userId);
    const roleCaps = await this.permissions.effectiveCapsForRole(user.role as RoleId);
    const overrideMap = new Map(user.overrides.map((o) => [o.capId, o.granted]));
    return {
      userId: user.id,
      role: user.role,
      capabilities: CAPABILITY_IDS.map((cap) => {
        const o = overrideMap.get(cap);
        const fromRole = roleCaps.includes(cap);
        return {
          ...CAPABILITIES[cap],
          fromRole,
          override: o === undefined ? null : o ? 'grant' : 'deny',
          effective: o === undefined ? fromRole : o,
        };
      }),
    };
  }

  /**
   * Patch per-user overrides. Value 'role' means "follow role" → delete override.
   * Bumps the target user's tokenVersion to invalidate their outstanding tokens.
   */
  async patchOverrides(userId: string, input: PatchOverridesInput): Promise<unknown> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundError('User', userId);

    const writes = [];
    const deletes: CapabilityId[] = [];
    for (const cap of CAPABILITY_IDS) {
      const v = input.overrides[cap];
      if (v === undefined) continue;
      if (v === 'role') deletes.push(cap);
      else writes.push({ userId, capId: cap, granted: v });
    }

    await this.prisma.$transaction([
      ...deletes.map((capId) =>
        this.prisma.userOverride.deleteMany({ where: { userId, capId } }),
      ),
      ...writes.map((w) =>
        this.prisma.userOverride.upsert({
          where: { userId_capId: { userId, capId: w.capId } },
          create: w,
          update: { granted: w.granted },
        }),
      ),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);

    return this.getOverrides(userId);
  }
}
