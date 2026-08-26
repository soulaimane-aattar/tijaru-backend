import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContext } from '../../common/tenant/tenant-context';

import { DeliveryNotePdfService, type PdfNote } from './application/delivery-note-pdf.service';
import { DeliveryNotesService } from './application/delivery-notes.service';
import { DeliveryPdfInfoLookup } from './domain/delivery-notes.repository';
import {
  type AddPaymentInput,
  AddPaymentSchema,
  type CreateDeliveryNoteInput,
  CreateDeliveryNoteSchema,
  type CreateReturnInput,
  CreateReturnSchema,
  SetStatusSchema,
  type SetStatusInput,
  type ListDeliveryNotesQuery,
  ListDeliveryNotesQuerySchema,
  type UpdateSentInput,
  UpdateSentSchema,
} from './dto/delivery-notes.dto';

@ApiTags('delivery-notes')
@ApiBearerAuth()
@RequiresModule('delivery-notes')
@Controller({ path: 'delivery-notes', version: '1' })
export class DeliveryNotesController {
  constructor(
    private readonly svc: DeliveryNotesService,
    private readonly tenant: TenantContext,
    private readonly pdf: DeliveryNotePdfService,
    @Inject(DeliveryPdfInfoLookup) private readonly pdfInfo: DeliveryPdfInfoLookup,
  ) {}

  private bid(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new Error('missing tenant');
    return id;
  }

  @Get()
  @RequireCap('po.manage')
  list(
    @Query(new ZodValidationPipe(ListDeliveryNotesQuerySchema)) query: ListDeliveryNotesQuery,
  ): Promise<unknown> {
    return this.svc.list(this.bid(), query);
  }

  /** Per-customer outstanding balance — declared before `:id` so it wins routing. */
  @Get('customer-debts')
  @RequireCap('po.manage')
  customerDebts(): Promise<unknown> {
    return this.svc.listCustomerDebts(this.bid());
  }

  /** Payment history across all of one customer's bons. */
  @Get('customers/:customerId/payments')
  @RequireCap('po.manage')
  customerPayments(@Param('customerId') customerId: string): Promise<unknown> {
    return this.svc.listCustomerPayments(this.bid(), customerId);
  }

  @Get(':id')
  @RequireCap('po.manage')
  async get(@Param('id') id: string): Promise<unknown> {
    const businessId = this.bid();
    const [note, biz] = await Promise.all([
      this.svc.get(businessId, id),
      this.pdfInfo.getBusiness(businessId),
    ]);
    return { ...note, businessName: biz?.name ?? null };
  }

  @Post()
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(CreateDeliveryNoteSchema))
  create(@Body() body: CreateDeliveryNoteInput, @CurrentUser() user: AuthUser): Promise<unknown> {
    return this.svc.create(body, user);
  }

  @Patch(':id/lines')
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(UpdateSentSchema))
  patchLine(@Param('id') id: string, @Body() body: UpdateSentInput): Promise<unknown> {
    return this.svc.updateLineSent(this.bid(), id, body.lineId, body.sent);
  }

  @Post(':id/sign')
  @RequireCap('po.manage')
  @HttpCode(204)
  async sign(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.svc.sign(this.bid(), id, user);
  }

  /** Record a payment (partial or full) against a delivery note. */
  @Post(':id/payments')
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(AddPaymentSchema))
  addPayment(
    @Param('id') id: string,
    @Body() body: AddPaymentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.addPayment(this.bid(), id, body, user);
  }

  @Get(':id/payments')
  @RequireCap('po.manage')
  payments(@Param('id') id: string): Promise<unknown> {
    return this.svc.listPayments(this.bid(), id);
  }

  /** Return goods against a signed BL — creates and signs a linked RT note. */
  @Post(':id/return')
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(CreateReturnSchema))
  createReturn(
    @Param('id') id: string,
    @Body() body: CreateReturnInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.createReturn(this.bid(), id, body, user);
  }

  @Patch(':id/status')
  @RequireCap('po.manage')
  @HttpCode(204)
  async setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetStatusSchema)) body: SetStatusInput,
  ): Promise<void> {
    await this.svc.setStatus(this.bid(), id, body.status);
  }

  @Get(':id/pdf')
  @RequireCap('po.manage')
  async pdfFile(
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const businessId = this.bid();
    const note = await this.svc.get(businessId, id);
    const pdfNote = await this.toPdfNote(businessId, note);
    const buf = await this.pdf.render(pdfNote);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${note.number}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  /** Merge the JSON-API note DTO with the business/party contact details the PDF letterhead needs. */
  private async toPdfNote(
    businessId: string,
    note: Awaited<ReturnType<DeliveryNotesService['get']>>,
  ): Promise<PdfNote> {
    const [business, customer, supplier] = await Promise.all([
      this.pdfInfo.getBusiness(businessId),
      note.customerId ? this.pdfInfo.getCustomer(businessId, note.customerId) : null,
      note.supplierId ? this.pdfInfo.getSupplier(businessId, note.supplierId) : null,
    ]);
    return {
      number: note.number,
      type: note.type,
      date: note.date,
      status: note.status,
      signed: note.signed,
      notes: note.notes,
      business: business ?? { name: note.number, address: null, ice: null, phone: null },
      customer,
      supplier,
      issuedBy: { fullName: note.issuedByName },
      lines: note.lines,
      totals: note.totals,
    };
  }
}
