import { Body, Controller, Get, HttpCode, Post, Req, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/guards/jwt.guard';
import { PermissionsResolver } from '../../common/permissions-resolver.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CAPABILITIES, CAPABILITY_IDS, ROLES, ROLE_IDS } from '../../domain/permissions';

import { AuthService } from './application/auth.service';
import {
  type LoginInput,
  LoginSchema,
  type RefreshInput,
  RefreshSchema,
} from './dto/login.dto';
import { type RegisterInput, RegisterSchema } from './dto/register.dto';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly permissions: PermissionsResolver,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(LoginSchema))
  @ApiOperation({ summary: 'Unified login — checks platform admin first, then business user.' })
  async login(@Body() body: LoginInput, @Req() req: Request): Promise<unknown> {
    // Try platform admin first; falls through silently on no-match/wrong-password.
    const pa = await this.auth.loginPlatformAdmin(body.email, body.password);
    if (pa) {
      return { accessToken: pa.accessToken, type: 'platform-admin' };
    }

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
  @Post('register')
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(RegisterSchema))
  @ApiOperation({ summary: 'Self-serve signup. Creates a pending Business + owner User.' })
  async register(@Body() body: RegisterInput): Promise<{ status: string }> {
    return this.auth.register(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
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
  async getPermissions(): Promise<unknown> {
    const matrix = await this.permissions.effectiveMatrix();
    return {
      roles: ROLE_IDS.map((id) => ROLES[id]),
      capabilities: CAPABILITY_IDS.map((id) => CAPABILITIES[id]),
      matrix,
    };
  }
}
