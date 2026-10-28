import { Module } from '@nestjs/common';

import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

import { ProductsService } from './application/products.service';
import { ProductsRepository } from './domain/products.repository';
import { KyselyProductsRepository } from './infrastructure/kysely-products.repository';
import { ProductsController } from './products.controller';

@Module({
  imports: [StockLedgerModule],
  controllers: [ProductsController],
  providers: [ProductsService, { provide: ProductsRepository, useClass: KyselyProductsRepository }],
  exports: [ProductsService],
})
export class ProductsModule {}
