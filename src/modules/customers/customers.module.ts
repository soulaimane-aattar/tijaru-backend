import { Module } from '@nestjs/common';


import { CustomersService } from './application/customers.service';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './domain/customers.repository';
import { KyselyCustomersRepository } from './infrastructure/kysely-customers.repository';

@Module({
  controllers: [CustomersController],
  providers: [
    CustomersService,
    { provide: CustomersRepository, useClass: KyselyCustomersRepository },
  ],
})
export class CustomersModule {}
