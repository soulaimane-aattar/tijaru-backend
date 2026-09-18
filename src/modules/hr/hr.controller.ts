import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { HrService } from './application/hr.service';
import {
  checkInSchema,
  checkOutSchema,
  historyQuerySchema,
  type CheckInInput,
  type CheckOutInput,
  type HistoryQuery,
} from './dto/hr.dto';

@ApiTags('hr')
@ApiBearerAuth()
@RequiresModule('hr')
@Controller({ path: 'hr', version: '1' })
export class HrController {
  constructor(private readonly service: HrService) {}

  @Post('check-in')
  @RequireCap('hr.view')
  checkIn(
    @Body(new ZodValidationPipe(checkInSchema)) body: CheckInInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.checkIn(body, user);
  }

  @Post('check-out')
  @RequireCap('hr.view')
  checkOut(
    @Body(new ZodValidationPipe(checkOutSchema)) body: CheckOutInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.checkOut(body, user);
  }

  @Post('pause')
  @RequireCap('hr.view')
  togglePause(@CurrentUser() user: AuthUser) {
    return this.service.togglePause(user);
  }

  @Get('attendance/today')
  @RequireCap('hr.view')
  today(@CurrentUser() user: AuthUser) {
    return this.service.today(user);
  }

  @Get('attendance/history')
  @RequireCap('hr.view')
  history(
    @Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.history(query, user);
  }

  @Get('attendance/team')
  @RequireCap('hr.manage')
  team(@Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQuery) {
    return this.service.team(query);
  }
}
