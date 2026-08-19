import { Module } from '@nestjs/common';

import { ExpenseCategoriesService } from './application/expense-categories.service';
import { ExpenseCategoriesRepository } from './domain/expense-categories.repository';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { PrismaExpenseCategoriesRepository } from './infrastructure/prisma-expense-categories.repository';

@Module({
  controllers: [ExpenseCategoriesController],
  providers: [
    ExpenseCategoriesService,
    { provide: ExpenseCategoriesRepository, useClass: PrismaExpenseCategoriesRepository },
  ],
  exports: [ExpenseCategoriesRepository],
})
export class ExpenseCategoriesModule {}
