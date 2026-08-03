# Decision Log

> One entry per significant decision. Newest on top. Format: date · decision · why · rejected alternatives.

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
