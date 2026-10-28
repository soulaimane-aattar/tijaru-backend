import { Module } from '@nestjs/common';

import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { InventoryService } from './application/inventory.service';
import { InventoryRepository } from './domain/inventory.repository';
import { KyselyInventoryRepository } from './infrastructure/kysely-inventory.repository';
import { InventoryController } from './inventory.controller';

@Module({
  imports: [StockLedgerModule],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    { provide: InventoryRepository, useClass: KyselyInventoryRepository },
  ],
})
export class InventoryModule {}
