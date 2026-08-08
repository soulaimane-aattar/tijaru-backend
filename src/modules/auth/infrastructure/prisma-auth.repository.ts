import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma.service';
import {
  AuthRepository,
  type AuthUserView,
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
}
