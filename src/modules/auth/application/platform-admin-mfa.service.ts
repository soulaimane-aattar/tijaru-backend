import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ForbiddenError, UnauthorizedError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { seal, unseal } from '../domain/secret-box';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../domain/totp';

const MFA_TOKEN_TTL = '5m';
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const ISSUER = 'Tijaru';

export type MfaChallenge = {
  type: 'platform-admin-mfa';
  mfaToken: string;
  enrolled: boolean;
  /** Present only while enrolling: shown once so the admin can add it to an authenticator app. */
  enrollment?: { secret: string; otpauthUrl: string };
};

/**
 * Mandatory second factor for platform admins. A correct password only yields a short-lived
 * `mfaToken`; the real access token is issued by `verify` after a valid TOTP code. First login
 * enrols the authenticator, later logins just verify.
 */
@Injectable()
export class PlatformAdminMfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  // Sealed with the refresh secret: rotating it forces a re-enrolment, which is acceptable for one admin.
  private get sealKey(): string {
    return this.env.JWT_REFRESH_SECRET;
  }

  async challenge(admin: { id: string; email: string }): Promise<MfaChallenge> {
    const mfaToken = await this.jwt.signAsync(
      { sub: admin.id, type: 'platform-admin-mfa' },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: MFA_TOKEN_TTL },
    );

    const row = await this.prisma.platformAdmin.findUniqueOrThrow({
      where: { id: admin.id },
      select: { totpEnabledAt: true, totpSecret: true },
    });
    if (row.totpEnabledAt && this.readSecret(row.totpSecret)) {
      return { type: 'platform-admin-mfa', mfaToken, enrolled: true };
    }

    // Pending secret: only becomes active once a code generated from it verifies.
    const secret = generateTotpSecret();
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpSecret: seal(secret, this.sealKey), totpLastStep: null },
    });
    return {
      type: 'platform-admin-mfa',
      mfaToken,
      enrolled: false,
      enrollment: { secret, otpauthUrl: otpauthUrl(ISSUER, admin.email, secret) },
    };
  }

  async verify(mfaToken: string, code: string, now = Date.now()): Promise<{ accessToken: string; type: 'platform-admin' }> {
    const adminId = await this.adminIdFrom(mfaToken);
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    const secret = admin ? this.readSecret(admin.totpSecret) : null;
    if (!admin || !secret) throw new UnauthorizedError('Invalid or expired token');
    if (admin.mfaLockedUntil && admin.mfaLockedUntil.getTime() > now) {
      throw new ForbiddenError('Too many attempts. Try again later.');
    }

    const step = verifyTotp(secret, code, now, admin.totpLastStep);
    if (step === null) {
      const { mfaFailures } = await this.prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { mfaFailures: { increment: 1 } },
        select: { mfaFailures: true },
      });
      if (mfaFailures >= MAX_FAILURES) {
        await this.prisma.platformAdmin.update({
          where: { id: admin.id },
          data: { mfaFailures: 0, mfaLockedUntil: new Date(now + LOCK_MS) },
        });
      }
      throw new UnauthorizedError('Invalid code');
    }

    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        mfaFailures: 0,
        mfaLockedUntil: null,
        totpLastStep: step,
        totpEnabledAt: admin.totpEnabledAt ?? new Date(now),
      },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: admin.id, type: 'platform-admin', ver: admin.tokenVersion },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.PLATFORM_ADMIN_TTL },
    );
    return { accessToken, type: 'platform-admin' };
  }

  /** Null when absent or sealed with a rotated key — the admin then simply re-enrols. */
  private readSecret(sealed: string | null): string | null {
    if (!sealed) return null;
    try {
      return unseal(sealed, this.sealKey);
    } catch {
      return null;
    }
  }

  private async adminIdFrom(mfaToken: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type?: string }>(mfaToken, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
      if (payload.type === 'platform-admin-mfa') return payload.sub;
    } catch {
      // fall through
    }
    throw new UnauthorizedError('Invalid or expired token');
  }
}
