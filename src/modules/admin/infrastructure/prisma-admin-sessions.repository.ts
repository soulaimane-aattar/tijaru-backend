import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma.service';
import { AdminSessionsRepository } from '../domain/admin-sessions.repository';

@Injectable()
export class PrismaAdminSessionsRepository extends AdminSessionsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findActiveSessions(): Promise<unknown> {
    return this.prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async exists(id: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id },
      select: { id: true },
    });
    return session !== null;
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllActive(): Promise<number> {
    const r = await this.prisma.session.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return r.count;
  }
}
