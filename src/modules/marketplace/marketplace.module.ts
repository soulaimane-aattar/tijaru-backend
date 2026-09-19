import { Module } from '@nestjs/common';

import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { MarketplaceService } from './application/marketplace.service';
import { OrdersService } from './application/orders.service';
import { MarketplaceRepository } from './domain/marketplace.repository';
import { OrdersRepository } from './domain/orders.repository';
import { PrismaMarketplaceRepository } from './infrastructure/prisma-marketplace.repository';
import { PrismaOrdersRepository } from './infrastructure/prisma-orders.repository';
import { MarketplaceController } from './marketplace.controller';
import { OrdersController } from './orders.controller';

@Module({
  imports: [StockLedgerModule],
  controllers: [MarketplaceController, OrdersController],
  providers: [
    MarketplaceService,
    OrdersService,
    { provide: MarketplaceRepository, useClass: PrismaMarketplaceRepository },
    { provide: OrdersRepository, useClass: PrismaOrdersRepository },
  ],
  exports: [MarketplaceService, OrdersService],
})
export class MarketplaceModule {}
