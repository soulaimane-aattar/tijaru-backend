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
