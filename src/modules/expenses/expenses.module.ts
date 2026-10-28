import { Module } from '@nestjs/common';

import { ExpenseCategoriesModule } from '../expense-categories/expense-categories.module';

import { ExpenseReportPdfService } from './application/expense-report-pdf.service';
import { ExpensesService } from './application/expenses.service';
import { BusinessInfoLookup } from './domain/business-info.lookup';
import { ExpensesRepository } from './domain/expenses.repository';
import { OcrProvider } from './domain/ocr.provider';
import { ExpensesController } from './expenses.controller';
import { HttpOcrProvider } from './infrastructure/http-ocr.provider';
import { KyselyBusinessInfoLookup } from './infrastructure/kysely-business-info.lookup';
import { KyselyExpensesRepository } from './infrastructure/kysely-expenses.repository';

@Module({
  imports: [ExpenseCategoriesModule],
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    ExpenseReportPdfService,
    { provide: ExpensesRepository, useClass: KyselyExpensesRepository },
    { provide: OcrProvider, useClass: HttpOcrProvider },
    { provide: BusinessInfoLookup, useClass: KyselyBusinessInfoLookup },
  ],
})
export class ExpensesModule {}
