import { Module } from '@nestjs/common';


import { CustomersService } from './application/customers.service';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './domain/customers.repository';
import { PrismaCustomersRepository } from './infrastructure/prisma-customers.repository';

@Module({
  controllers: [CustomersController],
  providers: [
    CustomersService,
    { provide: CustomersRepository, useClass: PrismaCustomersRepository },
  ],
})
export class CustomersModule {}
