# Dépenses module + receipt OCR — design

**Date:** 2026-08-03
**Status:** approved (design), not implemented
**Scope:** v1 minimal expense tracking + receipt image upload with automatic field extraction

---

## 1. Problem

`docs/01-project-overview.md` lists **Dépenses / Expense tracking** as a product module. Nothing exists:

- No `Expense` model in `backend/prisma/schema.prisma` (34 models, none expense-related)
- No `backend/src/modules/expenses/`
- No web page, no i18n keys, no capability ids
- **No file-upload infrastructure anywhere in the backend** — no multer, no `FileInterceptor`, no storage service

Merchants record dépenses today by hand. Typing a total off a paper receipt is the slowest, most error-prone part. The goal: photograph the receipt, get the montant and date filled in, confirm, save.

## 2. Scope

**In (v1):**

- `Expense` CRUD, list page with totals, category breakdown
- Receipt image upload, stored on the backend filesystem
- Automatic extraction of **montant, TVA, date, nom du commerçant** from the photo
- Module gating via `BusinessModule` + role capabilities

**Out (YAGNI):** recurring expenses, approval workflow, line-item extraction, P&L reporting, S3/object storage, background job queue, expense budgets.

## 3. Key decisions

### D-a — Python OCR service, not a Node library

Tesseract.js in-process was the cheap option (zero new services). Rejected: Tesseract scores ~45% on hard/degraded input vs ~73% for PaddleOCR-family models, and it is markedly worse on the small dense fonts typical of thermal receipts. Accuracy is the whole point of the feature — a scan that fills in the wrong montant is worse than no scan, because the user may not catch it.

### D-b — RapidOCR, not PaddleOCR proper

RapidOCR runs PaddleOCR's trained models on ONNXRuntime, dropping the PaddlePaddle framework:

| | PaddleOCR | RapidOCR |
|---|---|---|
| Install size | ~500 MB | **~80 MB** |
| CPU inference | slow without GPU | **0.2–1 s/page, CPU-optimized** |
| Long-running procs | known memory leak | fixed |

Same models, same recognition accuracy. PaddleOCR's only real advantage is PP-StructureV3 table parsing, which v1 does not need (no line items). The deployment target is a CPU docker-compose host, so RapidOCR wins on every axis that matters here.

### D-c — Field extraction lives in Python, using bounding boxes

The naive pipeline is `image → raw text → regex`. It fails: OCR noise turns `RM28.20` into `IRMZ8. 20`, and decorative receipt text defeats line-based regex.

RapidOCR returns each detected text block **with its bounding box**. Flattening to a string discards that geometry. The extractor keeps it:

1. Locate the box whose text matches `TOTAL|TTC|MONTANT|NET À PAYER|A PAYER|الإجمالي`
2. Take the amount-shaped box in the **same horizontal band**, rightmost
3. Fall back: largest amount-shaped value in the bottom third of the image
4. Emit a per-field confidence

This is why extraction belongs in the Python service and not in NestJS — the geometry does not survive the service boundary.

### D-d — French/Latin model in v1, Arabic behind a flag

PP-OCRv5 covers 106 languages including French and Arabic, but each pass costs latency. v1 runs the Latin model. `OCR_LANGS=fr,ar` enables a second Arabic pass, off by default.

### D-e — Local filesystem storage, served through an authenticated route

Receipts go to `backend/uploads/<businessId>/<cuid>.<ext>`. Tenant-scoped paths make cross-tenant reads impossible by construction.

They are served by `GET /expenses/:id/receipt` behind the normal auth guard — **not** Nest's static-file middleware. Static serving would make every tenant's receipts readable by anyone holding a URL, and receipts contain supplier names and amounts.

### D-f — Scan suggests, the user commits

`POST /expenses/scan` never creates an `Expense`. It returns a suggestion the form pre-fills and visibly marks as unverified. OCR is probabilistic; silently persisting its guesses would put wrong numbers in the books. Correspondingly, OCR failure never blocks recording an expense — the form opens blank with the receipt still attached.

## 4. Architecture

```
web :8080 ──> backend :3002 ──(internal HTTP)──> ocr-service :8000
                    │                                   │
             uploads/ on disk                   RapidOCR (ONNX, CPU)
                    │
              postgres :5433
```

A fourth app joins `backend/`, `web/`, `mobile/`: **`ocr-service/`** — Python 3.12 + FastAPI + RapidOCR, own Dockerfile, added to `docker-compose`. **No published host port** — reachable only on the compose network from `backend`. It holds no state and never touches Postgres.

## 5. Data model

```prisma
enum ExpenseCategory {
  rent utilities salaries supplies transport
  maintenance taxes marketing other
}

enum OcrStatus { pending done failed }

model Expense {
  id            String          @id @default(cuid())
  businessId    String          @map("business_id")
  warehouseId   String?         @map("warehouse_id")
  date          DateTime
  amount        Decimal         @db.Decimal(12, 2)
  taxAmount     Decimal?        @db.Decimal(12, 2) @map("tax_amount")
  category      ExpenseCategory @default(other)
  supplierId    String?         @map("supplier_id")
  merchantName  String?         @map("merchant_name")
  note          String?
  paymentMethod PaymentMethod   @default(cash) @map("payment_method")
  receiptPath   String?         @map("receipt_path")
  ocrStatus     OcrStatus?      @map("ocr_status")
  ocrRaw        Json?           @map("ocr_raw")
  createdById   String          @map("created_by_id")
  createdAt     DateTime        @default(now()) @map("created_at")
  updatedAt     DateTime        @updatedAt @map("updated_at")

  business  Business   @relation(fields: [businessId], references: [id], onDelete: Cascade)
  warehouse Warehouse? @relation(fields: [warehouseId], references: [id])
  supplier  Supplier?  @relation(fields: [supplierId], references: [id])
  createdBy User       @relation(fields: [createdById], references: [id])

  @@index([businessId, date])
  @@map("expenses")
}
```

- Amounts in MAD, matching the existing money columns (no currency column exists in the schema).
- `paymentMethod` reuses the existing `PaymentMethod` enum (`cash | card | credit | split`).
- `receiptPath` is **relative** (`<businessId>/<cuid>.jpg`); the storage root is config, so moving the volume does not require a data migration.
- `ocrRaw` keeps the blocks + confidences so a bad extraction can be re-parsed offline without re-running OCR.
- Back-relations added on `Business`, `Warehouse`, `Supplier`, `User`.

## 6. Permissions and gating

Following `backend/src/domain/permissions.ts`:

- New capability ids: `expenses.view`, `expenses.create`, `expenses.edit`, `expenses.delete`
- Entries in `CAPABILITIES` with `domain: 'expenses'` and French labels, matching the existing style
- `ROLE_PERMS`: owner (all, via `CAPABILITY_IDS`), admin (all four), manager (view/create/edit), stockkeeper (none), cashier (none), viewer (`expenses.view`)
- Module id `expenses` in `BusinessModule` for per-business feature gating

## 7. Backend module

`backend/src/modules/expenses/`

| File | Responsibility |
|---|---|
| `expenses.controller.ts` | CRUD, `GET /expenses/summary`, `POST /expenses/scan`, `GET /expenses/:id/receipt` |
| `expenses.service.ts` | Business logic, tenant scoping |
| `storage/local-storage.service.ts` | Write/read/delete under `<root>/<businessId>/`; only file-path knowledge in the codebase |
| `ocr/ocr.provider.ts` | `interface OcrProvider { extract(buf, filename): Promise<OcrResult> }` |
| `ocr/http-ocr.provider.ts` | Calls `ocr-service`; 5 s timeout, 1 retry |
| `dto/` | Create/update/query DTOs with `class-validator` |

The `OcrProvider` interface exists so Nest e2e tests run with a mock and **never require Python to be running**.

### `POST /expenses/scan`

`multipart/form-data`, `FileInterceptor`. Validation, in order:

1. Size ≤ 8 MB
2. Extension in `jpg|jpeg|png|webp|heic`
3. **Magic-byte sniff of the buffer** — declared mimetype is attacker-controlled and must not be trusted

Then: write to disk → POST bytes to `ocr-service` → return

```json
{
  "receiptPath": "<businessId>/<cuid>.jpg",
  "ocrStatus": "done",
  "suggestion": {
    "amount": 284.50,
    "taxAmount": 47.42,
    "date": "2026-08-01",
    "merchantName": "MARJANE HOLDING",
    "confidence": { "amount": 0.94, "date": 0.71, "merchantName": 0.55 }
  }
}
```

No `Expense` row is created.

## 8. OCR service

`ocr-service/` — FastAPI, one meaningful endpoint.

`POST /extract` (multipart) → `{ blocks: [{text, box, score}], suggestion: {...} }`

| File | Responsibility |
|---|---|
| `main.py` | FastAPI app, `/extract`, `/health` |
| `ocr.py` | RapidOCR engine wrapper, loaded once at startup |
| `preprocess.py` | Grayscale, contrast normalize, deskew, upscale small images |
| `extract.py` | **Pure function** `blocks -> suggestion`. No I/O. The real logic |
| `tests/fixtures/` | Saved block-JSON from real receipts |

Models are **baked into the image at build time**, not downloaded on first run — otherwise the first scan on a fresh or offline prod host fails.

## 9. Web

- `web/src/pages/ExpensesPage.tsx` — list, filters (date range, category), totals per category
- `web/src/pages/ExpenseFormPage.tsx` — create/edit, receipt drop zone
- `web/src/api/expenses.ts` — client
- i18n keys under `expenses.*`
- Route + nav entry gated on `expenses.view` and the `expenses` module

Scan flow: drop photo → spinner → form fields pre-filled, each scanned field visibly marked *"scanné — à vérifier"*, low-confidence fields marked more strongly → user edits → saves.

## 10. Error handling

| Failure | Behavior |
|---|---|
| Oversize / wrong type / bad magic bytes | 400 **before** any disk write |
| `ocr-service` down or timeout | `ocrStatus: failed`, empty suggestion, **HTTP 200** — form opens blank, receipt still attached |
| OCR runs but finds no amount | `ocrStatus: done`, `suggestion.amount: null` |
| Disk full / write error | 500, no orphan row |
| Expense deleted | Receipt file deleted best-effort; failure logged, not surfaced |

Scanning is an assist. No scan failure may prevent recording an expense.

## 11. Testing

**`extract.py` unit tests (pytest) are the primary coverage.** Fixtures: Moroccan French receipt, Arabic/French mixed, faded thermal, receipt with several `TOTAL`-like lines, receipt with no total at all, amounts with `,` decimal separator.

- Nest e2e: upload → suggestion shape; oversize rejected; wrong magic bytes rejected; **tenant A cannot fetch tenant B's receipt**; CRUD + summary
- Web: form pre-fill from suggestion, failed-scan path leaves form usable

## 12. Risks

- **Image size.** Python + onnxruntime + models ≈ 400 MB. Accepted for accuracy; mitigated by RapidOCR over PaddleOCR (~80 MB of deps rather than ~500 MB).
- **Cold start.** Engine init on first request adds latency. Load at app startup, not per request.
- **Extraction accuracy is not guaranteed.** Mitigated end-to-end by design: user confirms every field, and confidence is surfaced in the UI.
- **`uploads/` needs a volume** in docker-compose, or receipts vanish on container rebuild.
