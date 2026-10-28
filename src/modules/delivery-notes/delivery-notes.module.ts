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
import { KyselyDeliveryNotesRepository } from './infrastructure/kysely-delivery-notes.repository';
import { KyselyDeliveryPdfInfoLookup } from './infrastructure/kysely-delivery-pdf-info-lookup';
import { KyselyProductPriceLookup } from './infrastructure/kysely-product-price-lookup';

@Module({
  imports: [StockLedgerModule],
  controllers: [DeliveryNotesController],
  providers: [
    DeliveryNotesService,
    DeliveryNotePdfService,
    { provide: DeliveryNotesRepository, useClass: KyselyDeliveryNotesRepository },
    { provide: ProductPriceLookup, useClass: KyselyProductPriceLookup },
    { provide: DeliveryPdfInfoLookup, useClass: KyselyDeliveryPdfInfoLookup },
  ],
  exports: [DeliveryNotesService, DeliveryNotePdfService, DeliveryPdfInfoLookup],
})
export class DeliveryNotesModule {}
