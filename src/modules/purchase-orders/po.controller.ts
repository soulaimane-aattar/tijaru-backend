import {
  Body,
  Controller,
  Delete,
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
import { DeliveryNotePdfService } from '../delivery-notes/application/delivery-note-pdf.service';
import { DeliveryPdfInfoLookup } from '../delivery-notes/domain/delivery-notes.repository';

import { POService } from './application/po.service';
import {
  type CreatePOInput,
  CreatePOSchema,
  type ListPOQuery,
  ListPOQuerySchema,
  type PatchPOInput,
  PatchPOSchema,
  type ReceivePOInput,
  ReceivePOSchema,
} from './dto/po.dto';

/** Shape of `POService.get()` needed for the carnet PDF (repo returns Prisma include). */
type PODetailForPdf = {
  number: string;
  date: Date;
  status: string;
  notes: string | null;
  supplier: { name: string; phone: string | null; city: string | null } | null;
  lines: Array<{ qty: number; received: number; price: unknown; product: { name: string } }>;
};

@ApiTags('purchase-orders')
@ApiBearerAuth()
@RequiresModule('purchase-orders')
@Controller({ path: 'purchase-orders', version: '1' })
export class POController {
  constructor(
    private readonly svc: POService,
    private readonly tenant: TenantContext,
    private readonly pdf: DeliveryNotePdfService,
    @Inject(DeliveryPdfInfoLookup) private readonly pdfInfo: DeliveryPdfInfoLookup,
  ) {}

  @Get()
  @RequireCap('po.manage')
  list(@Query(new ZodValidationPipe(ListPOQuerySchema)) query: ListPOQuery): Promise<unknown> {
    return this.svc.list(query);
  }

  @Get(':id')
  @RequireCap('po.manage')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(id);
  }

  @Post()
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(CreatePOSchema))
  create(@Body() body: CreatePOInput): Promise<unknown> {
    return this.svc.create(body);
  }

  @Patch(':id')
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(PatchPOSchema))
  patch(@Param('id') id: string, @Body() body: PatchPOInput): Promise<unknown> {
    return this.svc.patch(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('po.manage')
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(id);
  }

  @Get(':id/pdf')
  @RequireCap('po.manage')
  async pdfFile(@Param('id') id: string, @Res({ passthrough: false }) res: Response): Promise<void> {
    const po = (await this.svc.get(id)) as PODetailForPdf;
    const businessId = this.tenant.getBusinessId();
    const business = businessId ? await this.pdfInfo.getBusiness(businessId) : null;
    const lines = po.lines.map((l) => ({
      label: l.product.name,
      ordered: l.qty,
      sent: l.received,
      unitPrice: Number(l.price),
    }));
    const subtotal =
      Math.round(lines.reduce((s, l) => s + l.ordered * l.unitPrice, 0) * 100) / 100;
    const buf = await this.pdf.render({
      number: po.number,
      type: 'order',
      date: po.date,
      status: po.status,
      signed: false,
      notes: po.notes,
      business: business ?? { name: '', address: null, ice: null, phone: null },
      customer: null,
      supplier: po.supplier
        ? { name: po.supplier.name, phone: po.supplier.phone, address: po.supplier.city }
        : null,
      issuedBy: { fullName: business?.name ?? '' },
      lines,
      totals: { subtotal },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po.number}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  @Post(':id/receive')
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(ReceivePOSchema))
  receive(
    @Param('id') id: string,
    @Body() body: ReceivePOInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.receive(id, body, user);
  }
}
