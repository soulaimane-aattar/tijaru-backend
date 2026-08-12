# Bons — PDF export + WhatsApp share

**Date:** 2026-08-12
**Scope:** `backend/` (module `delivery-notes`, new PDF endpoint), `web/` (bons list actions, line editor), `mobile/` (bons list actions, line editor). i18n en/fr/ar.
**Out of scope:** status enum rework (keep current `prepared/sent/shipped/partial/delivered/closed`); BL sign flow; stored subtotal column.

## Problem

Users want to send `bons` (BC / BL / BR) to customers over WhatsApp with:
- addressee (client for BL, fournisseur for BC/BR — already modeled),
- line items with quantity, product label, **unit price**, and **subtotal** (missing today),
- a shareable PDF attachment (missing today).

Current `DeliveryNoteLine` has `ordered` and `sent` but no `unitPrice`; there is no PDF endpoint; no share action in UI.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Add `unit_price Decimal(12,2)` to `delivery_note_lines`; default 0. | Enables subtotal without a schema-versioning story. |
| 2 | `subtotal` computed in app layer (not stored). BL uses `sent × unitPrice`; BC/BR use `ordered × unitPrice`. | Avoids drift when unit price is edited. |
| 3 | Prefill `unitPrice` from `product.price` on line create when omitted. Editable per line. | Fast entry; still overrideable. |
| 4 | PDF generated server-side (`pdfkit`), single template for all three types. Endpoint `GET /delivery-notes/:id/pdf`. | One template to evolve (logo / TVA / legal); consistent output across web + mobile. |
| 5 | Web share: `navigator.share({files:[pdfFile], title, text})` when supported; fallback = download + open `https://wa.me/<phone>?text=<link>`. | Best UX on mobile browsers; graceful on desktop. |
| 6 | Mobile share: `expo-file-system.downloadAsync` → `expo-sharing.shareAsync(uri, {mimeType:'application/pdf', UTI:'com.adobe.pdf'})`. | System share sheet includes WhatsApp when installed; PDF is pre-attached. |
| 7 | Keep existing status enum untouched. | Explicit user call. |

## Schema

Migration `20260812xxxxxx_bon_line_unit_price`:

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

Applied via `npx prisma migrate deploy` per env. Existing rows get `0` — acceptable (bons pre-feature have no price; UI shows dash).

## Backend

### DTO changes

`create-delivery-note.dto.ts` — `linesSchema[i]` gains `unitPrice: z.number().nonnegative().optional()`. If omitted, service prefills `product.price ?? 0`.

`update-line-sent.dto.ts` — unchanged. New optional `update-line.dto.ts` for editing `unitPrice` (PATCH `/delivery-notes/:id/lines/:lineId`).

### Service

`DeliveryNotesService`:
- `create()` — for each line, if `unitPrice` missing, read `product.price` and use it (0 fallback).
- New helper `computeTotals(note)`:
  ```ts
  const qtyOf = (l) => note.type === 'out' ? l.sent : l.ordered;
  const subtotal = lines.reduce((s, l) => s + qtyOf(l) * l.unitPrice, 0);
  ```
  Returned as Decimal (currency-safe) with `.toFixed(2)`.
- `getById()` response DTO gains `lines[].subtotal` and `totals.subtotal`.

### PDF endpoint

`GET /delivery-notes/:id/pdf` (Public? No — `@RequireCap('po.manage')`, `@RequiresModule('delivery-notes')`; tenant-scoped like other reads):

1. Load note w/ business, customer, supplier, issuedBy, lines→product.
2. Assert business match (existing pattern).
3. Stream via `pdfkit`:
   - **Header:** business.name (bold), address, ICE, phone.
   - **Title:** type label (Bon de commande / Bon de livraison / Bon de réception) + `note.number` + `date`.
   - **Destinataire block:** customer (for `out`) or supplier (for `order|in_`) — name, phone, address.
   - **Table:** columns `Produit | Qté | PU | Sous-total`. Quantity = `sent` for BL else `ordered`. Subtotal per line.
   - **Total** row (right-aligned).
   - **Footer:** statut label, signé Y/N + date, notes.
   - Font: default `Helvetica`. Arabic labels deferred.
4. Response: `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<number>.pdf"`.

Dependency: `pdfkit` (~1.5 MB installed, MIT). Add to `backend/package.json`.

## Web

### API client (`src/api/bons.ts`)

```ts
export type BonLine = { …; unitPrice: number; subtotal: number };
export type Bon = { …; lines: BonLine[]; totals: { subtotal: number } };

// Extend web/src/api/client.ts: export a `fetchBlob(path)` helper that
// wraps rawFetch (auth + refresh) and returns the raw Response. Then:
export async function getBonPdfBlob(id: string): Promise<Blob> {
  const res = await fetchBlob(`/delivery-notes/${id}/pdf`);
  if (!res.ok) throw new Error(`pdf_${res.status}`);
  return await res.blob();
}
```

### Bons list (`pages/bons/BonsPage.tsx`)

Row actions column adds two icon buttons:
- **📄 PDF** → `getBonPdfBlob` → `URL.createObjectURL` → anchor download `<number>.pdf`.
- **💬 WhatsApp** → 
  ```ts
  const blob = await getBonPdfBlob(id);
  const file = new File([blob], `${number}.pdf`, { type: 'application/pdf' });
  if (navigator.canShare?.({ files:[file] })) {
    await navigator.share({ files:[file], title: number, text: `${businessName} — ${number}` });
    return;
  }
  // Fallback
  triggerDownload(blob, `${number}.pdf`);
  const phone = normalizeMAPhone(customer?.phone ?? supplier?.phone);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`${businessName} — ${number}`)}`, '_blank');
  ```
- `normalizeMAPhone`: strip non-digits; if 10 digits starting `0`, replace with `212`; return `''` if empty.

### Line editor

Wherever bon lines are edited (create / edit form — currently ordered-only), add `unitPrice` input:
- Type `number`, `min={0}`, `step="0.01"`, prefilled from `product.price` on product select.
- Subtotal cell reads `qty × unitPrice` live.
- Total row under table.

## Mobile

### API queries (`src/api/bons-queries.ts`)

Same type extension. New util in `src/lib/pdf.ts`:

```ts
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getAccessToken } from '../api/client';

export async function shareBonPdf(id: string, number: string): Promise<void> {
  const url = `${BASE_URL}/delivery-notes/${id}/pdf`;
  const uri = `${FileSystem.cacheDirectory}${number}.pdf`;
  const { status } = await FileSystem.downloadAsync(url, uri, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });
  if (status !== 200) throw new Error(`pdf_download_${status}`);
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: number,
  });
}
```

### Bons list (`app/bons.tsx`)

Each card gets two buttons: **PDF** (opens native viewer via share sheet) and **WhatsApp** (same share sheet; WhatsApp shows if installed with PDF attached).

### Line editor

Same `unitPrice` input + subtotal display in bon form screen.

### Deps

Add to `mobile/package.json`: `expo-sharing`, `expo-file-system` (verify present — both ship with Expo SDK; likely already installed).

## i18n

New FR keys (mirror EN + AR):

```ts
bons: {
  download: 'Télécharger PDF',
  shareWhatsApp: 'Partager sur WhatsApp',
  unitPrice: 'PU',
  subtotal: 'Sous-total',
  total: 'Total',
  destinataire: 'Destinataire',
}
```

Applied in `web/src/i18n/*.ts` and `mobile/src/i18n/*.ts`.

## Tests

### Backend (`backend/src/modules/delivery-notes/*.spec.ts`)

- `create()` — unitPrice defaults to `product.price` when omitted; explicit unitPrice preserved.
- `computeTotals` — subtotal uses `sent` for BL, `ordered` for BC/BR; multiple lines aggregate correctly; empty lines → 0.
- PDF endpoint (integration): `GET /delivery-notes/:id/pdf` → `200`, `Content-Type: application/pdf`, body starts with `%PDF-`.
- Auth: unauthenticated → 401; other tenant → 404.

### Web (`web/src/pages/bons/BonsPage.test.tsx`)

- PDF button click → `getBonPdfBlob` called with row id.
- WhatsApp click w/ mocked `navigator.canShare` true → `navigator.share` called with files array.
- WhatsApp click w/ `canShare` unsupported → download triggered + `window.open` called with `wa.me/<212...>?text=...`.
- Line editor — subtotal updates when qty or unitPrice changes.

### Mobile

Skipped (no RN test harness yet).

## Rollout

1. Backend migration + PDF endpoint + tests.
2. Web changes + tests.
3. Mobile changes.
4. Manual verify: create BL with 2 lines → PDF button → WhatsApp share → arrives on target device with attached PDF.
5. `document-step`.

## Risks

- `pdfkit` bundle size: ~1.5 MB — acceptable in server image.
- `navigator.share` w/ files unsupported on desktop Firefox / older Safari → fallback covers.
- WhatsApp file-attach via `wa.me` link **not** supported (only text). Attachment path is `navigator.share` (web) / `Sharing.shareAsync` (mobile). Fallback link therefore ships text-only + user manually attaches downloaded PDF — documented in UI helper text.
- Arabic PDF text: `pdfkit` default fonts lack Arabic glyphs. Header/labels stay French for now; product labels rendered as stored (Latin-only bons work; Arabic labels may show boxes — call out in follow-up).
