import { Module } from '@nestjs/common';


import { ReportsService } from './application/reports.service';
import { ReportsRepository } from './domain/reports.repository';
import { PrismaReportsRepository } from './infrastructure/prisma-reports.repository';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    { provide: ReportsRepository, useClass: PrismaReportsRepository },
  ],
})
export class ReportsModule {}
