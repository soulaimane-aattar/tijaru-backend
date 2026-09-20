import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Delivery signing, after Saleor's `Saleor-Signature` header
 * (`saleor/plugins/webhook/tasks.py`): HMAC-SHA256 over the **raw** body, so a
 * receiver must verify before parsing. Saleor's own advisory GHSA-3rqj-9v87-2x3f
 * is the reason `verifySignature` compares in constant time.
 */
export function signPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

export function verifySignature(secret: string, rawBody: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(secret, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Retry schedule: attempts² minutes, so 1, 4, 9 … minutes after each failure. */
export function nextAttemptAt(attempts: number, now = new Date()): Date {
  return new Date(now.getTime() + attempts * attempts * 60_000);
}

export const MAX_ATTEMPTS = 8;

// ─── API keys (Medusa `api_key` shape: public prefix + hashed token) ─────────

export const API_KEY_PREFIX = 'tj_';

export function generateApiKey(): { token: string; prefix: string; hash: string } {
  const prefix = API_KEY_PREFIX + randomBytes(4).toString('hex');
  const token = `${prefix}_${randomBytes(24).toString('hex')}`;
  return { token, prefix, hash: hashApiKey(token) };
}

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `tj_ab12cd34_<secret>` → `tj_ab12cd34`; null when the shape is wrong. */
export function prefixOf(token: string): string | null {
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  const [scheme, id] = token.split('_');
  return scheme && id ? `${scheme}_${id}` : null;
}

export function apiKeyMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
