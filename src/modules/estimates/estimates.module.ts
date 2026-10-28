import { Module } from '@nestjs/common';

import { EstimatesService } from './application/estimates.service';
import { EstimatesRepository } from './domain/estimates.repository';
import { EstimatesController } from './estimates.controller';
import { KyselyEstimatesRepository } from './infrastructure/kysely-estimates.repository';

@Module({
  controllers: [EstimatesController],
  providers: [
    EstimatesService,
    { provide: EstimatesRepository, useClass: KyselyEstimatesRepository },
  ],
  exports: [EstimatesService],
})
export class EstimatesModule {}
