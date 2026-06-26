import { Controller, Get, HttpCode, Injectable, Module, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<unknown> {
    return this.prisma.notification.findMany({ orderBy: { date: 'desc' }, take: 100 });
  }

  unreadCount(): Promise<number> {
    return this.prisma.notification.count({ where: { read: false } });
  }

  markRead(id: string): Promise<unknown> {
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllRead(): Promise<{ updated: number }> {
    const r = await this.prisma.notification.updateMany({
      where: { read: false },
      data: { read: true },
    });
    return { updated: r.count };
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @RequireCap('dashboard.view')
  list(): Promise<unknown> {
    return this.svc.list();
  }

  @Get('unread-count')
  @RequireCap('dashboard.view')
  async count(): Promise<{ unread: number }> {
    return { unread: await this.svc.unreadCount() };
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequireCap('dashboard.view')
  read(@Param('id') id: string): Promise<unknown> {
    return this.svc.markRead(id);
  }

  @Post('read-all')
  @RequireCap('dashboard.view')
  readAll(): Promise<unknown> {
    return this.svc.markAllRead();
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PrismaService],
})
export class NotificationsModule {}
