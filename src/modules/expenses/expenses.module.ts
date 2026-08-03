import { Module } from '@nestjs/common';

import { ExpensesService } from './application/expenses.service';
import { ExpensesRepository } from './domain/expenses.repository';
import { OcrProvider } from './domain/ocr.provider';
import { ExpensesController } from './expenses.controller';
import { HttpOcrProvider } from './infrastructure/http-ocr.provider';
import { LocalStorageService } from './infrastructure/local-storage.service';
import { PrismaExpensesRepository } from './infrastructure/prisma-expenses.repository';

@Module({
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    LocalStorageService,
    { provide: ExpensesRepository, useClass: PrismaExpensesRepository },
    { provide: OcrProvider, useClass: HttpOcrProvider },
  ],
})
export class ExpensesModule {}
