import { DeliveryNotePdfService, type PdfNote } from './delivery-note-pdf.service';

const noteFixture: PdfNote = {
  number: 'BL-2026-0001',
  type: 'out' as const,
  date: new Date('2026-08-12'),
  status: 'prepared',
  signed: false,
  business: { name: 'Aissa SARL', address: 'Rabat', ice: '000123456', phone: '0522000000' },
  customer: { name: 'Client A', phone: '0660000000', address: 'Casa' },
  supplier: null,
  issuedBy: { fullName: 'Omar' },
  lines: [
    { label: 'Farine 25kg', ordered: '10', sent: '10', unitPrice: '120' },
    { label: 'Sucre 1kg', ordered: '5', sent: '5', unitPrice: '10' },
  ],
  totals: { subtotal: 1250 },
};

/**
 * pdfkit 0.19 always serializes glyph runs as hex strings inside `TJ` arrays
 * (even for standard/non-embedded fonts) — never as literal `(...)Tj` ASCII.
 * Decode those hex runs back to text so the assertions below check what a
 * PDF viewer would actually render, not the raw byte layout.
 */
function extractText(buf: Buffer): string {
  const s = buf.toString('latin1');
  const hexRuns = [...s.matchAll(/<([0-9a-fA-F]+)>/g)];
  return hexRuns.map((m) => Buffer.from(m[1] ?? '', 'hex').toString('latin1')).join('');
}

describe('DeliveryNotePdfService', () => {
  const svc = new DeliveryNotePdfService();

  it('returns a non-empty PDF buffer starting with %PDF-', async () => {
    const buf = await svc.render(noteFixture);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('embeds the bon number and customer name in the stream', async () => {
    const buf = await svc.render(noteFixture);
    const text = extractText(buf);
    expect(text).toContain('BL-2026-0001');
    expect(text).toContain('Client A');
  });
});
