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
import { TenantContext } from '../../common/tenant/tenant-context';

import { EstimatesService } from './application/estimates.service';
import {
  type CreateEstimateInput,
  CreateEstimateSchema,
  type ListEstimatesQuery,
  ListEstimatesQuerySchema,
  type UpdateEstimateInput,
  UpdateEstimateSchema,
} from './dto/estimates.dto';

@ApiTags('estimates')
@ApiBearerAuth()
@RequiresModule('estimates')
@Controller({ path: 'estimates', version: '1' })
export class EstimatesController {
  constructor(
    private readonly svc: EstimatesService,
    private readonly tenant: TenantContext,
  ) {}

  private bid(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new Error('missing tenant');
    return id;
  }

  @Get()
  @RequireCap('billing.manage')
  list(
    @Query(new ZodValidationPipe(ListEstimatesQuerySchema)) query: ListEstimatesQuery,
  ): Promise<unknown> {
    return this.svc.list(this.bid(), query);
  }

  @Get(':id')
  @RequireCap('billing.manage')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(this.bid(), id);
  }

  @Post()
  @RequireCap('billing.manage')
  @UsePipes(new ZodValidationPipe(CreateEstimateSchema))
  create(@Body() body: CreateEstimateInput, @CurrentUser() user: AuthUser): Promise<unknown> {
    return this.svc.create(body, user);
  }

  @Patch(':id')
  @RequireCap('billing.manage')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEstimateSchema)) body: UpdateEstimateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.update(this.bid(), id, body, user);
  }

  @Delete(':id')
  @RequireCap('billing.manage')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(this.bid(), id);
  }
}
