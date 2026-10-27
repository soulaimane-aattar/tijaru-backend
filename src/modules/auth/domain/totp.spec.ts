import { seal, unseal } from './secret-box';
import { base32Decode, base32Encode, hotp, verifyTotp } from './totp';

// RFC 6238 appendix B, SHA1 secret "12345678901234567890" (6-digit tail of the published 8-digit codes).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('round-trips base32', () => {
    const buf = Buffer.from('hello world, 2fa!');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('matches RFC 6238 vectors', () => {
    const key = base32Decode(RFC_SECRET);
    expect(hotp(key, Math.floor(59 / 30))).toBe('287082');
    expect(hotp(key, Math.floor(1111111109 / 30))).toBe('081804');
    expect(hotp(key, Math.floor(20000000000 / 30))).toBe('353130');
  });

  it('accepts ±1 step, rejects further drift, bad format and replay', () => {
    const now = 1_111_111_109_000;
    const step = Math.floor(now / 1000 / 30);
    const key = base32Decode(RFC_SECRET);
    expect(verifyTotp(RFC_SECRET, hotp(key, step), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(key, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(key, step + 2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, hotp(key, step), now, step)).toBeNull();
  });
});

describe('secret-box', () => {
  it('round-trips and rejects the wrong key', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP', 'k'.repeat(32));
    expect(unseal(sealed, 'k'.repeat(32))).toBe('JBSWY3DPEHPK3PXP');
    expect(() => unseal(sealed, 'x'.repeat(32))).toThrow();
  });
});
