import { Module } from '@nestjs/common';


import { MovementsService } from './application/movements.service';
import { MovementsRepository } from './domain/movements.repository';
import { PrismaMovementsRepository } from './infrastructure/prisma-movements.repository';
import { MovementsController } from './movements.controller';

@Module({
  controllers: [MovementsController],
  providers: [
    MovementsService,
    { provide: MovementsRepository, useClass: PrismaMovementsRepository },
  ],
  exports: [MovementsService],
})
export class MovementsModule {}
