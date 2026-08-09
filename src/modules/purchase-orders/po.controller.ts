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
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

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

@ApiTags('purchase-orders')
@ApiBearerAuth()
@RequiresModule('purchase-orders')
@Controller({ path: 'purchase-orders', version: '1' })
export class POController {
  constructor(private readonly svc: POService) {}

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
