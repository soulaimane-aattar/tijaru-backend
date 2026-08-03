import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';

import { NotificationsService } from './application/notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
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
