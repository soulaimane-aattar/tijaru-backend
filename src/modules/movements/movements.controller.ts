import { Body, Controller, Get, Post, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { MovementsService } from './application/movements.service';
import {
  type CreateMovementInput,
  CreateMovementSchema,
  type ListMovementsQuery,
  ListMovementsQuerySchema,
} from './dto/movement.dto';

@ApiTags('movements')
@ApiBearerAuth()
@RequiresModule('stock')
@Controller({ path: 'movements', version: '1' })
export class MovementsController {
  constructor(private readonly movements: MovementsService) {}

  @Get()
  @RequireCap('products.view')
  list(
    @Query(new ZodValidationPipe(ListMovementsQuerySchema)) query: ListMovementsQuery,
  ): Promise<unknown> {
    return this.movements.list(query);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateMovementSchema))
  record(@Body() body: CreateMovementInput, @CurrentUser() user: AuthUser): Promise<unknown> {
    // Per-type capability is enforced inside the service so the right cap id is reported.
    return this.movements.record(body, user);
  }
}
