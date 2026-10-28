import { Module } from '@nestjs/common';

import { ExpenseCategoriesService } from './application/expense-categories.service';
import { ExpenseCategoriesRepository } from './domain/expense-categories.repository';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { KyselyExpenseCategoriesRepository } from './infrastructure/kysely-expense-categories.repository';

@Module({
  controllers: [ExpenseCategoriesController],
  providers: [
    ExpenseCategoriesService,
    { provide: ExpenseCategoriesRepository, useClass: KyselyExpenseCategoriesRepository },
  ],
  exports: [ExpenseCategoriesRepository],
})
export class ExpenseCategoriesModule {}
