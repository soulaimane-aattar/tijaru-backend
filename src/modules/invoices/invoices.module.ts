import { Module } from '@nestjs/common';

import { InvoicesService } from './application/invoices.service';
import { InvoicesRepository } from './domain/invoices.repository';
import { KyselyInvoicesRepository } from './infrastructure/kysely-invoices.repository';
import { InvoicesController } from './invoices.controller';

@Module({
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    { provide: InvoicesRepository, useClass: KyselyInvoicesRepository },
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
