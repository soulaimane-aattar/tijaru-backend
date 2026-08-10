import { Module } from '@nestjs/common';

import { DeliveryNotesService } from './application/delivery-notes.service';
import { DeliveryNotesRepository } from './domain/delivery-notes.repository';
import { DeliveryNotesController } from './delivery-notes.controller';
import { PrismaDeliveryNotesRepository } from './infrastructure/prisma-delivery-notes.repository';

@Module({
  controllers: [DeliveryNotesController],
  providers: [
    DeliveryNotesService,
    { provide: DeliveryNotesRepository, useClass: PrismaDeliveryNotesRepository },
  ],
  exports: [DeliveryNotesService],
})
export class DeliveryNotesModule {}
