import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalStorageService } from './local-storage.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
]);

describe('LocalStorageService', () => {
  let root: string;
  let storage: LocalStorageService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tijaru-uploads-'));
    storage = new LocalStorageService({ UPLOADS_DIR: root } as never);
  });

  it('sniffs image types from magic bytes, not from a declared mimetype', () => {
    expect(storage.sniffExtension(JPEG)).toBe('jpg');
    expect(storage.sniffExtension(PNG)).toBe('png');
    expect(storage.sniffExtension(WEBP)).toBe('webp');
    expect(storage.sniffExtension(Buffer.from('<?php echo 1; ?>'))).toBeNull();
    expect(storage.sniffExtension(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('writes under a business-scoped directory and returns a relative path', async () => {
    const path = await storage.save('receipts', 'biz1', JPEG, 'jpg');
    expect(path).toMatch(/^receipts\/biz1\/[a-f0-9]+\.jpg$/);
    expect(readFileSync(join(root, path))).toEqual(JPEG);
  });

  it('gives every receipt a distinct name', async () => {
    const a = await storage.save('receipts', 'biz1', JPEG, 'jpg');
    const b = await storage.save('receipts', 'biz1', JPEG, 'jpg');
    expect(a).not.toEqual(b);
  });

  it('reads back what it wrote', async () => {
    const path = await storage.save('receipts', 'biz1', PNG, 'png');
    await expect(storage.read(path)).resolves.toEqual(PNG);
  });

  it('refuses to traverse outside the uploads root', async () => {
    await expect(storage.read('../../etc/passwd')).rejects.toThrow(/outside/i);
    await expect(storage.remove('biz1/../../secrets')).rejects.toThrow(/outside/i);
    await expect(storage.read('/etc/passwd')).rejects.toThrow(/outside/i);
  });

  it('removes a file and tolerates a second removal', async () => {
    const path = await storage.save('receipts', 'biz1', JPEG, 'jpg');
    await storage.remove(path);
    await expect(storage.remove(path)).resolves.toBeUndefined();
  });
});
