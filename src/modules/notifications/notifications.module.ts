import { Module } from '@nestjs/common';

import { NotificationsScannerService } from './application/notifications-scanner.service';
import { NotificationsService } from './application/notifications.service';
import { NotificationsRepository } from './domain/notifications.repository';
import { PrismaNotificationsRepository } from './infrastructure/prisma-notifications.repository';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsScannerService,
    { provide: NotificationsRepository, useClass: PrismaNotificationsRepository },
  ],
})
export class NotificationsModule {}
