import { Injectable } from '@nestjs/common';

import { NotificationsRepository } from '../domain/notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: NotificationsRepository) {}

  list(): Promise<unknown> {
    return this.notifications.findRecent();
  }

  unreadCount(): Promise<number> {
    return this.notifications.countUnread();
  }

  markRead(id: string): Promise<unknown> {
    return this.notifications.markRead(id);
  }

  async markAllRead(): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllUnreadRead() };
  }
}
