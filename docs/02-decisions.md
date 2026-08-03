# Decision Log

> One entry per significant decision. Newest on top. Format: date · decision · why · rejected alternatives.

## D-010 — 2026-08-03 · Three repos: backend+ocr, web, mobile — **supersedes D-009**
- **Decision:** `backend` repo (root = the old `backend/`, with `ocr-service/` nested inside it and all product docs), `web` repo, `mobile` repo. Reverses D-009's single repo, decided the same day.
- **Why:** Deployment coupling is the real boundary, and it runs backend↔ocr, not backend↔frontends. `docker-compose.prod.yml` builds both from one context, so they must clone together; web deploys to Cloudflare Pages and mobile to EAS, each with an independent release cadence and its own CI needs. Docs ride with the backend because `DEPLOY.prod.md` and the progress log track it most closely.
- **Consequences:** `../ocr-service` → `./ocr-service` in both compose files. CI workflow returns to `.github/workflows/ci.yml` with no path filter or `working-directory`. `.dockerignore` must now exclude `ocr-service/`, `docs/` and the 2 MB HTML mockup from the Node build context. `CLAUDE.md` and `.claude/` live in the backend repo; the workspace root carries symlinks to them so tooling still resolves when run from the root — the symlinks are unversioned and must be recreated on a fresh checkout.
- **Rejected:** single repo (D-009 — atomic cross-app commits are real, but they were bought at the price of tangled CI and a clone that drags three unrelated apps), ocr as a fourth standalone repo (would force a registry + image push just to deploy), git submodules (coordination cost without the benefit).

## D-009 — 2026-08-03 · One git repository for all four apps *(superseded by D-010 the same day)*
- **Decision:** Single repo at the workspace root covering `backend/`, `web/`, `mobile/`, `ocr-service/` and `docs/`. Supersedes the per-app repo layout. **Not** a monorepo in the tooling sense — no npm workspace, no turbo; each app keeps its own `package.json`, install and deploy (D-001 stands).
- **Why:** Only `backend/` was actually versioned — `web/` and `mobile/` had git dirs with **zero commits**, `ocr-service/` and `docs/` had none, and no repo had a remote: one bad `rm` would have erased the project. Beyond that, `backend/docker-compose.prod.yml` builds `ocr` from `../ocr-service`, which only resolves inside one tree; and schema changes routinely touch backend + web + mobile together, which split repos turn into three PRs with a version-skew window.
- **Migration:** backend history rewritten into the `backend/` subdirectory (`git filter-branch --index-filter` on a bare clone — `git-filter-repo` is unavailable under PEP 668), fetched into a fresh root repo, index restored with a mixed `git reset` so the uncommitted multi-tenancy WIP was never touched. Verified: uncommitted diff hash identical before/after (`00ce901c…`), 40 modified + 58 untracked files unchanged.
- **Rejected:** separate repos per app (breaks the compose relative build context, splits atomic changes), git submodules (all the coordination cost of split repos plus detached-HEAD footguns), keeping the workspace root unversioned (docs and the mandatory progress log had no history at all).
- **Cost accepted:** CI must path-filter (`paths: backend/**`) or every push builds all four apps.

## D-008 — 2026-08-03 · Prod compose lives in `backend/`, secrets only in `.env.prod`
- **Decision:** `docker-compose.prod.yml` + `.env.prod.example` + `Makefile` moved from the workspace root into `backend/` (build context `.`). `DATABASE_URL` and every other secret come from `.env.prod` via `env_file` — never inline in the compose file. Prod publishes **zero** host ports (postgres and ocr internal-only, backend reachable only on the external `nginx-proxy` network); dev keeps `3002`/`5433`.
- **Why:** `backend/` *is* the git repo — the workspace root is not versioned, so a root-level compose file was untracked and could not ship with the code. Inline `DATABASE_URL` in compose puts a production password in git; `env_file` keeps it in the gitignored `.env.prod`. Publishing prod ports would expose Postgres and the receipt OCR service directly to the host/internet, bypassing nginx and TLS.
- **Rejected:** compose at workspace root (outside the repo, untracked), `environment:` block with `${DATABASE_URL}` interpolation (works, but duplicates the variable in two places and still needs `--env-file`), separate prod override file layered on the dev compose (dev publishes ports — an override cannot *remove* a published port, only add).

## D-007 — 2026-08-03 · Receipts served through an authenticated route, not static middleware
- **Decision:** `GET /v1/expenses/:id/receipt` behind the normal auth guard + `expenses.view`. Files live at `backend/uploads/<businessId>/<random>.<ext>`, path resolution rejects anything escaping the root.
- **Why:** A Nest static mount would make every tenant's receipts readable to anyone holding a URL. Receipts carry supplier names and amounts. Tenant-scoped paths + a tenant-filtered `findById` make cross-tenant reads impossible by construction.
- **Rejected:** static file middleware (URL = access), Postgres bytea (DB bloat), S3/MinIO (extra service now; `LocalStorageService` is the only file-path-aware class, so swapping later is contained).

## D-006 — 2026-08-03 · OCR field extraction uses bounding boxes, in Python
- **Decision:** `ocr-service/app/extract.py` matches an amount to its label by horizontal band, with a bottom-third largest-amount fallback and per-field confidence. Pure function, no I/O.
- **Why:** `image → raw text → regex` is the standard approach and it fails: OCR noise turns `RM28.20` into `IRMZ8. 20`, and decorative text defeats line-based regex. RapidOCR returns a box per fragment; flattening to a string throws away exactly the geometry that makes label→amount matching reliable. Geometry does not survive the service boundary, so extraction cannot live in NestJS.
- **Rejected:** regex over concatenated text (fragile), LayoutLM/Donut (GPU + training data for a 4-field problem).

## D-005 — 2026-08-03 · RapidOCR (ONNXRuntime), not PaddleOCR proper
- **Decision:** `rapidocr-onnxruntime`, models baked into the image at build time.
- **Why:** Same PaddleOCR-trained models, ~80 MB of deps vs ~500 MB, CPU-optimized inference (0.2–1 s/page), and no long-running memory leak. PaddleOCR's only real edge is PP-StructureV3 table parsing, which v1 does not need — no line-item extraction. Baking models avoids a first-request download failing on a fresh or offline host.
- **Rejected:** PaddleOCR (heavy), Surya (~50× slower on CPU), EasyOCR (weaker on dense receipt fonts), OCR.space free API (ships customer receipts to a third party).

## D-004 — 2026-08-03 · Dépenses OCR runs in a Python service, not a Node library
- **Decision:** Fourth app `ocr-service/` (Python 3.12 + FastAPI + RapidOCR), compose-network only, **no published host port**. NestJS talks to it behind an `OcrProvider` port.
- **Why:** Tesseract.js scores ~45% on degraded input vs ~73% for PaddleOCR-family models, and is markedly worse on the small dense fonts typical of thermal receipts. A scan that fills in the *wrong* montant is worse than no scan, because the user may not catch it. The port keeps Python out of the application layer — unit and e2e suites run with a stub.
- **Rejected:** Tesseract.js in-process (accuracy), Claude vision API (per-scan cost + sends receipts off-box), Google Cloud Vision (extra billing account, still raw text only).

## D-003 — 2026-08-03 · Documentation system + auto-doc skill
- **Decision:** `docs/` folder with overview / decision log / progress log. Project skill `document-step` enforces: every passed step → documented same session.
- **Why:** Three-app build over many phases; context lost between sessions without a written trail.

## D-002 — 2026-08-02 · Product name: **Tijaru**
- **Decision:** Rename product "Stock" → **Tijaru** (Arabic *tijara* = commerce). Register tijaru.com + tijarou.com + tijaru.ma (+ tijaru.io).
- **Why:** "Stock" = generic, names one module only; app is a full suite (stock, POS, clients, factures, dépenses). *Tijara* root covers whole commerce. tijaru.com bare .com available; zero index/trademark collisions; pronounceable MA + EU. FR "u"=ü drift hedged with tijarou.com redirect.
- **Rejected:** Mizano (too stock-narrow), Caisso (POS-narrow), Tajiro (collision: Tajir YC app + TAJIRO on Play Store), Tijario (.com sniped mid-evaluation), Souko (Soko POS collision), Cashio (hacked Solana protocol), Caissa (fintech taken), Kasbah (India software co), attijaro (Attijariwafa Bank trademark risk).

## D-001 — (pre-doc) · Architecture: three independent apps, no monorepo
- **Decision:** `backend/` (NestJS+Prisma+Postgres) as single source of truth; `web/` (React+Vite); `mobile/` (Expo). Types shared via OpenAPI codegen, not workspace packages.
- **Why:** See `IMPLEMENTATION_PLAN.md §0` — simpler tooling, no pnpm workspace/turbo overhead.
