import { Injectable } from '@nestjs/common';
import type { BuiltInRole } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import {
  AdminRolesRepository,
  type CapabilityGrant,
  type UserOverridesView,
} from '../domain/admin-roles.repository';

@Injectable()
export class PrismaAdminRolesRepository extends AdminRolesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findUserWithOverrides(userId: string): Promise<UserOverridesView | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { overrides: true },
    });
  }

  async userExists(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    return user !== null;
  }

  async applyRoleCustomizations(
    businessId: string,
    role: string,
    changes: { remove: string[]; set: CapabilityGrant[] },
  ): Promise<void> {
    const roleValue = role as BuiltInRole;
    await this.prisma.$transaction([
      ...changes.remove.map((capId) =>
        this.prisma.roleCustomization.deleteMany({ where: { role: roleValue, capId } }),
      ),
      ...changes.set.map((w) =>
        this.prisma.roleCustomization.upsert({
          where: { businessId_role_capId: { businessId, role: roleValue, capId: w.capId } },
          create: { businessId, role: roleValue, capId: w.capId, granted: w.granted },
          update: { granted: w.granted },
        }),
      ),
      this.prisma.user.updateMany({
        where: { role: roleValue, deletedAt: null },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
  }

  async applyUserOverrides(
    userId: string,
    changes: { remove: string[]; set: CapabilityGrant[] },
  ): Promise<void> {
    await this.prisma.$transaction([
      ...changes.remove.map((capId) =>
        this.prisma.userOverride.deleteMany({ where: { userId, capId } }),
      ),
      ...changes.set.map((w) =>
        this.prisma.userOverride.upsert({
          where: { userId_capId: { userId, capId: w.capId } },
          create: { userId, capId: w.capId, granted: w.granted },
          update: { granted: w.granted },
        }),
      ),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
  }
}
