import { ForbiddenError, UnauthorizedError } from '../../../common/errors';
import { fakeDb } from '../../../common/testing/db-fake';
import { seal } from '../domain/secret-box';
import { base32Decode, generateTotpSecret, hotp, totpStep } from '../domain/totp';

import { PlatformAdminMfaService } from './platform-admin-mfa.service';

const env = { JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'r'.repeat(32), JWT_ACCESS_TTL: '15m', PLATFORM_ADMIN_TTL: '1h' } as never;
const NOW = 1_800_000_000_000;

function setup(admin: Record<string, unknown>) {
  const row = { id: 'pa1', email: 'a@t.com', tokenVersion: 3, totpLastStep: null, mfaFailures: 0, mfaLockedUntil: null, ...admin };
  const { db, calls } = fakeDb({
    'select:platform_admins': row,
    'update:platform_admins': { mfaFailures: (row.mfaFailures as number) + 1 },
  });
  const updates = () => calls.filter((c) => c.op === 'update').map((c) => c.set as Record<string, unknown>);
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed'),
    verifyAsync: jest.fn().mockResolvedValue({ sub: 'pa1', type: 'platform-admin-mfa' }),
  };
  return { updates, jwt, svc: new PlatformAdminMfaService(db, jwt as never, env) };
}

describe('PlatformAdminMfaService', () => {
  it('first login: stores a pending secret and returns it for enrolment', async () => {
    const { updates, svc } = setup({ totpEnabledAt: null });
    const res = await svc.challenge({ id: 'pa1', email: 'a@t.com' });
    expect(res).toMatchObject({ enrolled: false, mfaToken: 'signed' });
    expect(res.enrollment?.otpauthUrl).toContain(res.enrollment!.secret);
    expect(updates()[0]!.totpSecret).not.toContain(res.enrollment!.secret);
  });

  it('later logins: asks for a code without exposing the secret', async () => {
    const { svc } = setup({ totpSecret: seal(generateTotpSecret(), 'r'.repeat(32)), totpEnabledAt: new Date() });
    expect(await svc.challenge({ id: 'pa1', email: 'a@t.com' })).toEqual({
      type: 'platform-admin-mfa',
      mfaToken: 'signed',
      enrolled: true,
    });
  });

  it('valid code issues the access token, activates MFA and records the step', async () => {
    const secret = generateTotpSecret();
    const { updates, jwt, svc } = setup({ totpSecret: seal(secret, 'r'.repeat(32)), totpEnabledAt: null });
    const code = hotp(base32Decode(secret), totpStep(NOW));
    const res = await svc.verify('mfa-token', code, NOW);
    expect(res).toEqual({ accessToken: 'signed', type: 'platform-admin' });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: 'pa1', type: 'platform-admin', ver: 3 },
      expect.objectContaining({ expiresIn: '1h' }),
    );
    expect(updates()[0]).toMatchObject({
      totpLastStep: totpStep(NOW),
      totpEnabledAt: new Date(NOW),
      mfaFailures: 0,
    });
  });

  it('wrong code is rejected, and the 5th failure locks the account', async () => {
    const secret = generateTotpSecret();
    const { updates, svc } = setup({ totpSecret: seal(secret, 'r'.repeat(32)), totpEnabledAt: new Date(), mfaFailures: 4 });
    await expect(svc.verify('mfa-token', '000000', NOW)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(updates()[1]!.mfaLockedUntil).toEqual(new Date(NOW + 15 * 60_000));
  });

  it('refuses even a correct code while locked', async () => {
    const secret = generateTotpSecret();
    const { svc } = setup({
      totpSecret: seal(secret, 'r'.repeat(32)),
      totpEnabledAt: new Date(),
      mfaLockedUntil: new Date(NOW + 60_000),
    });
    const code = hotp(base32Decode(secret), totpStep(NOW));
    await expect(svc.verify('mfa-token', code, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a token that is not an mfa token (e.g. a full access token)', async () => {
    const { jwt, svc } = setup({});
    jwt.verifyAsync.mockResolvedValue({ sub: 'pa1', type: 'platform-admin' });
    await expect(svc.verify('access-token', '123456', NOW)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('a secret sealed with a rotated key means re-enrol, not a 500', async () => {
    const stale = seal(generateTotpSecret(), 'x'.repeat(32));
    const { svc } = setup({ totpSecret: stale, totpEnabledAt: new Date() });
    const res = await svc.challenge({ id: 'pa1', email: 'a@t.com' });
    expect(res.enrolled).toBe(false);
    expect(res.enrollment?.secret).toBeDefined();
    await expect(svc.verify('mfa-token', '123456', NOW)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
