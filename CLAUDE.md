# Tijaru (GestionStock)

All-in-one commerce platform for Moroccan/EU SMBs — stock, POS, clients, factures, dépenses. Product name: **Tijaru** (working title was "Stock").

## Docs — MANDATORY workflow

- Documentation lives in `docs/` — read `docs/README.md` first, `docs/03-progress.md` for current state.
- **After every passed step/phase/fix: invoke the `document-step` skill** and update `docs/03-progress.md` (+ `docs/02-decisions.md` for decisions) BEFORE starting the next step. Same session, no exceptions.
- Spec: `Stock-build-spec.md` · Plan: `IMPLEMENTATION_PLAN.md`

## Environment

- web :8080 · api :3002 · postgres :5433 (`.env DATABASE_URL` may point at wrong project DB — always override with 5433)
- Four independent apps, **three git repos** (see D-010):
  - **this repo** = `backend/` (NestJS+Prisma) at the root + `ocr-service/` (Python+FastAPI+RapidOCR) nested inside it, plus all product docs.
  - `../web` (React+Vite) — own repo.
  - `../mobile` (Expo) — own repo.
  No monorepo, no workspace: separate `package.json`, install and deploy per app.
- `ocr-service` has **no published host port** — reachable only on the compose network as `http://ocr:8000`. Receipts are private data.
- Deploy: `make deploy` from this repo root (`docker-compose.prod.yml`, no host ports). `make` alone lists targets.

## Mobile Design System (`mobile/src/theme/` + `mobile/src/ui/`)

### Tokens — ALWAYS use, never hardcode

| Token file | What | Import |
|---|---|---|
| `@/theme/colors` | Brand/ink/accent/danger palette | `colors.brand[700]`, `colors.ink[500]` |
| `@/theme/spacing` | Screen padding, gaps, card padding | `spacing.screenX` (16), `spacing.cardGap` (8) |
| `@/theme/typography` | Font sizes (7-step scale) | `fontSize.sm` (12), `textClass.base` ("text-[14px]") |
| `@/theme/shadows` | Card / subtle shadow presets | `shadows.card`, `shadows.subtle` |
| `@/theme` | Barrel export of all above | `import { colors, spacing, fontSize } from '@/theme'` |

### Typography scale (ONLY these sizes)

| Token | px | Tailwind class | Use for |
|---|---|---|---|
| xs | 10 | `text-[10px]` | Badges, timestamps, meta |
| sm | 12 | `text-[12px]` | Secondary text, small buttons |
| base | 14 | `text-[14px]` | Body, inputs, default |
| md | 15 | `text-[15px]` | Card titles, list items |
| lg | 17 | `text-[17px]` | Section headers, empty titles |
| xl | 20 | `text-[20px]` | Page numbers, totals |
| xxl | 24 | `text-[24px]` | Hero numbers |

No fractional sizes (no 10.5, 11.5, 12.5, 13.5). No sizes outside this scale.

### Spacing constants

- Screen horizontal padding: `spacing.screenX` (16) — use `px-4` or `paddingHorizontal: spacing.screenX`
- Card list gap: `spacing.cardGap` (8) — use `gap: spacing.cardGap`
- Section gap: `spacing.sectionGap` (12)
- Card inner padding: `spacing.cardPadding` (16) — handled by `<Card>`

### Shared UI components — use instead of re-implementing

| Component | Import | Use for |
|---|---|---|
| `<Btn>` | `@/ui/btn` | All buttons (primary/outline/danger/ghost) |
| `<Card>` | `@/ui/card` | All card containers (includes shadow) |
| `<Badge>` | `@/ui/badge` | Status/category labels |
| `<Icon>` | `@/ui/icon` | ALL icons — never raw emoji in `<Text>` |
| `<FilterChip>` | `@/ui/filter-chip` | Date/category filter pills |
| `<ActionRow>` | `@/ui/action-row` | Print/share/action button rows |
| `<Empty>` | `@/ui/empty` | Empty state with icon+title+body |
| `<ScreenHeader>` | `@/ui/screen-header` | Screen top bar with back+title+right |
| `<PrinterSheet>` | `@/components/PrinterSheet` | BLE printer picker bottom sheet |

### Rules

- **No hardcoded hex colors** — use Tailwind classes (`text-brand-700`) or `colors.*` for style props.
- **No hardcoded shadows** — use `shadows.card` or let `<Card>` handle it.
- **No raw emoji in `<Text>`** — always use `<Icon name="emoji">`. Emoji render as tofu boxes on iOS.
- **No inline Pressable button rows** — use `<ActionRow>` or `<Btn>`.
- **Spacing via tokens** — `contentContainerStyle={{ padding: spacing.screenX, gap: spacing.cardGap }}`.
