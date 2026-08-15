import { Module } from '@nestjs/common';

import { DeliveryNotesModule } from '../delivery-notes/delivery-notes.module';
import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { POService } from './application/po.service';
import { PurchaseOrdersRepository } from './domain/po.repository';
import { PrismaPurchaseOrdersRepository } from './infrastructure/prisma-po.repository';
import { POController } from './po.controller';

@Module({
  imports: [StockLedgerModule, DeliveryNotesModule],
  controllers: [POController],
  providers: [
    POService,
    { provide: PurchaseOrdersRepository, useClass: PrismaPurchaseOrdersRepository },
  ],
})
export class PurchaseOrdersModule {}
