import { Module } from '@nestjs/common';

import { StockLedgerService } from './application/stock-ledger.service';

@Module({
  providers: [StockLedgerService],
  exports: [StockLedgerService],
})
export class StockLedgerModule {}
