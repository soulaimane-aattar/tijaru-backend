# Bons — PDF export + WhatsApp share — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a PDF export for every `DeliveryNote` (BC / BL / BR) with priced line items and a WhatsApp share flow on web and mobile.

**Architecture:** Server-side PDF via `pdfkit` behind `GET /delivery-notes/:id/pdf`. New `DeliveryNoteLine.unitPrice` column; subtotals recomputed in the service (`sent × unitPrice` for BL, `ordered × unitPrice` for BC/BR). Clients fetch the PDF blob; web uses `navigator.share({files})` with `wa.me` fallback, mobile uses `expo-file-system` + `expo-sharing`.

**Tech Stack:** NestJS + Prisma, `pdfkit@0.15`, React + Vite, Expo (`expo-file-system`, `expo-sharing`).

## Global Constraints

- Backend path prefix `/api` + URI versioning `v1`; every new endpoint mounts under `/api/v1`.
- Cap `po.manage` + `@RequiresModule('delivery-notes')` gate all bon endpoints.
- Currency values `Decimal(12,2)`, quantities `Decimal(12,3)` — matches schema; render with `.toFixed(2)` / `.toFixed(3)` in PDF + UI.
- Follow existing repo pattern: DTOs = Zod, service = abstract repo + Prisma impl.
- French primary UI copy; en/ar mirrored in i18n files.
- No status enum change; keep `prepared/sent/shipped/partial/delivered/closed`.
- Migration name format `YYYYMMDDHHMMSS_snake_case`.

---

### Task 1: Prisma migration — `DeliveryNoteLine.unitPrice`

**Files:**
- Create: `backend/prisma/migrations/20260812120000_bon_line_unit_price/migration.sql`
- Modify: `backend/prisma/schema.prisma` (model `DeliveryNoteLine`)

**Interfaces:**
- Consumes: nothing.
- Produces: `unit_price Decimal(12,2) NOT NULL DEFAULT 0` column and matching Prisma field `unitPrice: Decimal`.

- [ ] **Step 1: Edit `schema.prisma`**

Add `unitPrice` field to `DeliveryNoteLine`:

```prisma
model DeliveryNoteLine {
  id             String  @id @default(cuid())
  deliveryNoteId String  @map("delivery_note_id")
  productId      String  @map("product_id")
  label          String
  ordered        Decimal @db.Decimal(12, 3)
  sent           Decimal @default(0) @db.Decimal(12, 3)
  unitPrice      Decimal @default(0) @db.Decimal(12, 2) @map("unit_price")

  deliveryNote DeliveryNote @relation(fields: [deliveryNoteId], references: [id], onDelete: Cascade)
  product      Product      @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@index([deliveryNoteId])
  @@map("delivery_note_lines")
}
```

- [ ] **Step 2: Write migration SQL**

```sql
ALTER TABLE "delivery_note_lines"
  ADD COLUMN "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Regenerate Prisma client + apply migration**

Run:
```
cd backend && npx prisma migrate deploy && npx prisma generate
```
Expected: migration `20260812120000_bon_line_unit_price` applied; `\d delivery_note_lines` shows `unit_price | numeric(12,2) | not null | 0`.

- [ ] **Step 4: Commit**

```
git add backend/prisma/schema.prisma backend/prisma/migrations/20260812120000_bon_line_unit_price
git commit -m "feat(bons): add unit_price to delivery_note_lines"
```

---

### Task 2: DTO + service — unitPrice prefill and subtotal computation

**Files:**
- Modify: `backend/src/modules/delivery-notes/dto/delivery-notes.dto.ts`
- Modify: `backend/src/modules/delivery-notes/application/delivery-notes.service.ts`
- Modify: `backend/src/modules/delivery-notes/domain/delivery-notes.repository.ts` (if line shape typed there)
- Modify: `backend/src/modules/delivery-notes/infrastructure/prisma-delivery-notes.repository.ts` (persist `unitPrice`, select it back)
- Test: `backend/src/modules/delivery-notes/application/delivery-notes.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 column.
- Produces:
  - `CreateDeliveryNoteInput.lines[i].unitPrice?: number` (optional; defaults to product price).
  - `DeliveryNoteLineDto { …, unitPrice: number, subtotal: number }`.
  - `DeliveryNoteDto { …, totals: { subtotal: number } }`.
  - `DeliveryNotesService.computeTotals(note): { subtotal: number }` — pure.

- [ ] **Step 1: Add failing tests**

Append to `delivery-notes.service.spec.ts`:

```ts
describe('unit price + totals', () => {
  it('prefills unitPrice from product.price when line omits it', async () => {
    productsRepo.findById.mockResolvedValue({ id: 'p1', price: '12.50' } as any);
    repo.create.mockImplementation(async (_, input) => ({ id: 'n1', ...input }));
    await service.create('biz', 'usr', {
      type: 'out', customerId: 'c1',
      lines: [{ productId: 'p1', label: 'X', ordered: '2' }],
    } as any);
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lines: [expect.objectContaining({ unitPrice: 12.5 })],
    }));
  });

  it('keeps explicit unitPrice', async () => {
    productsRepo.findById.mockResolvedValue({ id: 'p1', price: '99' } as any);
    repo.create.mockImplementation(async (_, input) => ({ id: 'n1', ...input }));
    await service.create('biz', 'usr', {
      type: 'out', customerId: 'c1',
      lines: [{ productId: 'p1', label: 'X', ordered: '2', unitPrice: 5 }],
    } as any);
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lines: [expect.objectContaining({ unitPrice: 5 })],
    }));
  });

  it('computeTotals: BL uses sent × unitPrice', () => {
    const note = { type: 'out', lines: [
      { sent: '3', ordered: '5', unitPrice: '10' },
      { sent: '2', ordered: '2', unitPrice: '7.5' },
    ] };
    expect(service.computeTotals(note as any).subtotal).toBe(45);
  });

  it('computeTotals: BC/BR uses ordered × unitPrice', () => {
    const noteBC = { type: 'order', lines: [{ sent: '0', ordered: '4', unitPrice: '25' }] };
    const noteBR = { type: 'in_', lines: [{ sent: '0', ordered: '3', unitPrice: '10' }] };
    expect(service.computeTotals(noteBC as any).subtotal).toBe(100);
    expect(service.computeTotals(noteBR as any).subtotal).toBe(30);
  });

  it('computeTotals: empty lines → 0', () => {
    expect(service.computeTotals({ type: 'out', lines: [] } as any).subtotal).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && npx jest src/modules/delivery-notes -t "unit price"`
Expected: 5 failures (unitPrice ignored / method missing).

- [ ] **Step 3: Extend Zod DTO**

In `dto/delivery-notes.dto.ts`, on the `lines[i]` schema for create, add:

```ts
unitPrice: z.number().nonnegative().optional(),
```

- [ ] **Step 4: Service — prefill + computeTotals**

Inject `ProductsRepository` (already available or import). In `create()` before `repo.create(...)`:

```ts
const lines = await Promise.all(input.lines.map(async (l) => {
  if (l.unitPrice !== undefined) return l;
  const p = await this.products.findById(businessId, l.productId);
  return { ...l, unitPrice: Number(p?.price ?? 0) };
}));
```

Add helper:

```ts
computeTotals(note: { type: DeliveryNoteType; lines: Array<{ sent: Decimal | string | number; ordered: Decimal | string | number; unitPrice: Decimal | string | number }> }): { subtotal: number } {
  const qty = (l: any) => Number(note.type === 'out' ? l.sent : l.ordered);
  const price = (l: any) => Number(l.unitPrice ?? 0);
  const subtotal = note.lines.reduce((s, l) => s + qty(l) * price(l), 0);
  return { subtotal: Math.round(subtotal * 100) / 100 };
}
```

In every response mapper for `getById` / `list`, attach `subtotal` per line and `totals`:

```ts
const totals = this.computeTotals(note);
return {
  ...noteMapped,
  lines: note.lines.map((l) => ({
    ...lineMapped(l),
    unitPrice: Number(l.unitPrice),
    subtotal: Math.round(Number(note.type === 'out' ? l.sent : l.ordered) * Number(l.unitPrice) * 100) / 100,
  })),
  totals,
};
```

- [ ] **Step 5: Persist unitPrice**

In `prisma-delivery-notes.repository.ts` `create()`, include `unitPrice: line.unitPrice` in `data.lines.create`. In `select`/`include` calls, ensure `unitPrice: true` (or default `select` — if using `include: { lines: true }`, it comes free).

- [ ] **Step 6: Run tests — expect PASS**

Run: `cd backend && npx jest src/modules/delivery-notes`
Expected: all green (previous count + 5 new).

- [ ] **Step 7: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```
git add backend/src/modules/delivery-notes
git commit -m "feat(bons): unitPrice on lines + subtotal in responses"
```

---

### Task 3: PDF endpoint

**Files:**
- Create: `backend/src/modules/delivery-notes/application/delivery-note-pdf.service.ts`
- Modify: `backend/src/modules/delivery-notes/delivery-notes.controller.ts`
- Modify: `backend/src/modules/delivery-notes/delivery-notes.module.ts` (provide PDF service)
- Modify: `backend/package.json` (add `pdfkit`, `@types/pdfkit`)
- Test: `backend/src/modules/delivery-notes/application/delivery-note-pdf.service.spec.ts`

**Interfaces:**
- Consumes: `DeliveryNotesService.getById(businessId, id)` (already exists) + `computeTotals` from Task 2.
- Produces: `DeliveryNotePdfService.render(note): Buffer` (Promise). Endpoint `GET /delivery-notes/:id/pdf` returning `application/pdf`.

- [ ] **Step 1: Install pdfkit**

```
cd backend && npm i pdfkit && npm i -D @types/pdfkit
```

- [ ] **Step 2: Write failing PDF service test**

`delivery-note-pdf.service.spec.ts`:

```ts
import { DeliveryNotePdfService } from './delivery-note-pdf.service';

const noteFixture = {
  id: 'n1', number: 'BL-2026-0001', type: 'out' as const,
  date: new Date('2026-08-12'), status: 'prepared' as const, signed: false,
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

describe('DeliveryNotePdfService', () => {
  const svc = new DeliveryNotePdfService();

  it('returns a non-empty PDF buffer starting with %PDF-', async () => {
    const buf = await svc.render(noteFixture as any);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('embeds the bon number and customer name in the stream', async () => {
    const buf = await svc.render(noteFixture as any);
    const s = buf.toString('latin1');
    expect(s).toContain('BL-2026-0001');
    expect(s).toContain('Client A');
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `cd backend && npx jest delivery-note-pdf.service`
Expected: module-not-found or `render` undefined.

- [ ] **Step 4: Implement service**

`delivery-note-pdf.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

type PdfNote = {
  number: string;
  type: 'order' | 'out' | 'in_';
  date: Date;
  status: string;
  signed: boolean;
  notes?: string | null;
  business: { name: string; address?: string | null; ice?: string | null; phone?: string | null };
  customer?: { name: string; phone?: string | null; address?: string | null } | null;
  supplier?: { name: string; phone?: string | null; address?: string | null } | null;
  issuedBy: { fullName: string };
  lines: Array<{ label: string; ordered: string | number; sent: string | number; unitPrice: string | number }>;
  totals: { subtotal: number };
};

const TYPE_LABEL: Record<PdfNote['type'], string> = {
  order: 'Bon de commande',
  out: 'Bon de livraison',
  in_: 'Bon de réception',
};

@Injectable()
export class DeliveryNotePdfService {
  render(note: PdfNote): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(16).text(note.business.name, { continued: false });
      doc.fontSize(9).fillColor('#555');
      if (note.business.address) doc.text(note.business.address);
      const meta = [note.business.ice && `ICE: ${note.business.ice}`, note.business.phone && `Tél: ${note.business.phone}`].filter(Boolean).join('  ·  ');
      if (meta) doc.text(meta);
      doc.moveDown(0.5).fillColor('black');

      // Title
      doc.fontSize(14).text(`${TYPE_LABEL[note.type]}  ${note.number}`);
      doc.fontSize(9).fillColor('#555').text(`Date: ${note.date.toISOString().slice(0, 10)}   Statut: ${note.status}${note.signed ? '   Signé' : ''}`);
      doc.moveDown(0.5).fillColor('black');

      // Destinataire
      const to = note.type === 'out' ? note.customer : note.supplier;
      doc.fontSize(10).text('Destinataire:', { underline: true });
      if (to) {
        doc.text(to.name);
        if (to.address) doc.text(to.address);
        if (to.phone) doc.text(`Tél: ${to.phone}`);
      } else {
        doc.text('—');
      }
      doc.moveDown(0.8);

      // Table header
      const cols = { label: 40, qty: 320, pu: 400, sub: 480 };
      const y0 = doc.y;
      doc.fontSize(10).fillColor('#000');
      doc.text('Produit', cols.label, y0);
      doc.text('Qté', cols.qty, y0, { width: 60, align: 'right' });
      doc.text('PU', cols.pu, y0, { width: 60, align: 'right' });
      doc.text('Sous-total', cols.sub, y0, { width: 75, align: 'right' });
      doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).stroke();
      doc.moveDown(0.4);

      // Rows
      for (const l of note.lines) {
        const qty = Number(note.type === 'out' ? l.sent : l.ordered);
        const pu = Number(l.unitPrice);
        const sub = Math.round(qty * pu * 100) / 100;
        const y = doc.y;
        doc.text(l.label, cols.label, y, { width: 270 });
        doc.text(qty.toFixed(3), cols.qty, y, { width: 60, align: 'right' });
        doc.text(pu.toFixed(2), cols.pu, y, { width: 60, align: 'right' });
        doc.text(sub.toFixed(2), cols.sub, y, { width: 75, align: 'right' });
        doc.moveDown(0.3);
      }

      // Total
      doc.moveTo(40, doc.y + 4).lineTo(555, doc.y + 4).stroke();
      doc.moveDown(0.4);
      doc.fontSize(11).text('Total', cols.pu, doc.y, { width: 60, align: 'right', continued: true });
      doc.text(note.totals.subtotal.toFixed(2), { width: 75, align: 'right' });

      // Footer
      doc.moveDown(1.5).fontSize(8).fillColor('#666');
      doc.text(`Émis par ${note.issuedBy.fullName}`);
      if (note.notes) doc.moveDown(0.3).text(note.notes);

      doc.end();
    });
  }
}
```

- [ ] **Step 5: Wire service in module**

In `delivery-notes.module.ts` add `DeliveryNotePdfService` to `providers`.

- [ ] **Step 6: Controller endpoint**

In `delivery-notes.controller.ts`:

```ts
@Get(':id/pdf')
@RequireCap('po.manage')
async pdf(@CurrentBusiness() bizId: string, @Param('id') id: string, @Res({ passthrough: false }) res: Response): Promise<void> {
  const note = await this.service.getById(bizId, id);
  const buf = await this.pdf.render(note);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${note.number}.pdf"`);
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
}
```

Import `Response` from `express`; inject `DeliveryNotePdfService` in the constructor.

- [ ] **Step 7: Run tests — expect PASS**

Run: `cd backend && npx jest src/modules/delivery-notes`
Expected: all green.

- [ ] **Step 8: Manual probe**

Rebuild + restart backend: `cd backend && docker compose up -d --build backend`.
Create a BL through the existing endpoint (or use an existing one), then:
```
curl -sS -H "Authorization: Bearer $TOKEN" -o /tmp/bon.pdf -w "%{http_code} %{content_type}\n" http://192.168.1.82:3002/api/v1/delivery-notes/<id>/pdf
file /tmp/bon.pdf
```
Expected: `200 application/pdf`, `/tmp/bon.pdf: PDF document, version 1.3`.

- [ ] **Step 9: Commit**

```
git add backend
git commit -m "feat(bons): pdf endpoint via pdfkit"
```

---

### Task 4: Web — `fetchBlob` helper + `getBonPdfBlob`

**Files:**
- Modify: `web/src/api/client.ts` (export `fetchBlob`)
- Modify: `web/src/api/bons.ts` (extend types + `getBonPdfBlob`)

**Interfaces:**
- Consumes: Task 3 endpoint.
- Produces:
  - `fetchBlob(path: string, opts?: {withAuth?: boolean}): Promise<Response>` in `client.ts`.
  - `BonLine.unitPrice: number`, `BonLine.subtotal: number`, `Bon.totals: {subtotal:number}`.
  - `getBonPdfBlob(id: string): Promise<Blob>`.

- [ ] **Step 1: Export `fetchBlob`**

In `web/src/api/client.ts`, export a helper that reuses `rawFetch` + refresh but returns the raw `Response`:

```ts
export async function fetchBlob(path: string, opts: { withAuth?: boolean } = {}): Promise<Response> {
  const withAuth = opts.withAuth ?? true;
  let res = await rawFetch(path, { method: 'GET' }, withAuth);
  if (res.status === 401 && withAuth && getRefreshToken()) {
    if (await tryRefresh()) res = await rawFetch(path, { method: 'GET' }, true);
  }
  return res;
}
```

- [ ] **Step 2: Extend `bons.ts`**

Add types + helper:

```ts
export type BonLine = {
  id: string; productId: string; label: string;
  ordered: number; sent: number;
  unitPrice: number; subtotal: number;
};
export type BonTotals = { subtotal: number };
// extend existing Bon type: lines: BonLine[]; totals: BonTotals;

export async function getBonPdfBlob(id: string): Promise<Blob> {
  const res = await fetchBlob(`/delivery-notes/${id}/pdf`);
  if (!res.ok) throw new Error(`pdf_${res.status}`);
  return await res.blob();
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```
git add web/src/api/client.ts web/src/api/bons.ts
git commit -m "feat(web): fetchBlob helper + bon pdf client"
```

---

### Task 5: Web — BonsPage row actions (PDF + WhatsApp)

**Files:**
- Create: `web/src/lib/whatsapp.ts`
- Modify: `web/src/pages/bons/BonsPage.tsx`
- Modify: `web/src/pages/bons/BonsPage.test.tsx`
- Modify: `web/src/i18n/en.ts` `fr.ts` `ar.ts`

**Interfaces:**
- Consumes: `getBonPdfBlob` (Task 4).
- Produces: `normalizeMAPhone(raw?: string): string` (empty when unusable). `waLink(phone: string, text: string): string`.

- [ ] **Step 1: Add i18n keys**

Under `bons` in each locale:

`fr.ts`:
```ts
download: 'Télécharger PDF',
shareWhatsApp: 'Partager sur WhatsApp',
unitPrice: 'PU',
subtotal: 'Sous-total',
total: 'Total',
destinataire: 'Destinataire',
```

`en.ts`:
```ts
download: 'Download PDF',
shareWhatsApp: 'Share on WhatsApp',
unitPrice: 'Unit price',
subtotal: 'Subtotal',
total: 'Total',
destinataire: 'Recipient',
```

`ar.ts`:
```ts
download: 'تنزيل PDF',
shareWhatsApp: 'مشاركة عبر واتساب',
unitPrice: 'السعر',
subtotal: 'المجموع الفرعي',
total: 'المجموع',
destinataire: 'المرسل إليه',
```

- [ ] **Step 2: `lib/whatsapp.ts`**

```ts
export function normalizeMAPhone(raw?: string | null): string {
  if (!raw) return '';
  const d = raw.replace(/\D+/g, '');
  if (!d) return '';
  if (d.startsWith('212')) return d;
  if (d.length === 10 && d.startsWith('0')) return '212' + d.slice(1);
  if (d.length === 9) return '212' + d;
  return d;
}

export function waLink(phone: string, text: string): string {
  const p = phone ? `/${phone}` : '';
  return `https://wa.me${p}?text=${encodeURIComponent(text)}`;
}
```

- [ ] **Step 3: Write failing tests**

In `BonsPage.test.tsx` add cases (mock `getBonPdfBlob` to return a `Blob(['x'], {type:'application/pdf'})`; mock `window.open`; mock `navigator.share` + `navigator.canShare`):

```ts
it('PDF button calls getBonPdfBlob with row id', async () => { /* click, assert */ });

it('WhatsApp uses navigator.share when canShare true', async () => {
  Object.assign(navigator, {
    canShare: () => true,
    share: vi.fn().mockResolvedValue(undefined),
  });
  // click, assert share called with files array containing a File
});

it('WhatsApp falls back to wa.me when share unsupported', async () => {
  Object.assign(navigator, { canShare: undefined, share: undefined });
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
  // click, assert openSpy called with https://wa.me/212660000000?text=...
});
```

- [ ] **Step 4: Run — expect FAIL**

Run: `cd web && npx vitest run src/pages/bons/BonsPage.test.tsx`
Expected: red on 3 new cases.

- [ ] **Step 5: Extend `BonsPage.tsx`**

Add per-row action cell. Inside the table row (adjacent to existing columns):

```tsx
<td>
  <button onClick={() => downloadPdf(row)} aria-label={t('bons.download')}>📄</button>
  <button onClick={() => shareWa(row)} aria-label={t('bons.shareWhatsApp')}>💬</button>
</td>
```

Handlers:

```ts
async function downloadPdf(row: Bon) {
  const blob = await getBonPdfBlob(row.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${row.number}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

async function shareWa(row: Bon) {
  const blob = await getBonPdfBlob(row.id);
  const file = new File([blob], `${row.number}.pdf`, { type: 'application/pdf' });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    await nav.share({ files: [file], title: row.number, text: `${row.number}` });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${row.number}.pdf`; a.click();
  URL.revokeObjectURL(url);
  const phone = normalizeMAPhone(row.customer?.phone ?? row.supplier?.phone);
  window.open(waLink(phone, row.number), '_blank');
}
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `cd web && npx vitest run`
Expected: 119 (prior) + 3 new all green.

- [ ] **Step 7: Build**

Run: `cd web && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```
git add web
git commit -m "feat(web): pdf + whatsapp share on bons"
```

---

### Task 6: Web — bon line editor unitPrice + subtotal

**Files:**
- Modify: whichever file renders the bon create/edit line rows (grep `web/src/pages/bons` for `ordered` input; likely `BonEditor.tsx` or inline in a modal). If none exists yet, extend the create modal in `BonsPage.tsx`.
- Test: extend `BonsPage.test.tsx` (or the editor's own spec if present).

**Interfaces:**
- Consumes: `BonLine.unitPrice`, `products` list (already fetched for product picker).
- Produces: bon-create request body with `unitPrice` per line.

- [ ] **Step 1: Locate editor**

Run: `grep -rn "ordered" web/src/pages/bons`
Pick the file with the qty input. Confirm where the product picker `onChange` lives.

- [ ] **Step 2: Add failing test — subtotal recalculates**

```tsx
it('recomputes subtotal when qty or unit price changes', async () => {
  render(<BonEditor products={[{ id: 'p1', name: 'X', price: 10 }]} />);
  await userEvent.selectOptions(screen.getByLabelText('Produit'), 'p1');
  await userEvent.type(screen.getByLabelText('Qté'), '3');
  expect(screen.getByTestId('line-subtotal')).toHaveTextContent('30.00');
  await userEvent.clear(screen.getByLabelText('PU'));
  await userEvent.type(screen.getByLabelText('PU'), '5');
  expect(screen.getByTestId('line-subtotal')).toHaveTextContent('15.00');
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Extend line row**

Add unit-price input beside qty:

```tsx
<input aria-label={t('bons.unitPrice')} type="number" min={0} step="0.01" value={line.unitPrice} onChange={(e) => update({ unitPrice: Number(e.target.value) })} />
<span data-testid="line-subtotal">{(Number(line.qty) * Number(line.unitPrice)).toFixed(2)}</span>
```

On product select:

```ts
const p = products.find(x => x.id === productId);
update({ productId, label: p?.name ?? '', unitPrice: Number(p?.price ?? 0) });
```

Add a total row summing `qty × unitPrice`.

Include `unitPrice` in the submit payload.

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd web && npx vitest run && npm run typecheck && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```
git add web
git commit -m "feat(web): unitPrice + subtotal in bon editor"
```

---

### Task 7: Mobile — pdf util + share

**Files:**
- Create: `mobile/src/lib/pdf.ts`
- Modify: `mobile/src/api/bons-queries.ts` (extend types)
- Modify: `mobile/app/bons.tsx` (row actions)
- Modify: `mobile/src/i18n/en.ts` `fr.ts` `ar.ts`
- Modify: `mobile/package.json` (verify deps)

**Interfaces:**
- Consumes: Task 3 endpoint, `BASE_URL` + `getAccessToken` from `src/api/client.ts`.
- Produces: `shareBonPdf(id: string, number: string): Promise<void>` — download to cache dir + open share sheet.

- [ ] **Step 1: Confirm deps**

Run: `cd mobile && npm ls expo-file-system expo-sharing`
If missing: `npx expo install expo-file-system expo-sharing`.

- [ ] **Step 2: Add i18n keys (same set as web, Task 5 Step 1)**

Under `bons:` in each of `mobile/src/i18n/{en,fr,ar}.ts`.

- [ ] **Step 3: `src/lib/pdf.ts`**

```ts
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getAccessToken } from '../api/client';
import Constants from 'expo-constants';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  ((Constants.expoConfig?.extra as Record<string, string> | undefined)?.API_URL) ??
  'http://localhost:3000/api/v1';

export async function shareBonPdf(id: string, number: string): Promise<void> {
  const uri = `${FileSystem.cacheDirectory}${number}.pdf`;
  const { status } = await FileSystem.downloadAsync(
    `${BASE_URL}/delivery-notes/${id}/pdf`,
    uri,
    { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } },
  );
  if (status !== 200) throw new Error(`pdf_${status}`);
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('sharing_unavailable');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: number,
  });
}
```

- [ ] **Step 4: Extend `bons-queries.ts` types**

Same as web: add `unitPrice`, `subtotal`, `totals`.

- [ ] **Step 5: Wire buttons in `app/bons.tsx`**

Each card gets:

```tsx
<Btn label={t('bons.download')} onPress={() => shareBonPdf(row.id, row.number)} />
<Btn label={t('bons.shareWhatsApp')} onPress={() => shareBonPdf(row.id, row.number)} />
```

Both call `shareBonPdf` — on iOS/Android the share sheet includes WhatsApp automatically when installed. Copy differs for clarity; behavior identical (single-source share sheet).

Wrap in `try { … } catch (e) { Alert.alert(t('common.error'), String((e as Error).message)); }`.

- [ ] **Step 6: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Manual verify**

Restart Expo `npx expo start --clear`. On device: open Bons, tap Share on a bon → share sheet appears → pick WhatsApp → PDF attached to chat.

- [ ] **Step 8: Commit**

```
git add mobile
git commit -m "feat(mobile): pdf download + whatsapp share on bons"
```

---

### Task 8: Mobile — bon line editor unitPrice + subtotal

**Files:**
- Modify: bon line editor screen — locate via `grep -rn "ordered" mobile/app mobile/src` and follow the qty input.
- Modify: `mobile/src/i18n/*.ts` (keys already added in Task 7).

**Interfaces:**
- Consumes: `product.price` from products query; `BonLine.unitPrice`.
- Produces: request payload includes `unitPrice` per line.

- [ ] **Step 1: Locate editor**

Run: `grep -rn "ordered" mobile/app mobile/src | grep -v node_modules`

- [ ] **Step 2: Add unitPrice `TextInput` + subtotal `<Text>`**

Next to qty input:

```tsx
<TextInput keyboardType="decimal-pad" value={String(line.unitPrice)}
  onChangeText={(t) => update({ unitPrice: Number(t.replace(',', '.')) || 0 })}
  placeholder={t('bons.unitPrice')} />
<Text>{(Number(line.qty) * Number(line.unitPrice)).toFixed(2)}</Text>
```

On product select prefill `unitPrice = Number(product.price ?? 0)`.

- [ ] **Step 3: Include unitPrice in submit payload**

- [ ] **Step 4: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual verify**

Create a fresh BL on device — 2 lines, edit PU — check total row updates. Submit — reopen from list — values persist.

- [ ] **Step 6: Commit**

```
git add mobile
git commit -m "feat(mobile): unitPrice + subtotal in bon editor"
```

---

### Task 9: Documentation

**Files:**
- Modify: `backend/docs/03-progress.md`
- Modify: `backend/docs/02-decisions.md` (only if a new D-XXX warranted)

**Interfaces:** none.

- [ ] **Step 1: Invoke `document-step` skill**

Append a log entry summarizing the shipped work — migration id, endpoint path, test counts (backend jest / web vitest), manual-verify evidence for both web share and mobile WhatsApp attach.

- [ ] **Step 2: Commit**

```
git add backend/docs
git commit -m "docs: bons pdf + whatsapp share"
```

---

## Self-Review

**Spec coverage:**
- Migration + unitPrice column → Task 1 ✓
- unitPrice prefill from product + subtotal computeTotals → Task 2 ✓
- PDF endpoint (pdfkit template) → Task 3 ✓
- Web PDF blob fetch → Task 4 ✓
- Web BonsPage actions (PDF + WhatsApp share w/ navigator.share + wa.me fallback + normalizeMAPhone) → Task 5 ✓
- Web line editor unitPrice + subtotal → Task 6 ✓
- Mobile share flow (expo-file-system + expo-sharing) → Task 7 ✓
- Mobile line editor unitPrice + subtotal → Task 8 ✓
- i18n keys (fr/en/ar) → Tasks 5, 7 ✓
- Tests (backend + web) → Tasks 2, 3, 5, 6 ✓
- Documentation → Task 9 ✓

**Placeholder scan:** grep-guided edits (`grep -rn "ordered"`) in Tasks 6, 8 — justified since the line-editor file is search-locatable and the plan gives the concrete snippet to insert; no generic "add error handling" phrases.

**Type consistency:** `getBonPdfBlob` (Task 4) called by Task 5; `shareBonPdf(id, number)` (Task 7) called by same-task step 5; `normalizeMAPhone` / `waLink` (Task 5) used in same task; `computeTotals` (Task 2) consumed by Task 3 (via `getById → totals`). Method / type names consistent across tasks.
