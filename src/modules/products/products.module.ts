import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';

import { ProductsService } from './application/products.service';
import { ProductsController } from './products.controller';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, PrismaService],
  exports: [ProductsService],
})
export class ProductsModule {}
