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

import { DeliveryNotesService } from './application/delivery-notes.service';
import {
  type CreateDeliveryNoteInput,
  CreateDeliveryNoteSchema,
  type DeliveryNoteStatus,
  DeliveryNoteStatusSchema,
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

  @Get(':id')
  @RequireCap('po.manage')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(this.bid(), id);
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
  async sign(@Param('id') id: string): Promise<void> {
    await this.svc.sign(this.bid(), id);
  }

  @Patch(':id/status')
  @RequireCap('po.manage')
  @HttpCode(204)
  async setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeliveryNoteStatusSchema)) status: DeliveryNoteStatus,
  ): Promise<void> {
    await this.svc.setStatus(this.bid(), id, status);
  }
}
