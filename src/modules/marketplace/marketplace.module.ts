import { Module } from '@nestjs/common';

import { IntegrationsModule } from '../integrations/integrations.module';
import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { MarketplaceService } from './application/marketplace.service';
import { OrdersService } from './application/orders.service';
import { MarketplaceRepository } from './domain/marketplace.repository';
import { OrdersRepository } from './domain/orders.repository';
import { KyselyMarketplaceRepository } from './infrastructure/kysely-marketplace.repository';
import { KyselyOrdersRepository } from './infrastructure/kysely-orders.repository';
import { MarketplaceController } from './marketplace.controller';
import { OrdersController } from './orders.controller';

@Module({
  imports: [StockLedgerModule, IntegrationsModule],
  controllers: [MarketplaceController, OrdersController],
  providers: [
    MarketplaceService,
    OrdersService,
    { provide: MarketplaceRepository, useClass: KyselyMarketplaceRepository },
    { provide: OrdersRepository, useClass: KyselyOrdersRepository },
  ],
  exports: [MarketplaceService, OrdersService],
})
export class MarketplaceModule {}
