import { Module } from '@nestjs/common';


import { PosService } from './application/pos.service';
import { PosRepository } from './domain/pos.repository';
import { PrismaPosRepository } from './infrastructure/prisma-pos.repository';
import { PosController } from './pos.controller';

@Module({
  controllers: [PosController],
  providers: [
    PosService,
    { provide: PosRepository, useClass: PrismaPosRepository },
  ],
  exports: [PosService],
})
export class PosModule {}
