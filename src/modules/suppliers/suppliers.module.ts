import { Module } from '@nestjs/common';


import { SuppliersService } from './application/suppliers.service';
import { SuppliersRepository } from './domain/suppliers.repository';
import { KyselySuppliersRepository } from './infrastructure/kysely-suppliers.repository';
import { SuppliersController } from './suppliers.controller';

@Module({
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    { provide: SuppliersRepository, useClass: KyselySuppliersRepository },
  ],
})
export class SuppliersModule {}
