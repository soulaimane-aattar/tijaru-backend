import {
  apiKeyMatches,
  generateApiKey,
  hashApiKey,
  MAX_ATTEMPTS,
  nextAttemptAt,
  prefixOf,
  signPayload,
  verifySignature,
} from './webhook-signature';

describe('webhook signature', () => {
  const body = JSON.stringify({ event: 'order.created', id: 'o1' });

  it('signs deterministically over the raw body', () => {
    expect(signPayload('s3cr3t', body)).toBe(signPayload('s3cr3t', body));
    expect(signPayload('s3cr3t', body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('changes with the secret and with the body', () => {
    expect(signPayload('a', body)).not.toBe(signPayload('b', body));
    expect(signPayload('a', body)).not.toBe(signPayload('a', `${body} `));
  });

  it('verifies its own signature and rejects tampering', () => {
    const sig = signPayload('a', body);
    expect(verifySignature('a', body, sig)).toBe(true);
    expect(verifySignature('a', `${body}x`, sig)).toBe(false);
    expect(verifySignature('b', body, sig)).toBe(false);
    expect(verifySignature('a', body, 'sha256=deadbeef')).toBe(false);
  });
});

describe('retry schedule', () => {
  it('backs off by attempts squared, in minutes', () => {
    const now = new Date('2026-09-19T10:00:00Z');
    expect(nextAttemptAt(1, now).toISOString()).toBe('2026-09-19T10:01:00.000Z');
    expect(nextAttemptAt(3, now).toISOString()).toBe('2026-09-19T10:09:00.000Z');
    expect(nextAttemptAt(MAX_ATTEMPTS, now).getTime() - now.getTime()).toBe(64 * 60_000);
  });
});

describe('api keys', () => {
  it('issues a token whose prefix is recoverable and whose hash matches', () => {
    const { token, prefix, hash } = generateApiKey();
    expect(token.startsWith(`${prefix}_`)).toBe(true);
    expect(prefixOf(token)).toBe(prefix);
    expect(hash).toBe(hashApiKey(token));
    expect(apiKeyMatches(token, hash)).toBe(true);
  });

  it('rejects a different token and a foreign scheme', () => {
    const { hash } = generateApiKey();
    expect(apiKeyMatches(generateApiKey().token, hash)).toBe(false);
    expect(prefixOf('Bearer abc')).toBeNull();
    expect(prefixOf('eyJhbGciOi')).toBeNull();
  });
});
