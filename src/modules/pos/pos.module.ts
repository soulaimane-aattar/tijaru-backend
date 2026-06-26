import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';

import { PosService } from './application/pos.service';
import { PosController } from './pos.controller';

@Module({
  controllers: [PosController],
  providers: [PosService, PrismaService],
  exports: [PosService],
})
export class PosModule {}
