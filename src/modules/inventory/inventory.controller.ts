import { Body, Controller, Get, Param, Post, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { InventoryService } from './application/inventory.service';
import {
  type ApplyCountInput,
  ApplyCountSchema,
  type StartCountInput,
  StartCountSchema,
} from './dto/inventory.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@RequiresModule('inventory')
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get()
  @RequireCap('inventory.count')
  list(): Promise<unknown> {
    return this.svc.list();
  }

  @Get(':id')
  @RequireCap('inventory.count')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(id);
  }

  @Post()
  @RequireCap('inventory.count')
  @UsePipes(new ZodValidationPipe(StartCountSchema))
  start(@Body() body: StartCountInput): Promise<unknown> {
    return this.svc.start(body);
  }

  @Post(':id/apply')
  @RequireCap('inventory.count')
  @UsePipes(new ZodValidationPipe(ApplyCountSchema))
  apply(
    @Param('id') id: string,
    @Body() body: ApplyCountInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.apply(id, body, user);
  }
}
