import { Module } from '@nestjs/common';

import { HrService } from './application/hr.service';
import { HrRepository } from './domain/hr.repository';
import { HrController } from './hr.controller';
import { PrismaHrRepository } from './infrastructure/prisma-hr.repository';

@Module({
  controllers: [HrController],
  providers: [HrService, { provide: HrRepository, useClass: PrismaHrRepository }],
})
export class HrModule {}
