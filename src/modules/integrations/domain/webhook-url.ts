import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { ValidationError } from '../../../common/errors';

/**
 * Webhook targets are tenant-supplied and fetched by the API container, which
 * sits on the compose network next to postgres and the OCR service. Without a
 * guard that is a blind SSRF: a `settings.manage` user could aim a hook at
 * `http://postgres:5432` or the cloud metadata endpoint and read the outcome
 * back from the delivery's `lastError`.
 *
 * Two layers, because DNS can change between the two:
 *   - `assertPublicWebhookUrl` at registration — fast feedback, rejects the
 *     obvious cases (bad scheme, loopback, literal private IP).
 *   - `resolveSafeWebhookUrl` right before each delivery — resolves the
 *     hostname and re-checks, which is what closes DNS rebinding.
 */

/** Loopback, RFC1918, link-local (incl. cloud metadata), CGNAT, unique-local. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    if (lower.startsWith('fe80')) return true; // link-local
    // IPv4-mapped (::ffff:127.0.0.1) — re-check the embedded address.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped?.[1] ? isPrivateAddress(mapped[1]) : false;
  }
  if (v !== 4) return true; // not an address we can reason about

  const [a = 0, b = 0] = ip.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local + metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Private targets are allowed only under NODE_ENV=test, where the e2e suite
 * runs a receiver on 127.0.0.1.
 */
const allowPrivate = (): boolean => process.env.NODE_ENV === 'test';

/** Shape and obvious-target checks. Throws ValidationError. */
export function assertPublicWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('invalid_webhook_url');
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowPrivate())) {
    throw new ValidationError('webhook_url_must_be_https');
  }
  if (allowPrivate()) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new ValidationError('webhook_url_not_public');
  }
  if (isIP(host) && isPrivateAddress(host)) {
    throw new ValidationError('webhook_url_not_public');
  }
  return url;
}

/**
 * Re-validate immediately before delivery, resolving the hostname so a name
 * that pointed somewhere public at registration cannot be re-pointed inside
 * the network afterwards. Returns the reason on refusal, `null` when safe.
 */
export async function webhookUrlRefusalReason(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = assertPublicWebhookUrl(raw);
  } catch {
    return 'refused: target is not a public https URL';
  }
  if (allowPrivate()) return null;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return null; // already checked above

  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      return 'refused: target resolves to a private address';
    }
  } catch {
    return 'refused: target host does not resolve';
  }
  return null;
}
