# Tijaru — Project Overview

## Brand

- **Name:** Tijaru (from Arabic *tijara/تجارة* = commerce). Formerly working name "Stock".
- **Domains:** tijaru.com (primary) · tijarou.com (FR-spelling redirect) · tijaru.ma (Morocco) · tijaru.io (spare)
- **Tagline:** *Votre commerce, au complet. تجارتك كاملة.*
- **Colors:** teal `#0F766E` (primary) · orange `#F97316` (accent) — full palette in `Stock-build-spec.md §3.2`
- **Logo:** Moroccan horseshoe-arch mark with negative-space "T" (variant A) — see decision log

## Product

All-in-one commerce platform for Moroccan (and later European) SMBs. Modules:

| Module | Scope |
|--------|-------|
| Stock | Multi-warehouse inventory, receptions, counts, transfers |
| POS (Caisse) | Front-of-counter checkout, ICE-compliant receipts, MAD |
| Clients | Client management |
| Factures | Invoicing |
| Dépenses | Expense tracking + receipt photo OCR (montant, TVA, date, commerçant) |
| Admin | Users, 6 roles, permissions, billing, multi-store |

- **Languages:** FR-first, AR (RTL), EN
- **Roles:** owner / admin / manager / stockkeeper / cashier / viewer (level 6→1)
- **Compliance:** ICE receipts (Morocco), MAD formatting

## Architecture

Four independent app folders (no monorepo):

```
GestionStock/
├── backend/      # NestJS + Prisma + PostgreSQL — single source of truth
├── web/          # React + Vite admin
├── mobile/       # Expo + React Native (NativeWind)
├── ocr-service/  # Python 3.12 + FastAPI + RapidOCR — receipt OCR, stateless,
│                 # compose-network only (no published host port)
└── docs/         # this documentation
```

- Type sharing: backend OpenAPI 3.1 → `pnpm gen:api` → `openapi-typescript` clients
- Permissions matrix duplicated per app + CI drift guard
- Local env: web :8080 · api :3002 · postgres :5433

## Key files

- `Stock-build-spec.md` — full spec (screens, data model, i18n strings)
- `IMPLEMENTATION_PLAN.md` — phase map + gates
- `docs/03-progress.md` — live build log
