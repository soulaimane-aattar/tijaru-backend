import { Module } from '@nestjs/common';

import { BugReportsService } from './application/bug-reports.service';
import { BugReportsController } from './bug-reports.controller';

@Module({
  controllers: [BugReportsController],
  providers: [BugReportsService],
})
export class BugReportsModule {}
