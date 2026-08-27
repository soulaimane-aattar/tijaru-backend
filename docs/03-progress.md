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
| 10 | Unified auth + subscriptions + super admin panel | backend + web | ✅ 12 tasks complete, final review passed, branch ready |
| 9 | Dépenses + receipt OCR | backend + ocr-service + web | ✅ migration applied, 196 unit + 132 e2e green, live OCR verified in browser |

> **retro** = phase completed before this log existed; status inferred from code, gate not re-verified. First future session touching a retro phase: verify its gate, then flip to plain ✅.

## Log

### 2026-08-27 — Fix: BC/bon PDF download 500 (Arabic font asset path mismatch)

**Bug.** Mobile TestFlight: `UnableToDownloadException … response has status 500` opening a purchase-order PDF (`GET purchase-orders/:id/pdf`, same code path as delivery-note PDFs).

**Root cause.** `nest-cli.json` asset rule copied `common/pdf/fonts/**/*.ttf` to `dist/`, but tsc (no `rootDir` strip, `outDir: ./dist`) compiles to `dist/src/...` (entrypoint `dist/src/main.js`). `arabic-fonts.ts`'s `path.join(__dirname, 'fonts')` resolves to `dist/src/common/pdf/fonts` at runtime — file didn't exist there (only `dist/common/pdf/fonts`). `registerFont` threw ENOENT inside `DeliveryNotePdfService.render()`'s Promise executor → unhandled rejection → 500 in prod images (only prod: dev runs via ts-node/jest straight from `src`, masking it).

**Fix.** `nest-cli.json`: asset `outDir` `"dist"` → `"dist/src"`. Verified: `rm -rf dist && npm run build` now places `dist/src/common/pdf/fonts/*.ttf` matching runtime `__dirname`. `delivery-note-pdf.service.spec.ts` still green (2/2, ts-jest reads `src` directly, doesn't exercise the asset-copy path).

**Next.** Redeploy (`make deploy`) so prod image picks up corrected font path; no migration/decision needed.

### 2026-08-26 — Web+backend: super-admin per-business configuration console

**Step.** Gave the super admin full per-business control from the web console: fine TVA (active rates + default), the bons→stock toggle, modules, and employee roles/access — extending the existing platform-admin module rather than adding a new one.

**Backend.**
- `Business.defaultVatRate Int @default(20)` + migration `20260825170000_business_default_vat_rate`; surfaced on `/auth/me`.
- `PATCH admin/platform/businesses/:id/settings` extended: accepts exact `enabledVatRates[]`, `defaultVatRate`, and `bonsAffectStock` alongside legacy `multiWarehouse`/`tvaEnabled`. Validation: the default must belong to the FINAL enabled set (`default_vat_not_enabled` conflict otherwise). Everything audited via `update-settings`.
- New `PATCH admin/platform/businesses/:id/users/:userId` (`UpdateBusinessUserSchema`: role enum / active): tenant-scoped lookup (cross-business ids 404), guards the **last active owner** against demotion/deactivation (`conflict`), audited as `update-business-user`.
- Specs +6: settings save/validation/bons-flag, role change, last-owner guard, cross-business 404. Fixed stale auth-spec fixture for the new me() field.

**Web.**
- `pa-api.ts`: typed `PASettingsPayload/Result`, `updateBusinessUser`, `PABusinessRole`; PABusiness carries `defaultVatRate`/`bonsAffectStock`.
- **PABusinessDetailPage**: replaced the coarse TVA on/off card with a Configuration card — active-rate chips (0/7/10/14/20, last-one-removal guarded client-side), default-rate radio group among enabled chips, multi-stock toggle, and "Les bons consomment le stock" toggle; one Save posts rates+default together. New Employés card: inline role `<select>` + access `Toggle` per employee (immediate PATCH). Auth store/bridge/types/fixtures carry `defaultVatRate`.

**Tests.** Playwright **34 → 40** (`pa-config.spec`, first PA-console suite): chips render pressed-state from settings, disable-rate+save POSTs exact `{enabledVatRates, defaultVatRate}`, default switch included in payload, bons toggle PATCHes immediately, module toggles through `/modules`, employee role/access PATCHes asserted per user.

**Gotchas.** PA pages live at TOP-LEVEL paths (`/businesses/:id`) inside the shared AdminShell — no `/platform-admin` prefix (spec initially 404'd to `/`). Super-admin sessions bootstrap from the JWT alone (`type:'platform-admin'`) — no API mock needed for auth. Repeated this session: arm `waitForRequest` before the triggering action; mutation dispatch races any post-action expect.

**Result.** ✅ backend: tsc clean · PA+auth jest **58/58** · nest build ✓. ✅ web: tsc · svelte-check 0/0 · eslint · vitest 146/146 · build ✓ · Playwright **40/40**.

**Addendum (same day) — module depth for Customers/Suppliers.**
- `customers` + `suppliers` joined the togglable module set: PA console Modules card, signup seed (`prisma-auth.repository` defaultModules), and **backfill migration `20260825171000_backfill_customers_suppliers_modules`** — without it, gating the nav would have hidden Clients/Fournisseurs for every existing tenant (module rows are opt-in per business).
- AdminShell: Clients/Fournisseurs nav entries now carry `module:` flags (same filter as all gated entries).
- Playwright +3 (→ **43/43**): customers module toggle through `/modules`; tenant-nav depth — Clients link disappears when the module is inactive and reappears when active. Gotcha: nav rendering requires BOTH the module AND the capability (`suppliers.manage`, …) — module-only fixtures hide links for cap reasons and mask regressions.

### 2026-08-26 — Web+backend: configurable bon→stock integration + workflow tests

**Step.** Made the bon signing → stock-ledger effect configurable per business and pinned the whole workflow with tests on both sides. The ledger effect already existed (`sign()`: BL `out` decrements via reason `vente`, BR `in_` increments via `achat`, RT retour increments, BC order never touches stock; default warehouse; only lines with `sent > 0`; idempotent) — what was missing was the toggle and any UI to sign from.

**Backend.**
- `Business.bonsAffectStock Boolean @default(true)` + migration `20260825160000_bons_affect_stock`; surfaced on `/auth/me` (auth repo select + domain type + service payload, default true when business row missing).
- `sign()` reads the flag before its transaction: disabled → documentary signature only (markSigned, no ledger post). Availability stays enforced by the ledger's conditional decrement — an insufficient-stock BL rejects and marks nothing signed.
- Unit specs (+7): multi-product/multi-qty posting with exact negative deltas (BL) / positive (BR), sent=0 lines skipped, BC no-op, idempotency, flag-off skip, missing-row defaults ON, insufficient-stock rollback. Fixed pre-existing spec breakage from an earlier commit (`ExpenseRef.businessId` fixtures ×3, auth me fixture).

**Web.**
- Auth store/bridge/types carry `bonsAffectStock` (default true).
- **BonsPage**: `Signer` action on unsigned non-order rows (hidden entirely when the feature is off), pending state, success invalidates bons/movements/products/reports, failure surfaces a `role="alert"` banner ("… le bon reste non signé") so insufficient stock is recoverable.

**Tests.** Playwright **29 → 34** (`bon-stock.spec`): Signer visibility matrix (unsigned BL/BR yes · signed · BC no), BL sign → POST `{}` asserted → journal shows `Sortie -4 vente` against the bon ref → list flips to `✓ Oui`, BR sign → `Entrée +20 achat`, feature-off hides Signer everywhere while PDF/WA actions remain, insufficient-stock 422 shows the alert and keeps the retry button. RTL unchanged (146/146).

**Infra gotcha worth remembering:** Playwright's `reuseExistingServer` silently served **other projects' dev servers** to the suite — first `cgp-dev` on :5174 (its login page for every test), then `epargn.app` grabbed :5176 mid-run. E2e now pins its own port (**5179**) with `--strictPort`; never reuse the shared Vite default here. Also: arm `waitForRequest` BEFORE the click — a routed fulfill can beat a post-click listener; and don't assert refetches of unmounted queries (`invalidateQueries` only refetches active observers).

**Result.** ✅ backend: prisma generate · tsc clean · affected jest suites **95/95** · nest build ✓ (migrations apply on next deploy). ✅ web: tsc · svelte-check 0/0 · eslint · vitest 146/146 · build ✓ · Playwright **34/34**.

### 2026-08-25 — Mobile+backend: fix bon thermal print & PDF download

**Step.** Fixed two broken flows on the mobile app: thermal print of bons was crashing, PDF share/download was failing silently.

**Root causes.**
1. **Data shape mismatch.** `GET /delivery-notes/:id` returns a flat DTO (`{ id, number, type, customerName, ... }`). Mobile `BonDetail` type expects `{ bon: BonRow, lines, totals, businessName }`. Accessing `detail.bon.number` → undefined crash → `PrintableBon` never renders → bitmap capture fails → print fails.
2. **Missing `businessName`.** Backend detail endpoint never included business info; `PrintableBon` needs it for the letterhead.
3. **PDF download URL divergence.** `lib/pdf.ts` duplicated `BASE_URL` construction instead of using shared `apiUrl()` from the client — could diverge from the canonical API URL. No auth guard: if tokens not yet loaded, download silently fails with 401.

**Fixes.**
- **Backend** (`delivery-notes.controller.ts`): `get()` now enriches the response with `businessName` from `pdfInfo.getBusiness()`.
- **Mobile** (`features/bons/api.ts`): `getBonDetail()` transforms flat API response → `BonDetail` shape (constructs `bon: BonRow` with derived `partyName`, `ordered`, `sent`).
- **Mobile** (`components/PrintableBon.tsx`): Redesigned layout with bordered table (Qté | Désignation | PU | Total), header row with inverted colors, alternating row tint. Keeps 576-dot width for 80mm thermal.
- **Mobile** (`lib/pdf.ts`): Replaced duplicate `BASE_URL` with `apiUrl()`, added early `not_authenticated` throw when token is null.
- **i18n**: Added `bons.typeReturn` key (fr/en/ar) for retour bon type label.

**Result.** ✅ backend: 427/427 tests pass, tsc clean. ✅ mobile: tsc clean, no type errors.

### 2026-08-25 — Web+backend: customer credit ceiling (dette alerts) + payment/bon e2e coverage

**Step.** Built the missing dette feature end-to-end and pinned the bons/invoice-payment/POS-credit workflows with Playwright. Discovery first: the backend already had debt plumbing (`GET /delivery-notes/customer-debts` = ΣBL lines − paid − returns; `POST/GET /delivery-notes/:id/payments`; invoice `paid` tracking) but **zero web UI consumed any of it**, customers had no ceiling field, POS had no credit payment UI, and invoices had no record-payment UI.

**Backend (small).**
- `Customer.creditLimit Decimal?` (nullable = no limit) + hand-written migration `20260825150000_customer_credit_limit` + `prisma generate`.
- DTO: `creditLimit: z.number().min(0).nullable().optional()` on create (`.partial()` covers update; `null` clears). Repo `CreateCustomerData` extended — service/controller untouched (passthrough).

**Web.**
- `useCustomerDebts()` hook (`customer-debts` cache key) + `creditLimit` on Customer/CustomerInput.
- **CustomersPage**: Dette/Limite columns (fmtMAD) merged from customer-debts; état badge — `Dépassé` (red) when balance > limite, `Proche limite` (amber) at ≥80 %; drawer gains a Limite de crédit field (empty → PATCH `null`). `Td` primitive now spreads rest props (testids were being silently dropped).
- **InvoicesPage**: per-row `Encaisser` action (hidden when paid/draft/cancelled) opening a modal whose amount defaults to the remaining due → `POST /invoices/:id/payments`.
- **POSPage**: client `<select>`, third `Crédit` button (disabled without a customer), and the dette alert — when `dette BL + ticket > creditLimit`, a `role="alert"` banner shows the math and blocks Crédit. Checkout body carries `customerId` + `{ method:'credit', customerId }`.

**Tests.** RTL: +3 POS credit tests (blocked-over-limit, allowed-within-limit POST shape, disabled-until-customer). Playwright **17 → 29**: `bons-workflow.spec` (BL/BR tab isolation, signature/counters, PDF fetch request), `invoice-payments.spec` (Encaisser only on unpaid rows, prefilled full payment POST {amount:800}, custom partial 150), `customers-debt.spec` (Dette/Limite rendering incl. Dépassé/Proche badges, create-with-ceiling POST, clearing PATCHes null), `pos-credit.spec` (alert math + blocked Crédit over ceiling; allowed credit checkout POST + cart reset).

**Gotchas.** `route.fulfill(x, 201)` — status is a `fulfill` option, not a second arg (`json(data, 201)`); mocked-mutation tests must mutate the fixture list the GET serves, since `invalidateQueries` refetches it.

**Result.** ✅ web gate: tsc clean · svelte-check 0/0 · eslint 0/0 · vitest **146/146** · build ✓ · Playwright **29/29**. ✅ backend: prisma generate + tsc/nest build clean (no DB run — migration applies on next `migrate dev/deploy`).

### 2026-08-25 — Web: Expense + Movement form pages converted to Svelte (D-023, web repo)

**Step.** Third increment: both form pages — the most stateful screens in the app — are now Svelte islands. The whole dépenses and stock/movements domains (lists, forms, journal) run on Svelte with the React shell only providing routing/layout.

**Converted** (React twins deleted):
- `/expenses/new` + `/expenses/:id/edit` → `pages/expenses/ExpenseFormPage.svelte` (`mode` prop via `SvelteOutlet`). Full port of the tricky bits: OCR scan flow (multipart → `scanReceipt()` extracted from the old hook into a framework-agnostic fn), scanned-field confidence badges via a param'd `{#snippet scanMark()}`, TVA auto-calc from the per-category rate with `tvaTouched` override semantics, edit-mode hydration `$effect`, authenticated receipt blob preview with revoke-on-change cleanup.
- `/movements/new` → `pages/movements/MovementsFormPage.svelte`. Type segmented control, client-side product picker (radio list), source/destination selects with transfer conditional, qty stepper, reason auto-follows type ($effect), cap-gated submit.

**Two structural fixes with lasting relevance:**
- **Island routes need unique `key`s.** Navigating `/stock` → `/movements/new` left the Stock page on screen: both routes render `<SvelteOutlet>`, same component type at the same tree position → React *updates* instead of remounting, and the outlet's `useEffect([], [])` never re-runs. Masked until now because the old target was a React page (different type = forced remount). Every island route now carries `key="<route>"`. Relatedly, `SvelteOutlet`'s props went loose (`Component<any>` + `Record<string, unknown>`): literal route props can't satisfy an island's Props union under contravariance; svelte-check enforces prop correctness inside the island instead.
- **Labels wrapping button groups pollute accessible names.** Wrapping the type segmented control in `<label>` made the Entrée button's accName contain "↔ Transfert", breaking `getByRole('button', {name})` strict mode. Button groups get a plain heading span, never a label.

Also: `useScanReceipt`/`useReceiptImage` hooks retired from `api/expense-queries.ts` (standalone `scanReceipt()` kept; receipt-blob logic moved into the island's `$effect`); new bindings in `api/svelte-queries.ts`: `expenseDetailQuery`, `create/updateExpenseMutation`, `createMovementMutation`, `productsQuery`.

**Result.** ✅ web gate: tsc clean · svelte-check 0/0 · eslint 0/0 · vitest 143/143 · build ✓ · Playwright **17/17** — expenses create (POST body incl. auto-TVA) and movement entry+transfer (POST body incl. conditional `toWarehouseId`) verified against the Svelte forms.

**Next.** Products list/detail (+ e2e spec first — they have none yet), then POS/invoices; AdminShell last.

### 2026-08-25 — Web: Expenses/Bons/Movements pages converted to Svelte behind the e2e net (D-023, web repo)

**Step.** Second migration increment: converted the three list pages to Svelte 5 islands with the 17-test Playwright suite as the safety net — it caught every regression the conversion introduced, and finished green with zero spec edits needed for behavior.

**Converted** (React twins + their RTL tests deleted; routes now mount via `SvelteOutlet`):
- `/expenses` → `pages/expenses/{ExpensesPage,ExpenseFilters,ExpenseSummary}.svelte` + `display.ts` (tone/label helpers) — filters are `$bindable`, delete uses `createMutation` invalidating the shared `['expenses']` cache.
- `/bons` → `pages/bons/{BonsPage,BonsMetrics}.svelte` + `actions.ts` (PDF download / WhatsApp share, reusing `lib/whatsapp`) — reuses framework-agnostic `status.ts`; aria-labels go through the new i18n rune binding.
- `/movements` → `pages/movements/MovementsPage.svelte` — segmented type filter, warehouse/date filters, journal table with relTime(lang).

**Data layer consolidated in `api/svelte-queries.ts`** (absorbed `pages/stock/queries.ts`): one sectioned module of svelte-query bindings whose keys mirror the React hooks. Two load-bearing patterns:
- **Explicit client injection:** every binding passes `() => queryClient` as svelte-query's second argument. Gotcha that cost a debugging round: Svelte context does NOT reach the island root's own `<script>` — `<QueryClientProvider>` only covers its slot children, so root-level `createQuery` calls crashed with "No QueryClient was found in Svelte context" (the e2e suite flagged it instantly: all island pages rendered empty). With explicit injection, islands need no provider at all (`/stock` only ever worked because its queries lived in child components).
- **Accessor-style params** (`expensesQuery(() => filters)`): passing a plain object freezes the query at mount; the accessor runs inside createQuery's tracked effect so `$state`/`$props` reads refetch on change.

Also: added optional `ref` to the shared `Movement` type (backend returns it; React had a local cast).

**Result.** ✅ web gate: tsc clean · svelte-check 0/0 · eslint 0/0 · vitest **143/143** (21 files; 2 retired RTL suites removed) · build ✓ · Playwright **17/17** against the fully-Svelte expenses/bons/stock/movements surfaces.

**Next.** Convert the form pages (ExpenseForm, MovementForm) + Products list/detail, then POS/invoices; AdminShell last.

### 2026-08-25 — Web: D-023 migration foundation + real Svelte /stock page + e2e for expenses/bons/stock (web repo)

**Step.** Continued the React→Svelte 5 migration along the documented roadmap (primitives → store bridge → i18n binding → pages) and pinned the expense/bons/stock flows with backend-free Playwright suites before those pages convert.

**Migration foundation.**
- `api/query-client.ts` — the TanStack `QueryClient` extracted to a singleton both frameworks share: React via `<QueryClientProvider>`, Svelte islands via `@tanstack/svelte-query`'s provider. One client = one cache, so mutations from either side invalidate queries observed by the other.
- **Version alignment gotcha:** react-query 5.59 + svelte-query 5.90 each nested their own `@tanstack/query-core` → two incompatible `QueryClient` types ("Property 'subscribe' is missing" noise + provider type error). Upgraded react-query → 5.102 and svelte-query → 6.x so npm hoists a single query-core 5.102. **svelte-query v6 is runes-native:** `createQuery` no longer returns a Svelte store — read `query.data`/`query.isLoading` directly, no `$` prefix.
- Primitives ported to `src/ui/*.svelte`: Badge, Btn, Input (`$bindable` value), PageHeader (+ Card gained rest-prop spread). React twins stay until their last consumer migrates; APIs mirror 1:1 so page ports stay mechanical.
- Bridges: `auth/auth.svelte.ts` (rune snapshot over the vanilla zustand store — `$state.raw` + reassign on subscribe; zustand remains the source of truth) and `i18n/i18n.svelte.ts` (reactive `t()` reading a `$state` lang var updated on `languageChanged` — the `useTranslation()` equivalent).
- `mount/navigate.ts` — island→react-router SPA nav via `pushState` + synthetic `popstate`.

**Real `/stock` page (Svelte, modular).** Replaced the pilot stub: `pages/stock/{StockPage,StockTotals,WarehouseValues,LowStockTable}.svelte` + co-located `queries.ts` whose keys mirror the React hooks (shared cache entries). Shows stock value/units totals, per-dépôt breakdown (hidden when `multiWarehouse=false` per D-020, read from the auth bridge), low-stock alerts table (Rupture/Bas badges) linking into product pages. StubPage deleted.

**Playwright (4 → 17 tests).** Shared `e2e/fixtures.ts` (mockAuthenticated with capability/multiWarehouse overrides, `json()` helper); app.spec refactored onto it. New specs: **expenses** (list+summary strip, category filter w/ request-param assert, delete via confirm dialog → DELETE asserted → refetch, create form posting auto-computed TVA), **bons** (metric-card math incl. exclusion rows, type-tab filter, search by number/party, empty state), **stock** (Svelte island totals/breakdown/alerts, single-stock hides breakdown, entry-movement create from the island CTA through to POST body + journal render, transfer requiring destination).

**e2e gotchas worth keeping:**
- A `200` fulfill with an empty/unparseable body breaks `res.json()` in `apiFetch` → mutation never reaches `onSuccess`. DELETE mocks must return `204`.
- The GDPR cookie banner intercepts pointer events while unanswered — fixtures seed `localStorage['stock.cookie-consent']='granted'` (returning-user consent).
- Unassociated `<label>`+`<select>` pairs (movement form Destination) aren't reachable via `getByLabel`; use `label:text-is("Destination *") + select` (ancestor `:has()` over-matches wrappers).
- Assert a pre-interaction baseline before driving controlled inputs — guarantees React mounted before `fill()`.
- Fixture-builder defaults can silently satisfy the wrong row (bons partyName default matched the search assertion's target); keep metric/search fixtures mutually exclusive.

**Result.** ✅ web gate: tsc clean · svelte-check 0/0 · eslint 0/0 (--max-warnings=0) · vitest **153/153** (23 files) · build ✓ · Playwright **17/17**.

**Next.** Convert ExpensesPage/BonsPage/MovementsPage to Svelte behind the now-green e2e net (their RTL tests retire at conversion time) → then POS/invoices → AdminShell last.

### 2026-08-25 — Web: React→Svelte migration started (D-023) + Playwright e2e + audit fixes (web repo)

**Step.** Setup audit of `web/` found lint debt + 2 broken tests; fixed them, then started the owner-approved Svelte 5 migration incrementally and added Playwright e2e covering the pilot.

**Audit findings → all fixed.**
- 31 lint errors (import/order across App.tsx, ProductsPage, ExpensesPage ×2, InvoiceFormPage, QuickAdjustDialog) → `eslint --fix`.
- 5 lint warnings → analytics.tsx file-level disable (provider+imperative API by design); ProductsPage `items` wrapped in `useMemo` (`q.data` dep).
- ExpensesPage.test.tsx "No QueryClient set" ×2 — page grew a `useExpenseCategories` call without the test growing a provider/mock → QueryClientProvider wrapper + category hook mock.

**Svelte toolchain (D-023).** `svelte@5.56`, `@sveltejs/vite-plugin-svelte@4` (Vite-5-compatible), `svelte-check`. Dual-plugin vite config `[react(), svelte()]`; `svelte.config.js` with vitePreprocess; `src/svelte-shims.d.ts` for TSX-side imports; `npm run check` = svelte-check.
- `src/mount/SvelteOutlet.tsx` — React adapter mounting Svelte islands via `mount()`/`unmount()`; generic `<P>` typed against svelte's quirky `Component<Props, Exports, Bindings>` variance (constraint on the 3rd param breaks inference — must write `Component<P>` explicitly).
- Pilot conversion: `StubPage.tsx` deleted → `StubPage.svelte` (+ new `ui/Card.svelte` primitive); `/stock` route renders through SvelteOutlet inside the React shell.

**Playwright.** `@playwright/test` + chromium; `playwright.config.ts` (webServer `npm run dev` :5174); `npm run e2e`; backend-free tests via pathname-based route mocks — **gotcha:** a `**/api/**` glob also swallows Vite module URLs like `/src/api/client.ts` (empty MIME kills boot); use `(url) => url.pathname.startsWith('/api/')`. Also: `**/api/**` inside a block comment terminates it early (`*/`). vitest excludes `e2e/**`; tsconfig includes `e2e` + playwright.config.ts.

**Result.** ✅ web gate: tsc clean · svelte-check 0/0 · eslint 0/0 (--max-warnings=0) · vitest **141/141** · build ✓ (2.6s) · Playwright **4/4** (landing hero, login→shell, /products→/login redirect, /stock Svelte-in-React pilot).

**Decisions.** D-023 (migrate to Svelte incrementally, overruled stay-on-React recommendation).

**Next.** Migration plan doc (phase order for remaining 39 pages) → port shared primitives (Btn/Input/Badge/Table/PageHeader) → zustand↔runes store bridge → i18next Svelte binding.

### 2026-08-19 — Receipt scan flow: explicit "Analyser" button, no auto-OCR (mobile)

Best-practice receipt-capture pattern: user drives OCR, not the shutter. Before this change, taking a photo or importing from gallery would immediately hit the OCR endpoint — cropping meant waiting for a scan you didn't want, then re-scanning after adjust. Wasteful round-trip, bad on flaky mobile networks.

**Now:**
1. Take photo / import → image lands in preview only (no OCR).
2. Preview shows status *"Prêt à analyser"* + a hint *"Recadrez si besoin, puis tapez « Analyser »"*.
3. Action row: rotate ± / Reprendre / Recadrer — all edit the preview locally, still no network.
4. Prominent brand-primary **"Analyser"** button below → fires OCR on the current preview.
5. Once done, badge flips to *"Analysé"* and the button becomes *"Ré-analyser"* if the user wants to redo after another crop/rotate.

**Files:**
- `mobile/src/features/expenses/components/expense-form.tsx` — split `onPhoto` into `setPreview(uri, mime)` (no OCR, resets scan state) + `runScan()` (explicit, uses stored `receiptMime` for the correct file extension). All entry points — camera, gallery, rotate, crop-overlay confirm — now go through `setPreview` only. New `scanned` boolean drives the status badge + button label. `clearReceipt` resets the new state fields too.
- Camera tile label swapped from "Scanner / Caméra + OCR" to "Prendre photo / Caméra" so it matches the split behavior.

**Verification.** `npx tsc --noEmit` clean.

### 2026-08-19 — Audit fixes on the categories + PostHog + crop diff

Ran a 3-fork audit (backend / web / mobile) on the uncommitted diff. Zero FAIL rows, ~5 meaningful WARN. All 5 fixed, plus polish:

**Priority.**
1. `web/App.tsx:119` — `/settings/expense-categories` route now wrapped in `<RoleGuard requires="user">` (was reachable by any authenticated user via URL-force).
2. `mobile/crop-overlay.tsx` — `Gesture.Pan().runOnJS(true)` on both `centerPan` and `cornerPan` so the JS-closure captures (`bounds`, `clamp`) work reliably; reanimated would otherwise auto-workletize the callbacks and cross-thread capture is fragile. Added a `mounted` ref to guard the `Image.getSize` unmount race.
3. `web/ExpenseFormPage.tsx` — categories arrive async, so a `useEffect([categories.data, tvaTouched])` recomputes TVA once the real per-category rate lands (was fixed at 20 % if the user typed before the query resolved).
4. `mobile/expense-form.tsx` — `applyScan` now passes `rateFor(category)` (was hard-coded 20 %); added the symmetric categories-arrive `useEffect` so mobile matches web.
5. `web/ExpenseFormPage.tsx` — `applyScan` moved the TVA compute inside the functional `setForm((f) => …)` so it reads the fresh `f.category` instead of the stale closure `form.category`.

**Polish.**
- `web/analytics.tsx` — early-return in `ensureStarted()` when `import.meta.env.DEV`, so PostHog no longer opens a session in dev before opting out.
- `mobile/analytics.tsx` — `autocapture={false}` (POS/expense screens tap-heavy, would burn PostHog quota; instrument explicitly instead).
- `web/AdminShell.tsx` + `web/src/i18n/{fr,en,ar}.ts` — nav entry now uses `labelKey: 'nav.expenseCategories'` with FR/EN/AR translations (was hard-coded French).
- `backend/prisma/migrations/20260818000000_.../migration.sql` — seed `INSERT` now has `ON CONFLICT ("business_id", "key") DO NOTHING`, so mid-migration recovery doesn't abort.
- Doc drift fixed: transport is 14 %, not 20/0.

**Skipped by design.**
- Backend TOCTOU on category delete + product image path — bounded (design tolerates orphan keys / stale blobs).
- Mobile `categories = data ?? []` new-array per render — not hot path.
- Web `CATEGORY_TONE` static map — `'gray'` fallback for tenant-added categories is intentional.
- Web `confirm()` native for delete — consistent with `ExpensesPage`, not a regression.
- `products/new.tsx` `allowsEditing: true` — product photos deliberately 1:1 cropped.

**Verification.** `npx tsc --noEmit` clean on backend + web + mobile.

### 2026-08-19 — TestFlight crash on image resize + PostHog error reporting

**The crash.** TestFlight build 8 crash log (`351E9097-…`) — main-thread `SIGABRT` bubbling through `objc_exception_rethrow` in `CFRunLoopRunSpecific`, with **no Tijaru symbols in the stack**. User reports it triggers when resizing the receipt image. Almost certainly `expo-image-manipulator` throwing a native NSException on iPhone X (2 GB RAM, iOS 16.7): a 12 MP source photo blows past the memory headroom needed to allocate the rotated/cropped bitmap, or the crop rect overshoots the image bounds by 1 px and `UIImage` aborts.

**Defensive fix — new `mobile/src/lib/image-safe.ts`.**
  - `downsizeIfLarge(uri)` — if the longest side exceeds 2000 px, resize down first (JPEG, 0.9 quality). Called on every image right after `ImagePicker.launchCamera` / `launchImageLibrary` returns, so nothing bigger than 2000 px ever reaches the manipulator.
  - `safeManipulate(uri, actions)` — same as `ImageManipulator.manipulateAsync` but pre-resizes and reports the failure to PostHog before rethrowing, so we see silent failures.
  - `safeCropRect(rect, imgSize)` — clamps `originX/Y + width/height` to stay inside the source image, rounds to integers, and never returns a zero-sized rect. iOS `UIImage` NSExceptions on an out-of-bounds rect even by 1 px, and our old crop math relied on `Math.min(imgSize.w, ...)` which bounded `width` alone but let `originX + width` overflow.

**Wired into every image entry point.**
  - `crop-overlay.tsx` — uses `safeCropRect` + `safeManipulate` on the confirm path.
  - `expense-form.tsx` — `pickFromGallery`/`takePhoto` downsize the picked asset before OCR; rotate uses `safeManipulate`.
  - `app/products/new.tsx` — same downsize on camera + gallery picks.

**PostHog wired on both mobile and web (Sentry rejected, PostHog is what we already know / prefer).**
  - **Mobile:** added `posthog-react-native ^4.63.2`. Config lives in `.env` (best-practice — `EXPO_PUBLIC_POSTHOG_KEY` + `EXPO_PUBLIC_POSTHOG_HOST`, both populated in `.env` and documented in `.env.example`). PostHog project API keys are public by design, so bundling them in the client is expected — no secret in the source.
  - New `mobile/src/lib/analytics.tsx` — exports `<AnalyticsProvider>` wrapping `PostHogProvider` (autocapture on, EU host default), plus imperative `captureError` / `trackEvent` / `identifyUser` / `resetAnalytics` that share a singleton client so error reports raised outside the React tree still land.
  - `app/_layout.tsx` — wraps the tree in `<AnalyticsProvider>` inside `SafeAreaProvider`.
  - `install-error-handler.ts` — every JS fatal + unhandled promise rejection now forwards to `captureError`.
  - No config plugin / native pod required — `posthog-react-native` is JS-only (uses `expo-file-system` for offline queue, already installed).
  - **Web:** added `posthog-js ^1.418.1`. Same env-driven config (`VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` in `.env` + `.env.example`).
  - New `web/src/lib/analytics.tsx` — `<AnalyticsProvider>` wrapping `PostHogProvider` (autocapture on, session replay on in prod, off in dev via `opt_out_capturing`), plus a `<RouteTracker>` that fires `$pageview` on every react-router `location.pathname/search` change (default pageview off — SPA needs it wired manually).
  - `App.tsx` — provider mounted inside `<BrowserRouter>` (needs `useLocation`).
  - `window.addEventListener('error'|'unhandledrejection')` installed once at PostHog init → both forward to `captureError` with source metadata.

**Verification.**
  - `npx tsc --noEmit` clean.
  - Not verified on device — needs a new TestFlight build to confirm both (a) the resize crash is gone and (b) PostHog receives events.

**Follow-ups.**
  - Ship build 9 to TestFlight; ask the reporter to reproduce the resize flow; verify PostHog `$exception` events appear if anything still throws.
  - If the crash persists, add `expo-application` restart hooks or drop `MAX_SIDE` to 1500.
  - Consider adding source-map upload to PostHog (there's a CLI plugin) so the JS frames in captured errors are symbolicated too — deferred until we see the first prod event to confirm the current setup works end-to-end.

### 2026-08-18 — Expense form UX pass (icons, TVA, free crop, per-tenant categories)

Four related changes shipped together so the receipt-scan flow finally feels right.

**1. Rotate/crop icons were invisible.** `↺` and `↻` weren't in the emoji→Ionicons map, so they fell through to `Ionicons name="↺"` which isn't a real glyph name and rendered as tofu. Added `↺` → `arrow-undo`, `↻` → `arrow-redo`, `✂` → `cut-outline` in `mobile/src/ui/icon.tsx`.

**2. TVA is now auto-calculated (web + mobile).** When you type the TTC amount the TVA fills in as `amount × rate / (100 + rate)` and a hint appears: *"Auto-calculée à 20 % TTC — modifiable"*. If you edit the TVA yourself, or if the OCR extracted a TVA from the receipt, we set a `tvaTouched` flag and stop overwriting it. If OCR gave us an amount but no TVA, we auto-fill and leave `tvaTouched=false` — so changing the category later still recomputes with the new rate. The rate comes from the selected category (see #4), not a hardcoded 20 %.

**3. Free-form crop on mobile.** Two issues rolled into one:
  - `allowsEditing: true` on `expo-image-picker` was forcing a **square** crop on Android, which is useless for tall receipts. Dropped it — the raw photo comes back, and you can see the whole receipt.
  - Added a real in-app crop overlay: new `mobile/src/features/expenses/components/crop-overlay.tsx`. Full-screen modal, dark backdrop, letterboxed image, 4 corner-drag handles + a center drag to move the whole box. Min 50×50 px, clamped to image bounds. On Valider it converts display coords → image coords via the measured layout, calls `ImageManipulator.manipulateAsync({crop:...})`, then re-runs OCR through the existing `onPhoto()` path. The "Recadrer" button, which used to re-open the gallery, now opens this overlay.

**4. Expense categories are configurable per tenant.** The `ExpenseCategory` Prisma enum is gone. Instead:
  - New table `expense_category_defs` (`id, businessId, key, label, taxRate, sortOrder, archived`) — one row per category, scoped to a business.
  - `Expense.category` is now `String @default("other")` (kept the value semantically identical — validation moves up one layer).
  - Migration `20260818000000_expense_categories_configurable` seeds every existing business with the same 9 defaults (rent, utilities, salaries, supplies, transport, maintenance, taxes, marketing, other) with FR labels and MA-appropriate tax rates — 20 % for goods/services, 14 % for transport, 0 % for salaries / taxes / other. Seed row IDs are deterministic (`seed_<businessId>_<key>`) and the `INSERT` uses `ON CONFLICT ("business_id", "key") DO NOTHING` so partial re-runs are safe.
  - New NestJS module `expense-categories/` — full CRUD (`GET/POST/PATCH/DELETE /expense-categories`), tenant-scoped via `TENANT_MODELS`, guarded by `expenses.view` / `expenses.edit`. Delete is soft (archive) when a category is still referenced by expenses, hard otherwise. `ExpensesService.assertCategoryUsable()` rejects unknown / archived keys on create/update, so we don't need a DB-level FK (see D-022 for why we deliberately kept it loose).
  - New-business bootstrap seeds defaults in the same transaction as the business row.
  - **Web:** new `/settings/expense-categories` admin page (list / add / edit / archive / delete, sort by ordre), plus nav entry in `AdminShell`. The expense form's category select + the list-page filter/badges now resolve labels via `useExpenseCategories`, with `FALLBACK_CATEGORY_LABEL_FR` for the pre-fetch render.
  - **Mobile:** category chips + list picker load from the same API. TVA auto-calc uses the selected category's `taxRate` instead of a hardcoded 20 %.

**Verification:**
- Backend `npx tsc --noEmit` clean.
- Backend tests: `npx jest --testPathPattern="expense-categor|expenses.service|tenant-context"` → **32/32 pass** (3 suites).
- Web `npx tsc --noEmit` clean.
- Mobile `npx tsc --noEmit` clean.

**Not verified — one blocker:** the migration hasn't been applied to a live DB. `stock-postgres` isn't running, and host port 5433 is currently held by an unrelated project (`groupeeko_cgp_postgres_1`) — this matches the CLAUDE.md note about the `.env` `DATABASE_URL` pointing at the wrong project DB. To apply: `cd backend && docker compose up -d postgres && DATABASE_URL="postgresql://stock:stock@localhost:5433/stock?schema=public" npx prisma migrate deploy`.

**Decisions logged:** [D-022](02-decisions.md#d-022--2026-08-18--expense-categories-become-a-per-tenant-table-expensecategorydef-expensecategory-demoted-from-enum-to-free-string-validation-lives-in-the-service-layer-not-a-db-fk).

**Follow-ups:**
- Apply the migration once the Tijaru postgres is back on :5433.
- E2E test for `POST /expense-categories` tenant isolation.
- i18n keys for default category labels (currently FR-only fallback map).
- FK from `Expense.category` → `ExpenseCategoryDef.key` was rejected on purpose (D-022) — historical rows must survive category deletion.

### 2026-08-17 — Expense receipt duplicate detection (sha256)
- **Step:** `POST /expenses/scan` now hashes the receipt bytes (sha256) and looks up prior expenses with the same hash before saving. Backend: schema `Expense.receiptHash Char(64)` + `@@index([businessId, receiptHash])`, migration `20260817000000_expense_receipt_hash`; `ExpensesRepository.findByReceiptHash` (tenant-scoped by middleware); `ScanResult` extended with `receiptHash` + `duplicate {id,date,amount,merchantName} | null`; `CreateExpenseSchema.receiptHash` accepted so create persists it. Mobile: `ScanResult` + `ExpenseInput` extended; `expense-form.tsx` stores `receiptHash`, renders amber "⚠️ Reçu déjà enregistré" banner (date · amount · merchant) linking to prior expense, includes hash in create payload; `clearReceipt` resets both. Duplicate is a warning only — user can still confirm the double-entry.
- **Result:** ✅ `npx jest src/modules/expenses/application/expenses.service.spec.ts` → 21/21 (added 2: deterministic sha256 + prior-expense flag). Backend `npx tsc --noEmit` clean. Mobile `npx tsc --noEmit` clean.
- **Next:** perceptual-hash (pHash) fallback for re-photographed receipts + OCR-tuple heuristic, only if users report false negatives.

### 2026-08-16 — Arabic text in bon + expense-report PDFs
- **Step:** Arabic names rendered as mojibake ("bvDc Jd") — pdfkit's built-in Helvetica has no Arabic glyphs. Vendored **IBM Plex Sans Arabic** Regular+Bold (SIL OFL, covers Latin+Arabic) in `src/common/pdf/fonts/`; new `src/common/pdf/arabic-fonts.ts` (`registerArabicFonts(doc)` + `fontFor(text, helveticaFace)` — Arabic-range regex picks the Plex face per string, Latin-only strings keep Helvetica; italic falls back to upright, Plex Arabic has none). fontkit (inside pdfkit) does the OpenType shaping + RTL run reversal once a real TTF is embedded — verified visually: connected glyphs, correct RTL word order, mixed AR/Latin/digits ok. Applied to `DeliveryNotePdfService` (business name/address, party name, line labels, émis-par, notes — covers BL/BR/BC since the BC endpoint reuses it) and `ExpenseReportPdfService` (business, merchant names). `nest-cli.json` assets config copies TTFs to `dist` (verified post-build; Dockerfile ships dist unchanged).
- **Result:** ✅ `npx tsc --noEmit` clean; full `npx jest` 407/407; sample PDF rendered via tsx + `sips` rasterize — Arabic business/customer/product/notes all legible. Commit `7604d4a`.
- **Decisions:** IBM Plex Sans Arabic over Noto Sans Arabic (Plex bundles Latin glyphs → one font per string, no per-word font switching); rely on fontkit shaping instead of an arabic-reshaper dependency.
- **Next:** none — mobile/web share the same server-rendered PDFs, nothing client-side to change.

### 2026-08-15 — Fix `POST /movements` 500 + `stock` module toggleable from super admin
- **Step:** Reproduced `POST /v1/movements` → 500 `PrismaClientValidationError: Unknown argument productId_warehouseId` inside `StockLedgerService.applyDelta`. Root cause: `TenantMiddleware` rewrote `findUnique` → `findFirst` on tenant models, invalidating compound-key aliases. Fix: middleware now passes `findUnique`/`findUniqueOrThrow` through unchanged and post-filters the result on `businessId` (null if mismatch, throw for `orThrow`); tenant spec updated (7/7). Added `stock` as a first-class business module — controller `MovementsController` wears `@RequiresModule('stock')`; new-business bootstrap (`prisma-auth.repository`) and demo seed include `stock`; migration `20260815220000_backfill_stock_module` inserts the row for every existing business (`ON CONFLICT DO NOTHING`); web platform-admin `PABusinessDetailPage` module list gains `stock` toggle; web `AdminShell` sidebar `/stock` + `/movements` items now carry `module:'stock'` so they hide when disabled.
- **Result:** ✅ backend `npx jest` 407/407 (incl. 3 new middleware post-filter cases); migration applied on :5433; live end-to-end: PA `PATCH /admin/platform/businesses/:id/modules {"stock":false}` → `POST /v1/movements` returns `403 module_disabled:stock`, re-enable → `201`; web + backend `tsc` clean. E2E: 7 pre-existing failures (16 at baseline before this step — net −9, all remaining failures unrelated: expenses tenant isolation, users/warehouses 403, notifications ordering).
- **Decisions:** D-021.
- **Next:** address the 7 remaining pre-existing e2e failures; mobile has no super-admin console, no change needed there.

### 2026-08-15 — Multi-stock + TVA moved to platform (super admin) control, effective web + mobile
- **Step:** Backend: new `PATCH /v1/admin/platform/businesses/:id/settings` (`PlatformAdminService.updateSettings`) — multi-stock off renames/creates the single default warehouse with the business name (409 if >1 active), TVA toggle writes `enabledVatRates` `[0]`/`[0,7,10,14,20]`, platform audit entry `update-settings`; tenant PATCH `vat-rates`/`multi-warehouse` deleted (GETs kept); `/auth/me` += `multiWarehouse`. Web: PA business detail gains Settings card (Multi-stock + TVA toggles) and full 7-module list (added missing `invoices`, `delivery-notes`); tenant SettingsPage toggles replaced by read-only "Géré par la plateforme" rows; AdminShell hides `/warehouses`, `/stock` and the warehouse switcher when `multiWarehouse=false`. Mobile: auth store += `modules`/`enabledVatRates`/`multiWarehouse` (+`hasModule`), warehouses tab hidden via `href:null` when multi-stock off, settings + admin screens read-only for multi-dépôt, `/admin/vat` screen removed, product-form VAT default derives from enabled rates (0 when TVA off).
- **Result:** ✅ backend `tsc` clean + jest 405/405 (5 new `updateSettings` tests); web `tsc` clean + vitest 141/141 (SettingsPage suite rewritten read-only); mobile `tsc` clean + jest 18/18.
- **Decisions:** D-020.
- **Next:** deploy + verify on device that a TVA-off business shows 0% defaults in POS/invoices; consider backend-side validation of `vat` against `enabledVatRates` on product/invoice writes (still advisory-only).


### 2026-08-15 — Mobile crash fix: date formatters vs null API dates
- **Step:** On-device render error "Cannot read property 'getTime' of undefined" — `relTime()` called with a null API date field (stack pointed at CartSheet via stale Metro symbolication; POS has no relTime — real risk sites: `sessions.lastSeenAt`, movement dates, notification createdAt). `relTime`/`fmtDate`/`fmtDateTime` in `mobile/src/i18n/format.ts` now accept `null | undefined` and render "—" for missing/invalid dates. New `__tests__/format.test.ts` (null/undefined/invalid/valid cases).
- **Result:** ✅ mobile `npx tsc --noEmit` clean; `npx jest` 18/18 (3 suites, 11 new format tests). Commit `071e5d1`.
- **Decisions:** none.
- **Next:** none.

### 2026-08-15 — Web: public landing page on `/` (prototype accueil.html)
- **Step:** `AccueilPage` rewritten to match `Tijaru-Platform-Prototype/accueil.html` — sticky nav (Fonctionnalités / Console plateforme / Tarifs + Se connecter / Essayer gratuitement), hero + kicker + browser-mock preview (sidebar + 6 stat cards), 8-module features grid, 3 étapes "Mise en route", dark "Console plateforme" pitch (4 bullets + stats card), pricing Essentiel 120 / Standard 240 (reco) / Pro 400 MAD/mois, final CTA, footer. Routing: `ProtectedRoute` → `ProtectedShell` on `/` — visitors on exactly `/` get the landing, other protected paths redirect to `/login`, authenticated users get `AdminShell` (ByRole dispatch unchanged); `/accueil` kept as alias. All CTAs → `/login` (no self-serve signup page on web yet — backend `/auth/register` exists).
- **Result:** ✅ web `npx tsc --noEmit` clean; vitest 146/146 (AccueilPage suite rewritten to new copy: hero H1, CTAs→/login, 8 features, 3 steps, 3 plans + "Le plus choisi", console pitch).
- **Decisions:** none new.
- **Next:** self-serve signup page wired to `/auth/register` so "Essayer gratuitement" doesn't dead-end on login; browser screenshot pass.

### 2026-08-15 — Compact bon lines, generic PDF share, draft BC edit, in-app text size
- **Step:** (1) UX: `purchase-orders/new` + `bons/new` line cards collapsed to one row (produit flex + Qté w-12 + prix w-20 [+ TVA chip cycling enabled rates on tap, BC only] + 🗑), one shared column-header row, sku·sous-total line under picked rows. (2) Share simplified per user pivot: dropped WhatsApp-targeted intent (expo-intent-launcher uninstalled — no native rebuild needed anymore); single "Partager" via system sheet (`expo-sharing`) exposing WhatsApp/email/etc.; `src/lib/pdf.ts` now `shareBonPdf`/`sharePOPdf`; wired bons list ("Partager PDF" single button), both post-create alerts, PO detail "Partager le PDF". (3) Draft BC editing: backend `PatchPOSchema` += supplierId/warehouseId/lines (draft-only, service guard `not_draft` 422; status/notes still editable until reception), repo `update` replaces line set (`deleteMany` + create, received 0); mobile `usePatchPurchaseOrder`, `purchase-orders/new?id=` edit mode (prefill once, non-draft bounces, type selector hidden, CTA "Enregistrer les modifications"), PO detail "Modifier le brouillon" button on drafts. (4) Accessibility: in-app "Taille du texte" (Normal/Grand/Très grand ×1/1.15/1.3) — `src/lib/font-scale.ts` zustand + AsyncStorage store, one-time forwardRef render patch on `Text`/`TextInput` multiplying resolved fontSize (stacks on OS font scaling), root `Stack key={fontScaleId}` remounts tree on change, Settings card with A-size preview chips.
- **Result:** ✅ backend `tsc` clean + `npx jest purchase-orders` 11/11 (3 new patch tests: draft line replace, sent lines → `not_draft`, sent status/notes ok); mobile `tsc` clean + jest 7/7 + prettier clean.
- **Decisions:** share sheet over WhatsApp deep targeting (user pivot; also drops native dep); font scale via render patch + full remount rather than refactoring every screen to a scaled Text component.
- **Next:** device test share sheet + font scale; bons (delivery notes) draft editing if asked (only BC covered).

### 2026-08-15 — WhatsApp share = PDF document (not text) + BC PDF endpoint
- **Step:** Backend: new `GET /purchase-orders/:id/pdf` — reuses `DeliveryNotePdfService` carnet renderer (`type:'order'`, lines mapped qty/received/price, subtotal ordered×PU); `DeliveryNotesModule` now exports `DeliveryNotePdfService` + `DeliveryPdfInfoLookup`, `PurchaseOrdersModule` imports it; letterhead via `TenantContext` businessId. Mobile: `src/lib/pdf.ts` reworked — `downloadPdf()` (authed cache download), `sharePdfToWhatsApp(path, filename)`: **Android** direct `android.intent.action.SEND` into `com.whatsapp` (expo-intent-launcher ~11.0.1 installed, `FileSystem.getContentUriAsync` + FLAG_GRANT_READ_URI_PERMISSION, fallback share sheet if WhatsApp absent); **iOS** share sheet (no API can target an app with a file; `whatsapp://` scheme is text-only). Wired: bons list WhatsApp button, bons/new + purchase-orders/new post-create alerts, PO detail "Envoyer le PDF par WhatsApp". `src/lib/whatsapp.ts` (wa.me text) deleted — superseded.
- **Result:** ✅ backend `npx tsc --noEmit` clean + `npx jest purchase-orders delivery-notes` 39/39; mobile `npx tsc --noEmit` clean + jest suites pass, prettier clean. ⚠️ expo-intent-launcher = native module: bare app needs `npx expo run:android` rebuild before the Android direct-to-WhatsApp path works on device.
- **Decisions:** BC PDF reuses the delivery-note carnet renderer instead of a new PO PDF service (same layout, zero duplication); iOS keeps share sheet by platform constraint.
- **Next:** device test both platforms; consider caching content URIs; web parity for BC PDF download.

### 2026-08-15 — Mobile bons/BC UX overhaul: type select, WhatsApp/PDF share, real error messages, sign → stock
- **Step:** (1) `purchase-orders/new.tsx` — "Type de bon" selector (BC stays; BL/BR `router.replace('/bons/new?type=out|in_')`), per-line sous-total HT, totals card HT/TVA/TTC, post-create Alert "Envoyer au fournisseur ?" → WhatsApp (`wa.me` prefilled BC summary, supplier phone). (2) `bons/new.tsx` — accepts `?type=` param; post-create Alert offers WhatsApp (client/fournisseur) + PDF (`shareBonPdf`). (3) New `src/lib/whatsapp.ts` (mirror of web `normalizeMAPhone`/`waLink` + `openWhatsApp` via Linking). (4) New `src/api/errors.ts` `apiErrorMessage()` — `apiFetch` throws a plain ApiError object, NOT an Error, so every screen's `err instanceof Error ? err.message : fallback` showed generic "Échec création" (user hit it on `module_disabled:delivery-notes` 403); mapper renders module_disabled:<id> ("Le module « Bons » est désactivé…"), insufficient_stock, forbidden/unauthorized/not_found/conflict, zod field errors; swept all 17 screens via script + import insert. (5) Stock correctness: mobile created BR with `sent: 0` → backend `sign()` posts only `sent > 0` lines → réception never incremented stock; now `sent = qty` for BL+BR (BC stays 0). No UI anywhere exposed sign — `bons/index.tsx` gains "Signer" button (unsigned rows) with confirm stating stock effect; backend already correct: sign(in_) +stock, sign(out) −stock guarded by `insufficient_stock` (ConflictError).
- **Result:** ✅ mobile `npx tsc --noEmit` clean, `npx jest` 7/7, prettier clean on touched files; backend `npx jest delivery-notes` 31/31 (existing coverage: sign(out) negative ledger lines, sign(in_) positive, sign(order) no-op, idempotent re-sign).
- **Decisions:** BL/BR creation lives in bons flow only — PO screen redirects instead of duplicating; PO has no PDF endpoint so BC share = WhatsApp text (PDF export stays bons-only for now).
- **Next:** device-test WhatsApp deep link + PDF share; consider BC PDF service (pattern exists in delivery-notes); web BonsPage has no create/sign UI — port mobile parity.

### 2026-08-14 — Platform audit journal — "Activité de la console" now real data
- **Step:** New append-only `PlatformAuditLog` model (`platform_audit_logs`: action, tone ok/warn/err, targetType business/user, targetId?, targetName, detail, createdAt; migration `20260814210000_platform_audit_log`, hand-generated via `prisma migrate diff` — `migrate dev` refuses non-interactive shells; stray `stock_levels.updatedAt DROP DEFAULT` drift excluded, pre-existing). `PlatformAdminService` gains private `audit()` (best-effort, try/catch — journaling can never fail the action) called from approve/reject/extend (+N mois detail)/suspend (err)/activate/update-limits (before→after diff)/update-modules (on/off list)/reset-password (warn, user target). `GET /admin/platform/audit` (PlatformAdminGuard, last 20). Web: `paApi.audit()` + `PAAuditEntry`; PADashboardPage "Activité de la console" card renders real entries (HH:MM, FR action labels, detail line, tone dot) replacing the "Bientôt" placeholder.
- **Result:** ✅ migration applied on :5433 (`_prisma_migrations` shows `20260814210000_platform_audit_log`; `\d platform_audit_logs` ok); backend `npx tsc --noEmit` clean + `npx jest platform-admin` 31/31 (4 new: suspend logs err entry, extend detail "+12 mois", journal failure swallowed, listAudit ordering/limit); web `tsc` clean + vitest 145/145.
- **Decisions:** journal is best-effort (swallowed errors) and stores action codes, not French text — web maps codes → labels; MRR/essais/tickets stay "Bientôt" (no pricing/support data in schema).
- **Next:** deploy needs `prisma migrate deploy` in prod; pricing data model for MRR.

### 2026-08-14 — Super admin console consolidated on `/` — "Vue plateforme" dashboard (web + backend)
- **Step:** Super admin landing rebuilt to match `Tijaru-Platform-Prototype/admin-dashboard.html`, all on `/` (no `/platform-admin` prefix; legacy paths already redirect to `/`). Web: `PADashboardPage` rewritten in French — 7 stat cards with colored top borders (commerces/actifs/expirés/en attente/suspendus/utilisateurs/nouveaux 7 j), quick-action buttons (approbations badge, commerces, utilisateurs), metric row MRR/essais/tickets as "Bientôt" placeholders (no billing/support data source yet), approvals banner, "Échéances proches" from real `subscriptionEnd` ≤ 60 j (J-x badge, urgent ≤ 20 j), "Activité de la console" placeholder (no PA audit log yet). `AdminShell`: PA header titles ("Vue plateforme · Console Tijaru" etc.), warehouse selector hidden for super admin, sidebar role label "Super admin · Plateforme". `auth-store.bootstrap` now decodes the JWT and restores `type:'platform-admin'` sessions client-side (was calling `/auth/me` → 401 → super admin logged out on every refresh). Backend: `getStats` adds `users` + `newUsers7d` (User counts, `deletedAt: null`).
- **Result:** ✅ web `npx tsc --noEmit` clean + vitest 145/145; backend `npx tsc --noEmit` clean + `npx jest platform-admin` 27/27.
- **Decisions:** none new (route architecture already per D-existing ByRole-on-`/` design).
- **Next:** real data sources for MRR/essais/tickets + PA action audit log (Activité de la console).

### 2026-08-14 — Monthly expense report PDF export (backend + web) + module-seed fix
- **Step:** `GET /v1/expenses/report?month=YYYY-MM` streams an A4 PDF: summary table (date/commerçant/catégorie/paiement/montant/TVA), per-category subtotals + grand total, then one page per receipt image. New `ExpenseReportPdfService` (pdfkit, pattern from delivery-notes), `ExpensesService.monthlyReportData` (webp→png via new dep `sharp`; missing file degrades to no image), `BusinessInfoLookup` port + Prisma impl. Web: `ExpensesPage` gains month picker + "Exporter PDF" button (`downloadExpenseReport` authenticated blob fetch). Fixes on the way: (1) `prisma/seed.ts` never seeded `business_modules` — ModuleGuard 403'd every `@RequiresModule` route after `seedFresh`, breaking module-gated e2e suites; seed now creates the 7 default module rows (+ wipe entry). (2) Completed stray WIP: implemented missing `createDefault()` in `PrismaAdminPolicyRepository` (abstract had been added without impl → whole e2e compile broken).
- **Result:** ✅ backend `npx jest` 400/400 (5 new pdf-service + 5 new service cases), `npx tsc --noEmit` clean, `expenses.e2e-spec` 18/18 (4 new: PDF 200 + content-disposition + MARJANE in stream, tenant exclusion, malformed month 400, cashier 403). Web vitest 145/145 (2 new ExpensesPage export cases), web `tsc` clean. Pre-existing e2e failures remain in pos/movements/batch-modules/crud-batch/users/notifications (POS checkout 500s etc.) — present at baseline (`git stash` check: pos 11 fail before vs 7 after; remainder unrelated to this step).
- **Decisions:** D-019.
- **Next:** fix pre-existing POS checkout 500 in e2e; mobile screen for monthly report export; consider Arabic labels in the PDF (pdfkit default font has no Arabic shaping).

### 2026-08-14 — Mobile: expenses full parity — receipt scan (OCR), summary, edit/delete
- **Step:** Completed mobile expenses to web parity. `src/ui/receipt-camera.tsx` (expo-camera CameraView + takePictureAsync, permission UI mirrored from BarcodeScanner). `src/ui/expense-form.tsx` — shared form extracted from `new.tsx`, now used by create + edit; embeds scan flow: Modal camera → `useScanReceipt` (RN FormData `{uri,name,type}` through `apiFetch`, multipart works because rawFetch only forces JSON content-type on string bodies) → prefill amount/TVA/date/commerçant + keep `receiptPath`, low-confidence fields (<0.6) listed in "À vérifier" hint. `app/expenses/[id].tsx` — detail/edit: receipt image via authed `Image source={{uri, headers}}` (new `apiUrl()` export in client.ts), PATCH save, delete with Alert confirm (gated `expenses.edit`/`expenses.delete`, both added to `CapabilityId`). `index.tsx` — teal summary total card (`useExpenseSummary`, follows category filter), rows navigate to detail.
- **Result:** ✅ `npx tsc --noEmit` clean; `npx jest` 7/7 pass; prettier clean.
- **Decisions:** camera capture via existing expo-camera dep instead of adding expo-image-picker (bare app — new native dep would force pod install/rebuild); no gallery pick for now.
- **Next:** device test of scan flow against `http://ocr:8000` chain (backend `/expenses/scan`); gallery pick if users ask.

### 2026-08-14 — Mobile: expenses (dépenses) — list + manual create
- **Step:** New mobile screens wired to backend `/v1/expenses`: `src/api/expense-queries.ts` (types mirrored from web `expense-queries.ts` — `amount` is a Prisma-Decimal string; `useExpenses` with category filter, `useCreateExpense` + invalidate), `app/expenses/index.tsx` (list with horizontal category filter chips, fmtMAD amounts, category/payment badges, Empty state), `app/expenses/new.tsx` (form: date default today, montant/TVA decimal-pad with `,`→`.` normalize, category + payment chips, optional supplier chips via `useSuppliers`, commerçant, note). Added `expenses.view`/`expenses.create` to mobile `CapabilityId` union; "Dépenses" 🧾 tile in More tab (locked without `expenses.view`).
- **Result:** ✅ mobile `npx tsc --noEmit` clean; `npx jest` 2 suites / 7 tests pass.
- **Decisions:** scope deliberately list+create only — no edit/delete, no `POST /expenses/scan` OCR flow yet (mobile camera receipt scan is the natural next increment).
- **Next:** receipt scan flow (camera → `POST /expenses/scan` → prefilled form), expense summary card.

### 2026-08-13 — Mobile: proper Android + iOS app icons from Tijaru mark
- **Step:** Old `mobile/assets/icon.png`/`adaptive-icon.png`/`favicon.png` were one identical 1024px file: full logo **with "Tijaru" wordmark** on white — unreadable at icon size, and Android adaptive foreground had no safe-zone padding. Regenerated everything from the vector master `backend/mark.svg` (2×2 rounded-square grid, teal `#0F766E` + orange `#F97316`) with a PIL script (4× supersampled, exact SVG geometry): `assets/icon.png` 1024 opaque mark-on-white (66% span), `assets/adaptive-icon.png` 1024 transparent foreground (43% span — fits the 66dp safe circle), `assets/favicon.png` 196. App is **bare** (ios/+android/ committed), so native assets were regenerated directly instead of relying on prebuild: iOS `ios/Mizano/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` (single-size catalog, no alpha), Android `mipmap-{m,h,x,xx,xxx}hdpi/ic_launcher{,_round,_foreground}.png` (48dp legacy square/round + 108dp adaptive foreground per density). `res/values/colors.xml` `iconBackground` fixed `#0F766E` → `#FFFFFF` to match `app.json` `android.adaptiveIcon.backgroundColor`.
- **Result:** ✅ 19 PNGs written; visual preview strip verified (mark centered, orange top-right, safe-zone respected); `sips -g hasAlpha` on iOS icon → `no`; AppIcon Contents.json single-1024 entry matches filename. Generator kept at scratchpad `gen_icons.py` (session-local; regenerate anytime from `backend/mark.svg`).
- **Decisions:** icon = mark only (no wordmark); adaptive background white with colored mark (matches web favicon), not teal-with-white-mark.
- **Next:** rebuild native apps to see it (`npx expo run:android` / `run:ios` or EAS build). `assets/splash.png` (400px, still old wordmark logo) not regenerated — separate pass if wanted.

### 2026-08-13 — Mobile: visible add-category CTAs on /admin/categories
- **Step:** Create button existed only as a small ➕ in the header — users couldn't find it (reported). Added full-width "+ Nouvelle catégorie" Btn: primary in the empty state, outline under the list when categories exist. Same `openCreate` modal.
- **Result:** ✅ mobile `npx tsc --noEmit` clean.
- **Decisions:** none.
- **Next:** none.

### 2026-08-13 — Mobile: category quick-create on product form (empty-chips fix)
- **Step:** `mobile/app/products/new.tsx` rendered zero chips under "Catégorie" when the business had no active categories — field looked unfillable (user screenshot). Added: dashed "+ Nouvelle" chip toggling an inline name input (`useCreateCategory` → `POST /categories`, defaults icon 📦 / tone `#0F766E` / active); on success the new category is auto-selected. Empty state now shows a hint pointing at "+ Nouvelle" instead of blank space.
- **Result:** ✅ mobile `npx tsc --noEmit` clean.
- **Decisions:** none. `POST /categories` requires `settings.manage` — non-admin users get an Alert on 403; acceptable, category management is an admin task.
- **Next:** none.

### 2026-08-13 — Mobile: multi-dépôt switch in admin center
- **Step:** `mobile/app/admin/index.tsx` gains a Multi-dépôt switch card (above Recommandations), same logic as `app/settings/index.tsx`: blocks disable while >1 active warehouse (Alert with count), `useMultiWarehouse`/`useSetMultiWarehouse` against `/admin/multi-warehouse`. Admin center now controls both: multi-dépôt (new) + Taux TVA (pre-existing `/admin/vat` screen). Mobile forms already consume enabled rates — `app/products/new.tsx` and `app/purchase-orders/new.tsx` filter options via `useVatRates()` with all-rates fallback; nothing to change there.
- **Result:** ✅ mobile `npx tsc --noEmit` clean.
- **Decisions:** none. Known quirk: mobile forms read `/admin/vat-rates` (cap `settings.manage`) — non-admin users 403 and silently fall back to all rates; proper fix is reading `enabledVatRates` from `/auth/me` (now available) like web does.
- **Next:** switch mobile forms + vat screen read-path to `/auth/me.enabledVatRates` for non-admin correctness.

### 2026-08-13 — Forms consume `enabledVatRates` (backend `/auth/me` + web pickers)
- **Step:** Backend: `/auth/me` now returns top-level `enabledVatRates` — `BusinessSubscriptionView` + `findBusinessById` select gained the column; `AuthService.me()` falls back to `[0,7,10,14,20]` for super admin / missing business. Web: auth store holds `enabledVatRates` (same fallback). `ProductFormPage` VAT segmented picker now renders enabled rates only (dropped hardcoded `VAT_RATES`); default VAT = 20 if enabled else highest enabled; edit mode keeps a since-disabled rate selectable (union with current value) so saving doesn't silently change the product. `InvoiceFormPage` per-line TVA free-number input replaced by a `<select>` of enabled rates (same union rule); `emptyLine`/product-select fallback use the computed default instead of hardcoded 20.
- **Result:** ✅ Backend `npx jest` → 390/390 (3 auth me() specs extended), `tsc --noEmit` clean. Web `tsc --noEmit` clean, `vitest run` → 19 files, 143/143 (new case: TVA select offers only `[0,10]` and defaults to 10 when store restricted).
- **Decisions:** rates ship on `/auth/me` rather than opening `GET /admin/vat-rates` to all users — that endpoint requires `settings.manage`, which cashiers/billing users lack; `me` already carries modules/subscription and every form loads it.
- **Next:** POS uses `p.vat` straight from product data — no picker, nothing to gate. Mobile product form still hardcodes rates if one exists (check on next mobile pass).

### 2026-08-13 — Web: TVA enable/disable + rate selection on Settings (admin)
- **Step:** `/settings` gains a TVA row next to the existing multi-warehouse toggle. Master switch: OFF patches `enabledVatRates: [0]` (backend requires ≥1 rate — "hors champ TVA" state), ON restores all `allowed` rates. When ON, per-rate pills (0/7/10/14/20) toggle individual rates; removal of the last remaining rate is blocked client-side. New hooks `useVatRates`/`useSetVatRates` in `web/src/api/admin-queries.ts` against the pre-existing `GET/PATCH /admin/vat-rates` (no backend change). Both switches got `aria-label`s (page now has two switches).
- **Result:** ✅ `npx tsc --noEmit` clean; `vitest run` → 19 files, 142/142 (5 new SettingsPage TVA cases: ON state + pills, OFF state + helper, off→[0]/on→all patch values, pill toggle patch value, empty-list guard).
- **Decisions:** TVA "disabled" is represented as `enabledVatRates=[0]`, not a new boolean column — reuses the existing field/endpoint, and 0% stays valid for non-taxed products.
- **Next:** make product/invoice forms consume `enabledVatRates` instead of the hardcoded `0|7|10|14|20` union so disabled rates disappear from pickers.

### 2026-08-13 — Web: removed `/platform-admin` URL prefix — role-based page rendering
- **Step:** PA pages moved to top-level paths inside `AdminShell`: dashboard now at `/` (super admin sees `PADashboardPage`, regular user `DashboardPage` — new `ByRole` dispatcher in `App.tsx` renders per role on the same path, no redirect), `/users` likewise dispatches `PAUsersPage` vs `UsersPage`. PA-only paths `/businesses`, `/businesses/:id`, `/approvals`, `/subscriptions` keep `<RoleGuard requires="platform-admin">` (403 in-place on URL-forcing). Deleted `RoleHome` redirect component. Legacy `platform-admin/*` URLs → `<Navigate to="/" replace>`. Updated: `PA_GROUP` sidebar links (`AdminShell.tsx`), internal links/navigates in `PADashboardPage`/`PABusinessListPage`/`PAUsersPage`/`PASubscriptionsPage`, `ForbiddenPage` homeHref (now always `/`, dropped `useAuth` dep), `LoginPage` comment, `PAUsersPage.test.tsx` expected href.
- **Result:** ✅ `npx tsc --noEmit` clean; `vitest run` → 19 files, 137/137.
- **Decisions:** none — sidebar visibility already permission-driven (`isSuperAdmin` picks PA_GROUP vs GROUPS; tenant items filtered by `cap`/`module`).
- **Next:** none immediate; consider i18n page-title entries in `pageKeys` for PA paths (falls back to "Dashboard" today, same as before).

### 2026-08-13 — Fix: mobile product pickers requested `pageSize=500`, backend caps at 200
- **Step:** `GET /products?pageSize=500` → 400 validation (`Number must be less than or equal to 200`, `product.dto.ts:60` Zod cap). Two mobile screens asked 500: `app/purchase-orders/new.tsx:45`, `app/movements/new.tsx:31`. Lowered both to `pageSize: 200` (matches backend cap + `useProducts` default). Mobile-side fix chosen over raising the backend cap — cap is a deliberate perf guard and a backend change would need a prod redeploy.
- **Result:** ✅ `grep pageSize` shows both at 200, no 500 left anywhere in `app/`+`src/`; `npx tsc --noEmit` clean.
- **Decisions:** none. Known limit: businesses with >200 products get a truncated picker on those two screens — proper fix is a server-searched product picker (follow-up).
- **Next:** searchable product picker for PO/movement forms when product counts grow.

### 2026-08-12 — Fix: mobile register (all API calls) broken — `.env` pointed at unregistered `api.tijaru.ma`
- **Step:** Mobile register failed with the generic network-error alert. Root cause: `mobile/.env` (edited 2026-08-12 22:24) set `EXPO_PUBLIC_API_URL=https://api.tijaru.ma/api/v1`, but `tijaru.ma` is **not registered** (registre.ma whois: "No Object Found" → DNS NXDOMAIN → every fetch fails, not just register). Actual prod lives at **`api.tijaru.com`** (vhost + cert exist in `../euras/eurasians-proxy`, behind Cloudflare). Fixed `mobile/.env` → `https://api.tijaru.com/api/v1`; also fixed the same stale `.ma` URL in `web/.env.production.example`.
- **Result:** ✅ `curl https://api.tijaru.com/api/health` → `{"status":"ok","database":"up"}`; `POST https://api.tijaru.com/api/v1/auth/register` with `{}` → 400 validation (businessName/ownerName/email/password Required) proving the route serves. `.ma` probe: `Could not resolve host`. Register screen + backend endpoint themselves were never broken. Note: `EXPO_PUBLIC_*` is baked at bundle time — restart Expo (`npx expo start -c`) / rebuild for the fix to take effect.
- **Decisions:** none logged — but `DEPLOY.prod.md` still says `api.tijaru.ma` throughout (§2, §3 `VITE_API_URL`); either register `tijaru.ma` and migrate, or update the doc to `.com`. Cloudflare Pages Production env var `VITE_API_URL` should also be checked for the same `.ma` value.
- **Next:** verify register end-to-end on device after Expo restart; reconcile DEPLOY.prod.md domain (`.ma` vs `.com`); check `mobile/.env.example` (still says port 3000, real local API is 3002).

### 2026-08-12 — Stock Phase S2-D1: web `ProductsPage` upgrade (tabs + category filter + supplier col + plan-limit banner + empty-state fix)

- **Step:** `web/src/pages/ProductsPage.tsx` brought in line with the Tijaru prototype (CSV import deferred to S2-D2). (1) 4 filter chips — Tous/Actifs/Stock faible/Rupture — each showing a live count, client-filtered from `q.data.items` (`active`: total>0; `low`: total>0 && total<=minStock && minStock>0; `out`: total===0). (2) Category `<select>` next to the search box, wired to the pre-existing `useCategories()` hook in `web/src/api/product-mutations.ts` (no new hook needed — `ProductFormPage` already used it). (3) New "Fournisseur" column between TVA and Stock, reading `p.supplier?.name ?? '—'` — added an **optional** `supplier?: { id; name } | null` field to `Product` in `web/src/api/types.ts`; the `/products` list endpoint doesn't join supplier yet (confirmed via backend `products.controller.ts`/`products.service.ts` — no supplier join on list), so the column renders `'—'` everywhere until that backend join lands (separate task). (4) Plan-limit banner (`Card` + `bg-warning-soft text-warning-700` per D-015) shown when `items.length >= subscription.limits.maxProducts` — added an **optional** `limits?: { maxUsers; maxProducts; maxWarehouses }` to a new shared `SubscriptionInfo` type (`web/src/api/types.ts`), used by both `MeResponse.subscription` and `useAuth`'s `subscription` field (`web/src/auth/auth-store.ts`); `/auth/me` doesn't return `limits` yet either, so the banner is dormant until that backend field ships — code path is fully wired and tested with a mocked auth store. (5) Empty-state now distinguishes `q.isLoading` ("Chargement…") vs. truly no data + no filters active ("Aucun produit — commencez par en créer un" + "Nouveau produit" CTA) vs. filtered-to-zero ("Aucun résultat pour ces filtres — essayez d'autres critères") — previously always showed "Chargement…" once `items.length` was falsy, even after a real empty load.
- **Result:** ✅ New `web/src/pages/ProductsPage.test.tsx` (9 cases: 4 tabs render with counts, tab click filters rows, category dropdown filters rows, supplier name/dash rendering, plan-limit banner renders at/over max, banner absent below max, loading placeholder, no-data empty state + CTA, no-filter-match empty state). `npm run typecheck` clean. `npm test -- --run` → 19 files, 137/137 passing (was 128). `npm run build` clean (tsc + vite, only pre-existing >500kB main-chunk warning, unrelated). Commit `0e67198` (web repo, `219f958..0e67198`, file-scoped `git add` — verified `git diff --cached --stat` touched only `ProductsPage.tsx`, `ProductsPage.test.tsx`, `api/types.ts`, `auth/auth-store.ts`, none of the pending unstaged `admin-queries.ts`/`SettingsPage.tsx`/`SettingsPage.test.tsx`).
- **Decisions:** none new — reused D-015 warning tokens; added `SubscriptionInfo` as a shared exported type (was inlined separately in both `MeResponse` and the auth store) rather than duplicating the `limits` shape twice.
- **Next:** S2-D2 — CSV import for ProductsPage. Separately, unblock the two dormant features added here: backend should (a) join `supplier` on `GET /products` list (same shape as `ProductDetail.supplier` in `entity-queries.ts`), and (b) return `limits: { maxUsers, maxProducts, maxWarehouses }` on `/auth/me`'s `subscription` object (values already exist per-business as `PABusiness.maxUsers/maxProducts/maxWarehouses` in `platform-admin`) so the plan-limit banner actually renders in production.

### 2026-08-12 — Stock Phase S2-A Task 1: backend `GET /v1/products/by-barcode/:code`
- **Step:** Tenant-scoped barcode lookup endpoint, mirroring `GET /:id`'s response shape. New `ProductsRepository.findByBarcode(code)` (abstract) + Prisma impl (`product.findFirst({where:{barcode, deletedAt:null}, include:{stockLevels+warehouse, category, supplier}})` — relies on `Product` being in `TENANT_MODELS` for implicit `businessId` scoping, same as `findDetail`). `ProductsService.findByBarcode(_actor, code)` throws `NotFoundError('product_not_found')` on miss (actor param kept per interface contract for future use, unused today — prefixed `_actor` for eslint). Controller route `GET by-barcode/:code` registered **before** `GET :id` (route-order guard against being shadowed), `@RequireCap('products.view')`. Files: `src/modules/products/{products.controller.ts, application/products.service.ts, domain/products.repository.ts, infrastructure/prisma-products.repository.ts, application/products.service.spec.ts}`, `test/products.e2e-spec.ts`.
- **Result:** ✅ `npx jest src/modules/products` → 9/9 (2 new: returns product on match, `NotFoundError` on miss). Full backend `npx jest` → 25 suites, 385/385. `npx tsc --noEmit` clean. `DATABASE_URL=postgresql://stock:stock@localhost:5433/stock?schema=public npm run test:e2e -- products` → 21/21 (2 new: 200 on match returns correct id, 404 `{code:'not_found'}` on miss). Commit `1b8a3b1`.
- **Decisions:** none new. Deviated from the plan's literal test snippets in two places: (1) e2e uses `tokens.owner` not `tokens.viewer` — this codebase's demo-role set is owner/admin/manager/stockkeeper/cashier, no `viewer` role exists; (2) real API prefix is `/api/v1/products/...` not `/v1/products/...` as shown in the plan (matches existing e2e conventions in the same file).
- **Next:** Task 2 of the same plan (mobile `expo-camera` scanner primitive + `useProductByBarcode` hook + `/scan` demo route) is a separate dispatch, not done here — see `docs/superpowers/plans/2026-08-12-stock-phase-s2a-barcode.md`. Noted but out of scope: running the *full* e2e suite in one Jest invocation shows 37 pre-existing cross-suite failures (403/500, token/DB interference between suites sharing the same tenant DB) — reproduced with `--runInBand` too and confirmed unrelated to this task via `git stash` isolation; not caused by this change.

### 2026-08-12 — Stock Phase S1: correctness + shared StockLedger (audit → 12-task SDD plan)
- **Step:** Full stock-module audit surfaced 8 critical bugs (B1–B8) and 14 missing SMB features; Phase S1 scope agreed as data-integrity blockers only (lots deferred to S3). Shipped through subagent-driven execution: T1 schema `20260812120000_stock_level_enrichment` (adds `businessId` FK+idx, `reservedQty Int`, `avgCost Decimal(12,4)`, `updatedAt` to `stock_levels`; registers `StockLevel` in `TENANT_MODELS`) → T2 new `src/modules/stock-ledger/` with `StockLedgerService.post(input, tx?)` — sole writer using conditional `updateMany({where:{qty:{gte:n}}, data:{qty:{decrement:n}}})` to close TOCTOU (throws `ConflictError('insufficient_stock')` on `count===0`) + WAC recompute on positive `unitCost` deltas → T3–T7 migrated POS checkout, Movements record, Inventory apply, PO receive, DN sign to route stock through ledger inside one `prisma.$transaction` (activity log becomes tx-atomic in same commit as ledger.post via `tx?` param on `logActivity`) → T8 `PATCH /products/:id` drops silent `stock` array; new `POST /products/:id/adjust` (Zod DTO `ecart|casse|perime|vol|retour` → `MovementReason` mapped, `note` preserves user-facing label) → T9 warehouse `delete` rejects `409 warehouse_not_empty` via `countNonZeroStock`; `isDefault` reset scoped by `businessId` → T10 real-Prisma e2e `test/stock-concurrency.e2e-spec.ts` (two concurrent `POST /movements` type=out qty=5 vs qty=8 → exactly one 201, one 409, final qty=3) → T11 mobile ships pure `src/lib/ean13.ts` + jest tests (validator only; detail/edit routes deferred behind pending mobile refactor). Inventory `apply()` now computes `delta = counted − liveQty` inside the tx (was `qty = counted` overwrite, erased concurrent sales). Removed `only_out_signable` restriction on DN sign — `order` is now a no-op, `in_` increments via `type:'in',reason:'achat'`, `out` decrements via `type:'out',reason:'vente'`, using business's default warehouse looked up inside the tx.
- **Result:** ✅ Backend 373/373 unit tests pass; e2e concurrency proves negative-stock impossible; `tsc --noEmit` clean except pre-existing `prisma/seed.ts` (missing `StockLevel.businessId` on seed + missing `expense.deleteMany` in wipe — deferred minor). Bugs fixed: B1 POS race, B2 side-channel product PATCH stock rewrite, B3 inventory-apply snapshot overwrite, B4 movements TOCTOU, B5 `StockLevel` cross-tenant leak, B6 warehouse soft-delete leaves dangling qty, B7 mobile EAN validator. Commits: `8a7ae70` T1 schema · `d483d31` T2 ledger · `321a450` T3 POS · `965632b` T4 movements (fix round 1 folded activity into tx) · `85a44db` T5 inventory (recovered after concurrent-agent race detached `cc1334d`) · `572eeef` T6 PO+WAC · `8e94f64` T7 DN sign · `ae89928` T8 products/adjust · `e58a93d` T9 warehouse guard · `786b42d` T10 concurrency e2e · mobile `d7ad3f5` T11 EAN validator.
- **Decisions:** D-017 (StockLedger sole writer + conditional `updateMany` over `FOR UPDATE`/version columns) · D-018 (WAC recomputed only on positive deltas that carry `unitCost` — sales/adjustments don't touch `avgCost`). Full ledger + task briefs/reports at `backend/.superpowers/sdd/2026-08-11-stock-phase-s1/`.
- **Next:** B8 mobile (product detail + edit routes + tap-to-detail + quick-adjust) deferred until mobile's pending refactor commits — then wire `isValidEan13` submit gate on `app/products/new.tsx`. Deferred pre-existing bugs: (1) `prisma/seed.ts` — add `businessId` on `StockLevel` seeds + `expense.deleteMany` in wipe tx; (2) `test/movements.e2e-spec.ts` asserts `422` for insufficient_stock but actual is `409` (correct); (3) fold two ambient minors — no spec for transfer-without-toWarehouseId rejection, `LedgerLine.delta` JSDoc lacks sign-convention note for transfers. Phase S2 (barcode scan, low-stock notifications, quick-adjust dialog, ProductsPage tabs, CSV import, valuation KPIs) is the next scoped brainstorm.

### 2026-08-12 — Bons PDF/WhatsApp plan: web (Task 4+5) + mobile (Task 7) share
- **Step:** Web `src/api/client.ts` gains `fetchBlob(path, opts?)` (reuses `rawFetch` + `tryRefresh`, no auto-JSON, returns raw `Response`); `src/api/bons.ts` extends `BonLine` w/ `unitPrice`+`subtotal`, adds `BonTotals`, exposes `getBonPdfBlob(id): Promise<Blob>`. Web `pages/bons/BonsPage.tsx` adds two per-row buttons — PDF (`getBonPdfBlob` → anchor `download`) + WhatsApp (`navigator.share({files:[File]})` when `canShare({files})` true, else download + `window.open(waLink(...))`). New `src/lib/whatsapp.ts` — `normalizeMAPhone()` (10-digit `0…` → `212…`, 9-digit → `212…`, `212…` passthrough, empty on empty) + `waLink(phone, text)` (drops phone segment when empty). 6 new `bons.*` i18n keys mirrored across en/fr/ar (web + mobile). Mobile new `src/lib/pdf.ts` — `shareBonPdf(id, number)` downloads to `FileSystem.cacheDirectory` w/ Bearer header, throws on non-200, guards `Sharing.isAvailableAsync()`, opens system share sheet with `application/pdf` + UTI `com.adobe.pdf`. Mobile `app/bons.tsx` cards get Download + Share-WhatsApp buttons (both call `shareBonPdf`; WhatsApp appears in share sheet when installed). `expo-sharing` added via `npx expo install`.
- **Result:** ✅ Web `vitest run` → 17 files, 122/122 (was 119 + 3 new BonsPage cases: PDF click, WhatsApp `navigator.share` path, WhatsApp `wa.me` fallback). Web `tsc --noEmit` + `npm run build` clean. Mobile `tsc --noEmit` clean repo-wide. Commits: `695cdde` (web fetchBlob+client), `6490e8a` (web BonsPage actions+i18n+whatsapp lib), `c061e92` (mobile pdf+share+i18n+dep).
- **Decisions:** none. Line-editor tasks (T6 web, T8 mobile) parked — neither web nor mobile has a bon create/edit UI yet (both pages are read-only lists). `unitPrice` input becomes a follow-up once an editor exists (B3d). Full ledger + minors: `backend/.superpowers/sdd/2026-08-12-bons-pdf-whatsapp/progress.md`.
- **Next:** Follow-up B3d — build web + mobile bon editor forms and wire `unitPrice` input + subtotal display. Also: rebuild `stock-backend` container once ambient multi-warehouse WIP build errors resolve, then live curl probe `/api/v1/delivery-notes/:id/pdf` and manual WhatsApp share verify on device.

### 2026-08-12 — Bons PDF/WhatsApp plan Task 1: `DeliveryNoteLine.unitPrice`
- **Step:** Migration `20260812120000_bon_line_unit_price` adds `unit_price DECIMAL(12,2) NOT NULL DEFAULT 0` to `delivery_note_lines`; matching Prisma field `unitPrice Decimal @default(0) @db.Decimal(12, 2) @map("unit_price")`. Applied to local pg 5433; prisma generate re-emitted client.
- **Result:** ✅ Migration up-to-date; `\d delivery_note_lines` shows `unit_price | numeric(12,2) | not null | 0`. Commit `c338b5e` (after fix round 1 removed accidental drift into unrelated WIP schema hunks).
- **Decisions:** default `0` on existing rows (bons pre-feature had no price; UI shows dash where 0).
- **Next:** Task 2 (DTO + subtotal service).

### 2026-08-12 — Bons PDF/WhatsApp plan Task 3: PDF endpoint (`pdfkit`)
- **Step:** `GET /api/v1/delivery-notes/:id/pdf` (`@RequireCap('po.manage')`) streams the bon as an A4 PDF — letterhead, bon number/status, destinataire block, line-item table, total. New `DeliveryNotePdfService.render(note): Promise<Buffer>` (pure, no I/O) in `src/modules/delivery-notes/application/delivery-note-pdf.service.ts`, built on `pdfkit` (+ `@types/pdfkit` devDep). Task 2's `DeliveryNoteDto` (from `DeliveryNotesService.get()`) has no business/party contact details (only `customerName`/`supplierName`/`issuedByName` strings) — added a small `DeliveryPdfInfoLookup` port (domain abstract + `PrismaDeliveryPdfInfoLookup` adapter) that fetches `Business{name,address,ice,phone}` and `Customer`/`Supplier{name,phone,city→address}` by id, matching the design doc's "load note w/ business, customer, supplier, issuedBy" intent without changing the existing JSON API DTO. Controller merges `svc.get()` + this lookup into the `PdfNote` shape before calling `render()`.
- **Result:** ✅ `npx jest src/modules/delivery-notes` → 29/29 (21+6 prior + 2 new PDF tests: buffer starts `%PDF-` and >500 bytes; bon number + customer name present in the rendered text). Full backend `npx jest` → 23 suites, 356/356 (was 329). `npx tsc --noEmit` clean for `delivery-notes/**` (remaining 15 errors are the pre-existing ambient multi-warehouse WIP already in the working tree, confirmed via `git stash` to exist identically without this task's changes). `eslint delivery-notes/**` clean except 7 pre-existing `no-explicit-any` warnings in Task 2's `delivery-notes.service.spec.ts` (untouched here). Commit `802116b`.
- **Decisions:** pdfkit 0.19 always hex-encodes glyph runs in `TJ` arrays (verified even for plain ASCII) rather than literal `(...)Tj` — the brief's test assertion (`buf.toString('latin1').toContain(...)`) can't pass against this dependency version regardless of implementation; adjusted the spec to decode the hex runs back to text first (same intent, correct for the installed version). Also `compress: false` on `PDFDocument` (otherwise the content stream is Flate-compressed, unreadable to any text check). Docker rebuild + live curl probe were blocked — `docker compose up -d --build backend` fails during `npx prisma generate && npm run build` on 5 pre-existing TS errors from the ambient multi-warehouse WIP (`prisma/seed.ts`, `products/infrastructure/prisma-products.repository.ts`), confirmed unrelated via `git stash`; endpoint mapping verified statically instead (route decorator + module-level guards + passing unit suite). Full detail: `.superpowers/sdd/2026-08-12-bons-pdf-whatsapp/task-3-report.md`.
- **Next:** Task 4 of the bons-pdf-whatsapp plan (web share button / WhatsApp deep link, per the design doc) — not started here. Also: rebuild `stock-backend` and run the live curl probe once the ambient multi-warehouse WIP's build errors are fixed (out of this task's scope).

### 2026-08-12 — Bons PDF/WhatsApp plan Task 2: unitPrice prefill + subtotal on delivery-notes
- **Step:** Extended `src/modules/delivery-notes/` (consumes Task 1's `DeliveryNoteLine.unitPrice` column). Zod `DeliveryNoteLineInputSchema` gained `unitPrice?: number` (nonnegative). `DeliveryNotesService.create()` now prefills a line's `unitPrice` from the product's current `sale` price when the caller omits it (explicit value always wins); new pure `computeTotals(note)` — BL (`out`) bills `sent × unitPrice`, BC/BR bill `ordered × unitPrice`, summed and rounded to 2dp. `get()`/`create()`/`updateLineSent()` now return a `DeliveryNoteDto` (lines carry `unitPrice`+`subtotal`, note carries `totals.subtotal`); `list()` unchanged (aggregate rows only, no per-line detail). Added a delivery-notes-scoped `ProductPriceLookup` port (domain abstract + `PrismaProductPriceLookup` adapter) instead of reusing `ProductsRepository` — that repo has no `findById`/price accessor and isn't exported from `ProductsModule`, so cross-module injection wasn't viable without touching `products/**` (out of scope).
- **Result:** ✅ `npx jest src/modules/delivery-notes` → 27/27 (21 prior + 6 new: prefill from product price, explicit unitPrice wins, `computeTotals` for BL/BC-BR/empty, `get()` response shape). `npx tsc --noEmit` clean for `delivery-notes/**` (remaining errors are the pre-existing, unrelated `businessId`-on-`StockLevel` gap in `inventory`/`movements`/`products`/`purchase-orders`/`prisma/seed.ts`, not touched here). Commit `a18fc05`.
- **Decisions:** unitPrice prefill uses `product.sale` (sell/HT price) uniformly for all note types (`out`/`order`/`in_`) rather than `purchase` for BC/BR — matches the existing POS prefill convention and the task brief's single generic `product.price` concept; flagged as a possible refinement (BC/BR could prefill from `purchase` instead) but not implemented, out of this task's stated scope.
- **Next:** Task 3 of the bons-pdf-whatsapp plan (see `.superpowers/sdd/2026-08-12-bons-pdf-whatsapp/`) — PDF generation for bons, presumably consuming `totals.subtotal`/line `subtotal` from this response shape.

### 2026-08-12 — Stock Phase S1 Task 3: POS checkout routed through `StockLedger` (fix B1)
- **Step:** `PrismaPosRepository.executeCheckout` no longer writes `StockLevel`/`Movement` inline; the `!data.parked` block now calls `StockLedgerService.post({businessId, userId: cashierId, type:'out', reason:'vente', ref: ticketNumber, lines: [{productId, warehouseId, delta: -qty}]}, tx)` inside the same `$transaction`, so a sale's stock floor is enforced by the ledger's atomic conditional `updateMany` (D-017) instead of the old unguarded `stockLevel.update({decrement})`. `PosModule` now imports `StockLedgerModule`; `PrismaPosRepository` constructor gains `StockLedgerService`. `CheckoutTicketData` (domain port) gained a required `businessId` field, sourced from `actor.businessId` in `PosService.performCheckout` — `LedgerPost.businessId` is explicit, unlike the `scoped()`-wrapped Prisma creates elsewhere in this file that get `businessId` auto-injected by the tenant Prisma middleware.
- **Result:** ✅ `npx jest src/modules/pos src/modules/stock-ledger` → 2 suites, 26/26 (1 new POS test: repo/ledger `ConflictError('insufficient_stock')` propagates through `PosService.checkout`). `npx tsc --noEmit` → same 5 pre-existing gap errors as Task 2 minus the POS one (now clean): `prisma/seed.ts` ×3 + `inventory`/`movements`/`products`/`purchase-orders` Prisma repos — 4 files, all still Tasks 4-8's job; zero new errors.
- **Decisions:** none new (executes D-017). Caught two brief inaccuracies while implementing: (1) the task brief's ledger-call snippet used `type: 'vente'`, but Prisma's `MovementType` enum is `in|out|transfer` — `'vente'` is a `MovementReason` value, not a type; used `type:'out', reason:'vente'`. (2) the brief's suggested failing test (`ledger.post.mockRejectedValueOnce`) assumed `PosService` calls `StockLedgerService` directly; it doesn't — `PosService` only depends on the abstract `PosRepository`, and the ledger lives inside `PrismaPosRepository`. Adapted the test to mock `repo.executeCheckout` rejecting with `ConflictError('insufficient_stock')` and assert the service propagates it; passed immediately (no red step) since that propagation contract already existed — confirming the real fix belonged in the infra layer.
- **Next:** Task 4 — migrate purchase-orders repo to `StockLedgerService.post()` (clears one of the remaining 4 pre-existing `businessId` tsc errors); Tasks 5-8 do the same for inventory/movements/products.

### 2026-08-12 — Stock Phase S1 Task 2: `StockLedger` service — single writer
- **Step:** New `src/modules/stock-ledger/` module — the sole writer for stock mutations going forward (Tasks 3-8 will migrate POS/PO/inventory/movements/products repos to call it instead of writing `StockLevel`/`Movement` directly). `domain/stock-ledger.types.ts`: `LedgerLine`/`LedgerPost` types, `type`/`reason` typed against the real Prisma enums (`MovementType = in|out|transfer`, `MovementReason = achat|vente|transfert|peremption|ajustement|casse` — brief's string-literal union in the interface comment was aspirational, not the actual schema). `application/stock-ledger.service.ts`: `StockLedgerService.post(input, tx?)` — runs each `LedgerLine` through `applyDelta` inside `prisma.$transaction` (or an outer `tx` if passed), positive deltas `upsert` `StockLevel` with weighted-average-cost recompute, negative deltas use a conditional `updateMany({where:{qty:{gte:needed}}})` that throws `ConflictError('insufficient_stock')` when 0 rows match (atomic stock-floor guard, no separate read-then-write race), `transfer` type applies the delta twice (source -qty, dest +qty) in the same tx, every line also emits a `Movement` row. `stock-ledger.module.ts` exports the service (PrismaService comes from the global module, not re-provided here). Registered in `app.module.ts` (2-line diff: import + module).
- **Result:** ✅ `npx jest src/modules/stock-ledger --no-cache` → 7/7 (increments+emits Movement on `in`; rejects `out` w/ insufficient stock via `ConflictError` when conditional update matches 0 rows; creates missing `StockLevel` row on positive delta; `transfer` decrements source + increments dest in one tx; WAC recompute — qty=10,avg=5 + 10@10 → avg=7.5; avgCost untouched on negative delta; runs inside a passed-in `tx` without opening its own `$transaction`). `npx tsc --noEmit` → 8 errors remain, all in the 5 files already flagged as Task 1's known downstream gap (`prisma/seed.ts` ×3, `inventory`/`movements`/`products` ×2/`purchase-orders` Prisma repos — `StockLevel` create calls missing `businessId`, Tasks 3-8's job); zero new errors in any file this task touched.
- **Decisions:** see D-017 (mocked `PrismaService` directly for the spec, following `platform-admin.service.spec.ts`'s pattern rather than the repo-mock pattern used by `pos`/`delivery-notes` specs — this service has no repository abstraction, it *is* the Prisma boundary). Used `ValidationError` in place of the brief's `BadRequestError` (doesn't exist in `src/common/errors.ts`) for `transfer_missing_destination`.
- **Next:** Task 3+ — migrate POS/PO/inventory/movements/products repos to call `StockLedgerService.post()` instead of writing `StockLevel`/`Movement` directly (also clears the 5 pre-existing `businessId` tsc errors above as a side effect).

### 2026-08-12 — Multi-warehouse toggle: migration applied + mobile mirror + web vitest
- **Step:** Applied `20260811120000_business_multi_warehouse` to local pg 5433 (`prisma migrate status` = up to date; `\d businesses` shows `multi_warehouse | boolean | not null | true`). Web vitest `SettingsPage.test.tsx` — 4 cases (switch reflects ON, switch reflects OFF, click calls mutate with inverted value, disabled + helper text when >1 warehouse still active); mocks `../i18n` + `react-i18next` + `api/queries` + `api/entity-queries` + `api/admin-queries` + `auth/auth-store`. Mobile: `useMultiWarehouse` / `useSetMultiWarehouse` in `src/api/queries.ts` (invalidates `['settings','multi-warehouse']` + `['warehouses']`). `app/settings/index.tsx` gains a "Multi-dépôt" Card with an RN `Switch`; when trying to turn off with >1 active warehouse, `Alert` explains + skips mutate.
- **Result:** ✅ Migration up-to-date in local pg. Web `vitest run` → 17 files, 119/119 (was 115 + 4 new). Mobile `npx tsc --noEmit` clean.
- **Decisions:** none.
- **Next:** Hide warehouse selectors across app when `multiWarehouse=false` (Movements/PO/POS/Inventory/Products/Users forms) — auto-default to the sole warehouse; add mobile vitest for the toggle once RN test harness lands.

### 2026-08-12 — Mobile register fix (unreachable API + missing route + mislabel)
- **Step:** Reported "Network error" on mobile Create-account. Four root causes fixed: (1) `mobile/.env` → `EXPO_PUBLIC_API_URL=http://192.168.1.82:3002/api/v1` (was `https://api.tijaru.com/api/v1`, unreachable). (2) Freed host :5433 by stopping stray `groupeeko_cgp_postgres_1`, force-recreated `stock-postgres` (network was detached after external stop), brought stack up. (3) Rebuilt `stock-backend` image — running container was pre-`/auth/register` build, returning 404. (4) Renamed field label `Email or phone` → `Email` in `src/i18n/{en,fr,ar}.ts` (backend requires strict email; user was typing phone into email field).
- **Result:** ✅ `curl -X POST http://192.168.1.82:3002/api/v1/auth/register` → `201 {"status":"pending"}`. Health `GET /api/health` → `200`. Nest routes now include `Mapped {/api/auth/register, POST} (version: 1)`.
- **Decisions:** none — LAN dev URL matches CLAUDE.md env spec (api :3002). Restrict to email in signup (D-XXX if needed later for phone-login).
- **Next:** Restart Expo w/ `--clear` to pick up new env. Account lands in `pending` — platform-admin must activate before login. Consider setting `EXPO_PUBLIC_API_URL` per-env instead of committing LAN IP; add proper API domain (`api.tijaru.ma` per spec, not `.com`) for prod builds.

### 2026-08-12 — Multi-warehouse toggle: unit tests + web Settings UI
- **Step:** Backend tests: `WarehousesService.create` gating — 4 cases (allow when enabled regardless of count; allow 1st when disabled; reject 2nd when disabled → `ForbiddenError`; skip gating when tenant context missing). `BusinessSettingsService` multiWarehouse — 4 cases (get returns current flag; enable always OK; disable OK when ≤1 warehouse; disable rejected with `DomainError` when >1). Web: `useMultiWarehouse` / `useSetMultiWarehouse` in `api/admin-queries.ts` (PATCH invalidates `admin.multi-warehouse` + `warehouses` caches). `SettingsPage` gains a "Multi-dépôt" Row with an aria `role="switch"` toggle; disabled with helper text when trying to turn off while >1 warehouse still active. i18n French strings inline (matches page convention).
- **Result:** ✅ Backend `npx jest` → 19 files, 329/329 (was 321 + 8 new). Web `npm run typecheck` clean; `vitest run` → 16 files, 115/115; `npm run build` clean (1.94s, JS 493.29 kB gzip 137.22 kB, CSS 36.53 kB gzip 6.91 kB).
- **Decisions:** none.
- **Next:** Apply migration in envs (`npx prisma migrate deploy`). Optional: hide/collapse warehouse selectors app-wide when `multiWarehouse=false` (Movements/PO/POS/Inventory/Products/Users forms all use `useWarehouses`); add mobile toggle mirror; add web vitest for `SettingsPage` toggle.

### 2026-08-11 — Multi-warehouse toggle (`Business.multiWarehouse`)
- **Step:** New per-tenant setting to enable/disable multi-stock. Prisma: `Business.multiWarehouse Boolean @default(true) @map("multi_warehouse")`; migration `20260811120000_business_multi_warehouse` (adds column, default true so existing tenants keep multi-stock). Backend: `WarehousesRepository.countActive()` + Prisma impl; `WarehousesService.create` now reads `business.multiWarehouse` from tenant and throws `ForbiddenError('multi_warehouse_disabled')` when disabled and ≥1 non-deleted warehouse already exists. `BusinessSettingsService.getMultiWarehouse()` / `setMultiWarehouse(bool)` — disabling with >1 active warehouse rejected via `DomainError('validation_error', 400)`. Two new endpoints on `AdminController` gated by `settings.manage`: `GET /admin/multi-warehouse`, `PATCH /admin/multi-warehouse` (Zod: `{multiWarehouse: boolean}`).
- **Result:** ✅ `npx prisma generate` OK; `npx tsc --noEmit` clean. Migration file created but not applied — Tijaru pg not running locally (`groupeeko_cgp_postgres_1` currently occupies host 5433). Run `npx prisma migrate deploy` in each env.
- **Decisions:** default `true` — preserves existing tenants' multi-stock behavior; toggle is opt-out, not opt-in. Enforcement point = service (not just `LimitGuard`) so it fires regardless of caller. Disabling blocked when >1 warehouse already exists to avoid orphaning stock/movements.
- **Next:** Apply migration once Tijaru pg is up. Web: add toggle in Admin → Settings screen calling `paApi`/`adminApi` PATCH; hide warehouse selector UI when `multiWarehouse=false`. Add unit tests for the disabled-mode create-block and the disable-with-multiple-warehouses rejection.

### 2026-08-11 — Platform-admin: admin-initiated user password reset
- **Step:** Closed the real gap behind a prototype request (screenshot was the old static prototype; the real app already has platform-only sidebar `isSuperAdmin ? [PA_GROUP]`, separate PA pages, and `/accueil` — none needed rebuilding). Backend: `PlatformAdminService.resetUserPassword(userId)` — finds live user (`deletedAt:null` → `NotFoundError`), reads business `SecurityPolicy.passwordMinLen`, generates a one-time temp password via `crypto.randomInt` over an unambiguous alphabet (no `O/0/I/1/l`, length `max(10, minLen)`), persists only the `bcrypt.hash(BCRYPT_COST)`, bumps `tokenVersion` and revokes active sessions (`session.updateMany {revokedAt}`, matching logout-all). Endpoint `POST /admin/platform/users/:id/reset-password` behind `PlatformAdminGuard`. Web: `paApi.resetUserPassword(id)`; new reusable `src/ui/Modal.tsx` (focus trap, Esc, backdrop-close); `PAUsersPage` gains an Actions column → "Réinitialiser le mot de passe" → confirm modal (warns session closes) → success modal revealing the temp password with a Copier button. Spec: `docs/superpowers/specs/2026-08-11-admin-password-reset-design.md`.
- **Result:** ✅ Backend: `tsc --noEmit` + `eslint --max-warnings=0` clean; `jest platform-admin.service` → 27/27 (5 new: temp-pw length/alphabet, bcrypt verifies, tokenVersion+session revoke, honors larger minLen, NotFound on unknown/soft-deleted); full backend `jest` → 17 files, 321/321 (was 316). Web: `tsc --noEmit` + `eslint` clean; `vitest run` → 16 files, 115/115 (PAUsersPage 5→7: opens confirm modal, calls resetUserPassword with row id, reveals temp password).
- **Decisions:** none — reused `PlatformAdminGuard` + PA-token pathway; temp-password-on-screen over email-reset-link (no email infra exists yet); scope limited to platform-admin (merchant `UsersPage` untouched) per user.
- **Next:** Optional — surface the same reset on merchant `UsersPage` for owners/admins; add a backend e2e once Playwright/e2e harness lands.

### 2026-08-10 — Batch 3b: Bons (BC/BL/BR) — backend + web + mobile
- **Step:** Full-stack shipping of the delivery-notes chain from `Tijaru-Platform-Prototype/bons.html`. Backend: `DeliveryNote` + `DeliveryNoteLine` + enums `DeliveryNoteType (order|out|in_)` / `DeliveryNoteStatus (prepared|sent|shipped|partial|delivered|closed)`, migration `20260810140000_add_delivery_notes` (not auto-applied). Back-relations wired on Business/User/Customer/Supplier/Product. New module `src/modules/delivery-notes/`: Zod DTOs (create/updateSent/list w/ superRefine — `out` requires customer, `order`/`in_` require supplier), abstract repo + Prisma impl, `DeliveryNotesService` w/ pure `statusFromLines(lines, fallback)` helper (all sent >= ordered → delivered · some sent > 0 → partial · else fallback), sequential per-type numbering (`BC-YYYY-NNNN`, `BL-YYYY-NNNN`, `BR-YYYY-NNNN`), `sign()` restricted to type=`out`, `updateLineSent()` re-derives status and blocks on closed. Controller under `@RequiresModule('delivery-notes')` + `@RequireCap('po.manage')`. Registered in `app.module`; seeded module id. Web: `api/bons.ts` client + hooks, `pages/bons/status.ts` shared label+tone map, `pages/bons/BonsPage.tsx` — prototype-matching 4-stat row (Commandes ouvertes / Livraisons en cours / Réceptions partielles / Non signés) + type tabs (Tous · BC · BL · BR) + card-wrapped table (n° mono · type badge · date · tiers + sourceRef · status badge · signé · cmd/reçu). Route `/bons`, nav link in `groups.sales` gated by `po.manage` + module `delivery-notes`. Mobile: `src/api/bons-queries.ts` + `app/bons.tsx` — type tab chips + list of Cards w/ number, type badge, party, sourceRef, cmd/reçu, signed check. Wired as new tile "Bons (BC/BL/BR)" in `app/(tabs)/more.tsx`.
- **Result:** ✅ Backend: `npx tsc --noEmit` clean; `npx jest src/modules/delivery-notes` → 21/21 new (statusFromLines edge cases · numbering per type · sent > ordered rejection · status derivation across create/updateLineSent · sign restricted to out · closed rejection). Full backend `npx jest` → 17 files, 316/316 (was 295). Web: `npm run typecheck` clean · `npm test` → 16 files, 113/113 (new: `BonsPage.test.tsx` 5) · `npm run build` clean. Mobile: `npx tsc --noEmit` clean.
- **Decisions:** Enum member name `in_` (SQL-safe: `in` is reserved); UI maps to short label `BR` and prototype text. Type-per-year sequential numbering (mirrors invoices FA-YYYY-NNNN pattern, D-016 rationale — module-level cap `po.manage` already covers the domain).
- **Next:** Devis + Document detail = follow-up B3c. Playwright e2e still deferred.

### 2026-08-10 — Batch 5: Landing (`accueil`) + Subscription-expired polish
- **Step:** Web: new public route `/accueil` → `pages/AccueilPage.tsx` — sticky nav w/ Tijaru logo tiles + "Se connecter"/"Démarrer" CTAs, hero (`clamp` type + brand kicker + dual CTA + trust line), 8-card feature grid (Caisse, Stock multi-dépôt, Facturation & devis, Achats, Clients & crédits, Dépenses OCR, Rapports & TVA, Rôles & permissions), 3-step onboarding block, dark bento CTA card w/ accent kicker, footer w/ support mailto. All classes reference existing tokens (`bg-brand-50`, `text-brand-700`, `bg-accent-500`, `rounded-card/ctl/pill`, `shadow-pop`) — no hard-coded hex. `SubscriptionExpiredPage.tsx` rewritten (French copy, brand-neutral logo tiles via inline RGB matching tokens, alert box w/ `bg-warning-soft`+`text-warning-700`, primary CTA = mailto to support, secondary = Se déconnecter). Route wired in `App.tsx` (public — outside `ProtectedRoute`).
- **Result:** ✅ Web: `npm run typecheck` clean; `npm test` → 15 files, 108/108 (new: `AccueilPage.test.tsx` 5, `SubscriptionExpiredPage.test.tsx` 3); `npm run build` clean (2.23s, CSS 36.32 kB gzip 6.85 kB, JS 476 kB gzip 133 kB).
- **Decisions:** none.
- **Next:** Deferred (all 5 batches shipped): (1) `npx prisma migrate deploy` for `20260810120000_add_invoices` in each env before hitting `/invoices/*`. (2) Devis/Bons/Document detail pages = follow-up B3b (each is its own Prisma model + module + page). (3) Playwright e2e setup (install `@playwright/test`, browsers, auth-bootstrap fixture, POS checkout + invoices happy path).

### 2026-08-10 — Batch 4: Platform-admin extras — Subscriptions + Users pages
- **Step:** Backend: `PlatformAdminService.listBusinesses(status?, plan?)` — added `plan` filter (both AND-combined); new `PlatformAdminService.listUsers({search?, businessId?, role?, page, pageSize})` — cross-business paginated user listing, name+email `ilike` search, excludes soft-deleted (`deletedAt: null`), joins `business{id,name,plan,status}`. Controller: `GET /admin/platform/businesses?status=&plan=` and new `GET /admin/platform/users` (guarded by `PlatformAdminGuard`, `@Public()` to bypass JWT since PA uses its own token). Web: `paApi.businesses(params: {status?,plan?})` signature switched from positional-string to param-object; existing caller in `PABusinessListPage` migrated. New `paApi.users(params)`. Two new pages under `pages/platform-admin/`: `PASubscriptionsPage.tsx` (plan filter chips, days-left column with negative-red rendering, `1mo/3mo/6mo/1yr` extend buttons wired to `paApi.extend`), `PAUsersPage.tsx` (role filter + name/email search + pagination + business link + active badge). Both wrap in `PALayout` and reuse the auth guard pattern from `PADashboardPage`. Nav in `PALayout.tsx` gains `Subscriptions` + `Users` links; routes in `App.tsx`.
- **Result:** ✅ Backend: `npx tsc --noEmit` clean; `npx jest src/modules/platform-admin` → 22/22 (7 new: listBusinesses status+plan combined, no-filter case, listUsers pagination, businessId filter, insensitive OR search, soft-delete exclusion); full backend `npx jest` → 16 files, 295/295 (was 289); `npm run build` clean. Web: `npm run typecheck` clean; `npm test` → 13 files, 100/100 (new: `PASubscriptionsPage.test.tsx` 4, `PAUsersPage.test.tsx` 5); `npm run build` clean (1.91s, CSS 33.66 kB gzip 6.43 kB).
- **Decisions:** none — reused existing `PlatformAdminGuard` + PA-token auth pathway.
- **Next:** Batch 5 — Landing/accueil + subscription-expired polish.

### 2026-08-10 — Batch 3: Facturation (Invoices) — backend module + web pages
- **Step:** Backend: added Prisma `Invoice` + `InvoiceLine` models + `InvoiceStatus` enum (`draft/sent/partial/paid/overdue/cancelled`), unique `(businessId,number)`, indexes on `(businessId,date)`, `(businessId,status)`, `customerId`. Migration file `prisma/migrations/20260810120000_add_invoices/migration.sql` created — NOT applied (user runs `npx prisma migrate deploy`). Back-relations wired on `Business.invoices`, `User.invoicesIssued`, `Customer.invoices`, `Product.invoiceLines`. `npx prisma format` + `validate` + `generate` clean. New module `src/modules/invoices/` (dto/domain/application/infrastructure/controller/module): Zod DTOs (`CreateInvoice`, `UpdateInvoice`, `RecordPayment`, `ListInvoicesQuery`), abstract `InvoicesRepository` port + `PrismaInvoicesRepository` adapter, `InvoicesService` (per-line HT/TVA compute w/ per-line discount, global discount subtract, sequential number `FA-YYYY-NNNN` per business, `recordPayment` auto-transitions to `partial`/`paid`, rejects overpayment/cancelled/invoice not found, `cancel` blocks on paid or partial). `InvoicesController` protected by `@RequiresModule('invoices')` + `@RequireCap('billing.manage')` (reused existing cap — no permissions matrix change). Registered in `app.module.ts`. Added `invoices` to `seed-default-modules.ts`. Web: `api/invoices.ts` client + hooks (`useInvoices`, `useInvoice`, `useCreateInvoice`, `useRecordPayment`, `useCancelInvoice`). `pages/invoices/status.ts` — shared status label + Badge tone map. `pages/invoices/InvoicesPage.tsx` — status filter tabs (Toutes + 6 statuts) + search + table (n°/date/client/échéance/total/restant/statut). `pages/invoices/InvoiceFormPage.tsx` — client + date/due-date + line grid (product select → auto-fills label/priceHt/vat, qty, per-line discount) + global discount + notes + live HT/TVA/total; validates before POST. Routes `/invoices` + `/invoices/new` in `App.tsx`.
- **Result:** ✅ Backend: `npx tsc --noEmit` clean; `npx jest src/modules/invoices` → 19/19 new; full backend `npx jest` → 16 files, 289/289 (was 270). Web: `npm run typecheck` clean; `npm test` → 11 files, 91/91 (new: `InvoicesPage.test.tsx` 5, `InvoiceFormPage.test.tsx` 8); `npm run build` clean (2.06s, 1708 modules, CSS 33.63 kB gzip 6.43 kB).
- **Decisions:** D-016 (reuse `billing.manage` cap for invoices; do not fork per-action caps yet).
- **Next:** Migration MUST be applied in each env before endpoint is called (`npx prisma migrate deploy`). Devis (`Quote`), Bons (`DeliveryNote`/`PurchaseNote`), Document detail page = follow-up Batch 3b (each is its own model + module + page). Batch 4 — Admin platform extras next.

### 2026-08-10 — Batch 2: POS module — service unit tests + web POS page
- **Step:** Backend: added `src/modules/pos/application/pos.service.spec.ts` with 18 unit tests using a jest-mocked `PosRepository` — sessions (open/current), checkout math (HT/TVA/total from price×qty+VAT, discount subtract, ticket-number increment from highest existing ref), validations (unknown product → `NotFoundError`, `insufficient_stock`, `insufficient_payment`, `invalid_split`, parked skips payment+stock checks), credit (`due = total`), park (mark + not-found), resume (not-parked rejected, replaceTicketId passed through), receipt (base64 QR payload w/ number/ice/total/date, not-found). Web: created `web/src/api/pos.ts` (typed client + hooks: `useCurrentSession`, `useOpenSession`, `useCheckout`, `useReceipt`), `web/src/pages/pos/usePosCart.ts` (pure cart state machine — add/inc/dec/remove/clear, stock cap, `computeTotals` derives HT/TVA from TTC per VAT rate), `web/src/pages/pos/POSPage.tsx` (prototype-faithful catalog grid + sticky cart aside + totals + Espèces/Carte buttons, out-of-stock disabled with Rupture badge, warehouse selector). Route `/pos` in `App.tsx` swapped from `StubPage` → `POSPage`.
- **Result:** ✅ Backend: `npx jest src/modules/pos` → 18/18 new; full backend `npx jest` → 15 files, 270/270 passing. Web: `npm run typecheck` clean; `npm test` → 9 files, 78/78 (new: `usePosCart.test.ts` 12, `POSPage.test.tsx` 9); `npm run build` clean (1.79s, 1704 modules, CSS 33.48 kB gzip 6.39 kB).
- **Decisions:** none — service surface + DTOs pre-existed.
- **Next:** Playwright e2e for POS checkout flow is deferred to a dedicated setup step (needs `@playwright/test` install + browsers + config + auth-bootstrap fixture). Then Batch 3 — Facturation (invoices/devis/bons/document): new backend module + migration + 4 web pages + tests.

### 2026-08-10 — Batch 1: Web design-system aligned to Tijaru-Platform-Prototype tokens
- **Step:** Ported prototype `assets/app.css` design tokens into `web/`. Fixed a11y-critical color drift: `accent-700` 194,65,12 → 154,52,18 (only orange passing 4.5:1 on accent-50/surface), `accent-50` 255,247,237 → 255,243,235, `brand-900` 19,78,74 → 9,78,74. Added `success-700/warning-700/info-700` semantic-dark variants + status-soft backgrounds matching prototype. Emitted new theme-independent shell tokens (`--r-card 16px`, `--r-ctl 12px`, `--r-pill`, `--sidebar-w 264px`, `--header-h 76px`, `--shadow-card`, `--shadow-pop`) in `index.scss`; exposed via `tailwind.config.ts` (`rounded-{card,ctl,pill}`, `shadow-{card,pop}`, `spacing.sidebar/header`, `success/warning/info.700`). Refreshed primitives: `Btn` (variants remapped to prototype specs — primary brand-700→brand-900 hover, secondary surface+ink-200 border, ghost transparent+ink-700, danger soft w/ tinted border; sizes now h-8/38/46/52), `Card` (surface+shadow-card+subtle border) + new `CardHead`/`CardBody` subcomponents, `Badge` (added semantic status tones `active/trial/expired/suspended/pending`, optional `dot`), `Input` (h-38 + r-ctl + brand-700 3px focus ring + hover ink-400 border).
- **Result:** ✅ `npm run typecheck` clean. `npm test` → 7 files, 57/57 passing (new: `Card.test.tsx` 6, `Input.test.tsx` 6, `PageHeader.test.tsx` 4, `Table.test.tsx` 3; expanded: `Btn.test.tsx` 14, `Badge.test.tsx` 6). `npm run build` clean (Vite 2.12s, 1701 modules, 31.34 kB CSS gzip 6.05 kB).
- **Decisions:** D-015 (prototype = visual contract for web + tokens live in SCSS as source of truth, tailwind consumes via CSS vars).
- **Next:** Batch 2 — POS. Wire `pos.html` prototype → `POSPage`, gap-fill backend `modules/pos`, add checkout unit+e2e+RTL+Playwright tests.

### 2026-08-09 — Fix: prod boot crash-loop from required PLATFORM_ADMIN env vars
- **Step:** `env.ts` required `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` at every app boot via zod schema, but only `prisma/seed-platform-admin.ts` (a one-off script) actually reads them — app code never touches them. Prod was crash-looping (`tijaru-backend exited with code 1 (restarting)`, `Invalid environment configuration`) because those vars weren't set and the admin was already seeded. Made both fields `.optional()` in `env.ts`; `seed-platform-admin.ts` now throws its own explicit error if run without them.
- **Result:** ✅ `env.spec.ts`: 2/2 passing (added case asserting `loadEnv()` succeeds with both vars absent).
- **Next:** user to `make deploy` on prod when ready.

### 2026-08-09 — Phase 10 complete: unified auth + subscriptions + super admin panel
- **Step:** All 12 tasks implemented via SDD across backend (`feat/unified-auth-subscriptions`, 10 commits) and web (3 commits). Backend: Prisma migration (subscription fields on Business), unified login (PA→User fallback), SubscriptionGuard (auto-downgrades expired), ModuleGuard + `@RequiresModule`, LimitGuard + `@EnforceLimit`, super admin API (stats/detail/extend/suspend/activate/modules), registration PA email conflict check, default module seeding, `/auth/me` with modules+subscription. Web: unified auth store (merged PA store), super admin panel (dashboard/business list/detail), module-based nav filtering, subscription-expired redirect page + 403 interception.
- **Result:** ✅ Backend: 251/251 tests passing, `tsc` clean. Web: `tsc` clean, `vite build` clean. Final whole-branch review caught one critical bug (wire-format mismatch: `ForbiddenError` produces `code: 'forbidden'` but frontend checks `code: 'subscription_expired'`) — fixed with dedicated `SubscriptionExpiredError` class. Commits: `60a917f`..`1f1f136` (backend), `cb5f5ef`..`92c200c` (web).
- **Decisions:** D-011 (unified login), D-012 (subscription model), D-013 (module gating), D-014 (guard order: Throttler→JWT→Subscription→Module→Limit→Caps).
- **Next:** Merge to main, deploy (`make deploy`), run `npx tsx prisma/seed-default-modules.ts` inside container for existing businesses. Browser test: PA login → admin panel, user login → module gating, subscription expired flow.

### 2026-08-09 — Task 10: `/auth/me` includes modules + subscription — backend
- **Step:** `AuthService.me()` now takes a `businessId` param (passed by the controller from `AuthUser.businessId`) and, when non-empty, fetches the business's active modules and plan/subscription end via two new `AuthRepository` methods — `findBusinessById` (returns `{ plan, subscriptionEnd }` via `prisma.business.findUnique`) and `findBusinessModules` (returns `{ moduleId, active }[]` via `prisma.businessModule.findMany`), implemented in `PrismaAuthRepository`. Response now includes `modules: string[]` (active module ids only) and `subscription: { plan, end } | null`. Super admin callers (`businessId: ''`) short-circuit to `modules: [], subscription: null` without hitting the DB. Web-side changes (`web/src/api/types.ts`, `web/src/auth/auth-store.ts`) from the task brief are **out of scope** — this session only touched the backend repo.
- **Result:** ✅ `npx jest src/modules/auth --silent` → 16/16 passed (4 new `me()` cases: null profile, active-modules-filtered + subscription shape, business-not-found → null subscription, super-admin businessId `''` skips repo calls entirely). `npx tsc --noEmit -p tsconfig.json` clean. `npx eslint` on all touched files clean. Commit `a82371f`.
- **Decisions:** Passed `businessId` as an explicit 4th param to `me()` (from `AuthUser.businessId`, already present on the JWT-derived user) rather than adding `businessId` to `UserProfileView`/`findProfile` — avoids widening an existing, differently-shaped DTO and cleanly handles the super-admin empty-string case without a DB round trip.
- **Next:** Task 3 — SubscriptionGuard to block expired businesses (still pending); web-side Task 10 work (types + auth store) not yet done.

### 2026-08-09 — Task 2: Unified login — backend
- **Step:** `POST /auth/login` unified per D-011. `AuthService.loginPlatformAdmin` checks `PlatformAdmin` by email; returns `null` on not-found or wrong password (never throws — only the controller decides what's a 401), so a wrong PA password falls through silently to the existing business-user `login()`. `JwtAuthGuard` now branches on `payload.type === 'platform-admin'` to build an `AuthUser` with `isSuperAdmin: true`, `businessId: ''`, `role: 'owner'`, and every `CAPABILITY_IDS` entry. `CapsGuard` bypasses cap checks when `user.isSuperAdmin`. Added `AuthRepository.findPlatformAdminByEmail` (abstract + Prisma impl) and `AuthUser.isSuperAdmin?: boolean`.
- **Result:** ✅ `npx tsc --noEmit -p tsconfig.json` clean. `npm test` → `Test Suites: 11 passed, 11 total / Tests: 210 passed, 210 total` (includes 5 new `auth.service.spec.ts` cases: PA match, PA not-found→null, PA wrong-password→null, unknown-email→401 via `login()`, PA-wrong-password-falls-through-to-successful-user-login). Cross-checked against Task 1's pre-existing `PlatformAdminService.login`/`PlatformAdminGuard` (separate `POST /auth/platform-admin/login` endpoint) — identical JWT payload shape (`{ sub, type: 'platform-admin', ver }`), so tokens from either path are interchangeable and that endpoint's behavior is unchanged. Commit `0995144`.
- **Decisions:** Deviated from the task brief's literal `CapsGuard` snippet — placed the `isSuperAdmin` bypass *after* the existing `if (!required || required.length === 0) return true;` early return rather than before it. `CapsGuard` is a global `APP_GUARD` alongside `JwtAuthGuard`, so it also runs on `@Public()` routes (`/auth/login`, `/auth/register`, `/auth/permissions`) which never populate `request.user`; bypassing first would throw `UnauthorizedError` on every public route. Full 210-test suite confirms no regression. No new D-XXX — implements D-011 as designed.
- **Next:** Task 3 — SubscriptionGuard to block expired businesses.

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
