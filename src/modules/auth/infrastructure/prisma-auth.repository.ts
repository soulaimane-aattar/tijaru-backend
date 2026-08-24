import { Injectable } from '@nestjs/common';
import { BuiltInRole, BusinessStatus } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { DEFAULT_EXPENSE_CATEGORIES } from '../../expense-categories/domain/default-categories';
import {
  AuthRepository,
  type AuthUserView,
  type BusinessModuleView,
  type BusinessSubscriptionView,
  type CreateBusinessWithOwnerData,
  type CreateBusinessWithOwnerResult,
  type CreateSessionData,
  type SessionView,
  type UserProfileView,
} from '../domain/auth.repository';

@Injectable()
export class PrismaAuthRepository extends AuthRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findUserByEmail(email: string): Promise<AuthUserView | null> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { overrides: true, business: { select: { status: true } } },
    });
    if (!user) return null;
    return { ...user, businessStatus: user.business.status };
  }

  async findPlatformAdminByEmail(email: string) {
    return this.prisma.platformAdmin.findUnique({ where: { email } });
  }

  async findProfile(userId: string): Promise<UserProfileView | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        active: true,
        lastLogin: true,
        warehouses: { select: { warehouseId: true } },
      },
    });
    if (!user) return null;
    return { ...user, warehouseIds: user.warehouses.map((w) => w.warehouseId) };
  }

  async emailInUse(email: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    return user !== null;
  }

  async recordLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLogin: new Date() },
    });
  }

  async findSessionByTokenHash(hash: string): Promise<SessionView | null> {
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: hash, revokedAt: null },
      include: {
        user: {
          include: {
            overrides: true,
            business: { select: { status: true } },
          },
        },
      },
    });
    if (!session) return null;
    return {
      ...session,
      user: { ...session.user, businessStatus: session.user.business.status },
    };
  }

  async createSession(data: CreateSessionData): Promise<void> {
    await this.prisma.session.create({ data });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSessionByTokenHash(userId: string, hash: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async bumpTokenVersion(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async createBusinessWithOwner(
    data: CreateBusinessWithOwnerData,
  ): Promise<CreateBusinessWithOwnerResult> {
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: data.businessName,
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          status: data.status as BusinessStatus,
        },
      });
      const user = await tx.user.create({
        data: {
          businessId: business.id,
          name: data.ownerName,
          email: data.email,
          passwordHash: data.passwordHash,
          role: BuiltInRole.owner,
        },
      });
      const defaultModules = ['stock', 'pos', 'expenses', 'purchase-orders', 'inventory', 'reports'];
      await tx.businessModule.createMany({
        data: defaultModules.map((moduleId) => ({
          businessId: business.id,
          moduleId,
          active: true,
        })),
      });
      await tx.expenseCategoryDef.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
          businessId: business.id,
          key: c.key,
          label: c.label,
          taxRate: c.taxRate,
          sortOrder: c.sortOrder,
        })),
      });
      return { businessId: business.id, userId: user.id };
    });
  }

  async findBusinessById(businessId: string): Promise<BusinessSubscriptionView | null> {
    return this.prisma.business.findUnique({
      where: { id: businessId },
      select: { plan: true, subscriptionEnd: true, enabledVatRates: true, multiWarehouse: true },
    });
  }

  async findBusinessModules(businessId: string): Promise<BusinessModuleView[]> {
    return this.prisma.businessModule.findMany({
      where: { businessId },
      select: { moduleId: true, active: true },
    });
  }

  async findUserById(userId: string): Promise<{ id: string; passwordHash: string } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
