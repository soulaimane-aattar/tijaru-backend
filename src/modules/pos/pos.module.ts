import { Module } from '@nestjs/common';

import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { PosService } from './application/pos.service';
import { PosRepository } from './domain/pos.repository';
import { PrismaPosRepository } from './infrastructure/prisma-pos.repository';
import { PosController } from './pos.controller';

@Module({
  imports: [StockLedgerModule],
  controllers: [PosController],
  providers: [
    PosService,
    { provide: PosRepository, useClass: PrismaPosRepository },
  ],
  exports: [PosService],
})
export class PosModule {}
