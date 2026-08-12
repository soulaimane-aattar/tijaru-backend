import { Module } from '@nestjs/common';

import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { InventoryService } from './application/inventory.service';
import { InventoryRepository } from './domain/inventory.repository';
import { PrismaInventoryRepository } from './infrastructure/prisma-inventory.repository';
import { InventoryController } from './inventory.controller';

@Module({
  imports: [StockLedgerModule],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    { provide: InventoryRepository, useClass: PrismaInventoryRepository },
  ],
})
export class InventoryModule {}
