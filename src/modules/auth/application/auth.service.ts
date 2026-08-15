import { randomBytes, createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { ConflictError, ForbiddenError, UnauthorizedError } from '../../../common/errors';
import { PermissionsResolver } from '../../../common/permissions-resolver.service';
import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { type CapabilityId, type RoleId } from '../../../domain/permissions';
import { AuthRepository, type AuthUserView } from '../domain/auth.repository';

type TokensResult = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

type SessionMeta = {
  ip?: string | undefined;
  userAgent?: string | undefined;
  device?: string | undefined;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly permissions: PermissionsResolver,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  /**
   * Platform-admin login. Returns null when the admin isn't found or the
   * password doesn't match, so the caller can fall through to business-user
   * login without leaking whether the email belongs to a platform admin.
   */
  async loginPlatformAdmin(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; type: 'platform-admin' } | null> {
    const admin = await this.authRepo.findPlatformAdminByEmail(email.toLowerCase());
    if (!admin) return null;
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return null;

    const accessToken = await this.jwt.signAsync(
      { sub: admin.id, type: 'platform-admin', ver: admin.tokenVersion },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL },
    );
    return { accessToken, type: 'platform-admin' };
  }

  async login(email: string, password: string, meta: SessionMeta): Promise<{
    tokens: TokensResult;
    user: { id: string; name: string; email: string; role: RoleId };
    capabilities: CapabilityId[];
  }> {
    const user = await this.authRepo.findUserByEmail(email.toLowerCase());
    if (!user || !user.active) {
      throw new UnauthorizedError('Invalid credentials');
    }

    if (user.businessStatus !== 'active') {
      const msg =
        user.businessStatus === 'pending'
          ? 'Your account is awaiting approval'
          : user.businessStatus === 'rejected'
            ? 'Your application was not approved'
            : 'Business is suspended';
      throw new ForbiddenError(msg);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const overrides = this.overridesOf(user);
    const role = user.role as RoleId;
    const roleCaps = await this.permissions.effectiveCapsForRole(role);

    const tokens = await this.issueTokens(
      { id: user.id, businessId: user.businessId, role, ver: user.tokenVersion, roleCaps, overrides },
      meta,
    );

    await this.authRepo.recordLogin(user.id);

    const effective = roleCaps
      .filter((c) => overrides[c] !== false)
      .concat(
        (Object.keys(overrides) as CapabilityId[]).filter(
          (c) => overrides[c] === true && !roleCaps.includes(c),
        ),
      );

    return {
      tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
      },
      capabilities: [...new Set(effective)],
    };
  }

  async refresh(refreshToken: string, meta: SessionMeta): Promise<TokensResult> {
    const hash = this.hashRefresh(refreshToken);
    const session = await this.authRepo.findSessionByTokenHash(hash);
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Rotate: revoke old session, issue new
    await this.authRepo.revokeSession(session.id);

    const overrides = this.overridesOf(session.user);
    const role = session.user.role as RoleId;
    const roleCaps = await this.permissions.effectiveCapsForRole(role);

    return this.issueTokens(
      {
        id: session.user.id,
        businessId: session.user.businessId,
        role,
        ver: session.user.tokenVersion,
        roleCaps,
        overrides,
      },
      meta,
    );
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const hash = this.hashRefresh(refreshToken);
    await this.authRepo.revokeSessionByTokenHash(userId, hash);
  }

  async logoutAllSessions(userId: string): Promise<void> {
    await this.authRepo.revokeAllSessions(userId);
    // bump token version → invalidate any outstanding access tokens
    await this.authRepo.bumpTokenVersion(userId);
  }

  private overridesOf(user: AuthUserView): Partial<Record<CapabilityId, boolean>> {
    const overrides: Partial<Record<CapabilityId, boolean>> = {};
    for (const o of user.overrides) {
      overrides[o.capId as CapabilityId] = o.granted;
    }
    return overrides;
  }

  private async issueTokens(
    subject: {
      id: string;
      businessId: string;
      role: RoleId;
      ver: number;
      roleCaps: CapabilityId[];
      overrides: Partial<Record<CapabilityId, boolean>>;
    },
    meta: SessionMeta,
  ): Promise<TokensResult> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: subject.id,
        bid: subject.businessId,
        role: subject.role,
        ver: subject.ver,
        caps: subject.roleCaps,
        overrides: subject.overrides,
      },
      {
        secret: this.env.JWT_ACCESS_SECRET,
        expiresIn: this.env.JWT_ACCESS_TTL,
      },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshHash = this.hashRefresh(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + this.parseTtlMs(this.env.JWT_REFRESH_TTL));

    await this.authRepo.createSession({
      userId: subject.id,
      refreshTokenHash: refreshHash,
      device: meta.device ?? null,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      expiresAt: refreshExpiresAt,
    });

    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /**
   * Current profile + effective capabilities (role caps merged with per-user
   * overrides), plus the business's active modules and subscription info.
   * `businessId` is `''` for super-admin callers — module/subscription
   * lookups are skipped in that case.
   */
  async me(
    userId: string,
    role: RoleId,
    overrides: Record<string, boolean>,
    businessId: string,
  ): Promise<unknown | null> {
    const profile = await this.authRepo.findProfile(userId);
    if (!profile) return null;
    const roleCaps = await this.permissions.effectiveCapsForRole(role);
    const effective = new Set<CapabilityId>(roleCaps);
    for (const [cap, granted] of Object.entries(overrides)) {
      if (granted) effective.add(cap as CapabilityId);
      else effective.delete(cap as CapabilityId);
    }

    if (!businessId) {
      return {
        ...profile,
        capabilities: [...effective],
        modules: [],
        subscription: null,
        enabledVatRates: [0, 7, 10, 14, 20],
        multiWarehouse: true,
      };
    }

    const [business, modules] = await Promise.all([
      this.authRepo.findBusinessById(businessId),
      this.authRepo.findBusinessModules(businessId),
    ]);

    return {
      ...profile,
      capabilities: [...effective],
      modules: modules.filter((m) => m.active).map((m) => m.moduleId),
      subscription: business ? { plan: business.plan, end: business.subscriptionEnd } : null,
      enabledVatRates: business?.enabledVatRates ?? [0, 7, 10, 14, 20],
      multiWarehouse: business?.multiWarehouse ?? true,
    };
  }

  async ensureNoConflict(email: string): Promise<void> {
    const lower = email.toLowerCase();
    if (await this.authRepo.emailInUse(lower)) {
      throw new ConflictError('Email already in use');
    }
    if (await this.authRepo.findPlatformAdminByEmail(lower)) {
      throw new ConflictError('Email already in use');
    }
  }

  /** Self-serve signup. Creates a pending Business + owner User. */
  async register(input: {
    businessName: string;
    ownerName: string;
    email: string;
    phone?: string | undefined;
    password: string;
  }): Promise<{ status: string }> {
    await this.ensureNoConflict(input.email);
    const passwordHash = await bcrypt.hash(input.password, this.env.BCRYPT_COST);
    await this.authRepo.createBusinessWithOwner({
      businessName: input.businessName,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      status: 'pending',
      ownerName: input.ownerName,
      email: input.email.toLowerCase(),
      passwordHash,
    });
    return { status: 'pending' };
  }

  private hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Parse a TTL string like "15m" / "7d" / "3600s" into milliseconds. */
  private parseTtlMs(ttl: string): number {
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl.trim());
    if (!match) throw new Error(`Invalid TTL: "${ttl}"`);
    const n = Number(match[1]);
    const unit = match[2]!;
    const mult: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return n * mult[unit]!;
  }
}
