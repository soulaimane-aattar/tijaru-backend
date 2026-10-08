import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ValidationError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContext } from '../../common/tenant/tenant-context';

import { BugReportsService } from './application/bug-reports.service';
import { type CreateBugReportInput, CreateBugReportSchema } from './dto/bug-report.dto';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

@ApiTags('bug-reports')
@ApiBearerAuth()
@Controller({ path: 'bug-reports', version: '1' })
export class BugReportsController {
  constructor(
    private readonly svc: BugReportsService,
    private readonly tenant: TenantContext,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SCREENSHOT_BYTES } }))
  create(
    @Body(new ZodValidationPipe(CreateBugReportSchema)) body: CreateBugReportInput,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const businessId = this.tenant.getBusinessId();
    if (!businessId) throw new ValidationError('missing tenant context');
    return this.svc.create(body, file?.buffer, businessId, user.id);
  }

  @Get()
  @RequireCap('dashboard.view')
  list() {
    const businessId = this.tenant.getBusinessId();
    if (!businessId) throw new ValidationError('missing tenant context');
    return this.svc.list(businessId);
  }
}
