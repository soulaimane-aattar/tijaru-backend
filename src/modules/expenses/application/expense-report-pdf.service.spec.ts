import { inflateSync } from 'node:zlib';

import sharp from 'sharp';

import { ExpenseReportPdfService, type PdfExpenseReport } from './expense-report-pdf.service';

function extractText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const parts: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  for (const m of raw.matchAll(streamRe)) {
    let data = m[1] ?? '';
    try {
      data = inflateSync(Buffer.from(data, 'latin1')).toString('latin1');
    } catch {}
    const hexRuns = [...data.matchAll(/<([0-9a-fA-F]+)>/g)];
    parts.push(hexRuns.map((h) => Buffer.from(h[1] ?? '', 'hex').toString('latin1')).join(''));
  }
  return parts.join('');
}

function countPages(buf: Buffer): number {
  return [...buf.toString('latin1').matchAll(/\/Type \/Page[^s]/g)].length;
}

const jpeg = (): Promise<Buffer> =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } })
    .jpeg()
    .toBuffer();

const baseReport = (): PdfExpenseReport => ({
  period: '2026-08',
  title: 'Rapport des dépenses — 2026-08',
  business: { name: 'Aissa SARL', address: 'Rabat', ice: '000123456', phone: '0522000000' },
  lines: [
    {
      date: new Date('2026-08-05'),
      category: 'transport',
      merchantName: 'Total Energies',
      paymentMethod: 'cash',
      amount: 450.5,
      taxAmount: 45.05,
      receipt: null,
    },
    {
      date: new Date('2026-08-12'),
      category: 'supplies',
      merchantName: null,
      paymentMethod: 'card',
      amount: 120,
      taxAmount: null,
      receipt: null,
    },
  ],
  totals: {
    total: 570.5,
    byCategory: [
      { category: 'transport', total: 450.5 },
      { category: 'supplies', total: 120 },
    ],
  },
});

describe('ExpenseReportPdfService', () => {
  const svc = new ExpenseReportPdfService();

  it('returns a non-empty PDF buffer starting with %PDF-', async () => {
    const buf = await svc.render(baseReport());
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('embeds business name, month, merchant, category labels and totals', async () => {
    const buf = await svc.render(baseReport());
    const text = extractText(buf);
    expect(text).toContain('Aissa SARL');
    expect(text).toContain('2026-08');
    expect(text).toContain('Total Energies');
    expect(text).toContain('Transport');
    expect(text).toContain('Fournitures');
    expect(text).toContain('570.50');
    expect(text).toContain('450.50');
  });

  it('renders one summary page when no expense has a receipt', async () => {
    const buf = await svc.render(baseReport());
    expect(countPages(buf)).toBe(1);
  });

  it('adds one page per receipt image', async () => {
    const report = baseReport();
    const img = await jpeg();
    report.lines[0]!.receipt = { buffer: img, ext: 'jpg' };
    report.lines[1]!.receipt = { buffer: img, ext: 'jpg' };
    const buf = await svc.render(report);
    expect(countPages(buf)).toBe(3);
  });

  it('renders a placeholder instead of crashing on an unreadable image', async () => {
    const report = baseReport();
    report.lines[0]!.receipt = { buffer: Buffer.from('not an image'), ext: 'jpg' };
    const buf = await svc.render(report);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(extractText(buf)).toContain('Image illisible');
  });
});
