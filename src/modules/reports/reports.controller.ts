import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { ReportsService } from './application/reports.service';
import { type DaysQuery, DaysQuerySchema } from './dto/report.dto';

@ApiTags('reports')
@ApiBearerAuth()
@RequiresModule('reports')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('low-stock')
  @RequireCap('reports.view')
  lowStock(): Promise<unknown> {
    return this.svc.lowStock();
  }

  @Get('out-of-stock')
  @RequireCap('reports.view')
  outOfStock(): Promise<unknown> {
    return this.svc.outOfStock();
  }

  @Get('expiring')
  @RequireCap('reports.view')
  expiring(@Query(new ZodValidationPipe(DaysQuerySchema)) query: DaysQuery): Promise<unknown> {
    return this.svc.expiring(query);
  }

  @Get('value')
  @RequireCap('reports.view')
  value(): Promise<unknown> {
    return this.svc.value();
  }

  @Get('top')
  @RequireCap('reports.view')
  top(@Query(new ZodValidationPipe(DaysQuerySchema)) query: DaysQuery): Promise<unknown> {
    return this.svc.top(query);
  }
}
