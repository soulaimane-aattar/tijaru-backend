import { NotFoundError, ValidationError } from '../../../common/errors';
import type { ExpensesRepository } from '../domain/expenses.repository';
import type { OcrProvider } from '../domain/ocr.provider';
import type { LocalStorageService } from '../infrastructure/local-storage.service';

import { ExpensesService } from './expenses.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

const repo = (): jest.Mocked<ExpensesRepository> =>
  ({
    findAll: jest.fn(),
    findDetail: jest.fn(),
    findById: jest.fn(),
    summary: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }) as never;

const storageStub = (ext: 'jpg' | null = 'jpg') =>
  ({
    sniffExtension: jest.fn().mockReturnValue(ext),
    save: jest.fn().mockResolvedValue('biz1/abc.jpg'),
    read: jest.fn().mockResolvedValue(JPEG),
    remove: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<LocalStorageService>;

const ocrStub = (result: unknown = { status: 'failed', suggestion: null, blocks: [] }) =>
  ({ extract: jest.fn().mockResolvedValue(result) }) as unknown as jest.Mocked<OcrProvider>;

const service = (
  r = repo(),
  s: jest.Mocked<LocalStorageService> = storageStub(),
  o: jest.Mocked<OcrProvider> = ocrStub(),
) => new ExpensesService(r, s, o);

describe('ExpensesService', () => {
  it('throws NotFound when getting a missing expense', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(null);
    await expect(service(r).get('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stamps the creating user onto the expense', async () => {
    const r = repo();
    r.create.mockResolvedValue({ id: 'e1' });

    await service(r).create(
      { date: new Date('2026-08-01'), amount: 10, category: 'other', paymentMethod: 'cash' },
      'user-1',
    );

    expect(r.create).toHaveBeenCalledWith(expect.objectContaining({ createdById: 'user-1' }));
  });

  it('throws NotFound when updating a missing expense', async () => {
    const r = repo();
    r.update.mockResolvedValue(0);
    await expect(service(r).update('nope', { amount: 5 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFound when deleting a missing expense', async () => {
    const r = repo();
    r.findById.mockResolvedValue(null);
    await expect(service(r).remove('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes the receipt file along with the expense', async () => {
    const r = repo();
    r.findById.mockResolvedValue({ id: 'e1', receiptPath: 'biz1/abc.jpg' });
    r.delete.mockResolvedValue(1);
    const storage = storageStub();

    await service(r, storage).remove('e1');

    expect(storage.remove).toHaveBeenCalledWith('biz1/abc.jpg');
  });

  it('still deletes the expense when the receipt file is already gone', async () => {
    const r = repo();
    r.findById.mockResolvedValue({ id: 'e1', receiptPath: 'biz1/abc.jpg' });
    r.delete.mockResolvedValue(1);
    const storage = storageStub();
    storage.remove.mockRejectedValue(new Error('ENOENT'));

    await expect(service(r, storage).remove('e1')).resolves.toBeUndefined();
    expect(r.delete).toHaveBeenCalledWith('e1');
  });
});

describe('ExpensesService.scan', () => {
  it('saves the receipt and returns the OCR suggestion without creating an expense', async () => {
    const r = repo();
    const storage = storageStub();
    const ocr = ocrStub({
      status: 'done',
      blocks: [],
      suggestion: {
        amount: 284.5,
        taxAmount: null,
        date: '2026-08-01',
        merchantName: 'MARJANE',
        confidence: { amount: 0.9, taxAmount: 0, date: 0.7, merchantName: 0.5 },
      },
    });

    const result = await service(r, storage, ocr).scan(JPEG, 'biz1');

    expect(result.receiptPath).toBe('biz1/abc.jpg');
    expect(result.ocrStatus).toBe('done');
    expect(result.suggestion?.amount).toBe(284.5);
    expect(r.create).not.toHaveBeenCalled();
  });

  it('rejects a payload whose magic bytes are not an image', async () => {
    const storage = storageStub(null);

    await expect(service(repo(), storage).scan(Buffer.from('<?php'), 'biz1')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('keeps the receipt and reports failed when OCR is unavailable', async () => {
    const storage = storageStub();

    const result = await service(repo(), storage, ocrStub()).scan(JPEG, 'biz1');

    expect(result.ocrStatus).toBe('failed');
    expect(result.suggestion).toBeNull();
    // The photo is still attached, so the user can record the expense by hand.
    expect(result.receiptPath).toBe('biz1/abc.jpg');
  });
});

describe('ExpensesService.readReceipt', () => {
  it('returns the bytes and extension of an existing receipt', async () => {
    const r = repo();
    r.findById.mockResolvedValue({ id: 'e1', receiptPath: 'biz1/abc.jpg' });

    const result = await service(r).readReceipt('e1');

    expect(result.ext).toBe('jpg');
    expect(result.buffer).toEqual(JPEG);
  });

  it('throws NotFound when the expense has no receipt', async () => {
    const r = repo();
    r.findById.mockResolvedValue({ id: 'e1', receiptPath: null });
    await expect(service(r).readReceipt('e1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFound for an expense belonging to another tenant', async () => {
    const r = repo();
    // findById is tenant-filtered, so a cross-tenant id simply looks missing.
    r.findById.mockResolvedValue(null);
    await expect(service(r).readReceipt('other-tenant-id')).rejects.toBeInstanceOf(NotFoundError);
  });
});
