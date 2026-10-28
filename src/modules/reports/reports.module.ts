import { Module } from '@nestjs/common';


import { ReportsService } from './application/reports.service';
import { ReportsRepository } from './domain/reports.repository';
import { KyselyReportsRepository } from './infrastructure/kysely-reports.repository';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    { provide: ReportsRepository, useClass: KyselyReportsRepository },
  ],
})
export class ReportsModule {}
