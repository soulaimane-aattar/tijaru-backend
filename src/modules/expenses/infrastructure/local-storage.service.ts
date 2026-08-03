import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';

export type ReceiptExt = 'jpg' | 'png' | 'webp';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Receipt images on the local filesystem, one directory per business.
 *
 * Paths are tenant-scoped by construction: callers pass a businessId and get
 * back a relative path that already contains it, so reading another tenant's
 * receipt would require forging a path — which `resolveSafe` rejects.
 */
@Injectable()
export class LocalStorageService {
  private readonly root: string;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.root = resolve(env.UPLOADS_DIR);
  }

  /**
   * Identify the image from its magic bytes.
   *
   * The mimetype a client declares is attacker-controlled, so it is never
   * trusted: a `.jpg` upload carrying a PHP payload must be rejected here.
   */
  sniffExtension(buffer: Buffer): ReceiptExt | null {
    if (buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
    if (buffer.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
    if (
      buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buffer.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
      return 'webp';
    }
    return null;
  }

  async save(businessId: string, buffer: Buffer, ext: ReceiptExt): Promise<string> {
    const relativePath = `${businessId}/${randomBytes(12).toString('hex')}.${ext}`;
    const absolute = this.resolveSafe(relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);
    return relativePath;
  }

  // `async` so a rejected path surfaces as a rejected promise rather than a
  // synchronous throw — callers only ever await this.
  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolveSafe(relativePath));
  }

  async remove(relativePath: string): Promise<void> {
    await rm(this.resolveSafe(relativePath), { force: true });
  }

  /** Reject any path that escapes the uploads root. */
  private resolveSafe(relativePath: string): string {
    if (isAbsolute(relativePath)) {
      throw new Error(`Refusing path outside uploads root: ${relativePath}`);
    }
    const absolute = resolve(join(this.root, relativePath));
    const rel = relative(this.root, absolute);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Refusing path outside uploads root: ${relativePath}`);
    }
    return absolute;
  }
}
