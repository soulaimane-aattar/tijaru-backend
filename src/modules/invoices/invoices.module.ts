import { Module } from '@nestjs/common';

import { InvoicesService } from './application/invoices.service';
import { InvoicesRepository } from './domain/invoices.repository';
import { PrismaInvoicesRepository } from './infrastructure/prisma-invoices.repository';
import { InvoicesController } from './invoices.controller';

@Module({
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    { provide: InvoicesRepository, useClass: PrismaInvoicesRepository },
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
