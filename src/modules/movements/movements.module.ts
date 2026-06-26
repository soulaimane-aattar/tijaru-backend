import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';

import { MovementsService } from './application/movements.service';
import { MovementsController } from './movements.controller';

@Module({
  controllers: [MovementsController],
  providers: [MovementsService, PrismaService],
  exports: [MovementsService],
})
export class MovementsModule {}
