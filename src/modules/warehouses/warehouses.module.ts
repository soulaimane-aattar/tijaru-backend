import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';

import { WarehousesService } from './application/warehouses.service';
import { WarehousesController } from './warehouses.controller';

@Module({
  controllers: [WarehousesController],
  providers: [WarehousesService, PrismaService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
