import { Module } from '@nestjs/common';


import { POService } from './application/po.service';
import { PurchaseOrdersRepository } from './domain/po.repository';
import { PrismaPurchaseOrdersRepository } from './infrastructure/prisma-po.repository';
import { POController } from './po.controller';

@Module({
  controllers: [POController],
  providers: [
    POService,
    { provide: PurchaseOrdersRepository, useClass: PrismaPurchaseOrdersRepository },
  ],
})
export class PurchaseOrdersModule {}
