import { Module } from '@nestjs/common';

import { ExpenseReportPdfService } from './application/expense-report-pdf.service';
import { ExpensesService } from './application/expenses.service';
import { BusinessInfoLookup } from './domain/business-info.lookup';
import { ExpensesRepository } from './domain/expenses.repository';
import { OcrProvider } from './domain/ocr.provider';
import { ExpensesController } from './expenses.controller';
import { HttpOcrProvider } from './infrastructure/http-ocr.provider';
import { LocalStorageService } from './infrastructure/local-storage.service';
import { PrismaBusinessInfoLookup } from './infrastructure/prisma-business-info.lookup';
import { PrismaExpensesRepository } from './infrastructure/prisma-expenses.repository';

@Module({
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    ExpenseReportPdfService,
    LocalStorageService,
    { provide: ExpensesRepository, useClass: PrismaExpensesRepository },
    { provide: OcrProvider, useClass: HttpOcrProvider },
    { provide: BusinessInfoLookup, useClass: PrismaBusinessInfoLookup },
  ],
})
export class ExpensesModule {}
