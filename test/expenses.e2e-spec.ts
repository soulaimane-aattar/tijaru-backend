import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { OcrProvider, type OcrResult } from '../src/modules/expenses/domain/ocr.provider';

import { api, bearer, login, seedFresh } from './helpers/test-app';

/** Minimal valid JPEG header — enough for the magic-byte sniffer. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(64),
]);

const SUGGESTION: OcrResult = {
  status: 'done',
  blocks: [],
  suggestion: {
    amount: 284.5,
    taxAmount: 47.42,
    date: '2026-08-01',
    merchantName: 'MARJANE HOLDING',
    confidence: { amount: 0.94, taxAmount: 0.9, date: 0.8, merchantName: 0.6 },
  },
};

/** Stub OCR so the suite never needs the Python service running. */
class StubOcrProvider extends OcrProvider {
  extract(): Promise<OcrResult> {
    return Promise.resolve(SUGGESTION);
  }
}

describe('Expenses (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerToken: string;
  let cashierToken: string;
  let otherTenantToken: string;
  let expenseWithReceiptId: string;

  beforeAll(async () => {
    // Receipts must not land in the working tree during tests.
    process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'tijaru-e2e-uploads-'));

    await seedFresh();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OcrProvider)
      .useClass(StubOcrProvider)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = new PrismaClient();
    ownerToken = (await login(app, 'owner')).accessToken;
    cashierToken = (await login(app, 'cashier')).accessToken;

    // A second tenant, created through the raw client so the tenant middleware
    // does not scope it. Password hash is copied from a seeded user so the
    // demo password works.
    const seeded = await prisma.user.findFirstOrThrow({ where: { email: 'youssef@elamrani.ma' } });
    const other = await prisma.business.create({
      data: { name: 'Autre Commerce', ice: '999999999999999' },
    });
    // Without a module row, ModuleGuard would 403 before tenant isolation is exercised.
    await prisma.businessModule.create({
      data: { businessId: other.id, moduleId: 'expenses', active: true },
    });
    await prisma.user.create({
      data: {
        businessId: other.id,
        name: 'Rival Owner',
        email: 'rival@example.ma',
        passwordHash: seeded.passwordHash,
        role: 'owner',
      },
    });
    otherTenantToken = (await login(app, 'rival@example.ma')).accessToken;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /expenses/scan', () => {
    it('stores the receipt and returns a suggestion without creating an expense', async () => {
      const before = await prisma.expense.count();

      const res = await api(app)
        .post('/api/v1/expenses/scan')
        .set(bearer(ownerToken))
        .attach('file', JPEG, 'receipt.jpg')
        .expect(201);

      expect(res.body.ocrStatus).toBe('done');
      expect(res.body.suggestion.amount).toBe(284.5);
      expect(res.body.receiptPath).toMatch(/\.jpg$/);
      expect(await prisma.expense.count()).toBe(before);
    });

    it('rejects a payload whose magic bytes are not an image', async () => {
      await api(app)
        .post('/api/v1/expenses/scan')
        .set(bearer(ownerToken))
        .attach('file', Buffer.from('<?php echo 1; ?>'), 'evil.jpg')
        .expect(400);
    });

    it('rejects an oversize upload', async () => {
      await api(app)
        .post('/api/v1/expenses/scan')
        .set(bearer(ownerToken))
        .attach('file', Buffer.alloc(9 * 1024 * 1024), 'big.jpg')
        .expect(413);
    });

    it('denies a cashier (no expenses.create)', async () => {
      await api(app)
        .post('/api/v1/expenses/scan')
        .set(bearer(cashierToken))
        .attach('file', JPEG, 'receipt.jpg')
        .expect(403);
    });
  });

  describe('CRUD', () => {
    it('creates an expense carrying the scanned receipt', async () => {
      const scan = await api(app)
        .post('/api/v1/expenses/scan')
        .set(bearer(ownerToken))
        .attach('file', JPEG, 'receipt.jpg')
        .expect(201);

      const res = await api(app)
        .post('/api/v1/expenses')
        .set(bearer(ownerToken))
        .send({
          date: '2026-08-01',
          amount: 284.5,
          taxAmount: 47.42,
          category: 'supplies',
          merchantName: 'MARJANE HOLDING',
          paymentMethod: 'card',
          receiptPath: scan.body.receiptPath,
        })
        .expect(201);

      expect(Number(res.body.amount)).toBe(284.5);
      expenseWithReceiptId = res.body.id;
    });

    it('lists the created expense', async () => {
      const res = await api(app).get('/api/v1/expenses').set(bearer(ownerToken)).expect(200);
      expect(res.body.some((e: { id: string }) => e.id === expenseWithReceiptId)).toBe(true);
    });

    it('summarises totals by category', async () => {
      const res = await api(app)
        .get('/api/v1/expenses/summary')
        .set(bearer(ownerToken))
        .expect(200);

      const supplies = res.body.byCategory.find(
        (row: { category: string }) => row.category === 'supplies',
      );
      expect(supplies.total).toBeGreaterThanOrEqual(284.5);
      expect(res.body.total).toBeGreaterThanOrEqual(284.5);
    });

    it('filters by category', async () => {
      const res = await api(app)
        .get('/api/v1/expenses?category=rent')
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body.every((e: { category: string }) => e.category === 'rent')).toBe(true);
    });

    it('updates an expense', async () => {
      const res = await api(app)
        .patch(`/api/v1/expenses/${expenseWithReceiptId}`)
        .set(bearer(ownerToken))
        .send({ note: 'Fournitures bureau' })
        .expect(200);
      expect(res.body.note).toBe('Fournitures bureau');
    });

    it('denies a cashier listing expenses (no expenses.view)', async () => {
      await api(app).get('/api/v1/expenses').set(bearer(cashierToken)).expect(403);
    });
  });

  describe('GET /expenses/:id/receipt — tenant isolation', () => {
    it('serves the receipt to its owner', async () => {
      const res = await api(app)
        .get(`/api/v1/expenses/${expenseWithReceiptId}/receipt`)
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
    });

    it('hides another tenant’s receipt', async () => {
      // The whole reason receipts are not served by static middleware.
      await api(app)
        .get(`/api/v1/expenses/${expenseWithReceiptId}/receipt`)
        .set(bearer(otherTenantToken))
        .expect(404);
    });

    it('hides another tenant’s expense record', async () => {
      await api(app)
        .get(`/api/v1/expenses/${expenseWithReceiptId}`)
        .set(bearer(otherTenantToken))
        .expect(404);
    });
  });

  describe('GET /expenses/report', () => {
    /** pdfkit writes glyph runs as hex `<...>` TJ arrays; decode them for text assertions. */
    const pdfText = (buf: Buffer): string => {
      const s = buf.toString('latin1');
      return [...s.matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((m) => Buffer.from(m[1] ?? '', 'hex').toString('latin1'))
        .join('');
    };

    it('exports the month as a PDF with totals and the receipt image', async () => {
      const res = await api(app)
        .get('/api/v1/expenses/report?month=2026-08')
        .set(bearer(ownerToken))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('depenses-2026-08.pdf');
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdfText(body)).toContain('MARJANE HOLDING');
      expect(pdfText(body)).toContain('284.50');
    });

    it('excludes other tenants’ expenses from the report', async () => {
      const res = await api(app)
        .get('/api/v1/expenses/report?month=2026-08')
        .set(bearer(otherTenantToken))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(pdfText(res.body as Buffer)).not.toContain('MARJANE HOLDING');
    });

    it('rejects a malformed month', async () => {
      await api(app)
        .get('/api/v1/expenses/report?month=2026-13')
        .set(bearer(ownerToken))
        .expect(400);
    });

    it('denies a cashier (no expenses.view)', async () => {
      await api(app)
        .get('/api/v1/expenses/report?month=2026-08')
        .set(bearer(cashierToken))
        .expect(403);
    });
  });

  describe('DELETE /expenses/:id', () => {
    it('deletes the expense', async () => {
      await api(app)
        .delete(`/api/v1/expenses/${expenseWithReceiptId}`)
        .set(bearer(ownerToken))
        .expect(204);

      await api(app)
        .get(`/api/v1/expenses/${expenseWithReceiptId}`)
        .set(bearer(ownerToken))
        .expect(404);
    });
  });
});
