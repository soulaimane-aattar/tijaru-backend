import { Module } from '@nestjs/common';


import { WarehousesService } from './application/warehouses.service';
import { WarehousesRepository } from './domain/warehouses.repository';
import { PrismaWarehousesRepository } from './infrastructure/prisma-warehouses.repository';
import { WarehousesController } from './warehouses.controller';

@Module({
  controllers: [WarehousesController],
  providers: [
    WarehousesService,
    { provide: WarehousesRepository, useClass: PrismaWarehousesRepository },
  ],
  exports: [WarehousesService],
})
export class WarehousesModule {}
