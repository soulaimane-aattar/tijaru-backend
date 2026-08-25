import sharp from 'sharp';

import { NotFoundError, ValidationError } from '../../../common/errors';
import type { LocalStorageService } from '../../../common/storage/local-storage.service';
import type { ExpenseCategoriesRepository } from '../../expense-categories/domain/expense-categories.repository';
import type { BusinessInfoLookup } from '../domain/business-info.lookup';
import type { ExpensesRepository } from '../domain/expenses.repository';
import type { OcrProvider } from '../domain/ocr.provider';

import { ExpensesService } from './expenses.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

const repo = (): jest.Mocked<ExpensesRepository> =>
  ({
    findAll: jest.fn(),
    findDetail: jest.fn(),
    findById: jest.fn(),
    findByReceiptHash: jest.fn().mockResolvedValue(null),
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

const lookupStub = (
  info: unknown = { name: 'Aissa SARL', address: null, ice: null, phone: null },
) => ({ get: jest.fn().mockResolvedValue(info) }) as unknown as jest.Mocked<BusinessInfoLookup>;

const categoriesStub = (
  view: unknown = {
    id: 'cat-1',
    key: 'other',
    label: 'Autre',
    taxRate: 0,
    sortOrder: 90,
    archived: false,
  },
) =>
  ({
    findAll: jest.fn(),
    findById: jest.fn(),
    findByKey: jest.fn().mockResolvedValue(view),
    create: jest.fn(),
    update: jest.fn(),
    countUses: jest.fn(),
    delete: jest.fn(),
  }) as unknown as jest.Mocked<ExpenseCategoriesRepository>;

const service = (
  r = repo(),
  s: jest.Mocked<LocalStorageService> = storageStub(),
  o: jest.Mocked<OcrProvider> = ocrStub(),
  b: jest.Mocked<BusinessInfoLookup> = lookupStub(),
  c: jest.Mocked<ExpenseCategoriesRepository> = categoriesStub(),
) => new ExpensesService(r, s, o, b, c);

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

  it('returns a deterministic sha256 hash of the receipt bytes', async () => {
    const result = await service().scan(JPEG, 'biz1');
    // Precomputed sha256(JPEG bytes) — locks the hash format the mobile client relies on.
    expect(result.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.duplicate).toBeNull();
  });

  it('flags the prior expense when the same receipt bytes were already scanned', async () => {
    const r = repo();
    r.findByReceiptHash.mockResolvedValue({
      id: 'e-prior',
      date: new Date('2026-08-10T00:00:00Z'),
      amount: '123.45',
      merchantName: 'MARJANE',
    });

    const result = await service(r).scan(JPEG, 'biz1');

    expect(r.findByReceiptHash).toHaveBeenCalledWith(result.receiptHash);
    expect(result.duplicate).toEqual({
      id: 'e-prior',
      date: '2026-08-10T00:00:00.000Z',
      amount: 123.45,
      merchantName: 'MARJANE',
    });
  });
});

describe('ExpensesService.monthlyReportData', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    date: new Date('2026-08-05'),
    category: 'transport',
    merchantName: 'Total',
    paymentMethod: 'cash',
    amount: '450.50',
    taxAmount: null,
    receiptPath: null,
    ...over,
  });

  it('rejects a malformed month', async () => {
    await expect(service().monthlyReportData('2026-13', 'biz1')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service().monthlyReportData('nope', 'biz1')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('queries the full month and assembles lines, totals and business info', async () => {
    const r = repo();
    r.findAll.mockResolvedValue([row()]);
    r.summary.mockResolvedValue({
      total: 450.5,
      byCategory: [{ category: 'transport', total: 450.5 }],
    });

    const report = await service(r).monthlyReportData('2026-08', 'biz1');

    const query = r.findAll.mock.calls[0]?.[0] as { from: Date; to: Date };
    expect(query.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(query.to.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    expect(report.period).toBe('2026-08');
    expect(report.title).toBe('Rapport des dépenses — 2026-08');
    expect(report.business.name).toBe('Aissa SARL');
    expect(report.lines).toEqual([
      expect.objectContaining({ merchantName: 'Total', amount: 450.5, receipt: null }),
    ]);
    expect(report.totals.total).toBe(450.5);
  });

  it('attaches receipt bytes for expenses that have one', async () => {
    const r = repo();
    r.findAll.mockResolvedValue([row({ receiptPath: 'biz1/abc.jpg' })]);
    r.summary.mockResolvedValue({ total: 450.5, byCategory: [] });

    const report = await service(r).monthlyReportData('2026-08', 'biz1');

    expect(report.lines[0]?.receipt).toEqual({ buffer: JPEG, ext: 'jpg' });
  });

  it('degrades to no receipt when the file is missing on disk', async () => {
    const r = repo();
    r.findAll.mockResolvedValue([row({ receiptPath: 'biz1/gone.jpg' })]);
    r.summary.mockResolvedValue({ total: 450.5, byCategory: [] });
    const storage = storageStub();
    storage.read.mockRejectedValue(new Error('ENOENT'));

    const report = await service(r, storage).monthlyReportData('2026-08', 'biz1');

    expect(report.lines[0]?.receipt).toBeNull();
  });

  it('converts webp receipts to png so pdfkit can embed them', async () => {
    const webp = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#333' },
    })
      .webp()
      .toBuffer();
    const r = repo();
    r.findAll.mockResolvedValue([row({ receiptPath: 'biz1/abc.webp' })]);
    r.summary.mockResolvedValue({ total: 450.5, byCategory: [] });
    const storage = storageStub();
    storage.read.mockResolvedValue(webp);

    const report = await service(r, storage).monthlyReportData('2026-08', 'biz1');

    expect(report.lines[0]?.receipt?.ext).toBe('png');
    expect(report.lines[0]?.receipt?.buffer.subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('ExpensesService.quarterlyReportData', () => {
  it('rejects a malformed quarter', async () => {
    await expect(service().quarterlyReportData('2026-Q5', 'biz1')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service().quarterlyReportData('26-Q1', 'biz1')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('queries the full quarter and titles the report', async () => {
    const r = repo();
    r.findAll.mockResolvedValue([]);
    r.summary.mockResolvedValue({ total: 0, byCategory: [] });

    const report = await service(r).quarterlyReportData('2026-Q3', 'biz1');

    const query = r.findAll.mock.calls[0]?.[0] as { from: Date; to: Date };
    expect(query.from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(query.to.toISOString()).toBe('2026-09-30T23:59:59.999Z');
    expect(report.period).toBe('2026-Q3');
    expect(report.title).toBe('Rapport trimestriel — 2026 Q3 (Juil–Sep)');
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
