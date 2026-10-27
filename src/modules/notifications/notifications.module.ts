import { Module } from '@nestjs/common';

import { EmailRemindersService } from './application/email-reminders.service';
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
    EmailRemindersService,
    { provide: NotificationsRepository, useClass: PrismaNotificationsRepository },
  ],
})
export class NotificationsModule {}
