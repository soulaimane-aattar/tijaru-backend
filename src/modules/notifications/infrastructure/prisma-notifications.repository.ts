import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma.service';
import { NotificationsRepository } from '../domain/notifications.repository';

@Injectable()
export class PrismaNotificationsRepository extends NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findRecent(): Promise<unknown[]> {
    return this.prisma.notification.findMany({ orderBy: { date: 'desc' }, take: 100 });
  }

  countUnread(): Promise<number> {
    return this.prisma.notification.count({ where: { read: false } });
  }

  markRead(id: string): Promise<unknown> {
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllUnreadRead(): Promise<number> {
    const r = await this.prisma.notification.updateMany({
      where: { read: false },
      data: { read: true },
    });
    return r.count;
  }
}
