import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContext } from '../../common/tenant/tenant-context';

import { InvoicesService } from './application/invoices.service';
import {
  type CreateInvoiceInput,
  CreateInvoiceSchema,
  type InvoiceStatus,
  InvoiceStatusSchema,
  type ListInvoicesQuery,
  ListInvoicesQuerySchema,
  type RecordPaymentInput,
  RecordPaymentSchema,
} from './dto/invoices.dto';

@ApiTags('invoices')
@ApiBearerAuth()
@RequiresModule('invoices')
@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(
    private readonly svc: InvoicesService,
    private readonly tenant: TenantContext,
  ) {}

  private bid(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new Error('missing tenant');
    return id;
  }

  @Get()
  @RequireCap('billing.manage')
  list(
    @Query(new ZodValidationPipe(ListInvoicesQuerySchema)) query: ListInvoicesQuery,
  ): Promise<unknown> {
    return this.svc.list(this.bid(), query);
  }

  @Get(':id')
  @RequireCap('billing.manage')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(this.bid(), id);
  }

  @Post()
  @RequireCap('billing.manage')
  @UsePipes(new ZodValidationPipe(CreateInvoiceSchema))
  create(@Body() body: CreateInvoiceInput, @CurrentUser() user: AuthUser): Promise<unknown> {
    return this.svc.create(body, user);
  }

  @Post(':id/payments')
  @RequireCap('billing.manage')
  @UsePipes(new ZodValidationPipe(RecordPaymentSchema))
  pay(@Param('id') id: string, @Body() body: RecordPaymentInput): Promise<unknown> {
    return this.svc.recordPayment(this.bid(), id, body);
  }

  @Patch(':id/status')
  @RequireCap('billing.manage')
  @HttpCode(204)
  async setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(InvoiceStatusSchema)) status: InvoiceStatus,
  ): Promise<void> {
    await this.svc.setStatus(this.bid(), id, status);
  }

  @Post(':id/cancel')
  @RequireCap('billing.manage')
  @HttpCode(204)
  async cancel(@Param('id') id: string): Promise<void> {
    await this.svc.cancel(this.bid(), id);
  }
}
