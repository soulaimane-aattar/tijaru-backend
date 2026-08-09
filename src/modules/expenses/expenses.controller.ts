import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ValidationError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContext } from '../../common/tenant/tenant-context';

import { ExpensesService } from './application/expenses.service';
import {
  type CreateExpenseInput,
  CreateExpenseSchema,
  type ListExpensesQuery,
  ListExpensesSchema,
  type UpdateExpenseInput,
  UpdateExpenseSchema,
} from './dto/expense.dto';

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
};

@ApiTags('expenses')
@ApiBearerAuth()
@RequiresModule('expenses')
@Controller({ path: 'expenses', version: '1' })
export class ExpensesController {
  constructor(
    private readonly svc: ExpensesService,
    private readonly tenant: TenantContext,
  ) {}

  @Get()
  @RequireCap('expenses.view')
  list(
    @Query(new ZodValidationPipe(ListExpensesSchema)) query: ListExpensesQuery,
  ): Promise<unknown> {
    return this.svc.list(query);
  }

  // Declared before ':id' so "summary" is not swallowed by the param route.
  @Get('summary')
  @RequireCap('expenses.view')
  summary(
    @Query(new ZodValidationPipe(ListExpensesSchema)) query: ListExpensesQuery,
  ): Promise<unknown> {
    return this.svc.summary(query);
  }

  /**
   * Upload a receipt photo and get back suggested field values.
   *
   * Returns a draft only — no Expense row is created. The user confirms the
   * numbers in the form and saves from there.
   */
  @Post('scan')
  @RequireCap('expenses.create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  scan(@UploadedFile() file: Express.Multer.File | undefined): Promise<unknown> {
    if (!file) throw new ValidationError('file is required');
    const businessId = this.tenant.getBusinessId();
    if (!businessId) throw new ValidationError('missing tenant context');
    return this.svc.scan(file.buffer, businessId);
  }

  @Get(':id')
  @RequireCap('expenses.view')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(id);
  }

  /**
   * Receipts are served here rather than by static middleware: a static mount
   * would make every tenant's receipts readable to anyone holding a URL, and
   * receipts carry supplier names and amounts.
   */
  @Get(':id/receipt')
  @RequireCap('expenses.view')
  async receipt(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, ext } = await this.svc.readReceipt(id);
    res.setHeader('content-type', MIME_BY_EXT[ext] ?? 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(buffer);
  }

  @Post()
  @RequireCap('expenses.create')
  create(
    @Body(new ZodValidationPipe(CreateExpenseSchema)) body: CreateExpenseInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.create(body, user.id);
  }

  @Patch(':id')
  @RequireCap('expenses.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateExpenseSchema)) body: UpdateExpenseInput,
  ): Promise<unknown> {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('expenses.delete')
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(id);
  }
}
