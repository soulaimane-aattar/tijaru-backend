import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContext } from '../../common/tenant/tenant-context';

import { OrdersService } from './application/orders.service';
import {
  type CreateOrderInput,
  CreateOrderSchema,
  type ListOrdersQuery,
  ListOrdersQuerySchema,
  type TransitionInput,
  TransitionSchema,
} from './dto/orders.dto';

@ApiTags('orders')
@ApiBearerAuth()
@RequiresModule('marketplace')
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(
    private readonly svc: OrdersService,
    private readonly tenant: TenantContext,
  ) {}

  private bid(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new Error('missing tenant');
    return id;
  }

  // ─── seller side ───────────────────────────────────────────────────────────

  @Get('received')
  @RequireCap('marketplace.manage')
  received(
    @Query(new ZodValidationPipe(ListOrdersQuerySchema)) query: ListOrdersQuery,
  ): Promise<unknown> {
    return this.svc.list(this.bid(), 'seller', query);
  }

  // ─── buyer side ────────────────────────────────────────────────────────────

  @Get('received/:id')
  @RequireCap('marketplace.manage')
  receivedDetail(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(this.bid(), id);
  }

  @Post('received/:id/status')
  @RequireCap('marketplace.manage')
  transition(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransitionSchema)) body: TransitionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.transition(id, body.status, user, body.note);
  }

  // ─── buyer side ────────────────────────────────────────────────────────────

  @Get('sent')
  @RequireCap('marketplace.buy')
  sent(
    @Query(new ZodValidationPipe(ListOrdersQuerySchema)) query: ListOrdersQuery,
  ): Promise<unknown> {
    return this.svc.list(this.bid(), 'buyer', query);
  }

  @Get('sent/:id')
  @RequireCap('marketplace.buy')
  sentDetail(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(this.bid(), id);
  }

  @Post('sent/:id/cancel')
  @RequireCap('marketplace.buy')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<unknown> {
    return this.svc.transition(id, 'cancelled', user);
  }

  @Post()
  @RequireCap('marketplace.buy')
  create(
    @Body(new ZodValidationPipe(CreateOrderSchema)) body: CreateOrderInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.create(body, user);
  }

  // Detail/transition routes are split per side because CapsGuard ANDs the
  // caps it is given: a seller-only user must not need `marketplace.buy`.
}
