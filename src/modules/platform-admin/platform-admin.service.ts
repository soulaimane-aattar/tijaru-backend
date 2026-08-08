import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../common/prisma.service';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../common/errors';
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
}
