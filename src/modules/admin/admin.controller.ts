import { Body, Controller, Delete, Get, HttpCode, Param, Patch, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
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

const PatchVatRatesSchema = z.object({
  enabledVatRates: z.array(z.number().int()).min(1),
});
type PatchVatRatesInput = z.infer<typeof PatchVatRatesSchema>;

const PatchMultiWarehouseSchema = z.object({ multiWarehouse: z.boolean() });
type PatchMultiWarehouseInput = z.infer<typeof PatchMultiWarehouseSchema>;

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

  // ─── VAT rates ────────────────────────────────────────────────────────────

  @Get('vat-rates')
  @RequireCap('settings.manage')
  getVatRates(): Promise<unknown> {
    return this.settings.getVatRates();
  }

  @Patch('vat-rates')
  @RequireCap('settings.manage')
  @UsePipes(new ZodValidationPipe(PatchVatRatesSchema))
  patchVatRates(@Body() body: PatchVatRatesInput): Promise<unknown> {
    return this.settings.setVatRates(body.enabledVatRates);
  }

  // ─── Multi-warehouse toggle ───────────────────────────────────────────────

  @Get('multi-warehouse')
  @RequireCap('settings.manage')
  getMultiWarehouse(): Promise<unknown> {
    return this.settings.getMultiWarehouse();
  }

  @Patch('multi-warehouse')
  @RequireCap('settings.manage')
  @UsePipes(new ZodValidationPipe(PatchMultiWarehouseSchema))
  patchMultiWarehouse(@Body() body: PatchMultiWarehouseInput): Promise<unknown> {
    return this.settings.setMultiWarehouse(body.multiWarehouse);
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
}
