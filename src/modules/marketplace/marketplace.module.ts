import { Module } from '@nestjs/common';

import { MarketplaceService } from './application/marketplace.service';
import { MarketplaceRepository } from './domain/marketplace.repository';
import { PrismaMarketplaceRepository } from './infrastructure/prisma-marketplace.repository';
import { MarketplaceController } from './marketplace.controller';

@Module({
  controllers: [MarketplaceController],
  providers: [
    MarketplaceService,
    { provide: MarketplaceRepository, useClass: PrismaMarketplaceRepository },
  ],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
