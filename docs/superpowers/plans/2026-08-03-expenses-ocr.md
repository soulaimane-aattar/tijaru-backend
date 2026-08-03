# Dépenses + Receipt OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dépenses module to Tijaru where a merchant photographs a receipt and gets montant, TVA, date and merchant name pre-filled into the expense form.

**Architecture:** Three moving parts. (1) A new `Expense` Prisma model + NestJS module in `backend/` following the existing port/adapter layout. (2) A new fourth app `ocr-service/` — Python 3.12 + FastAPI + RapidOCR — running on the compose network with no published host port, which does both OCR and bounding-box-aware field extraction. (3) Two new React pages in `web/`. The backend stores receipt images on its own filesystem and proxies bytes to the OCR service; the OCR service is stateless and never touches Postgres.

**Tech Stack:** NestJS 10 + Prisma 5 + Zod · React + Vite + TanStack Query + Tailwind · Python 3.12 + FastAPI + RapidOCR (ONNXRuntime) · Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-03-expenses-ocr-design.md`

## Global Constraints

- **This repo is not a git repository** (`git rev-parse` → `fatal: not a git repository`). The "Commit" steps below are written as `git` commands for when a repo exists. If `git status` fails, skip the commit step and move to the next task — do not run `git init` without asking.
- Ports are fixed: web `8080`, api `3002`, postgres `5433`. The `.env` `DATABASE_URL` may point at the wrong project's DB — **always override with 5433** when running migrations.
- OCR service gets **no published host port**. Compose-network access only.
- DTO validation uses **Zod + `ZodValidationPipe`**, never `class-validator`, even though `class-validator` is in `package.json` for legacy reasons.
- Backend modules use the port/adapter layout: `domain/<x>.repository.ts` (abstract class as DI token), `application/<x>.service.ts`, `infrastructure/prisma-<x>.repository.ts`, `dto/<x>.dto.ts`, `<x>.controller.ts`, `<x>.module.ts`.
- Tenant scoping is **automatic**: the Prisma middleware injects and filters `businessId` for every model listed in `TENANT_MODELS`. Repositories never write `businessId` by hand — they wrap create payloads in `scoped<T>()`.
- All user-facing strings are French-first, with `en` and `ar` translations added in the same commit.
- Money is `Decimal(12, 2)` in MAD. No currency column exists in the schema; do not add one.
- Backend runs `npm run typecheck && npm run lint && npm test` clean before any task is considered done.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `ocr-service/app/extract.py` | Pure `blocks -> suggestion`. No I/O. The accuracy-critical logic |
| `ocr-service/app/preprocess.py` | Grayscale, contrast, upscale before OCR |
| `ocr-service/app/ocr.py` | RapidOCR engine wrapper, loaded once at startup |
| `ocr-service/app/main.py` | FastAPI: `POST /extract`, `GET /health` |
| `ocr-service/tests/test_extract.py` | Fixture-driven extractor tests — primary coverage |
| `ocr-service/Dockerfile` | Python 3.12-slim, models baked at build |
| `backend/src/modules/expenses/**` | Expense CRUD, scan endpoint, storage, OCR client |
| `web/src/pages/ExpensesPage.tsx` | List + filters + totals |
| `web/src/pages/ExpenseFormPage.tsx` | Create/edit + receipt drop zone |
| `web/src/api/expense-queries.ts` | TanStack Query hooks |

**Modified:** `backend/prisma/schema.prisma`, `backend/src/common/tenant/tenant-context.ts`, `backend/src/domain/permissions.ts`, `backend/src/config/env.ts`, `backend/src/app.module.ts`, `backend/docker-compose.yml`, `web/src/App.tsx`, `web/src/layouts/AdminShell.tsx`, `web/src/i18n/{fr,en,ar}.ts`

---

### Task 1: Expense schema + tenant registration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/common/tenant/tenant-context.ts:6-23`
- Test: `backend/src/common/tenant/tenant-context.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: Prisma model `Expense`, enums `ExpenseCategory` (`rent|utilities|salaries|supplies|transport|maintenance|taxes|marketing|other`) and `OcrStatus` (`pending|done|failed`). `prisma.expense` client accessor available to all later backend tasks.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/common/tenant/tenant-context.spec.ts`:

```typescript
import { TENANT_MODELS } from './tenant-context';

describe('TENANT_MODELS', () => {
  it('auto-scopes the Expense model', () => {
    expect(TENANT_MODELS.has('Expense')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/common/tenant/tenant-context.spec.ts -t "auto-scopes the Expense"`
Expected: FAIL — `expect(false).toBe(true)`

- [ ] **Step 3: Add the enums and model to `schema.prisma`**

Append at the end of the schema file:

```prisma
// ─── Expenses (dépenses) ─────────────────────────────────────────────────────

enum ExpenseCategory {
  rent
  utilities
  salaries
  supplies
  transport
  maintenance
  taxes
  marketing
  other
}

enum OcrStatus {
  pending
  done
  failed
}

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

Add the back-relation `expenses Expense[]` to four existing models: `Business` (after `activities Activity[]`), `Warehouse`, `Supplier`, and `User`. Prisma fails validation if any is missing.

- [ ] **Step 4: Register `Expense` in `TENANT_MODELS`**

In `backend/src/common/tenant/tenant-context.ts`, add `'Expense',` to the `TENANT_MODELS` set, after `'Activity',`.

- [ ] **Step 5: Generate the migration**

```bash
cd backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/stock?schema=public" \
  npx prisma migrate dev --name add_expenses
```

Expected: a new folder under `backend/prisma/migrations/` containing `CREATE TABLE "expenses"`. If the command reports drift or asks to reset, **stop and report** — do not accept a reset, it destroys development data.

- [ ] **Step 6: Run tests and typecheck**

Run: `cd backend && npx prisma generate && npm run typecheck && npx jest src/common/tenant`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/src/common/tenant
git commit -m "feat(expenses): add Expense model and tenant scoping"
```

---

### Task 2: Expense capabilities

**Files:**
- Modify: `backend/src/domain/permissions.ts`
- Test: `backend/src/domain/permissions.spec.ts`

**Interfaces:**
- Consumes: Task 1 (nothing at runtime — independent, but ordered for coherent commits)
- Produces: `CapabilityId` union gains `'expenses.view' | 'expenses.create' | 'expenses.edit' | 'expenses.delete'`. Controllers in Task 7 and 8 use these in `@RequireCap(...)`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/domain/permissions.spec.ts`:

```typescript
import { CAPABILITIES, CAPABILITY_IDS, ROLE_PERMS } from './permissions';

describe('expenses capabilities', () => {
  const EXPENSE_CAPS = [
    'expenses.view',
    'expenses.create',
    'expenses.edit',
    'expenses.delete',
  ] as const;

  it('registers all four expense capability ids', () => {
    for (const cap of EXPENSE_CAPS) {
      expect(CAPABILITY_IDS).toContain(cap);
      expect(CAPABILITIES[cap]?.domain).toBe('expenses');
    }
  });

  it('grants owner and admin every expense capability', () => {
    for (const cap of EXPENSE_CAPS) {
      expect(ROLE_PERMS.owner.has(cap)).toBe(true);
      expect(ROLE_PERMS.admin.has(cap)).toBe(true);
    }
  });

  it('lets manager record expenses but not delete them', () => {
    expect(ROLE_PERMS.manager.has('expenses.create')).toBe(true);
    expect(ROLE_PERMS.manager.has('expenses.edit')).toBe(true);
    expect(ROLE_PERMS.manager.has('expenses.delete')).toBe(false);
  });

  it('gives viewer read-only access and stockkeeper/cashier none', () => {
    expect(ROLE_PERMS.viewer.has('expenses.view')).toBe(true);
    expect(ROLE_PERMS.viewer.has('expenses.create')).toBe(false);
    expect(ROLE_PERMS.stockkeeper.has('expenses.view')).toBe(false);
    expect(ROLE_PERMS.cashier.has('expenses.view')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/domain/permissions.spec.ts -t "expenses capabilities"`
Expected: FAIL — `expect(CAPABILITY_IDS).toContain('expenses.view')`

- [ ] **Step 3: Add the capabilities**

In `backend/src/domain/permissions.ts`:

1. Add to the `CAPABILITY_IDS` array (keep the existing grouping style, one domain per block):

```typescript
  'expenses.view',
  'expenses.create',
  'expenses.edit',
  'expenses.delete',
```

2. Add to the `CAPABILITIES` record:

```typescript
  'expenses.view': { id: 'expenses.view', domain: 'expenses', labelFr: 'Voir dépenses' },
  'expenses.create': { id: 'expenses.create', domain: 'expenses', labelFr: 'Créer dépenses' },
  'expenses.edit': { id: 'expenses.edit', domain: 'expenses', labelFr: 'Modifier dépenses' },
  'expenses.delete': { id: 'expenses.delete', domain: 'expenses', labelFr: 'Supprimer dépenses' },
```

3. In `ROLE_PERMS`: `owner` already spreads `CAPABILITY_IDS`, so it needs no change. Add all four to `admin`. Add `'expenses.view'`, `'expenses.create'`, `'expenses.edit'` to `manager`. Add `'expenses.view'` to `viewer`. Leave `stockkeeper` and `cashier` untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/domain/permissions.spec.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/permissions.ts backend/src/domain/permissions.spec.ts
git commit -m "feat(expenses): add expense capabilities to permission matrix"
```

---

### Task 3: OCR field extractor (pure logic, TDD)

This is the accuracy-critical task. It has no dependency on RapidOCR being installed — it operates on already-extracted blocks, so it is fast to iterate and fully deterministic.

**Files:**
- Create: `ocr-service/app/__init__.py` (empty)
- Create: `ocr-service/app/extract.py`
- Create: `ocr-service/tests/__init__.py` (empty)
- Create: `ocr-service/tests/test_extract.py`
- Create: `ocr-service/requirements.txt`
- Create: `ocr-service/requirements-dev.txt`

**Interfaces:**
- Consumes: nothing
- Produces:

```python
Block = TypedDict('Block', {'text': str, 'box': list[list[float]], 'score': float})
# box is 4 [x, y] corner points, clockwise from top-left — RapidOCR's native format

def extract(blocks: list[Block]) -> dict
# returns {"amount": float|None, "taxAmount": float|None, "date": "YYYY-MM-DD"|None,
#          "merchantName": str|None, "confidence": {field: float}}
```

Task 4 imports `extract`. Task 6's `OcrResult` TypeScript type mirrors this shape exactly.

- [ ] **Step 1: Create the dependency manifests**

`ocr-service/requirements.txt`:

```
fastapi==0.115.6
uvicorn[standard]==0.34.0
python-multipart==0.0.20
rapidocr-onnxruntime==1.4.4
opencv-python-headless==4.10.0.84
numpy==2.2.1
```

`ocr-service/requirements-dev.txt`:

```
-r requirements.txt
pytest==8.3.4
httpx==0.28.1
```

- [ ] **Step 2: Write the failing tests**

`ocr-service/tests/test_extract.py`:

```python
from app.extract import extract


def block(text: str, x: float, y: float, w: float = 80, h: float = 20, score: float = 0.95):
    """Build a RapidOCR-shaped block from a top-left corner plus size."""
    return {
        "text": text,
        "box": [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        "score": score,
    }


def test_picks_amount_on_the_same_line_as_total():
    blocks = [
        block("MARJANE HOLDING", 20, 10, w=200),
        block("Article A", 20, 60),
        block("12,00", 300, 60),
        block("TOTAL TTC", 20, 200),
        block("284,50", 300, 200),
    ]
    assert extract(blocks)["amount"] == 284.50


def test_prefers_total_over_larger_unrelated_amount():
    """A subtotal or an item price may be numerically larger; the TOTAL keyword wins."""
    blocks = [
        block("ACOMPTE", 20, 60),
        block("999,99", 300, 60),
        block("NET A PAYER", 20, 200),
        block("284,50", 300, 200),
    ]
    assert extract(blocks)["amount"] == 284.50


def test_parses_dot_decimal_separator():
    blocks = [block("TOTAL", 20, 200), block("1284.50", 300, 200)]
    assert extract(blocks)["amount"] == 1284.50


def test_strips_currency_suffix_and_thousands_separator():
    blocks = [block("TOTAL", 20, 200), block("1 284,50 DH", 300, 200)]
    assert extract(blocks)["amount"] == 1284.50


def test_falls_back_to_largest_amount_in_bottom_third():
    """No TOTAL keyword survived OCR — take the biggest amount low on the receipt."""
    blocks = [
        block("Article A", 20, 20),
        block("12,00", 300, 20),
        block("284,50", 300, 500),
        block("30,00", 300, 520),
    ]
    result = extract(blocks)
    assert result["amount"] == 284.50
    assert result["confidence"]["amount"] < 0.6


def test_returns_none_when_no_amount_present():
    blocks = [block("MERCI DE VOTRE VISITE", 20, 20, w=300)]
    result = extract(blocks)
    assert result["amount"] is None
    assert result["confidence"]["amount"] == 0.0


def test_extracts_tva_separately_from_total():
    blocks = [
        block("TVA 20%", 20, 170),
        block("47,42", 300, 170),
        block("TOTAL TTC", 20, 200),
        block("284,50", 300, 200),
    ]
    result = extract(blocks)
    assert result["amount"] == 284.50
    assert result["taxAmount"] == 47.42


def test_parses_french_slash_date():
    blocks = [block("Le 01/08/2026 14:32", 20, 40, w=220), block("TOTAL", 20, 200), block("10,00", 300, 200)]
    assert extract(blocks)["date"] == "2026-08-01"


def test_parses_iso_and_dashed_dates():
    assert extract([block("2026-08-01", 20, 40)])["date"] == "2026-08-01"
    assert extract([block("01-08-2026", 20, 40)])["date"] == "2026-08-01"


def test_ignores_impossible_dates():
    assert extract([block("99/99/9999", 20, 40)])["date"] is None


def test_merchant_name_is_the_topmost_wide_text_block():
    blocks = [
        block("MARJANE HOLDING", 20, 10, w=240),
        block("Casablanca", 20, 35, w=100),
        block("TOTAL", 20, 200),
        block("10,00", 300, 200),
    ]
    assert extract(blocks)["merchantName"] == "MARJANE HOLDING"


def test_merchant_name_skips_numeric_headers():
    blocks = [block("0522 33 44 55", 20, 10, w=240), block("CAFE ATLAS", 20, 40, w=200)]
    assert extract(blocks)["merchantName"] == "CAFE ATLAS"


def test_empty_input_is_safe():
    result = extract([])
    assert result == {
        "amount": None,
        "taxAmount": None,
        "date": None,
        "merchantName": None,
        "confidence": {"amount": 0.0, "taxAmount": 0.0, "date": 0.0, "merchantName": 0.0},
    }


def test_arabic_total_keyword_is_recognised():
    blocks = [block("الإجمالي", 20, 200), block("284,50", 300, 200)]
    assert extract(blocks)["amount"] == 284.50
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd ocr-service && python -m pytest tests/test_extract.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.extract'`

- [ ] **Step 4: Implement the extractor**

`ocr-service/app/extract.py`:

```python
"""Bounding-box-aware field extraction from OCR blocks.

Plain-text regex over concatenated OCR output is unreliable: receipts are noisy
and a naive "first number after TOTAL" rule breaks whenever a decorative line or
a mis-read character lands between the label and the value. RapidOCR gives us a
box per text fragment, so we keep the geometry and match the amount to the label
that sits on the same horizontal band.
"""

from __future__ import annotations

import re
from datetime import date as _date
from typing import Any

# Keywords that mark the grand total, in French, English and Arabic. Ordered by
# specificity: "NET A PAYER" is a stronger signal than a bare "TOTAL".
TOTAL_KEYWORDS = (
    "NET A PAYER",
    "NET À PAYER",
    "TOTAL TTC",
    "MONTANT TTC",
    "TOTAL",
    "MONTANT",
    "A PAYER",
    "الإجمالي",
    "المجموع",
)

TAX_KEYWORDS = ("TVA", "T.V.A", "TAXE", "VAT", "الضريبة")

# 1 234,56 / 1.234,56 / 1234.56 / 284,50 DH — optional grouping, 2-decimal tail.
AMOUNT_RE = re.compile(r"(?<![\d])(\d{1,3}(?:[ . ]\d{3})*|\d+)[.,](\d{2})(?![\d])")
DATE_RES = (
    re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)"),          # 2026-08-01
    re.compile(r"(?<!\d)(\d{2})[/.\-](\d{2})[/.\-](\d{4})(?!\d)"),  # 01/08/2026
    re.compile(r"(?<!\d)(\d{2})[/.\-](\d{2})[/.\-](\d{2})(?!\d)"),  # 01/08/26
)

EMPTY: dict[str, Any] = {
    "amount": None,
    "taxAmount": None,
    "date": None,
    "merchantName": None,
    "confidence": {"amount": 0.0, "taxAmount": 0.0, "date": 0.0, "merchantName": 0.0},
}


def _y(block: dict) -> float:
    """Vertical centre of a block."""
    return sum(point[1] for point in block["box"]) / 4.0


def _x_left(block: dict) -> float:
    return min(point[0] for point in block["box"])


def _height(block: dict) -> float:
    ys = [point[1] for point in block["box"]]
    return max(ys) - min(ys)


def _width(block: dict) -> float:
    xs = [point[0] for point in block["box"]]
    return max(xs) - min(xs)


def _parse_amount(text: str) -> float | None:
    """Largest 2-decimal number in `text`, or None. Handles , and . separators."""
    best: float | None = None
    for whole, cents in AMOUNT_RE.findall(text):
        value = float(f"{re.sub(r'[ . ]', '', whole)}.{cents}")
        if best is None or value > best:
            best = value
    return best


def _parse_date(text: str) -> str | None:
    for pattern in DATE_RES:
        match = pattern.search(text)
        if not match:
            continue
        a, b, c = match.groups()
        if len(a) == 4:
            year, month, day = int(a), int(b), int(c)
        else:
            day, month, year = int(a), int(b), int(c)
            if year < 100:
                year += 2000
        try:
            return _date(year, month, day).isoformat()
        except ValueError:
            continue  # 99/99/9999 and friends
    return None


def _same_band(a: dict, b: dict) -> bool:
    """True when two blocks sit on the same printed line.

    Tolerance scales with text height so it holds for both a 12px receipt footer
    and a 40px header.
    """
    tolerance = max(_height(a), _height(b), 12.0) * 0.7
    return abs(_y(a) - _y(b)) <= tolerance


def _find_labelled_amount(
    blocks: list[dict], keywords: tuple[str, ...]
) -> tuple[float | None, float]:
    """Amount on the same band as the best-matching keyword. Returns (value, confidence)."""
    for rank, keyword in enumerate(keywords):
        for label in blocks:
            if keyword not in label["text"].upper() and keyword not in label["text"]:
                continue
            # Prefer a value to the right of the label; fall back to the label's own text.
            candidates = [
                b
                for b in blocks
                if b is not label and _same_band(label, b) and _x_left(b) >= _x_left(label)
            ]
            candidates.sort(key=_x_left, reverse=True)
            for candidate in candidates:
                value = _parse_amount(candidate["text"])
                if value is not None:
                    # Earlier (more specific) keywords score higher.
                    penalty = min(rank, 4) * 0.03
                    return value, round(min(candidate["score"], 0.99) - penalty, 3)
            inline = _parse_amount(label["text"])
            if inline is not None:
                return inline, round(min(label["score"], 0.99) - 0.1, 3)
    return None, 0.0


def _fallback_amount(blocks: list[dict]) -> tuple[float | None, float]:
    """No usable keyword: take the largest amount in the bottom third of the receipt."""
    if not blocks:
        return None, 0.0
    ys = [_y(b) for b in blocks]
    threshold = min(ys) + (max(ys) - min(ys)) * (2 / 3)
    best: float | None = None
    for b in blocks:
        if _y(b) < threshold:
            continue
        value = _parse_amount(b["text"])
        if value is not None and (best is None or value > best):
            best = value
    if best is None:
        return None, 0.0
    return best, 0.4  # deliberately low — the UI must flag this for review


def _find_merchant(blocks: list[dict]) -> tuple[str | None, float]:
    """Topmost wide, mostly-alphabetic block — receipts print the shop name first."""
    header = sorted(blocks, key=_y)[:6]
    best: dict | None = None
    for b in header:
        text = b["text"].strip()
        letters = sum(ch.isalpha() for ch in text)
        if len(text) < 3 or letters < len(text) * 0.5:
            continue  # phone numbers, ICE lines, separators
        if best is None or _width(b) > _width(best):
            best = b
    if best is None:
        return None, 0.0
    return best["text"].strip(), round(min(best["score"], 0.99) * 0.8, 3)


def extract(blocks: list[dict]) -> dict[str, Any]:
    """Turn OCR blocks into a best-effort expense suggestion.

    Every field is independently optional. The caller treats this as a draft for
    the user to confirm, never as authoritative data.
    """
    if not blocks:
        return {**EMPTY, "confidence": dict(EMPTY["confidence"])}

    amount, amount_conf = _find_labelled_amount(blocks, TOTAL_KEYWORDS)
    if amount is None:
        amount, amount_conf = _fallback_amount(blocks)

    tax, tax_conf = _find_labelled_amount(blocks, TAX_KEYWORDS)
    # A "TVA 20%" label can yield the rate instead of the amount; reject values
    # that are not plausibly a tax component of the total.
    if tax is not None and amount is not None and tax >= amount:
        tax, tax_conf = None, 0.0

    parsed_date: str | None = None
    date_conf = 0.0
    for b in sorted(blocks, key=_y):
        parsed = _parse_date(b["text"])
        if parsed is not None:
            parsed_date = parsed
            date_conf = round(min(b["score"], 0.99) * 0.9, 3)
            break

    merchant, merchant_conf = _find_merchant(blocks)

    return {
        "amount": amount,
        "taxAmount": tax,
        "date": parsed_date,
        "merchantName": merchant,
        "confidence": {
            "amount": amount_conf,
            "taxAmount": tax_conf,
            "date": date_conf,
            "merchantName": merchant_conf,
        },
    }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ocr-service
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest tests/test_extract.py -v
```

Expected: 14 passed. If `test_falls_back_to_largest_amount_in_bottom_third` fails, the band threshold is the likely culprit — fix `_fallback_amount`, not the test.

- [ ] **Step 6: Commit**

```bash
git add ocr-service
git commit -m "feat(ocr): add bounding-box-aware receipt field extractor"
```

---

### Task 4: OCR service — FastAPI + RapidOCR + Docker

**Files:**
- Create: `ocr-service/app/preprocess.py`
- Create: `ocr-service/app/ocr.py`
- Create: `ocr-service/app/main.py`
- Create: `ocr-service/tests/test_api.py`
- Create: `ocr-service/Dockerfile`
- Create: `ocr-service/.dockerignore`
- Modify: `backend/docker-compose.yml`

**Interfaces:**
- Consumes: `app.extract.extract(blocks) -> dict` from Task 3
- Produces: `POST /extract` (multipart field name **`file`**) → `{"blocks": [...], "suggestion": {...}}`; `GET /health` → `{"status": "ok"}`. Task 6's HTTP client calls exactly these.

- [ ] **Step 1: Write the failing API test**

`ocr-service/tests/test_api.py`:

```python
import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_extract_rejects_a_non_image_payload():
    response = client.post(
        "/extract", files={"file": ("notes.txt", io.BytesIO(b"not an image"), "text/plain")}
    )
    assert response.status_code == 400


def test_extract_returns_blocks_and_suggestion_keys(monkeypatch):
    """The engine is stubbed — this asserts the response contract, not OCR accuracy."""
    from app import main

    monkeypatch.setattr(
        main,
        "run_ocr",
        lambda _image: [
            {"text": "TOTAL", "box": [[20, 200], [100, 200], [100, 220], [20, 220]], "score": 0.9},
            {"text": "284,50", "box": [[300, 200], [380, 200], [380, 220], [300, 220]], "score": 0.9},
        ],
    )
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    response = client.post("/extract", files={"file": ("r.png", io.BytesIO(png), "image/png")})
    assert response.status_code == 200
    body = response.json()
    assert body["suggestion"]["amount"] == 284.50
    assert len(body["blocks"]) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ocr-service && python -m pytest tests/test_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 3: Implement preprocessing**

`ocr-service/app/preprocess.py`:

```python
"""Image conditioning before OCR.

Phone photos of thermal receipts are the worst case: low contrast, small text,
uneven lighting. Normalising here costs milliseconds and measurably improves
recognition on faded print.
"""

from __future__ import annotations

import cv2
import numpy as np

MIN_WIDTH = 1000
MAX_WIDTH = 2200


def prepare(image_bytes: bytes) -> np.ndarray:
    """Decode, upscale small images, normalise contrast. Raises ValueError if undecodable."""
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("unsupported or corrupt image")

    height, width = image.shape[:2]
    if width < MIN_WIDTH:
        scale = MIN_WIDTH / width
        image = cv2.resize(image, (MIN_WIDTH, int(height * scale)), interpolation=cv2.INTER_CUBIC)
    elif width > MAX_WIDTH:
        scale = MAX_WIDTH / width
        image = cv2.resize(image, (MAX_WIDTH, int(height * scale)), interpolation=cv2.INTER_AREA)

    # CLAHE on the luminance channel: lifts faded thermal print without blowing
    # out already-dark ink the way global histogram equalisation does.
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, a, b = cv2.split(lab)
    lightness = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(lightness)
    return cv2.cvtColor(cv2.merge((lightness, a, b)), cv2.COLOR_LAB2BGR)
```

- [ ] **Step 4: Implement the engine wrapper**

`ocr-service/app/ocr.py`:

```python
"""RapidOCR engine wrapper.

The engine is instantiated once at import time — model loading takes seconds and
must not happen per request.
"""

from __future__ import annotations

import os

import numpy as np
from rapidocr_onnxruntime import RapidOCR

_engine = RapidOCR()

# Arabic needs a second recognition pass, which roughly doubles latency. Off by
# default; enable with OCR_LANGS=fr,ar once Arabic receipts are a real workload.
ARABIC_ENABLED = "ar" in os.getenv("OCR_LANGS", "fr").split(",")


def run_ocr(image: np.ndarray) -> list[dict]:
    """Detect and recognise text. Returns blocks with native RapidOCR boxes."""
    result, _elapsed = _engine(image)
    if not result:
        return []
    return [
        {"text": text, "box": [[float(x), float(y)] for x, y in box], "score": float(score)}
        for box, text, score in result
    ]
```

- [ ] **Step 5: Implement the API**

`ocr-service/app/main.py`:

```python
"""Receipt OCR service.

Stateless. Holds no database connection and stores nothing. The NestJS backend
owns the image file; this service only ever sees bytes in flight.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, File, HTTPException, UploadFile

from app.extract import extract
from app.ocr import run_ocr
from app.preprocess import prepare

MAX_BYTES = 8 * 1024 * 1024

log = logging.getLogger("ocr")
app = FastAPI(title="Tijaru OCR", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract")
async def extract_receipt(file: UploadFile = File(...)) -> dict:
    payload = await file.read()
    if len(payload) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="image too large")

    try:
        image = prepare(payload)
    except ValueError:
        raise HTTPException(status_code=400, detail="unsupported or corrupt image") from None

    try:
        blocks = run_ocr(image)
    except Exception:
        log.exception("ocr engine failed")
        raise HTTPException(status_code=500, detail="ocr failed") from None

    return {"blocks": blocks, "suggestion": extract(blocks)}
```

Note: `main` imports `run_ocr` into its own namespace, which is what makes `monkeypatch.setattr(main, "run_ocr", ...)` in the test work.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ocr-service && python -m pytest -v`
Expected: all pass. First run downloads RapidOCR models to `~/.cache` — allow time.

- [ ] **Step 7: Write the Dockerfile**

`ocr-service/Dockerfile`:

```dockerfile
FROM python:3.12-slim

# opencv-python-headless still needs libgl/libglib at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Bake the models into the image. Without this the first request on a fresh or
# offline host tries to download them and fails.
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`ocr-service/.dockerignore`:

```
.venv
tests
__pycache__
*.pyc
requirements-dev.txt
```

- [ ] **Step 8: Add the service to compose**

In `backend/docker-compose.yml`, add alongside the existing services:

```yaml
  ocr:
    build: ../ocr-service
    environment:
      OCR_LANGS: fr
    restart: unless-stopped
    # Intentionally no `ports:` — receipts must not be reachable from the host
    # network. The API talks to it over the compose network as http://ocr:8000.
```

- [ ] **Step 9: Verify the container builds and answers**

```bash
cd backend
docker compose build ocr
docker compose up -d ocr
docker compose exec ocr python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read())"
```

Expected: `b'{"status":"ok"}'`

- [ ] **Step 10: Commit**

```bash
git add ocr-service backend/docker-compose.yml
git commit -m "feat(ocr): add FastAPI RapidOCR service with baked models"
```

---

### Task 5: Receipt storage service

**Files:**
- Create: `backend/src/modules/expenses/infrastructure/local-storage.service.ts`
- Create: `backend/src/modules/expenses/infrastructure/local-storage.service.spec.ts`
- Modify: `backend/src/config/env.ts`

**Interfaces:**
- Consumes: `Env` from `backend/src/config/env.ts`
- Produces:

```typescript
class LocalStorageService {
  save(businessId: string, buffer: Buffer, ext: string): Promise<string>;  // -> relative path
  read(relativePath: string): Promise<Buffer>;
  remove(relativePath: string): Promise<void>;
  sniffExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | null;
}
```

Tasks 7 and 8 inject this.

- [ ] **Step 1: Add the env vars**

In `backend/src/config/env.ts`, add to `envSchema`:

```typescript
  UPLOADS_DIR: z.string().default('./uploads'),
  OCR_SERVICE_URL: z.string().url().default('http://ocr:8000'),
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
```

- [ ] **Step 2: Write the failing test**

`backend/src/modules/expenses/infrastructure/local-storage.service.spec.ts`:

```typescript
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalStorageService } from './local-storage.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
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
  });

  it('writes under a business-scoped directory and returns a relative path', async () => {
    const path = await storage.save('biz1', JPEG, 'jpg');
    expect(path).toMatch(/^biz1\/[a-z0-9]+\.jpg$/);
    expect(readFileSync(join(root, path))).toEqual(JPEG);
  });

  it('reads back what it wrote', async () => {
    const path = await storage.save('biz1', PNG, 'png');
    await expect(storage.read(path)).resolves.toEqual(PNG);
  });

  it('refuses to traverse outside the uploads root', async () => {
    await expect(storage.read('../../etc/passwd')).rejects.toThrow(/outside/i);
    await expect(storage.remove('biz1/../../secrets')).rejects.toThrow(/outside/i);
  });

  it('removes a file and tolerates a second removal', async () => {
    const path = await storage.save('biz1', JPEG, 'jpg');
    await storage.remove(path);
    await expect(storage.remove(path)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/expenses/infrastructure/local-storage.service.spec.ts`
Expected: FAIL — cannot find module `./local-storage.service`

- [ ] **Step 4: Implement the storage service**

`backend/src/modules/expenses/infrastructure/local-storage.service.ts`:

```typescript
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';

export type ReceiptExt = 'jpg' | 'png' | 'webp';

/**
 * Receipt images on the local filesystem, one directory per business.
 *
 * Paths are tenant-scoped by construction: callers pass a businessId and get
 * back a relative path that already contains it, so a cross-tenant read would
 * require forging the path — which `resolveSafe` rejects.
 */
@Injectable()
export class LocalStorageService {
  private readonly root: string;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.root = resolve(env.UPLOADS_DIR);
  }

  /** Identify the image from its magic bytes. A declared mimetype is attacker-controlled. */
  sniffExtension(buffer: Buffer): ReceiptExt | null {
    if (buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return 'png';
    }
    if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') {
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

  read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolveSafe(relativePath));
  }

  async remove(relativePath: string): Promise<void> {
    await rm(this.resolveSafe(relativePath), { force: true });
  }

  /** Reject any path that escapes the uploads root. */
  private resolveSafe(relativePath: string): string {
    const absolute = resolve(join(this.root, relativePath));
    const rel = relative(this.root, absolute);
    if (rel.startsWith('..') || resolve(rel) === rel) {
      throw new Error(`Refusing path outside uploads root: ${relativePath}`);
    }
    return absolute;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/modules/expenses && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Add the uploads volume and gitignore entry**

In `backend/docker-compose.yml`, mount a named volume `uploads:/srv/uploads` on the api service and declare it under `volumes:`. Without this, every rebuild deletes all receipts.

Add `uploads/` to `backend/.gitignore`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/expenses backend/src/config/env.ts backend/docker-compose.yml backend/.gitignore
git commit -m "feat(expenses): add tenant-scoped receipt storage service"
```

---

### Task 6: OCR provider port + HTTP adapter

**Files:**
- Create: `backend/src/modules/expenses/domain/ocr.provider.ts`
- Create: `backend/src/modules/expenses/infrastructure/http-ocr.provider.ts`
- Create: `backend/src/modules/expenses/infrastructure/http-ocr.provider.spec.ts`

**Interfaces:**
- Consumes: `Env.OCR_SERVICE_URL`, `Env.OCR_TIMEOUT_MS` from Task 5
- Produces:

```typescript
export type OcrSuggestion = {
  amount: number | null;
  taxAmount: number | null;
  date: string | null;          // YYYY-MM-DD
  merchantName: string | null;
  confidence: Record<'amount' | 'taxAmount' | 'date' | 'merchantName', number>;
};
export type OcrResult =
  | { status: 'done'; suggestion: OcrSuggestion; blocks: unknown[] }
  | { status: 'failed'; suggestion: null; blocks: [] };

export abstract class OcrProvider {
  abstract extract(buffer: Buffer, filename: string): Promise<OcrResult>;
}
```

Task 8's scan endpoint depends on `OcrProvider`, never on the HTTP adapter — so its e2e tests run without Python.

- [ ] **Step 1: Write the failing test**

`backend/src/modules/expenses/infrastructure/http-ocr.provider.spec.ts`:

```typescript
import { HttpOcrProvider } from './http-ocr.provider';

const env = { OCR_SERVICE_URL: 'http://ocr:8000', OCR_TIMEOUT_MS: 50 } as never;

describe('HttpOcrProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the suggestion when the service answers', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        blocks: [{ text: 'TOTAL', box: [], score: 0.9 }],
        suggestion: {
          amount: 284.5,
          taxAmount: 47.42,
          date: '2026-08-01',
          merchantName: 'MARJANE',
          confidence: { amount: 0.94, taxAmount: 0.8, date: 0.7, merchantName: 0.6 },
        },
      }),
    } as never);

    const result = await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');
    expect(result.status).toBe('done');
    expect(result.suggestion?.amount).toBe(284.5);
  });

  it('degrades to failed when the service is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');
    expect(result).toEqual({ status: 'failed', suggestion: null, blocks: [] });
  });

  it('degrades to failed on a non-2xx response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as never);
    const result = await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');
    expect(result.status).toBe('failed');
  });

  it('retries once before giving up', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          blocks: [],
          suggestion: {
            amount: 10,
            taxAmount: null,
            date: null,
            merchantName: null,
            confidence: { amount: 0.9, taxAmount: 0, date: 0, merchantName: 0 },
          },
        }),
      } as never);

    const result = await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/expenses/infrastructure/http-ocr.provider.spec.ts`
Expected: FAIL — cannot find module `./http-ocr.provider`

- [ ] **Step 3: Write the port**

`backend/src/modules/expenses/domain/ocr.provider.ts`:

```typescript
/**
 * Port: receipt OCR. The only implementation talks HTTP to the Python service,
 * but the abstraction keeps that dependency out of the application layer and
 * lets the e2e suite run without a Python process.
 */

export type OcrConfidence = Record<'amount' | 'taxAmount' | 'date' | 'merchantName', number>;

export type OcrSuggestion = {
  amount: number | null;
  taxAmount: number | null;
  /** ISO date, `YYYY-MM-DD`. */
  date: string | null;
  merchantName: string | null;
  confidence: OcrConfidence;
};

export type OcrResult =
  | { status: 'done'; suggestion: OcrSuggestion; blocks: unknown[] }
  | { status: 'failed'; suggestion: null; blocks: [] };

export abstract class OcrProvider {
  /** Never throws: an OCR failure returns `status: 'failed'` so scanning stays optional. */
  abstract extract(buffer: Buffer, filename: string): Promise<OcrResult>;
}
```

- [ ] **Step 4: Write the HTTP adapter**

`backend/src/modules/expenses/infrastructure/http-ocr.provider.ts`:

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { OcrProvider, type OcrResult, type OcrSuggestion } from '../domain/ocr.provider';

const FAILED: OcrResult = { status: 'failed', suggestion: null, blocks: [] };

@Injectable()
export class HttpOcrProvider extends OcrProvider {
  private readonly log = new Logger(HttpOcrProvider.name);

  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {
    super();
  }

  async extract(buffer: Buffer, filename: string): Promise<OcrResult> {
    // One retry: the service is a single container and a restart or a cold model
    // load can drop exactly one request.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.call(buffer, filename);
      } catch (err) {
        this.log.warn(`OCR attempt ${attempt + 1} failed: ${(err as Error).message}`);
      }
    }
    return FAILED;
  }

  private async call(buffer: Buffer, filename: string): Promise<OcrResult> {
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);

    const res = await fetch(`${this.env.OCR_SERVICE_URL}/extract`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(this.env.OCR_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ocr service responded ${res.status}`);

    const body = (await res.json()) as { blocks: unknown[]; suggestion: OcrSuggestion };
    return { status: 'done', suggestion: body.suggestion, blocks: body.blocks };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/modules/expenses && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/expenses
git commit -m "feat(expenses): add OCR provider port and HTTP adapter"
```

---

### Task 7: Expenses CRUD — repository, service, DTOs, controller

**Files:**
- Create: `backend/src/modules/expenses/domain/expenses.repository.ts`
- Create: `backend/src/modules/expenses/infrastructure/prisma-expenses.repository.ts`
- Create: `backend/src/modules/expenses/application/expenses.service.ts`
- Create: `backend/src/modules/expenses/application/expenses.service.spec.ts`
- Create: `backend/src/modules/expenses/dto/expense.dto.ts`
- Create: `backend/src/modules/expenses/expenses.controller.ts`
- Create: `backend/src/modules/expenses/expenses.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: Prisma `Expense` (Task 1), capabilities (Task 2)
- Produces: REST `GET /v1/expenses`, `GET /v1/expenses/summary`, `GET /v1/expenses/:id`, `POST /v1/expenses`, `PATCH /v1/expenses/:id`, `DELETE /v1/expenses/:id`. `ExpensesService` and `ExpensesRepository` are extended in Task 8.

- [ ] **Step 1: Write the DTOs**

`backend/src/modules/expenses/dto/expense.dto.ts`:

```typescript
import { z } from 'zod';

export const EXPENSE_CATEGORIES = [
  'rent',
  'utilities',
  'salaries',
  'supplies',
  'transport',
  'maintenance',
  'taxes',
  'marketing',
  'other',
] as const;

export const PAYMENT_METHODS = ['cash', 'card', 'credit', 'split'] as const;

export const CreateExpenseSchema = z.object({
  date: z.coerce.date(),
  amount: z.number().positive().max(99_999_999),
  taxAmount: z.number().min(0).max(99_999_999).optional(),
  category: z.enum(EXPENSE_CATEGORIES).default('other'),
  supplierId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
  merchantName: z.string().max(160).optional(),
  note: z.string().max(1000).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('cash'),
  receiptPath: z.string().max(300).optional(),
});
export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;

export const UpdateExpenseSchema = CreateExpenseSchema.partial();
export type UpdateExpenseInput = z.infer<typeof UpdateExpenseSchema>;

export const ListExpensesSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
});
export type ListExpensesQuery = z.infer<typeof ListExpensesSchema>;
```

- [ ] **Step 2: Write the failing service test**

`backend/src/modules/expenses/application/expenses.service.spec.ts`:

```typescript
import { NotFoundError } from '../../../common/errors';
import type { ExpensesRepository } from '../domain/expenses.repository';
import { ExpensesService } from './expenses.service';

const repo = (): jest.Mocked<ExpensesRepository> =>
  ({
    findAll: jest.fn(),
    findById: jest.fn(),
    summary: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }) as never;

describe('ExpensesService', () => {
  it('throws NotFound when getting a missing expense', async () => {
    const r = repo();
    r.findById.mockResolvedValue(null);
    await expect(new ExpensesService(r).get('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stamps the creating user onto the expense', async () => {
    const r = repo();
    r.create.mockResolvedValue({ id: 'e1' });
    await new ExpensesService(r).create(
      { date: new Date('2026-08-01'), amount: 10, category: 'other', paymentMethod: 'cash' },
      'user-1',
    );
    expect(r.create).toHaveBeenCalledWith(expect.objectContaining({ createdById: 'user-1' }));
  });

  it('throws NotFound when updating a missing expense', async () => {
    const r = repo();
    r.update.mockResolvedValue(0);
    await expect(new ExpensesService(r).update('nope', { amount: 5 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws NotFound when deleting a missing expense', async () => {
    const r = repo();
    r.findById.mockResolvedValue(null);
    await expect(new ExpensesService(r).remove('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/expenses/application`
Expected: FAIL — cannot find module `./expenses.service`

- [ ] **Step 4: Write the repository port**

`backend/src/modules/expenses/domain/expenses.repository.ts`:

```typescript
import type { ListExpensesQuery } from '../dto/expense.dto';

export type CreateExpenseData = {
  date: Date;
  amount: number;
  taxAmount?: number | undefined;
  category: string;
  supplierId?: string | undefined;
  warehouseId?: string | undefined;
  merchantName?: string | undefined;
  note?: string | undefined;
  paymentMethod: string;
  receiptPath?: string | undefined;
  ocrStatus?: string | undefined;
  ocrRaw?: unknown;
  createdById: string;
};

export type UpdateExpenseData = Partial<Omit<CreateExpenseData, 'createdById'>>;

export type ExpenseSummary = {
  total: number;
  byCategory: { category: string; total: number }[];
};

/**
 * Port: persistence for expenses. businessId never appears here — the Prisma
 * tenant middleware injects and filters it for every `Expense` query.
 */
export abstract class ExpensesRepository {
  abstract findAll(query: ListExpensesQuery): Promise<unknown[]>;
  abstract findById(id: string): Promise<{ id: string; receiptPath?: string | null } | null>;
  abstract summary(query: ListExpensesQuery): Promise<ExpenseSummary>;
  abstract create(data: CreateExpenseData): Promise<unknown>;
  /** Rows updated (0 when the expense does not exist). */
  abstract update(id: string, data: UpdateExpenseData): Promise<number>;
  /** Rows deleted (0 when the expense does not exist). */
  abstract delete(id: string): Promise<number>;
}
```

- [ ] **Step 5: Write the Prisma adapter**

`backend/src/modules/expenses/infrastructure/prisma-expenses.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { scoped } from '../../../common/tenant/tenant.helpers';
import {
  ExpensesRepository,
  type CreateExpenseData,
  type ExpenseSummary,
  type UpdateExpenseData,
} from '../domain/expenses.repository';
import type { ListExpensesQuery } from '../dto/expense.dto';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends Record<string, unknown>>(obj: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

@Injectable()
export class PrismaExpensesRepository extends ExpensesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private where(query: ListExpensesQuery): Prisma.ExpenseWhereInput {
    const where: Prisma.ExpenseWhereInput = {};
    if (query.from || query.to) {
      where.date = compact({ gte: query.from, lte: query.to });
    }
    if (query.category) where.category = query.category as never;
    return where;
  }

  findAll(query: ListExpensesQuery): Promise<unknown[]> {
    return this.prisma.expense.findMany({
      where: this.where(query),
      orderBy: { date: 'desc' },
      take: 500,
      include: {
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  findById(id: string): Promise<{ id: string; receiptPath: string | null } | null> {
    return this.prisma.expense.findUnique({
      where: { id },
      select: { id: true, receiptPath: true },
    });
  }

  async summary(query: ListExpensesQuery): Promise<ExpenseSummary> {
    const grouped = await this.prisma.expense.groupBy({
      by: ['category'],
      where: this.where(query),
      _sum: { amount: true },
    });
    const byCategory = grouped.map((row) => ({
      category: row.category as string,
      total: Number(row._sum.amount ?? 0),
    }));
    return {
      total: byCategory.reduce((sum, row) => sum + row.total, 0),
      byCategory,
    };
  }

  create(data: CreateExpenseData): Promise<unknown> {
    return this.prisma.expense.create({
      data: scoped<Prisma.ExpenseUncheckedCreateInput>(
        compact(data) as Omit<Prisma.ExpenseUncheckedCreateInput, 'businessId'>,
      ),
    });
  }

  async update(id: string, data: UpdateExpenseData): Promise<number> {
    const r = await this.prisma.expense.updateMany({ where: { id }, data: compact(data) });
    return r.count;
  }

  async delete(id: string): Promise<number> {
    const r = await this.prisma.expense.deleteMany({ where: { id } });
    return r.count;
  }
}
```

- [ ] **Step 6: Write the service**

`backend/src/modules/expenses/application/expenses.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import {
  ExpensesRepository,
  type ExpenseSummary,
} from '../domain/expenses.repository';
import type {
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateExpenseInput,
} from '../dto/expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly expenses: ExpensesRepository) {}

  list(query: ListExpensesQuery): Promise<unknown[]> {
    return this.expenses.findAll(query);
  }

  summary(query: ListExpensesQuery): Promise<ExpenseSummary> {
    return this.expenses.summary(query);
  }

  async get(id: string): Promise<unknown> {
    const found = await this.expenses.findById(id);
    if (!found) throw new NotFoundError('Expense', id);
    return found;
  }

  create(input: CreateExpenseInput, userId: string): Promise<unknown> {
    return this.expenses.create({ ...input, createdById: userId });
  }

  async update(id: string, input: UpdateExpenseInput): Promise<unknown> {
    const updated = await this.expenses.update(id, input);
    if (updated === 0) throw new NotFoundError('Expense', id);
    return this.expenses.findById(id);
  }

  async remove(id: string): Promise<void> {
    const found = await this.expenses.findById(id);
    if (!found) throw new NotFoundError('Expense', id);
    await this.expenses.delete(id);
  }
}
```

- [ ] **Step 7: Write the controller**

`backend/src/modules/expenses/expenses.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { ExpensesService } from './application/expenses.service';
import {
  type CreateExpenseInput,
  CreateExpenseSchema,
  type ListExpensesQuery,
  ListExpensesSchema,
  type UpdateExpenseInput,
  UpdateExpenseSchema,
} from './dto/expense.dto';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller({ path: 'expenses', version: '1' })
export class ExpensesController {
  constructor(private readonly svc: ExpensesService) {}

  @Get()
  @RequireCap('expenses.view')
  list(
    @Query(new ZodValidationPipe(ListExpensesSchema)) query: ListExpensesQuery,
  ): Promise<unknown> {
    return this.svc.list(query);
  }

  // Declared before ':id' so "summary" is not swallowed by the param route.
  @Get('summary')
  @RequireCap('expenses.view')
  summary(
    @Query(new ZodValidationPipe(ListExpensesSchema)) query: ListExpensesQuery,
  ): Promise<unknown> {
    return this.svc.summary(query);
  }

  @Get(':id')
  @RequireCap('expenses.view')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(id);
  }

  @Post()
  @RequireCap('expenses.create')
  create(
    @Body(new ZodValidationPipe(CreateExpenseSchema)) body: CreateExpenseInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.create(body, user.id);
  }

  @Patch(':id')
  @RequireCap('expenses.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateExpenseSchema)) body: UpdateExpenseInput,
  ): Promise<unknown> {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('expenses.delete')
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(id);
  }
}
```

Before writing this, open `backend/src/common/decorators/current-user.decorator.ts` and `backend/src/common/auth/auth-user.type.ts` and match the actual export names and the user id field — adjust `user.id` if the type calls it something else.

- [ ] **Step 8: Wire the module**

`backend/src/modules/expenses/expenses.module.ts`:

```typescript
import { Module } from '@nestjs/common';

import { ExpensesService } from './application/expenses.service';
import { ExpensesRepository } from './domain/expenses.repository';
import { OcrProvider } from './domain/ocr.provider';
import { ExpensesController } from './expenses.controller';
import { HttpOcrProvider } from './infrastructure/http-ocr.provider';
import { LocalStorageService } from './infrastructure/local-storage.service';
import { PrismaExpensesRepository } from './infrastructure/prisma-expenses.repository';

@Module({
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    LocalStorageService,
    { provide: ExpensesRepository, useClass: PrismaExpensesRepository },
    { provide: OcrProvider, useClass: HttpOcrProvider },
  ],
})
export class ExpensesModule {}
```

Register `ExpensesModule` in `backend/src/app.module.ts` — add the import and put it in the `imports` array after `NotificationsModule`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd backend && npm run typecheck && npm run lint && npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add backend/src
git commit -m "feat(expenses): add expenses CRUD module"
```

---

### Task 8: Scan endpoint + authenticated receipt route

**Files:**
- Modify: `backend/src/modules/expenses/expenses.controller.ts`
- Modify: `backend/src/modules/expenses/application/expenses.service.ts`
- Modify: `backend/src/modules/expenses/application/expenses.service.spec.ts`
- Create: `backend/test/expenses.e2e-spec.ts`

**Interfaces:**
- Consumes: `LocalStorageService` (Task 5), `OcrProvider` (Task 6), `ExpensesService` (Task 7)
- Produces: `POST /v1/expenses/scan` (multipart, field `file`) → `{ receiptPath, ocrStatus, suggestion }`; `GET /v1/expenses/:id/receipt` → image bytes. Task 11's form consumes both.

- [ ] **Step 1: Write the failing service tests**

Append to `backend/src/modules/expenses/application/expenses.service.spec.ts`:

```typescript
import { BadRequestError } from '../../../common/errors';
import type { OcrProvider } from '../domain/ocr.provider';
import type { LocalStorageService } from '../infrastructure/local-storage.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

const storageStub = (ext: 'jpg' | null = 'jpg') =>
  ({
    sniffExtension: jest.fn().mockReturnValue(ext),
    save: jest.fn().mockResolvedValue('biz1/abc.jpg'),
    read: jest.fn().mockResolvedValue(JPEG),
    remove: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<LocalStorageService>;

describe('ExpensesService.scan', () => {
  it('saves the receipt and returns the OCR suggestion without creating an expense', async () => {
    const r = repo();
    const storage = storageStub();
    const ocr = {
      extract: jest.fn().mockResolvedValue({
        status: 'done',
        blocks: [],
        suggestion: {
          amount: 284.5,
          taxAmount: null,
          date: '2026-08-01',
          merchantName: 'MARJANE',
          confidence: { amount: 0.9, taxAmount: 0, date: 0.7, merchantName: 0.5 },
        },
      }),
    } as unknown as jest.Mocked<OcrProvider>;

    const result = await new ExpensesService(r, storage, ocr).scan(JPEG, 'biz1');

    expect(result.receiptPath).toBe('biz1/abc.jpg');
    expect(result.ocrStatus).toBe('done');
    expect(result.suggestion?.amount).toBe(284.5);
    expect(r.create).not.toHaveBeenCalled();
  });

  it('rejects a payload whose magic bytes are not an image', async () => {
    const service = new ExpensesService(repo(), storageStub(null), {
      extract: jest.fn(),
    } as never);
    await expect(service.scan(Buffer.from('<?php'), 'biz1')).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it('keeps the receipt and reports failed when OCR is unavailable', async () => {
    const storage = storageStub();
    const ocr = {
      extract: jest.fn().mockResolvedValue({ status: 'failed', suggestion: null, blocks: [] }),
    } as never;

    const result = await new ExpensesService(repo(), storage, ocr).scan(JPEG, 'biz1');

    expect(result.ocrStatus).toBe('failed');
    expect(result.suggestion).toBeNull();
    expect(result.receiptPath).toBe('biz1/abc.jpg'); // the photo is still usable
  });
});
```

Also update the four existing `ExpensesService` constructions in this file to pass the two new arguments: `new ExpensesService(r, storageStub(), { extract: jest.fn() } as never)`.

Check `backend/src/common/errors.ts` for the actual name of the 400-mapping error class. If it is not `BadRequestError`, use whatever is exported there in both the test and the implementation.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/expenses/application`
Expected: FAIL — `service.scan is not a function`

- [ ] **Step 3: Extend the service**

In `backend/src/modules/expenses/application/expenses.service.ts`, inject the two new dependencies and add `scan` and `readReceipt`:

```typescript
  constructor(
    private readonly expenses: ExpensesRepository,
    private readonly storage: LocalStorageService,
    private readonly ocr: OcrProvider,
  ) {}

  /**
   * Store a receipt photo and return a best-effort field suggestion.
   *
   * Deliberately does NOT create an Expense: OCR output is a draft the user must
   * confirm. Saving it silently would put unverified numbers in the books.
   */
  async scan(
    buffer: Buffer,
    businessId: string,
  ): Promise<{ receiptPath: string; ocrStatus: 'done' | 'failed'; suggestion: OcrSuggestion | null }> {
    const ext = this.storage.sniffExtension(buffer);
    if (!ext) throw new BadRequestError('Unsupported image format');

    const receiptPath = await this.storage.save(businessId, buffer, ext);
    const result = await this.ocr.extract(buffer, `receipt.${ext}`);
    return { receiptPath, ocrStatus: result.status, suggestion: result.suggestion };
  }

  /** Receipt bytes for an expense the caller's tenant owns. */
  async readReceipt(id: string): Promise<{ buffer: Buffer; ext: string }> {
    const expense = await this.expenses.findById(id);
    // findById is tenant-filtered, so a cross-tenant id looks like a missing row.
    if (!expense?.receiptPath) throw new NotFoundError('Receipt', id);
    return {
      buffer: await this.storage.read(expense.receiptPath),
      ext: expense.receiptPath.split('.').pop() ?? 'jpg',
    };
  }
```

Also extend `remove` to clean up the file — best effort, since a missing file must not block deleting the record:

```typescript
  async remove(id: string): Promise<void> {
    const found = await this.expenses.findById(id);
    if (!found) throw new NotFoundError('Expense', id);
    await this.expenses.delete(id);
    if (found.receiptPath) {
      await this.storage.remove(found.receiptPath).catch(() => undefined);
    }
  }
```

- [ ] **Step 4: Add the controller routes**

In `backend/src/modules/expenses/expenses.controller.ts`:

```typescript
import { FileInterceptor } from '@nestjs/platform-express';
import { Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';

import { TenantContext } from '../../common/tenant/tenant-context';
```

Inject `private readonly tenant: TenantContext` into the constructor, then add:

```typescript
  @Post('scan')
  @RequireCap('expenses.create')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },  // 8 MB, enforced before any disk write
    }),
  )
  scan(@UploadedFile() file: Express.Multer.File | undefined): Promise<unknown> {
    if (!file) throw new BadRequestError('file is required');
    const businessId = this.tenant.getBusinessId();
    if (!businessId) throw new BadRequestError('missing tenant context');
    return this.svc.scan(file.buffer, businessId);
  }

  /**
   * Receipts are served here rather than by static middleware: a static mount
   * would make every tenant's receipts readable to anyone holding a URL, and
   * receipts carry supplier names and amounts.
   */
  @Get(':id/receipt')
  @RequireCap('expenses.view')
  async receipt(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, ext } = await this.svc.readReceipt(id);
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('content-type', mime);
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(buffer);
  }
```

`FileInterceptor` with no `storage` option buffers in memory, which is what `scan` expects. Place `@Post('scan')` above `@Get(':id')` in the file for readability; Nest matches by method + path so ordering is not strictly required here, but `@Get('summary')` before `@Get(':id')` **is**.

- [ ] **Step 5: Run unit tests**

Run: `cd backend && npx jest src/modules/expenses && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Write the e2e test**

Read `backend/test/` first and copy the bootstrap pattern from an existing e2e spec (login helper, app factory, DB reset). Then `backend/test/expenses.e2e-spec.ts` must cover:

```typescript
// 1. POST /v1/expenses/scan with a real JPEG and a mocked OcrProvider
//    (override the provider with `.overrideProvider(OcrProvider).useValue(...)`)
//    -> 201, body has receiptPath + suggestion.amount
// 2. POST /v1/expenses/scan with a 9 MB buffer -> 413
// 3. POST /v1/expenses/scan with Buffer.from('<?php') named "x.jpg" -> 400
// 4. POST /v1/expenses then GET /v1/expenses -> the created row is listed
// 5. GET /v1/expenses/summary -> total equals the sum of created amounts
// 6. Tenant isolation: create an expense with a receipt as business A,
//    then GET /v1/expenses/:id/receipt with a business B token -> 404
// 7. A cashier token (no expenses.view) hitting GET /v1/expenses -> 403
```

Case 6 is the important one — it is the whole justification for not using static file serving.

- [ ] **Step 7: Run the e2e suite**

Run: `cd backend && npm run test:e2e`
Expected: PASS. Requires postgres on 5433.

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(expenses): add receipt scan endpoint and authenticated receipt route"
```

---

### Task 9: Web API client

**Files:**
- Create: `web/src/api/expense-queries.ts`

**Interfaces:**
- Consumes: `api` and `apiFetch` from `web/src/api/client.ts`; the endpoints from Tasks 7–8
- Produces: `Expense`, `ExpenseInput`, `ScanResult`, `ExpenseSummary` types and the hooks `useExpenses`, `useExpenseSummary`, `useCreateExpense`, `useUpdateExpense`, `useDeleteExpense`, `useScanReceipt`. Tasks 10 and 11 import these.

- [ ] **Step 1: Write the client**

`web/src/api/expense-queries.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, getAccessToken } from './client';

export const EXPENSE_CATEGORIES = [
  'rent',
  'utilities',
  'salaries',
  'supplies',
  'transport',
  'maintenance',
  'taxes',
  'marketing',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type Expense = {
  id: string;
  date: string;
  amount: string;
  taxAmount: string | null;
  category: ExpenseCategory;
  merchantName: string | null;
  note: string | null;
  paymentMethod: 'cash' | 'card' | 'credit' | 'split';
  receiptPath: string | null;
  supplier: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
};

export type ExpenseInput = {
  date: string;
  amount: number;
  taxAmount?: number;
  category: ExpenseCategory;
  supplierId?: string;
  merchantName?: string;
  note?: string;
  paymentMethod: 'cash' | 'card' | 'credit' | 'split';
  receiptPath?: string;
};

export type ExpenseSummary = {
  total: number;
  byCategory: { category: ExpenseCategory; total: number }[];
};

export type ScanResult = {
  receiptPath: string;
  ocrStatus: 'done' | 'failed';
  suggestion: {
    amount: number | null;
    taxAmount: number | null;
    date: string | null;
    merchantName: string | null;
    confidence: Record<'amount' | 'taxAmount' | 'date' | 'merchantName', number>;
  } | null;
};

export type ExpenseFilters = { from?: string; to?: string; category?: ExpenseCategory };

const qs = (filters: ExpenseFilters) => {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.category) params.set('category', filters.category);
  const s = params.toString();
  return s ? `?${s}` : '';
};

export const useExpenses = (filters: ExpenseFilters = {}) =>
  useQuery({
    queryKey: ['expenses', filters],
    queryFn: () => api.get<Expense[]>(`/expenses${qs(filters)}`),
  });

export const useExpenseSummary = (filters: ExpenseFilters = {}) =>
  useQuery({
    queryKey: ['expenses', 'summary', filters],
    queryFn: () => api.get<ExpenseSummary>(`/expenses/summary${qs(filters)}`),
  });

export const useCreateExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ExpenseInput) => api.post<Expense>('/expenses', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
};

export const useUpdateExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ExpenseInput> }) =>
      api.patch<Expense>(`/expenses/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
};

export const useDeleteExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/expenses/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
};

/**
 * Upload a receipt photo for OCR.
 *
 * Bypasses `api.post` because that helper JSON-encodes the body; multipart needs
 * the browser to set its own `content-type` boundary.
 */
export const useScanReceipt = () =>
  useMutation({
    mutationFn: async (file: File): Promise<ScanResult> => {
      const form = new FormData();
      form.append('file', file);
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
      const res = await fetch(`${base}/expenses/scan`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
        body: form,
      });
      if (!res.ok) throw new Error(`scan failed: ${res.status}`);
      return (await res.json()) as ScanResult;
    },
  });

/** Authenticated receipt URL — the image route requires a bearer token. */
export const receiptUrl = (id: string) => {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
  return `${base}/expenses/${id}/receipt`;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck 2>/dev/null || npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/api/expense-queries.ts
git commit -m "feat(web): add expenses API client"
```

---

### Task 10: Expenses list page

**Files:**
- Create: `web/src/pages/ExpensesPage.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/layouts/AdminShell.tsx`
- Modify: `web/src/i18n/fr.ts`, `web/src/i18n/en.ts`, `web/src/i18n/ar.ts`

**Interfaces:**
- Consumes: `useExpenses`, `useExpenseSummary`, `useDeleteExpense`, `EXPENSE_CATEGORIES` from Task 9
- Produces: route `/expenses`, nav entry gated on `expenses.view`

- [ ] **Step 1: Add i18n keys**

In each of `fr.ts`, `en.ts`, `ar.ts`, add `expenses` to the `nav` block and to `subtitles`, plus an `expenses` section:

- `fr`: `nav.expenses: 'Dépenses'`, `subtitles.expenses: 'Vos dépenses'`, and `expenses: { new: 'Nouvelle dépense', total: 'Total', amount: 'Montant', tax: 'TVA', date: 'Date', category: 'Catégorie', merchant: 'Commerçant', note: 'Note', paymentMethod: 'Paiement', receipt: 'Reçu', scan: 'Scanner un reçu', scanning: 'Analyse du reçu…', scanned: 'Scanné — à vérifier', scanFailed: 'Lecture impossible, saisissez les montants manuellement', lowConfidence: 'Peu sûr — vérifiez', categories: { rent: 'Loyer', utilities: 'Charges', salaries: 'Salaires', supplies: 'Fournitures', transport: 'Transport', maintenance: 'Entretien', taxes: 'Taxes', marketing: 'Marketing', other: 'Autre' } }`
- `en`: same keys, English values (`'Expenses'`, `'New expense'`, `'Scan a receipt'`, `'Scanned — please verify'`, …)
- `ar`: same keys, Arabic values (`'المصاريف'`, `'مصروف جديد'`, `'مسح إيصال'`, `'تم المسح — يرجى التحقق'`, …)

Follow the exact nesting the three files already use. Match `fr.ts` key-for-key — a missing key in `en`/`ar` is a typecheck error if the files are typed against `fr`.

- [ ] **Step 2: Write the page**

`web/src/pages/ExpensesPage.tsx` — model the structure on `SuppliersPage.tsx` (same `Card`, `Btn`, `Badge`, `Input` primitives and the same Tailwind token classes such as `text-ink-500`). It renders:

- A filter row: `from`/`to` date inputs and a category `<select>` built from `EXPENSE_CATEGORIES`, held in one `useState<ExpenseFilters>` and passed straight to both hooks
- A summary strip from `useExpenseSummary(filters)`: grand total plus one chip per non-zero category
- A table from `useExpenses(filters)` with columns date, commerçant, catégorie (translated `Badge`), montant, TVA, reçu (a 📎 link to `receiptUrl(id)` when `receiptPath` is set), and a delete button
- Delete calls `useDeleteExpense` behind a `confirm()`
- A primary "Nouvelle dépense" button routing to `/expenses/new`

Amounts arrive as strings from Prisma `Decimal` — render with `Number(e.amount).toFixed(2)` and reuse the existing formatter in `web/src/i18n/format.ts` if it exposes a currency helper.

- [ ] **Step 3: Register route and nav**

In `web/src/App.tsx`: import `ExpensesPage` and add `<Route path="expenses" element={<ExpensesPage />} />` inside the `AdminShell` route.

In `web/src/layouts/AdminShell.tsx`: add `{ to: '/expenses', labelKey: 'nav.expenses', icon: Receipt, cap: 'expenses.view' },` to the nav array near the `/suppliers` entry (import `Receipt` from `lucide-react`), and add `'/expenses': { title: 'nav.expenses', sub: 'subtitles.expenses' },` to the title map.

- [ ] **Step 4: Verify in the browser**

```bash
cd web && npm run dev
```

Log in as an owner, open `http://localhost:8080/expenses`. Expected: page renders, empty table, no console errors. Log in as a cashier: the Dépenses nav entry is absent.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): add expenses list page"
```

---

### Task 11: Expense form with receipt scan

**Files:**
- Create: `web/src/pages/ExpenseFormPage.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useScanReceipt`, `useCreateExpense`, `useUpdateExpense`, `ScanResult` from Task 9
- Produces: routes `/expenses/new` and `/expenses/:id/edit`

- [ ] **Step 1: Write the form page**

`web/src/pages/ExpenseFormPage.tsx`, following `MovementFormPage.tsx` for layout and submit conventions. Behaviour, in order of importance:

1. **Scan zone at the top.** A file input accepting `image/*` with `capture="environment"` so phones open the camera. On change, call `useScanReceipt().mutate(file)`.
2. **While scanning**, disable submit and show `t('expenses.scanning')`.
3. **On `ocrStatus === 'done'`**, fill each form field whose suggestion value is non-null, and record which fields were auto-filled in a `Set<string>` held in state. Each auto-filled field renders a small `Badge` reading `t('expenses.scanned')`. Fields whose `confidence[field] < 0.6` render a stronger warning `Badge` with `t('expenses.lowConfidence')` instead.
4. **Clear a field's scanned marker as soon as the user edits it** — once they have looked at it, the warning is noise.
5. **On `ocrStatus === 'failed'`**, show `t('expenses.scanFailed')` as an inline notice, leave the form blank and editable, and **keep `receiptPath`** so the photo is still attached to the saved expense. A failed scan must never block recording the expense.
6. Always send `receiptPath` from the scan result in the create/update body.
7. Submit posts `ExpenseInput` and navigates back to `/expenses` on success.

The scanned-field highlight is the core UX contract from the spec: OCR output is a draft, and the user must be able to see at a glance which numbers a machine guessed.

- [ ] **Step 2: Register the routes**

In `web/src/App.tsx`:

```tsx
<Route path="expenses/new" element={<ExpenseFormPage mode="new" />} />
<Route path="expenses/:id/edit" element={<ExpenseFormPage mode="edit" />} />
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: End-to-end manual verification**

```bash
cd backend && docker compose up -d
cd backend && npm run start:dev     # api on 3002
cd web && npm run dev               # web on 8080
```

Photograph or download a real receipt. Open `/expenses/new`, upload it. Expected: montant fills in within a few seconds, marked "Scanné — à vérifier"; the date fills in when the receipt shows one; save works and the row appears in the list with a 📎 receipt link that opens the image.

Then stop the OCR container (`docker compose stop ocr`) and upload again. Expected: the failure notice appears after the timeout, the form stays usable, and saving still attaches the photo.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): add expense form with receipt scan autofill"
```

---

### Task 12: Documentation

**Files:**
- Modify: `docs/03-progress.md`
- Modify: `docs/02-decisions.md`
- Modify: `CLAUDE.md`
- Modify: `docs/01-project-overview.md`

- [ ] **Step 1: Invoke the `document-step` skill**

Project CLAUDE.md makes this mandatory after every passed step, in the same session.

- [ ] **Step 2: Log the decisions**

Add to `docs/02-decisions.md`, continuing the existing `D-XXX` numbering:

- **Python OCR service over an in-process Node library.** Tesseract.js scores ~45% on degraded input vs ~73% for PaddleOCR-family models, and is markedly worse on small dense receipt fonts. A scan that fills in the wrong montant is worse than no scan.
- **RapidOCR over PaddleOCR.** Same models, ~80 MB of dependencies instead of ~500 MB, CPU-optimized inference, no long-running memory leak. PaddleOCR's PP-StructureV3 table parsing is not needed without line-item extraction.
- **Field extraction in Python, using bounding boxes.** Flattening OCR output to a string discards the geometry that makes label-to-amount matching reliable.
- **Receipts served through an authenticated route, not static middleware.** A static mount would expose every tenant's receipts to anyone holding a URL.

- [ ] **Step 3: Update the environment section of CLAUDE.md**

The "Three independent apps" line is now wrong. Replace with four apps, adding `ocr-service/` (Python + FastAPI + RapidOCR, compose-network only, no host port).

- [ ] **Step 4: Mark the module shipped**

In `docs/01-project-overview.md`, mark Dépenses as implemented. Add a progress entry in `docs/03-progress.md` with the gate evidence: pytest output, backend test output, and the manual scan verification from Task 11 Step 4.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: record expenses module and OCR decisions"
```

---

## Self-Review

**Spec coverage:** §5 data model → Task 1. §6 permissions → Task 2. §8 OCR service (`extract.py`, `preprocess.py`, `ocr.py`, `main.py`, baked models) → Tasks 3–4. §4 architecture / compose wiring → Task 4 Step 8. §7 storage + magic-byte sniffing + authenticated receipt route → Tasks 5, 8. §7 `OcrProvider` port → Task 6. §7 CRUD + summary → Task 7. §7 scan endpoint → Task 8. §9 web → Tasks 9–11. §10 error handling → Task 5 (path traversal), Task 6 (service down), Task 8 (bad magic bytes, oversize), Task 11 (failed-scan UX). §11 testing → Task 3 (14 extractor tests), Task 8 Step 6 (7 e2e cases). §12 risks → mitigated in Task 4 Step 7 (baked models), Task 5 Step 6 (uploads volume).

**Deviations from the spec, deliberate:** the spec said `class-validator`; the codebase uses Zod + `ZodValidationPipe`, so the plan uses Zod. The spec described a flat module; the codebase uses port/adapter layering, so the plan follows that. The spec did not mention `TENANT_MODELS`; registration there is mandatory or expenses leak across tenants — added to Task 1.

**Type consistency:** `OcrSuggestion` (Task 6) mirrors `extract()`'s return shape (Task 3) field for field, and `ScanResult.suggestion` (Task 9) mirrors it again across the HTTP boundary. `ExpensesRepository.findById` returns `receiptPath`, which Task 8's `readReceipt` and `remove` both rely on. `LocalStorageService.save` takes `ReceiptExt`, which `sniffExtension` returns.

**Known soft spots:** Task 8 Step 6 describes e2e cases as comments rather than full code, because the bootstrap helpers in `backend/test/` must be read first and copied. Tasks 10 and 11 describe the React components in prose rather than full JSX, because they must match existing Tailwind tokens and the `useI18n` hook shape.
