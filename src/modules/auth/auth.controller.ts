import { Body, Controller, Get, HttpCode, Inject, Post, Req, UsePipes } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/guards/jwt.guard';
import { MailService } from '../../common/mail/mail.service';
import { registrationReceived } from '../../common/mail/mail.templates';
import { PermissionsResolver } from '../../common/permissions-resolver.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CAPABILITIES, CAPABILITY_IDS, ROLES, ROLE_IDS } from '../../domain/permissions';

import { AuthService } from './application/auth.service';
import { PlatformAdminMfaService } from './application/platform-admin-mfa.service';
import { type ChangePasswordInput, ChangePasswordSchema } from './dto/change-password.dto';
import {
  type LoginInput,
  LoginSchema,
  type RefreshInput,
  RefreshSchema,
} from './dto/login.dto';
import { type PlatformAdminMfaInput, PlatformAdminMfaSchema } from './dto/platform-admin-mfa.dto';
import { type RegisterInput, RegisterSchema } from './dto/register.dto';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: PlatformAdminMfaService,
    private readonly mail: MailService,
    private readonly permissions: PermissionsResolver,
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(LoginSchema))
  @ApiOperation({ summary: 'Unified login — checks platform admin first, then business user.' })
  async login(@Body() body: LoginInput, @Req() req: Request): Promise<unknown> {
    // Try platform admin first; falls through silently on no-match/wrong-password.
    const pa = await this.auth.loginPlatformAdmin(body.email, body.password);
    if (pa) return this.mfa.challenge(pa);

    // Fall through to business user login
    const result = await this.auth.login(body.email, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      device: req.headers['user-agent'],
    });
    return {
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      refreshExpiresAt: result.tokens.refreshExpiresAt,
      user: result.user,
      capabilities: result.capabilities,
      type: 'user',
    };
  }

  @Public()
  @Post('platform-admin/mfa')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(PlatformAdminMfaSchema))
  @ApiOperation({ summary: 'Second factor for platform admins: exchange mfaToken + TOTP code for the access token.' })
  platformAdminMfa(@Body() body: PlatformAdminMfaInput): Promise<unknown> {
    return this.mfa.verify(body.mfaToken, body.code);
  }

  @Public()
  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(RegisterSchema))
  @ApiOperation({ summary: 'Self-serve signup. Creates a pending Business + owner User.' })
  async register(@Body() body: RegisterInput): Promise<{ status: string }> {
    const result = await this.auth.register(body);
    void this.mail.send(
      body.email,
      registrationReceived({ ownerName: body.ownerName, businessName: body.businessName }),
    );
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(RefreshSchema))
  @ApiOperation({ summary: 'Rotate refresh token, issue new access + refresh.' })
  async refresh(@Body() body: RefreshInput, @Req() req: Request): Promise<unknown> {
    const tokens = await this.auth.refresh(body.refreshToken, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      device: req.headers['user-agent'],
    });
    return tokens;
  }

  @Post('logout')
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(RefreshSchema))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the supplied refresh token (current device).' })
  async logout(@Body() body: RefreshInput, @CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user.id, body.refreshToken);
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Self-service password change for the logged-in user.' })
  async changePassword(
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordInput,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user profile + capabilities + modules + subscription.' })
  me(@CurrentUser() user: AuthUser): Promise<unknown> {
    return this.auth.me(user.id, user.role, user.overrides, user.businessId);
  }

  @Public()
  @Get('permissions')
  @ApiOperation({
    summary: 'Live role × capability matrix (defaults + role customizations). Clients cache this.',
  })
  async getPermissions(@Req() req: Request): Promise<unknown> {
    // Public, but a valid bearer scopes the matrix to the caller's tenant; without one: role defaults only.
    let businessId: string | undefined;
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (token) {
      try {
        businessId = (await this.jwt.verifyAsync<{ bid?: string }>(token, { secret: this.env.JWT_ACCESS_SECRET })).bid;
      } catch {
        /* invalid token → defaults */
      }
    }
    const matrix = await this.permissions.effectiveMatrix(businessId);
    return {
      roles: ROLE_IDS.map((id) => ROLES[id]),
      capabilities: CAPABILITY_IDS.map((id) => CAPABILITIES[id]),
      matrix,
    };
  }
}
