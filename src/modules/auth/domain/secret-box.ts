import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const keyOf = (secret: string): Buffer => createHash('sha256').update(`secret-box:${secret}`).digest();

/** AES-256-GCM → `iv.tag.ciphertext` (base64 parts). */
export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function unseal(sealed: string, secret: string): string {
  const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64')) as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
