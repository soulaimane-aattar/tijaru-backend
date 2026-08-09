# Progress Log

> Append one entry after **every passed step** (same session it passes). Newest entry on top of the log section. Phase table mirrors `IMPLEMENTATION_PLAN.md`.

## Phase status

| # | Phase | Folder(s) | Status |
|---|-------|-----------|--------|
| 1 | Backend bootstrap | backend | ✅ retro — docker-compose, NestJS, swagger present |
| 2 | Domain + Prisma schema | backend | ✅ retro — migrations since 2026-05-22 |
| 3 | Permissions + Auth + Users | backend | ✅ retro — auth module + role_customization migration |
| 4 | Products module | backend | ✅ retro — modules present |
| 5 | Web bootstrap + login + dashboard | web | ✅ retro — pages/auth/layouts present |
| 6 | Mobile bootstrap + login + dashboard | mobile | ✅ retro — (auth)/(tabs) present |
| 7 | Products vertical slice | web + mobile | ✅ retro — inventory screens present |
| 8+ | POS, customers, suppliers, purchase-orders, admin, tenancy | all | 🟡 in progress — screens exist, gates unverified |
| 10 | Unified auth + subscriptions + super admin panel | backend + web | 🟡 design approved, plan written — implementation pending |
| 9 | Dépenses + receipt OCR | backend + ocr-service + web | ✅ migration applied, 196 unit + 132 e2e green, live OCR verified in browser |

> **retro** = phase completed before this log existed; status inferred from code, gate not re-verified. First future session touching a retro phase: verify its gate, then flip to plain ✅.

## Log

### 2026-08-09 — Unified auth + subscriptions + super admin panel: design + plan
- **Step:** Brainstormed, designed, and wrote full implementation plan for unified auth system. Design spec at `docs/superpowers/specs/2026-08-09-unified-auth-subscriptions-design.md`. Implementation plan at `docs/superpowers/plans/2026-08-09-unified-auth-subscriptions.md`.
- **Result:** ✅ Design approved by user. Plan covers 12 tasks: (1) Prisma migration — subscription fields on Business, (2) Unified login — single `/auth/login` checks PlatformAdmin then User, (3) SubscriptionGuard — block expired businesses, (4) ModuleGuard + `@RequiresModule` decorator, (5) LimitGuard — enforce maxUsers/Products/Warehouses, (6) Super admin API endpoints — CRUD + subscription + module management, (7) Web unified auth store + login redirect, (8) Web super admin panel pages — dashboard + business list/detail, (9) Registration email conflict check + default module seeding, (10) `/auth/me` includes modules + subscription, (11) Frontend module gating + subscription expired screen, (12) Deploy migration + seed existing businesses.
- **Decisions:** D-011 unified login approach (check PA table first, fall through to User), D-012 subscription model (flat fields on Business, no separate table), D-013 module gating (existing BusinessModule table + `@RequiresModule` + ModuleGuard), D-014 guard order (JWT → Subscription → Module → Limit → Caps, super admin bypasses all except JWT)
- **Next:** Begin Task 1 — Prisma migration to add subscription fields to Business model

### 2026-08-08 — Task 3: `POST /auth/register` self-serve signup
- **Step:** Added self-serve signup to the auth module (part of the signup+approval flow, task 3 of 3 planned backend tasks). New `RegisterSchema` Zod DTO (`src/modules/auth/dto/register.dto.ts`); `AuthRepository.createBusinessWithOwner` added to the abstract port and implemented in `PrismaAuthRepository` via `prisma.$transaction` (creates `Business` with `status: pending` + owner `User` in one transaction, using `BuiltInRole`/`BusinessStatus` enums); `AuthService.register()` (calls `ensureNoConflict`, hashes password with bcrypt, returns `{ status: 'pending' }`); `AuthController` gained `@Public() POST /auth/register` (`@HttpCode(201)`).
- **Result:** ✅ `npx jest src/modules/auth/application/auth.service.spec.ts --no-cache` → 5/5 passed (3 pre-existing login-gate tests + 2 new register tests: conflict throws `ConflictError`, success returns `{status:'pending'}` and calls `createBusinessWithOwner` with the right shape). `npx tsc --noEmit` → clean. Commit `4230742`.
- **Decisions:** none new — followed Task 1/2 conventions (`BusinessStatus` enum, nullable `ice`, `ForbiddenError`/`ConflictError` from `common/errors`). Minor TS-strict adaptation: `exactOptionalPropertyTypes` required a conditional spread (`...(input.phone !== undefined ? { phone: input.phone } : {})`) instead of directly assigning `phone: input.phone` in both `AuthService.register` and `PrismaAuthRepository.createBusinessWithOwner` — behavior unchanged, just satisfies the stricter TS config already enabled in this repo.
- **Next:** wire up the admin-approval side (approve/reject pending businesses) and any web-side signup form, if not already covered by a separate task.

### 2026-08-03 — nginx vhost hardened + /api/health + Swagger gated + .env.prod generated
- **Step:** Prepared the `api.tijaru.ma` deployment path end to end: reworked `euras/eurasians-proxy/nginx/sites-available/api.tijaru.ma.conf`, added a real health endpoint, closed a Swagger exposure, and generated the production env file.
- **Result:** ✅ verified against real containers, not by reading configs.
  - **Dead probe fixed:** the vhost proxied `/api/health`, which **did not exist** — global prefix is `api` + URI versioning, so every route is `/api/v1/*`. Added a version-neutral `HealthController` (`/api/health`, public, `SELECT 1` DB probe) → `200 {"status":"ok","database":"up"}` unauthenticated.
  - **Swagger exposure closed:** `SwaggerModule.setup` ran unconditionally, so `api.tijaru.ma/api/docs` would have published every route, DTO and auth requirement. Now `SWAGGER_ENABLED ?? NODE_ENV !== 'production'`. The dev compose stack sets `NODE_ENV=production`, so it opts back in explicitly — `/api/docs` still 200 locally, 404 with the flag unset. nginx returns 404 for `/api/docs` as a second layer.
  - **Proxy-wide outage risk removed:** the conf used `upstream { server tijaru-backend:3000; }`. nginx resolves upstream names at **startup**, so a missing backend container fails the whole config — proven live: `nginx -t` over the real proxy repo aborted on `api.hub.conf` for exactly this reason. Switched to request-time Docker DNS (`proxy_pass http://$tijaru_api$request_uri`, resolver already declared once in `nginx.conf`). With the backend disconnected: config test still passes, container stays up, requests return **502**; reconnecting recovers automatically within the DNS TTL.
  - **Duplicate headers deduped:** helmet and nginx both sent HSTS/nosniff/Referrer-Policy, including a weaker `max-age=15552000`. Added `proxy_hide_header` for the three; now exactly one copy each, `max-age=63072000; includeSubDomains; preload`.
  - **End-to-end proof** (real `stock-backend` container behind nginx:alpine on :8443, self-signed cert): `/api/health` 200, `/api/v1/products` 401, `/api/docs` 404, headers single-copy.
  - **`.env.prod` generated** at `backend/.env.prod`, `chmod 600`, gitignored (`git check-ignore` confirms) — strong DB password, two `openssl rand -hex 32` JWT secrets, admin password, CORS for `www.tijaru.ma`/`tijaru.ma`/`tijaru.pages.dev`. `make prod-config` resolves; password matches between `POSTGRES_PASSWORD` and `DATABASE_URL`; **0** published host ports.
  - Gates: `tsc --noEmit` clean, `eslint --max-warnings=0` clean, `196/196` unit tests. Commit `6f8609f`.
- **Blockers before this can actually serve traffic:**
  - ⚠️ **No TLS cert** — `euras/eurasians-proxy/ssl/api.tijaru.ma/` does not exist. The conf is already picked up by `sites-available/*.conf`, so reloading the proxy without it fails config validation and takes **all** hosted sites down.
  - ⚠️ **Port 80 unpublished** in the proxy compose (`# - "80:80"`) and no `/var/www/certbot` webroot mounted → HTTP-01 impossible, HTTP→HTTPS block inert. Use DNS-01, or publish 80 + mount a webroot.
  - The proxy-repo conf change is **uncommitted** in `euras/eurasians-proxy` (that repo is separate; the file was untracked there to begin with).
  - `PLATFORM_ADMIN_PASSWORD` in `.env.prod` is machine-generated — change it after first login.

### 2026-08-03 — Split into three repos: backend+ocr, web, mobile
- **Step:** Reversed the consolidation from the entry below (same session, user's call). `backend/` is now a repo whose **root is the old `backend/` directory**, with `ocr-service/` nested inside it and all product docs (`docs/`, plan, spec, `CLAUDE.md`, `DEPLOY.prod.md`, HTML mockup) moved in. `web/` and `mobile/` are separate repos.
- **Result:** ✅
  - Backend history came back at its **original SHAs** (`5723838`…`e5eab6c`) — hoisting `backend/*` to the root reproduced the pre-consolidation trees exactly. 11 commits, 129 files at HEAD, zero `web/`/`mobile/` paths.
  - **WIP preserved a third time:** diff hash still `00ce901cdd53…`, 40 modified + 58 untracked.
  - `web` and `mobile`: 1 commit each, 81 files each, clean tree. Their `main` initially pointed at backend-only history (nothing in it touched `web/`, so `--prune-empty` left the branch untouched) — repointed at the correct filtered commit and the stray `feat/multi-tenancy` branch dropped.
  - Compose verified from resolved config: ocr context → `…/backend/ocr-service`, backend context → `…/backend`, `DATABASE_URL` still only from `.env.prod`, **0** published host ports. `docker compose -f docker-compose.yml config -q` → OK.
  - Commits: `66b7661` (backend split fixes), `779dc2b` (web initial), `c988229` (mobile initial).
- **Decisions:** D-010, supersedes D-009.
- **Caveats / next:**
  - ⚠️ **Still no remotes** — three repos, all local-only. This remains the top risk.
  - `docker-compose.yml` (dev) carries the `./ocr-service` path fix **inside the uncommitted WIP**, since the file already had multi-tenancy edits and the two could not be separated cleanly. It ships when the WIP is committed.
  - Workspace-root `CLAUDE.md` and `.claude` are **symlinks** into the backend repo — unversioned, recreate with `ln -s backend/CLAUDE.md CLAUDE.md && ln -s backend/.claude .claude` on a fresh checkout.
  - `mobile/.gitignore` now drops the prebuild-generated `ios/` and `android/` trees.
  - CI workflow edited but never executed — no remote to run it.

### 2026-08-03 — All four apps consolidated into one git repository *(reverted same day — see the entry above)*
- **Step:** Root workspace is now the single git repo. Backend's 7 commits rewritten into the `backend/` subdirectory and imported; `web/`, `mobile/`, `ocr-service/`, `docs/`, spec, plan and the standalone HTML mockup tracked for the first time; root `.gitignore` added; nested `.git` dirs removed.
- **Result:** ✅
  - **Pre-state (the reason):** `web/.git` and `mobile/.git` existed with **0 commits** (19 and 65 uncommitted files); `ocr-service/` and `docs/` had no repo; no repo had a remote. Only `backend/` had history.
  - History preserved: `git log` shows all 7 commits, paths under `backend/`, 101 files in `HEAD`.
  - **WIP safety verified:** backend's uncommitted multi-tenancy work untouched — 40 modified + 58 untracked before and after, file lists `IDENTICAL`, and the diff hash matched exactly (`00ce901cdd53…` old repo vs new repo).
  - Consolidation commit `f432982` staged 191 files, **0** of them under `backend/` — the WIP stayed out of it.
  - No `node_modules` leaked into the index (`grep -c node_modules` → 0). `.claude/settings.local.json` excluded by the user's global gitignore.
  - Backups kept in the session scratchpad: `git-backup-backend.tgz`, `git-backup-nested.tgz`.
- **Decisions:** D-009.
- **Next / still open:**
  - ⚠️ **No remote yet** — the project still exists on one disk only. Create a private remote and push; needs the user's host choice + `gh` auth.
  - ✅ **CI fixed same session** (`9189558`): `backend/.github/workflows/ci.yml` → `.github/workflows/backend-ci.yml`. GitHub only reads `.github/workflows` at the **repo root**, so after consolidation the workflow would silently never have run. Job now sets `defaults.run.working-directory: backend`, `cache-dependency-path: backend/package-lock.json`, and `paths: ['backend/**', '.github/workflows/backend-ci.yml']` so one push does not build all four apps. Not yet executed on GitHub — no remote exists.
  - Web / mobile / ocr-service still have no CI workflow at all.

### 2026-08-03 — Prod deploy stack moved into `backend/` + Makefile
- **Step:** `docker-compose.prod.yml` and `.env.prod.example` moved from the workspace root into `backend/` (build context `./backend` → `.`); added `backend/Makefile` wrapping both stacks; added the missing `ocr` service + `tijaru-uploads` volume to prod; `.env.prod` and `backup-*.sql` gitignored; `Dockerfile.prod` pre-creates `/srv/uploads` owned by `node`.
- **Result:** ✅ verified from the resolved config, not from the source file.
  - `make prod-config | grep -c 'published:'` → **0** — no host port in prod. Postgres and ocr are `internal` net only; backend `expose: 3000` + `nginx-proxy` alias.
  - Resolved backend env: `DATABASE_URL=postgresql://tijaru:…@postgres:5432/tijaru?schema=public` (from `.env.prod`, absent from the compose file), `OCR_SERVICE_URL=http://ocr:8000`, `UPLOADS_DIR=/srv/uploads`, volume `tijaru-uploads → /srv/uploads`.
  - Build contexts resolve to `…/GestionStock/backend` and `…/GestionStock/ocr-service`.
  - `make` with no `.env.prod` → `".env.prod missing. Run: cp .env.prod.example .env.prod && edit it"`, exit 2. `make help` lists 18 targets.
  - Dev `docker-compose.yml` untouched: inline `DATABASE_URL` default, `3002:3000` + `5433:5432`.
  - Committed as `e5eab6c` — infra files only; the `feat/multi-tenancy` WIP stays uncommitted.
- **Decisions:** D-008.
- **Caveats / next:**
  - The `ocr` build context is `../ocr-service`, **outside** the git repo — the deploy host needs `ocr-service/` checked out next to `backend/`, or the ocr image built and pushed separately.
  - Nothing here has been run against a real prod host yet: only `docker compose config` was validated, no `make deploy` on a server.
  - `.env.prod` was previously *not* gitignored while `backend/` is the repo — now fixed. `git log --all -- .env.prod` → empty, so no real prod secret ever landed in history.

### 2026-08-03 — Dépenses + OCR: all gates green (Docker fixed)
- **Step:** Unblocked the Docker fault from the previous entry, applied the migration, ran every gate end-to-end. Also fixed two pre-existing breakages found on the way.
- **Result:** ✅ all green.
  - **Docker root cause:** containers created while the daemon was in a bad state came up with `NetworkSettings.Networks == {}` — no network, so neither the host port nor the compose network worked. `docker compose down` + `network prune` did **not** clear it; a Docker Desktop restart **plus recreating the container** did. Restarting the daemon alone was not enough — the broken container had to be destroyed.
  - Migration: `20260803160000_add_expenses` applied; `prisma migrate diff` → **"No difference detected"** (hand-written SQL matches the schema exactly).
  - Backend unit: `Test Suites: 9 passed / Tests: 196 passed`. Full e2e: `Test Suites: 9 passed / Tests: 132 passed` (includes 14 expenses cases: cross-tenant receipt 404, cross-tenant record 404, cashier 403, oversize 413, bad magic bytes 400).
  - **Live stack** (postgres + ocr + backend containers), real RapidOCR on a pharmacy receipt containing decoys `TOTAL HT 204,58` and a `145,00` line item → picked the correct `TOTAL TTC`: `amount 245.5 · taxAmount 40.92 · date 2026-07-15 · merchantName "PHARMACIE ALFARABI"`, confidence 0.775–0.99.
  - Receipt round-trip byte-identical (46 135 B); unauthenticated receipt fetch → **401**.
  - **Browser, full UI flow:** upload → 4 fields autofilled, each badged "Scanné — à vérifier" → editing the merchant cleared *only* that badge → saved → list shows the row with 📎 and the total updated to 491,00 MAD.
- **Fixes to pre-existing breakage (not caused by this work):**
  - `web` build and test runner were broken: `@testing-library/react` v16 needs `@testing-library/dom` as an explicit dep. Added it — `npm run build` now succeeds and web tests go from **0 runnable to 29 passing**.
  - `test/auth.e2e-spec.ts` hardcoded `18` capabilities; now derives from `CAPABILITY_IDS.length` so adding a capability cannot break it.
  - `web/vite.config.ts` dev proxy target is now overridable via `VITE_PROXY_TARGET` (needed to test OCR against the dockerised API, since `ocr-service` has no host port).
- **Next:** mobile screens for Dépenses; consider `OCR_LANGS=fr,ar` once Arabic receipts appear.

### 2026-08-03 — Dépenses module + receipt OCR (RapidOCR)
- **Step:** New `Expense` model + NestJS `expenses` module (CRUD, summary, scan, authenticated receipt route), new fourth app `ocr-service/` (Python 3.12 + FastAPI + RapidOCR), web list + form pages with scan autofill. Spec: `docs/superpowers/specs/2026-08-03-expenses-ocr-design.md` · Plan: `docs/superpowers/plans/2026-08-03-expenses-ocr.md`
- **Result:** 🟡 partial — code gates pass, DB gate blocked.
  - Backend unit: `Test Suites: 9 passed, 9 total / Tests: 196 passed, 196 total`; `tsc --noEmit` and `eslint --max-warnings=0` clean.
  - OCR service in-container: `20 passed in 1.08s` (15 extractor + 5 API).
  - **Real engine end-to-end** on a synthetic receipt → `amount 284.5 · taxAmount 47.42 · date 2026-08-01 · merchantName "CAFE ATLAS"`, confidences 0.79–0.99. Raw blocks read correctly including `TOTAL TTC` / `TVA 20%`.
  - Web: `tsc --noEmit` clean (2 pre-existing `@testing-library/react` errors in `Badge.test`/`Btn.test` only), `eslint` clean.
  - ❌ **Blocked:** `prisma migrate deploy` not run. Docker networking is corrupted on this machine — `stock-postgres` starts healthy but gets **no network at all** (`NetworkSettings.Networks == {}`), so both host port 5433 and the compose network are unreachable (`P1001`). Migration SQL is hand-written and committed at `backend/prisma/migrations/20260803160000_add_expenses/`. Web test runner is separately broken pre-existing: `Cannot find module '@testing-library/dom'`.
- **Decisions:** D-004 (Python OCR service), D-005 (RapidOCR over PaddleOCR), D-006 (bounding-box extraction), D-007 (authenticated receipt route).
- **Next:** After a Docker restart — `docker compose up -d postgres && npx prisma migrate deploy && npm run test:e2e` (`backend/test/expenses.e2e-spec.ts`, 15 cases incl. cross-tenant receipt 404), then drive a real photo through `/expenses/new`.

### 2026-08-03 — Documentation system created
- **Step:** docs/ scaffolding + `document-step` skill + project CLAUDE.md rule.
- **Result:** ✅ docs/README, 01-overview, 02-decisions (D-001…D-003 seeded), this log.
- **Next:** rename "Stock" → "Tijaru" across spec, i18n strings, app configs.

### 2026-08-02 — Product named **Tijaru**
- **Step:** naming research — functionality audit, collision searches, live whois/DNS checks.
- **Result:** ✅ Tijaru chosen (see D-002). tijaru.com confirmed available; registration pending (user action).
- **Next:** buy tijaru.com + tijarou.com + tijaru.ma; generate logo (Nano Banana prompt ready — arch-T variant A / module-grid variant B).

<!-- TEMPLATE — copy for each new entry:
### YYYY-MM-DD — <step title>
- **Step:** what was built/changed.
- **Result:** ✅/❌ + gate evidence (test output, screenshot, endpoint check).
- **Decisions:** link D-XXX if any.
- **Next:** immediate follow-up.
-->
