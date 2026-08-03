import { Module } from '@nestjs/common';


import { SuppliersService } from './application/suppliers.service';
import { SuppliersRepository } from './domain/suppliers.repository';
import { PrismaSuppliersRepository } from './infrastructure/prisma-suppliers.repository';
import { SuppliersController } from './suppliers.controller';

@Module({
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    { provide: SuppliersRepository, useClass: PrismaSuppliersRepository },
  ],
})
export class SuppliersModule {}
