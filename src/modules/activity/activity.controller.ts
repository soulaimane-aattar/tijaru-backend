import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { ActivityService } from './application/activity.service';
import { type ListActivityQuery, ListActivityQuerySchema } from './dto/activity.dto';

@ApiTags('activity')
@ApiBearerAuth()
@Controller({ path: 'activity', version: '1' })
export class ActivityController {
  constructor(private readonly svc: ActivityService) {}

  @Get()
  @RequireCap('activity.view')
  list(
    @Query(new ZodValidationPipe(ListActivityQuerySchema)) query: ListActivityQuery,
  ): Promise<unknown> {
    return this.svc.list(query);
  }
}
