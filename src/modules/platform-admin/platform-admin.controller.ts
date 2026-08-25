import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { ExtendSubscriptionSchema, type ExtendSubscriptionInput } from './dto/extend-subscription.dto';
import { PlatformAdminLoginSchema, type PlatformAdminLoginInput } from './dto/platform-admin-login.dto';
import {
  UpdateBusinessSettingsSchema,
  type UpdateBusinessSettingsInput,
} from './dto/update-business-settings.dto';
import { UpdateBusinessSchema, type UpdateBusinessInput } from './dto/update-business.dto';
import { UpdateModulesSchema, type UpdateModulesInput } from './dto/update-modules.dto';
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
  async listBusinesses(
    @Query('status') status?: string,
    @Query('plan') plan?: string,
  ): Promise<unknown[]> {
    return this.svc.listBusinesses(status, plan);
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Get('admin/platform/users')
  @ApiOperation({ summary: 'List users across every business (platform admin only).' })
  async listUsers(
    @Query('search') search?: string,
    @Query('businessId') businessId?: string,
    @Query('role') role?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    return this.svc.listUsers({
      ...(search ? { search } : {}),
      ...(businessId ? { businessId } : {}),
      ...(role ? { role } : {}),
      page: page ? Math.max(1, parseInt(page, 10) || 1) : 1,
      pageSize: pageSize ? Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25)) : 25,
    });
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

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Get('admin/platform/stats')
  @ApiOperation({ summary: 'Dashboard aggregates (platform admin only).' })
  async stats(): Promise<unknown> {
    return this.svc.getStats();
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Get('admin/platform/audit')
  @ApiOperation({ summary: 'Recent super-admin console actions (platform admin only).' })
  async audit(): Promise<unknown[]> {
    return this.svc.listAudit(20);
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Get('admin/platform/businesses/:id')
  @ApiOperation({ summary: 'Business detail with owner and modules (platform admin only).' })
  async getBusinessDetail(@Param('id') id: string): Promise<unknown> {
    return this.svc.getBusinessDetail(id);
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Patch('admin/platform/businesses/:id')
  @UsePipes(new ZodValidationPipe(UpdateBusinessSchema))
  @ApiOperation({ summary: 'Update business limits (platform admin only).' })
  async updateBusiness(
    @Param('id') id: string,
    @Body() body: UpdateBusinessInput,
  ): Promise<unknown> {
    return this.svc.updateBusiness(id, body);
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Post('admin/platform/businesses/:id/extend')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(ExtendSubscriptionSchema))
  @ApiOperation({ summary: 'Extend a business subscription (platform admin only).' })
  async extend(
    @Param('id') id: string,
    @Body() body: ExtendSubscriptionInput,
  ): Promise<unknown> {
    return this.svc.extendSubscription(id, body.duration);
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Post('admin/platform/businesses/:id/suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend a business (platform admin only).' })
  async suspend(@Param('id') id: string): Promise<{ ok: true }> {
    await this.svc.suspendBusiness(id);
    return { ok: true };
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Post('admin/platform/businesses/:id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a business (platform admin only).' })
  async activate(@Param('id') id: string): Promise<{ ok: true }> {
    await this.svc.activateBusiness(id);
    return { ok: true };
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Post('admin/platform/users/:id/reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset a user password. Optionally provide a custom password, otherwise generates a temp one.' })
  async resetUserPassword(
    @Param('id') id: string,
    @Body() body: { password?: string },
  ): Promise<{ tempPassword: string }> {
    return this.svc.resetUserPassword(id, body?.password);
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Patch('admin/platform/businesses/:id/modules')
  @UsePipes(new ZodValidationPipe(UpdateModulesSchema))
  @ApiOperation({ summary: 'Toggle business modules on/off (platform admin only).' })
  async updateModules(
    @Param('id') id: string,
    @Body() body: UpdateModulesInput,
  ): Promise<{ ok: true }> {
    await this.svc.updateModules(id, body.modules);
    return { ok: true };
  }

  @Public()
  @UseGuards(PlatformAdminGuard)
  @Patch('admin/platform/businesses/:id/settings')
  @UsePipes(new ZodValidationPipe(UpdateBusinessSettingsSchema))
  @ApiOperation({ summary: 'Toggle multi-stock / TVA for a business (platform admin only).' })
  async updateSettings(
    @Param('id') id: string,
    @Body() body: UpdateBusinessSettingsInput,
  ): Promise<unknown> {
    return this.svc.updateSettings(id, body);
  }
}
