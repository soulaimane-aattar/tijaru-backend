import { randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { ConflictError, NotFoundError, UnauthorizedError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

// Unambiguous alphabet: no O/0, I/1/l to avoid transcription errors when read aloud or copied.
const TEMP_PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateTempPassword(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_PW_ALPHABET[randomInt(TEMP_PW_ALPHABET.length)];
  return out;
}

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!admin) throw new UnauthorizedError('Invalid credentials');

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) throw new UnauthorizedError('Invalid credentials');

    const accessToken = await this.jwt.signAsync(
      { sub: admin.id, type: 'platform-admin', ver: admin.tokenVersion },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL },
    );
    return { accessToken };
  }

  async listBusinesses(status?: string, plan?: string): Promise<unknown[]> {
    const where = {
      ...(status ? { status: status as never } : {}),
      ...(plan ? { plan: plan as never } : {}),
    };
    return this.prisma.business.findMany({
      where,
      include: {
        users: {
          where: { role: 'owner', deletedAt: null },
          select: { id: true, name: true, email: true, phone: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cross-business user listing for the platform-admin panel.
   * Search hits both name + email (case-insensitive). Paginated.
   */
  async listUsers(params: {
    search?: string;
    businessId?: string;
    role?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    const { search, businessId, role, page, pageSize } = params;
    const where = {
      deletedAt: null,
      ...(businessId ? { businessId } : {}),
      ...(role ? { role: role as never } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          active: true,
          lastLogin: true,
          createdAt: true,
          business: { select: { id: true, name: true, plan: true, status: true } },
        },
      }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Append-only console journal. Failures must never break the action itself. */
  private async audit(entry: {
    action: string;
    tone?: 'ok' | 'warn' | 'err';
    targetType?: 'business' | 'user';
    targetId?: string;
    targetName: string;
    detail?: string;
  }): Promise<void> {
    try {
      await this.prisma.platformAuditLog.create({
        data: {
          action: entry.action,
          tone: entry.tone ?? 'ok',
          targetType: entry.targetType ?? 'business',
          targetId: entry.targetId ?? null,
          targetName: entry.targetName,
          detail: entry.detail ?? '',
        },
      });
    } catch {
      // swallow — journal is best-effort
    }
  }

  async listAudit(limit = 20): Promise<unknown[]> {
    return this.prisma.platformAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async approveBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    if (biz.status !== 'pending') throw new ConflictError('Business is not pending');
    await this.prisma.business.update({ where: { id }, data: { status: 'active' } });
    await this.audit({ action: 'approve', targetId: id, targetName: biz.name });
  }

  async rejectBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    if (biz.status !== 'pending') throw new ConflictError('Business is not pending');
    await this.prisma.business.update({ where: { id }, data: { status: 'rejected' } });
    await this.audit({ action: 'reject', tone: 'warn', targetId: id, targetName: biz.name });
  }

  async getBusinessDetail(id: string) {
    const biz = await this.prisma.business.findUnique({
      where: { id },
      include: {
        users: {
          where: { role: 'owner', deletedAt: null },
          select: { id: true, name: true, email: true, phone: true },
          take: 1,
        },
        modules: true,
      },
    });
    if (!biz) throw new NotFoundError('Business', id);
    return biz;
  }

  async updateBusiness(
    id: string,
    data: {
      maxUsers?: number | undefined;
      maxProducts?: number | undefined;
      maxWarehouses?: number | undefined;
    },
  ) {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    const updated = await this.prisma.business.update({ where: { id }, data: cleaned });
    const changes = Object.entries(cleaned)
      .map(([k, v]) => `${k} ${String(biz[k as keyof typeof biz])} → ${String(v)}`)
      .join(', ');
    if (changes) {
      await this.audit({ action: 'update-limits', targetId: id, targetName: biz.name, detail: changes });
    }
    return updated;
  }

  async extendSubscription(id: string, duration: '1mo' | '3mo' | '6mo' | '1yr') {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);

    const durations: Record<'1mo' | '3mo' | '6mo' | '1yr', number> = {
      '1mo': 30,
      '3mo': 90,
      '6mo': 180,
      '1yr': 365,
    };
    const days = durations[duration];
    const start = new Date();
    const end = new Date(start.getTime() + days * 86_400_000);

    const updated = await this.prisma.business.update({
      where: { id },
      data: { plan: 'active', subscriptionStart: start, subscriptionEnd: end },
    });
    const months: Record<typeof duration, string> = { '1mo': '+1 mois', '3mo': '+3 mois', '6mo': '+6 mois', '1yr': '+12 mois' };
    await this.audit({ action: 'extend', targetId: id, targetName: biz.name, detail: months[duration] });
    return updated;
  }

  async suspendBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    await this.prisma.business.update({
      where: { id },
      data: { status: 'suspended', plan: 'suspended' },
    });
    await this.audit({ action: 'suspend', tone: 'err', targetId: id, targetName: biz.name });
  }

  async activateBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    await this.prisma.business.update({
      where: { id },
      data: { status: 'active', plan: 'active' },
    });
    await this.audit({ action: 'activate', targetId: id, targetName: biz.name });
  }

  async updateModules(id: string, modules: Record<string, boolean>): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);

    const upserts = Object.entries(modules).map(([moduleId, active]) =>
      this.prisma.businessModule.upsert({
        where: { businessId_moduleId: { businessId: id, moduleId } },
        update: { active },
        create: { businessId: id, moduleId, active },
      }),
    );
    await this.prisma.$transaction(upserts);
    const detail = Object.entries(modules)
      .map(([m, active]) => `${m}: ${active ? 'on' : 'off'}`)
      .join(', ');
    await this.audit({ action: 'update-modules', targetId: id, targetName: biz.name, detail });
  }

  /**
   * Platform-level business settings: multi-stock and TVA.
   * Disabling multi-stock requires at most one active warehouse; the remaining
   * (or newly created) warehouse becomes the default and takes the business name.
   * TVA off ⇒ enabledVatRates [0]; TVA on ⇒ full Moroccan rate set.
   */
  async updateSettings(
    id: string,
    input: { multiWarehouse?: boolean | undefined; tvaEnabled?: boolean | undefined },
  ): Promise<{ multiWarehouse: boolean; enabledVatRates: number[] }> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);

    const details: string[] = [];

    if (input.multiWarehouse !== undefined && input.multiWarehouse !== biz.multiWarehouse) {
      if (!input.multiWarehouse) {
        const warehouses = await this.prisma.warehouse.findMany({
          where: { businessId: id, deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        });
        if (warehouses.length > 1) {
          throw new ConflictError(
            `Cannot disable multi-stock: ${warehouses.length} active warehouses exist. Remove extras first.`,
          );
        }
        const main = warehouses[0];
        if (main) {
          await this.prisma.warehouse.update({
            where: { id: main.id },
            data: { name: biz.name, isDefault: true, active: true },
          });
        } else {
          await this.prisma.warehouse.create({
            data: {
              businessId: id,
              name: biz.name,
              city: biz.city ?? '',
              isDefault: true,
              active: true,
            },
          });
        }
      }
      await this.prisma.business.update({
        where: { id },
        data: { multiWarehouse: input.multiWarehouse },
      });
      details.push(`multi-stock: ${input.multiWarehouse ? 'on' : 'off'}`);
    }

    if (input.tvaEnabled !== undefined) {
      const rates = input.tvaEnabled ? [0, 7, 10, 14, 20] : [0];
      await this.prisma.business.update({
        where: { id },
        data: { enabledVatRates: rates },
      });
      details.push(`tva: ${input.tvaEnabled ? 'on' : 'off'}`);
    }

    if (details.length) {
      await this.audit({
        action: 'update-settings',
        targetId: id,
        targetName: biz.name,
        detail: details.join(', '),
      });
    }

    const updated = await this.prisma.business.findUniqueOrThrow({
      where: { id },
      select: { multiWarehouse: true, enabledVatRates: true },
    });
    return updated;
  }

  /**
   * Admin-initiated password reset: generates a one-time temp password, revokes the user's
   * active sessions, and bumps tokenVersion so the old refresh token is rejected. The plaintext
   * is returned exactly once — only its bcrypt hash is persisted.
   */
  async resetUserPassword(userId: string, customPassword?: string): Promise<{ tempPassword: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, businessId: true, name: true, business: { select: { name: true } } },
    });
    if (!user) throw new NotFoundError('User', userId);

    let tempPassword: string;
    if (customPassword && customPassword.length >= 8) {
      tempPassword = customPassword;
    } else {
      const policy = await this.prisma.securityPolicy.findUnique({
        where: { businessId: user.businessId },
        select: { passwordMinLen: true },
      });
      const length = Math.max(10, policy?.passwordMinLen ?? 8);
      tempPassword = generateTempPassword(length);
    }
    const passwordHash = await bcrypt.hash(tempPassword, this.env.BCRYPT_COST);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit({
      action: 'reset-password',
      tone: 'warn',
      targetType: 'user',
      targetId: user.id,
      targetName: user.name,
      detail: user.business?.name ?? '',
    });
    return { tempPassword };
  }

  async getStats() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, active, expired, pending, suspended, users, newUsers7d] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.business.count({ where: { plan: 'active' } }),
      this.prisma.business.count({ where: { plan: 'expired' } }),
      this.prisma.business.count({ where: { status: 'pending' } }),
      this.prisma.business.count({ where: { plan: 'suspended' } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),
    ]);
    return { total, active, expired, pending, suspended, users, newUsers7d };
  }
}
