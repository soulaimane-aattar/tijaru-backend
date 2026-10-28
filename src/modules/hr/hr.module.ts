import { Module } from '@nestjs/common';

import { HrService } from './application/hr.service';
import { HrRepository } from './domain/hr.repository';
import { HrController } from './hr.controller';
import { KyselyHrRepository } from './infrastructure/kysely-hr.repository';

@Module({
  controllers: [HrController],
  providers: [HrService, { provide: HrRepository, useClass: KyselyHrRepository }],
})
export class HrModule {}
