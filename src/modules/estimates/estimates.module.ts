import { Module } from '@nestjs/common';

import { EstimatesService } from './application/estimates.service';
import { EstimatesRepository } from './domain/estimates.repository';
import { PrismaEstimatesRepository } from './infrastructure/prisma-estimates.repository';
import { EstimatesController } from './estimates.controller';

@Module({
  controllers: [EstimatesController],
  providers: [
    EstimatesService,
    { provide: EstimatesRepository, useClass: PrismaEstimatesRepository },
  ],
  exports: [EstimatesService],
})
export class EstimatesModule {}
