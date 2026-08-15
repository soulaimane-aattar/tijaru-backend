import { Module } from '@nestjs/common';

import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { DeliveryNotePdfService } from './application/delivery-note-pdf.service';
import { DeliveryNotesService } from './application/delivery-notes.service';
import { DeliveryNotesController } from './delivery-notes.controller';
import {
  DeliveryNotesRepository,
  DeliveryPdfInfoLookup,
  ProductPriceLookup,
} from './domain/delivery-notes.repository';
import { PrismaDeliveryNotesRepository } from './infrastructure/prisma-delivery-notes.repository';
import { PrismaDeliveryPdfInfoLookup } from './infrastructure/prisma-delivery-pdf-info-lookup';
import { PrismaProductPriceLookup } from './infrastructure/prisma-product-price-lookup';

@Module({
  imports: [StockLedgerModule],
  controllers: [DeliveryNotesController],
  providers: [
    DeliveryNotesService,
    DeliveryNotePdfService,
    { provide: DeliveryNotesRepository, useClass: PrismaDeliveryNotesRepository },
    { provide: ProductPriceLookup, useClass: PrismaProductPriceLookup },
    { provide: DeliveryPdfInfoLookup, useClass: PrismaDeliveryPdfInfoLookup },
  ],
  exports: [DeliveryNotesService, DeliveryNotePdfService, DeliveryPdfInfoLookup],
})
export class DeliveryNotesModule {}
