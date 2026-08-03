import { Module } from '@nestjs/common';


import { ProductsService } from './application/products.service';
import { ProductsRepository } from './domain/products.repository';
import { PrismaProductsRepository } from './infrastructure/prisma-products.repository';
import { ProductsController } from './products.controller';

@Module({
  controllers: [ProductsController],
  providers: [
    ProductsService,
    { provide: ProductsRepository, useClass: PrismaProductsRepository },
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
