import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ValidationError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { AdminPolicyService } from './application/admin-policy.service';
import { AdminRolesService } from './application/admin-roles.service';
import { AdminSessionsService } from './application/admin-sessions.service';
import { BusinessSettingsService } from './application/business-settings.service';
import {
  type PatchOverridesInput,
  PatchOverridesSchema,
  type PatchRoleInput,
  PatchRoleSchema,
  type PatchSecurityPolicyInput,
  PatchSecurityPolicySchema,
} from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly roles: AdminRolesService,
    private readonly sessions: AdminSessionsService,
    private readonly policy: AdminPolicyService,
    private readonly settings: BusinessSettingsService,
  ) {}

  // ─── VAT rates / multi-stock (read-only; toggled by platform admin) ──────

  @Get('vat-rates')
  @RequireCap('settings.manage')
  getVatRates(): Promise<unknown> {
    return this.settings.getVatRates();
  }

  @Get('multi-warehouse')
  @RequireCap('settings.manage')
  getMultiWarehouse(): Promise<unknown> {
    return this.settings.getMultiWarehouse();
  }

  // ─── Roles ───────────────────────────────────────────────────────────────

  @Get('roles')
  @RequireCap('users.manage')
  listRoles(): Promise<unknown> {
    return this.roles.listRoles();
  }

  @Patch('roles/:roleId')
  @RequireCap('users.manage')
  @UsePipes(new ZodValidationPipe(PatchRoleSchema))
  patchRole(@Param('roleId') roleId: string, @Body() body: PatchRoleInput): Promise<unknown> {
    return this.roles.patchRole(roleId, body);
  }

  // ─── User overrides ───────────────────────────────────────────────────────

  @Get('users/:id/overrides')
  @RequireCap('users.manage')
  getOverrides(@Param('id') id: string): Promise<unknown> {
    return this.roles.getOverrides(id);
  }

  @Patch('users/:id/overrides')
  @RequireCap('users.manage')
  @UsePipes(new ZodValidationPipe(PatchOverridesSchema))
  patchOverrides(
    @Param('id') id: string,
    @Body() body: PatchOverridesInput,
  ): Promise<unknown> {
    return this.roles.patchOverrides(id, body);
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  @Get('sessions')
  @RequireCap('users.manage')
  listSessions(): Promise<unknown> {
    return this.sessions.list();
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @RequireCap('users.manage')
  async revokeSession(@Param('id') id: string): Promise<void> {
    await this.sessions.revoke(id);
  }

  @Delete('sessions')
  @RequireCap('users.manage')
  revokeAll(): Promise<unknown> {
    return this.sessions.revokeAll();
  }

  // ─── Security policy ──────────────────────────────────────────────────────

  @Get('security-policy')
  @RequireCap('settings.manage')
  getPolicy(): Promise<unknown> {
    return this.policy.get();
  }

  @Patch('security-policy')
  @RequireCap('settings.manage')
  @UsePipes(new ZodValidationPipe(PatchSecurityPolicySchema))
  patchPolicy(@Body() body: PatchSecurityPolicyInput): Promise<unknown> {
    return this.policy.patch(body);
  }

  // ─── Business logo ────────────────────────────────────────────────────────

  private static readonly MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    webp: 'image/webp',
    jpg: 'image/jpeg',
  };

  @Get('logo')
  @RequireCap('settings.manage')
  async getLogo(@Res() res: Response): Promise<void> {
    const { buffer, ext } = await this.settings.readLogo();
    res.setHeader('content-type', AdminController.MIME_BY_EXT[ext] ?? 'image/png');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(buffer);
  }

  @Post('logo')
  @RequireCap('settings.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(@UploadedFile() file: Express.Multer.File | undefined): Promise<unknown> {
    if (!file) throw new ValidationError('file is required');
    return this.settings.uploadLogo(file.buffer);
  }

  @Delete('logo')
  @HttpCode(204)
  @RequireCap('settings.manage')
  async removeLogo(): Promise<void> {
    await this.settings.removeLogo();
  }
}
