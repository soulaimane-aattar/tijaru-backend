import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { PlatformAdminLoginSchema, type PlatformAdminLoginInput } from './dto/platform-admin-login.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';

@ApiTags('platform-admin')
@Controller({ version: '1' })
export class PlatformAdminController {
  constructor(private readonly svc: PlatformAdminService) {}

  @Public()
  @Post('auth/platform-admin/login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(PlatformAdminLoginSchema))
  @ApiOperation({ summary: 'Platform admin login. Returns access token.' })
  async login(@Body() body: PlatformAdminLoginInput): Promise<{ accessToken: string }> {
    return this.svc.login(body.email, body.password);
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Get('admin/platform/businesses')
  @ApiOperation({ summary: 'List businesses by status (platform admin only).' })
  async listBusinesses(@Query('status') status?: string): Promise<unknown[]> {
    return this.svc.listBusinesses(status);
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Post('admin/platform/businesses/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a pending business (platform admin only).' })
  async approve(@Param('id') id: string): Promise<{ ok: true }> {
    await this.svc.approveBusiness(id);
    return { ok: true };
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Post('admin/platform/businesses/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a pending business (platform admin only).' })
  async reject(@Param('id') id: string): Promise<{ ok: true }> {
    await this.svc.rejectBusiness(id);
    return { ok: true };
  }
}
