import { Module } from '@nestjs/common';

import { DeliveryNotesService } from './application/delivery-notes.service';
import { DeliveryNotesRepository, ProductPriceLookup } from './domain/delivery-notes.repository';
import { DeliveryNotesController } from './delivery-notes.controller';
import { PrismaDeliveryNotesRepository } from './infrastructure/prisma-delivery-notes.repository';
import { PrismaProductPriceLookup } from './infrastructure/prisma-product-price-lookup';

@Module({
  controllers: [DeliveryNotesController],
  providers: [
    DeliveryNotesService,
    { provide: DeliveryNotesRepository, useClass: PrismaDeliveryNotesRepository },
    { provide: ProductPriceLookup, useClass: PrismaProductPriceLookup },
  ],
  exports: [DeliveryNotesService],
})
export class DeliveryNotesModule {}
