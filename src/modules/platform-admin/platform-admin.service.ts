import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { ConflictError, NotFoundError, UnauthorizedError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

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

  async listBusinesses(status?: string): Promise<unknown[]> {
    const where = status ? { status: status as never } : {};
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

  async approveBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    if (biz.status !== 'pending') throw new ConflictError('Business is not pending');
    await this.prisma.business.update({ where: { id }, data: { status: 'active' } });
  }

  async rejectBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    if (biz.status !== 'pending') throw new ConflictError('Business is not pending');
    await this.prisma.business.update({ where: { id }, data: { status: 'rejected' } });
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
    return this.prisma.business.update({ where: { id }, data: cleaned });
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

    return this.prisma.business.update({
      where: { id },
      data: { plan: 'active', subscriptionStart: start, subscriptionEnd: end },
    });
  }

  async suspendBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    await this.prisma.business.update({
      where: { id },
      data: { status: 'suspended', plan: 'suspended' },
    });
  }

  async activateBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    await this.prisma.business.update({
      where: { id },
      data: { status: 'active', plan: 'active' },
    });
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
  }

  async getStats() {
    const [total, active, expired, pending, suspended] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.business.count({ where: { plan: 'active' } }),
      this.prisma.business.count({ where: { plan: 'expired' } }),
      this.prisma.business.count({ where: { status: 'pending' } }),
      this.prisma.business.count({ where: { plan: 'suspended' } }),
    ]);
    return { total, active, expired, pending, suspended };
  }
}
