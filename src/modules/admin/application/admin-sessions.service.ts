import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';

@Injectable()
export class AdminSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<unknown> {
    return this.prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revoke(id: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundError('Session', id);
    await this.prisma.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(): Promise<{ revoked: number }> {
    const r = await this.prisma.session.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: r.count };
  }
}
