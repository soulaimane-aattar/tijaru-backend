import { Module } from '@nestjs/common';


import { WarehousesService } from './application/warehouses.service';
import { WarehousesRepository } from './domain/warehouses.repository';
import { KyselyWarehousesRepository } from './infrastructure/kysely-warehouses.repository';
import { WarehousesController } from './warehouses.controller';

@Module({
  controllers: [WarehousesController],
  providers: [
    WarehousesService,
    { provide: WarehousesRepository, useClass: KyselyWarehousesRepository },
  ],
  exports: [WarehousesService],
})
export class WarehousesModule {}
