# Tijaru (GestionStock)

All-in-one commerce platform for Moroccan/EU SMBs — stock, POS, clients, factures, dépenses. Product name: **Tijaru** (working title was "Stock").

## Docs — MANDATORY workflow

- Documentation lives in `docs/` — read `docs/README.md` first, `docs/03-progress.md` for current state.
- **After every passed step/phase/fix: invoke the `document-step` skill** and update `docs/03-progress.md` (+ `docs/02-decisions.md` for decisions) BEFORE starting the next step. Same session, no exceptions.
- Spec: `Stock-build-spec.md` · Plan: `IMPLEMENTATION_PLAN.md`

## Environment

- web :8080 · api :3002 · postgres :5433 (`.env DATABASE_URL` may point at wrong project DB — always override with 5433)
- Four independent apps: `backend/` (NestJS+Prisma), `web/` (React+Vite), `mobile/` (Expo), `ocr-service/` (Python+FastAPI+RapidOCR). No monorepo, no workspace.
- `ocr-service` has **no published host port** — reachable only on the compose network as `http://ocr:8000`. Receipts are private data.
