import { Module } from '@nestjs/common';


import { CustomersService } from './application/customers.service';
import { CustomersController } from './customers.controller';
import { CustomerCategoriesRepository, CustomersRepository } from './domain/customers.repository';
import {
  KyselyCustomerCategoriesRepository,
  KyselyCustomersRepository,
} from './infrastructure/kysely-customers.repository';

@Module({
  controllers: [CustomersController],
  providers: [
    CustomersService,
    { provide: CustomersRepository, useClass: KyselyCustomersRepository },
    { provide: CustomerCategoriesRepository, useClass: KyselyCustomerCategoriesRepository },
  ],
})
export class CustomersModule {}
