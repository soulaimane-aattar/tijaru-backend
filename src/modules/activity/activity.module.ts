import { Module } from '@nestjs/common';


import { ActivityController } from './activity.controller';
import { ActivityService } from './application/activity.service';
import { ActivityRepository } from './domain/activity.repository';
import { PrismaActivityRepository } from './infrastructure/prisma-activity.repository';

@Module({
  controllers: [ActivityController],
  providers: [
    ActivityService,
    { provide: ActivityRepository, useClass: PrismaActivityRepository },
  ],
})
export class ActivityModule {}
