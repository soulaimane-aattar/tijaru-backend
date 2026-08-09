import { Body, Controller, Get, Param, Post, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { PosService } from './application/pos.service';
import {
  type CreateTicketInput,
  CreateTicketSchema,
  type OpenSessionInput,
  OpenSessionSchema,
  type PaymentInput,
  PaymentSchema,
} from './dto/pos.dto';

@ApiTags('pos')
@ApiBearerAuth()
@RequiresModule('pos')
@Controller({ path: 'pos', version: '1' })
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('sessions/current')
  @RequireCap('stock.out')
  current(): Promise<unknown> {
    return this.pos.currentSession();
  }

  @Post('sessions')
  @RequireCap('stock.out')
  @UsePipes(new ZodValidationPipe(OpenSessionSchema))
  open(@Body() body: OpenSessionInput): Promise<unknown> {
    return this.pos.openSession(body);
  }

  @Post('tickets')
  @RequireCap('stock.out')
  @UsePipes(new ZodValidationPipe(CreateTicketSchema))
  checkout(@Body() body: CreateTicketInput, @CurrentUser() user: AuthUser): Promise<unknown> {
    return this.pos.checkout(body, user);
  }

  @Get('tickets/:id')
  @RequireCap('stock.out')
  receipt(@Param('id') id: string): Promise<unknown> {
    return this.pos.receipt(id);
  }

  @Post('tickets/:id/park')
  @RequireCap('stock.out')
  park(@Param('id') id: string): Promise<unknown> {
    return this.pos.park(id);
  }

  @Post('tickets/:id/resume')
  @RequireCap('stock.out')
  @UsePipes(new ZodValidationPipe(PaymentSchema))
  resume(
    @Param('id') id: string,
    @Body() payment: PaymentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.pos.resume(id, payment, user);
  }
}
