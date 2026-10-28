import { Module } from '@nestjs/common';


import { ActivityController } from './activity.controller';
import { ActivityService } from './application/activity.service';
import { ActivityRepository } from './domain/activity.repository';
import { KyselyActivityRepository } from './infrastructure/kysely-activity.repository';

@Module({
  controllers: [ActivityController],
  providers: [
    ActivityService,
    { provide: ActivityRepository, useClass: KyselyActivityRepository },
  ],
})
export class ActivityModule {}
