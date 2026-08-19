import { Module } from '@nestjs/common';

import { ExpenseCategoriesModule } from '../expense-categories/expense-categories.module';

import { ExpenseReportPdfService } from './application/expense-report-pdf.service';
import { ExpensesService } from './application/expenses.service';
import { BusinessInfoLookup } from './domain/business-info.lookup';
import { ExpensesRepository } from './domain/expenses.repository';
import { OcrProvider } from './domain/ocr.provider';
import { ExpensesController } from './expenses.controller';
import { HttpOcrProvider } from './infrastructure/http-ocr.provider';
import { PrismaBusinessInfoLookup } from './infrastructure/prisma-business-info.lookup';
import { PrismaExpensesRepository } from './infrastructure/prisma-expenses.repository';

@Module({
  imports: [ExpenseCategoriesModule],
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    ExpenseReportPdfService,
    { provide: ExpensesRepository, useClass: PrismaExpensesRepository },
    { provide: OcrProvider, useClass: HttpOcrProvider },
    { provide: BusinessInfoLookup, useClass: PrismaBusinessInfoLookup },
  ],
})
export class ExpensesModule {}
