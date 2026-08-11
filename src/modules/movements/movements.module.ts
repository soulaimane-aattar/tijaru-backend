import { Module } from '@nestjs/common';

import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { MovementsService } from './application/movements.service';
import { MovementsRepository } from './domain/movements.repository';
import { PrismaMovementsRepository } from './infrastructure/prisma-movements.repository';
import { MovementsController } from './movements.controller';

@Module({
  imports: [StockLedgerModule],
  controllers: [MovementsController],
  providers: [
    MovementsService,
    { provide: MovementsRepository, useClass: PrismaMovementsRepository },
  ],
  exports: [MovementsService],
})
export class MovementsModule {}
