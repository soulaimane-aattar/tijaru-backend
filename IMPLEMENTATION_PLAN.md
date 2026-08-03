# Stock — Implementation Plan

Three independent app folders (no monorepo). Spec `Stock-build-spec.md` governs WHAT; this plan governs HOW + ORDER.

```
GestionStock/
├── backend/      # NestJS + Prisma + PostgreSQL — source of truth
├── web/          # React + Vite admin
├── mobile/       # Expo + React Native
├── Stock-build-spec.md
└── IMPLEMENTATION_PLAN.md
```

Each folder = own `package.json`, own git history (or one umbrella repo, three subdirs — user choice). No pnpm workspace, no turbo, no shared `packages/`.

---

## 0. Strategy

- **Backend is single source of truth.** All entities, role matrix, capabilities, validation rules live in `backend`. Web + mobile consume via HTTP + generated types.
- **Type sharing without monorepo:** backend exposes OpenAPI 3.1 (NestJS Swagger). Web + mobile run `pnpm gen:api` → produces `src/api/generated.ts` (types + typed fetcher) via `openapi-typescript` + `openapi-fetch`. No runtime coupling.
- **Role/cap matrix duplication:** small file `permissions.ts` (~80 lines) literally copy-pasted in all three apps. CI guard: a script in backend `tools/check-permissions-sync.ts` reads same file from `../web/src/permissions.ts` and `../mobile/src/permissions.ts`, hashes, fails if drift. Or — host as static `/auth/permissions` endpoint, clients fetch + cache at login.
- **i18n duplication:** FR/AR/EN strings duplicated in web + mobile (different bundles anyway, web has admin-only keys, mobile has POS-only keys). Backend keeps its own minimal i18n for receipts + notifications.
- **Bottom-up + vertical-slice hybrid.** Foundations (backend), then Products end-to-end through all three apps, then wide.
- **Each phase: typecheck + lint + tests green.**
- **Spec fidelity:** spec wording verbatim in i18n strings, colors, fields, capability ids.

---

## 1. Phase map

| # | Phase | Folder(s) | Output | Gate |
|---|-------|-----------|--------|------|
| 1 | Backend bootstrap | backend | NestJS, Prisma, Postgres, docker-compose, config, logger, swagger | `docker-compose up` + `/api/docs` loads |
| 2 | Domain + Prisma schema | backend | Full schema spec §5.1, migration, seed spec §5.2 | seed loads 5 users / 17 products |
| 3 | Permissions + Auth + Users | backend | JWT access+refresh, RolesGuard, `@RequireCap`, sessions, login 5 demo users | acceptance #2 partial |
| 4 | Products module | backend | CRUD, search, filter, soft-delete, purchase-price gating | functional tests green |
| 5 | Web bootstrap + login + dashboard skeleton | web | Vite, React Router, Tailwind, openapi-fetch, login → /admin/home | login as Youssef shows dashboard |
| 6 | Mobile bootstrap + login + dashboard | mobile | Expo, Expo Router, NativeWind, SecureStore, login → tabs | acceptance #1 partial |
| 7 | Products vertical slice | web + mobile | List/Detail/Form on both | create-edit-delete works end-to-end |
| 8 | Movements + Stock | backend → web + mobile | Atomic movement+stock, list, form (in/out/transfer) | transfer test passes |
| 9 | Warehouses / Categories / Suppliers / Customers | all three | CRUD + screens | — |
| 10 | Purchase Orders | all three | PO CRUD + `receive` → in-movements | acceptance partial |
| 11 | Inventory counts | all three | Count flow → adjustment movements | — |
| 12 | POS | backend + mobile | Tickets, payment 4 methods, receipt with ICE+QR, session | **acceptance #3 full** |
| 13 | Admin (roles/overrides/sessions/policy) | backend + web + mobile | Editor screens + endpoints | **acceptance #4–7** |
| 14 | Reports + Activity + Notifications | all three | Endpoints + charts (web) + lists (mobile) | — |
| 15 | i18n FR/AR/EN + RTL | web + mobile | Language switch, RTL on AR | **acceptance #8** |
| 16 | Permission matrix sheet + Switch user + More menu polish | mobile | Sheet UI | **acceptance #9** |
| 17 | Offline + sync polish | mobile | TanStack Query + MMKV persist + queue | — |
| 18 | E2E tests | all three | Maestro mobile, Playwright web, supertest backend | all 11 §13 pass |
| 19 | Docs + DX | each | README per app, ADD_MODULE.md, ADD_LOCALE.md | junior-dev test passes |

Est. ~19 work-sessions, parallelizable from phase 8 onward.

---

## 2. Phase 1 — Backend bootstrap (`backend/`)

```
backend/
├── package.json
├── tsconfig.json                # strict, NodeNext
├── nest-cli.json
├── docker-compose.yml           # postgres:16 + api service
├── .env.example                 # DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, PORT
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── main.ts                  # bootstrap, helmet, cors, swagger, pino
│   ├── app.module.ts            # auto-discover via glob
│   ├── config/                  # Zod env validation
│   ├── common/
│   │   ├── guards/jwt.guard.ts
│   │   ├── guards/roles.guard.ts
│   │   ├── decorators/require-cap.decorator.ts
│   │   ├── decorators/current-user.decorator.ts
│   │   ├── filters/http-exception.filter.ts
│   │   ├── interceptors/activity-log.interceptor.ts
│   │   ├── pipes/zod-validation.pipe.ts
│   │   └── prisma.service.ts
│   ├── domain/                  # framework-free
│   │   ├── entities/            # Product, Movement, Warehouse, User, Business, Supplier, Customer, PurchaseOrder, POSession, POTicket, Notification, Activity
│   │   ├── value-objects/       # Money, ICE, EAN13, Phone, VATRate
│   │   ├── permissions.ts       # ROLES, CAPABILITIES, ROLE_PERMS, hasPermission — single source
│   │   └── errors.ts
│   └── modules/                 # auto-registered
│       ├── auth/
│       ├── users/
│       ├── roles/
│       ├── businesses/
│       ├── warehouses/
│       ├── categories/
│       ├── products/
│       ├── movements/
│       ├── suppliers/
│       ├── customers/
│       ├── purchase-orders/
│       ├── inventory/
│       ├── pos/
│       ├── notifications/
│       ├── activity/
│       ├── reports/
│       └── admin/               # roles editor / overrides / sessions / policy
└── tools/
    └── export-permissions.ts    # writes permissions.ts copies into ../web/src and ../mobile/src
```

Each module Clean-Arch internally:
```
modules/<x>/
├── <x>.module.ts
├── <x>.controller.ts            # thin HTTP
├── application/                 # use cases — one class per
├── infrastructure/              # prisma-<x>.repository.ts implementing domain repo iface
├── dto/                         # Zod schemas
└── <x>.controller.spec.ts       # supertest
```

Stack: NestJS 10 · Prisma 5 · Postgres 16 · JWT (access 15min / refresh 7d) · `nestjs-zod` · Pino · `@nestjs/swagger` · Helmet · `@nestjs/throttler`.

OpenAPI: served at `/api/docs` (Swagger UI) + raw JSON at `/api/openapi.json` — consumed by web + mobile codegen.

---

## 3. Phase 2 — Schema + Seed

Prisma schema mirrors spec §5.1. Key adjustments for relational store:
- `Product.stock` → separate `StockLevel { productId, warehouseId, qty }` (composite PK).
- `User.overrides` → `UserOverride { userId, capId, granted }`.
- Soft-delete via `deletedAt` on Product/User/Warehouse.
- `Movement` transactional: write + adjust `StockLevel` in single `prisma.$transaction`. Transfer = decrement source + increment dest atomically.
- `Session` table for refresh tokens (hashed) + device + ip + ua + city.

Seed (spec §5.2 verbatim): 3 warehouses (Casa default / Marrakech / Rabat), 5 demo users (Youssef/Fatima/Karim/Hassan/Salma, bcrypt `demo1234`), 6 categories, 5 suppliers (Cosumar, Lesieur Cristal, Coopérative Argan Tiznit, Mahdia Distribution, Tria), 17 products with `611x` EAN-13, 10 movements over 9 days, 7 activity, 2 POs (1 sent, 1 partial), 4 notifications, 3 customers, El Amrani Distribution SARL ICE 001512345000078.

---

## 4. Phase 3 — Auth + Permissions

Endpoints:
- `POST /auth/login` → `{ access, refresh, user }`. Access JWT (15min, payload `{sub, role, ver}`). Refresh stored hashed in `Session`.
- `POST /auth/refresh` → rotate refresh, revoke old.
- `POST /auth/logout` → revoke session.
- `GET /auth/me` → user + effective capabilities (role caps merged with overrides).
- `GET /auth/permissions` → static role × cap matrix (cached forever client-side; bust on `Cache-Control: max-age + ETag`).

Rate-limit `/auth/login` 5/min/IP. Bcrypt cost 12.

`@RequireCap('products.edit')` decorator + `RolesGuard` use `hasPermission()` from `src/domain/permissions.ts`.

Unit tests: full §6.2 matrix (6 roles × 18 caps = 108) + override precedence.

---

## 5. Phase 4 — Products module (backend)

Endpoints (all `@RequireCap`-gated):
- `GET /products` — paginate, filter `category|lowStock|expiring|search`, sort.
- `GET /products/:id`.
- `POST /products` — `products.create`.
- `PATCH /products/:id` — `products.edit`.
- `DELETE /products/:id` — `products.delete` (soft).
- `POST /products/:id/duplicate`.

Response interceptor strips `purchase` field when actor lacks `products.viewPurchasePrice`.

Functional tests per endpoint × {happy, 401, 403, 400, 404}.

---

## 6. Phase 5 — Web bootstrap (`web/`)

```
web/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts            # brand/accent/danger/ink palettes (spec §3.2)
├── index.html
├── .env.example                  # VITE_API_URL
├── public/
│   └── fonts/                    # Inter, Noto Sans Arabic, JetBrains Mono (self-hosted)
└── src/
    ├── main.tsx
    ├── app.tsx                    # router root
    ├── api/
    │   ├── generated.ts           # openapi-typescript output (do not edit)
    │   └── client.ts              # openapi-fetch + auth header + refresh interceptor
    ├── auth/
    │   ├── auth-context.tsx
    │   ├── login-page.tsx
    │   └── use-current-user.ts
    ├── permissions.ts             # copied from backend, hash-checked in CI
    ├── i18n/
    │   ├── index.ts               # i18next setup
    │   ├── fr.ts ar.ts en.ts
    │   └── format.ts              # fmtMAD, fmtDate, fmtDateTime, relTime, formatICE, formatPhone
    ├── ui/                        # shadcn-style primitives
    │   ├── button.tsx input.tsx field.tsx select.tsx textarea.tsx
    │   ├── badge.tsx card.tsx sheet.tsx modal.tsx toast.tsx
    │   ├── segmented.tsx empty.tsx avatar.tsx stripe-placeholder.tsx
    │   └── screen-header.tsx
    ├── layouts/
    │   ├── admin-shell.tsx        # sidebar + topbar + lang switch
    │   └── auth-shell.tsx
    ├── pages/                     # one folder per feature
    │   ├── dashboard/
    │   ├── products/
    │   ├── movements/
    │   ├── warehouses/
    │   ├── users/
    │   ├── suppliers/
    │   ├── customers/
    │   ├── purchase-orders/
    │   ├── inventory/
    │   ├── reports/
    │   ├── activity/
    │   ├── notifications/
    │   ├── settings/
    │   └── admin/
    │       ├── roles/
    │       ├── overrides/
    │       ├── sessions/
    │       └── policy/
    └── lib/
        ├── query-client.ts        # TanStack Query
        └── format-utils.ts
```

Stack: React 18 · Vite 5 · TypeScript · React Router v6 · Tailwind · TanStack Query · TanStack Table · React Hook Form + Zod · Recharts · i18next.

`pnpm gen:api` script: `openapi-typescript http://localhost:3000/api/openapi.json -o src/api/generated.ts`.

---

## 7. Phase 6 — Mobile bootstrap (`mobile/`)

```
mobile/
├── package.json
├── app.json                       # Expo config (locales, RTL flag)
├── tsconfig.json
├── tailwind.config.js             # via NativeWind, mirrors web palette
├── babel.config.js
├── metro.config.js
├── .env.example                   # EXPO_PUBLIC_API_URL
├── assets/
│   └── fonts/                     # Inter, Noto Sans Arabic, JetBrains Mono
├── app/                           # Expo Router (file-based)
│   ├── _layout.tsx                # root: providers (Query, Auth, i18n, Toast)
│   ├── (auth)/
│   │   ├── splash.tsx
│   │   ├── login.tsx
│   │   └── onboarding/[step].tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx            # bottom nav 5 tabs, hide on fullScreens
│   │   ├── home.tsx
│   │   ├── products/
│   │   │   ├── index.tsx
│   │   │   ├── [id].tsx
│   │   │   ├── new.tsx
│   │   │   └── edit/[id].tsx
│   │   ├── movements/
│   │   │   ├── index.tsx
│   │   │   └── new.tsx
│   │   ├── warehouses/index.tsx
│   │   └── more.tsx
│   ├── pos/
│   │   ├── index.tsx
│   │   ├── receipt.tsx
│   │   └── _components/
│   │       ├── cart-sheet.tsx customer-picker-sheet.tsx
│   │       ├── scan-modal.tsx payment-sheet.tsx
│   ├── admin/
│   │   ├── home.tsx roles.tsx overrides.tsx sessions.tsx policy.tsx
│   ├── users.tsx suppliers.tsx customers.tsx purchase-orders.tsx
│   ├── inventory.tsx reports.tsx activity.tsx settings.tsx scan.tsx
├── src/
│   ├── api/
│   │   ├── generated.ts           # openapi-typescript output
│   │   └── client.ts              # openapi-fetch + SecureStore tokens + refresh
│   ├── auth/
│   │   ├── auth-store.ts          # Zustand
│   │   └── use-current-user.ts
│   ├── permissions.ts             # copied from backend, CI-hash-checked
│   ├── i18n/
│   │   ├── index.ts               # i18next + expo-localization + RTL handling
│   │   ├── fr.ts ar.ts en.ts
│   │   └── format.ts
│   ├── ui/                        # mirrors web primitives, RN versions
│   │   ├── btn.tsx field.tsx input.tsx sheet.tsx modal.tsx
│   │   ├── toast.tsx card.tsx badge.tsx avatar.tsx
│   │   ├── stripe-placeholder.tsx screen-header.tsx segmented.tsx
│   ├── stores/                    # Zustand: pos, warehouse, ui
│   ├── lib/
│   │   ├── query-client.ts        # TanStack Query + MMKV persister
│   │   └── format-utils.ts
│   └── theme/colors.ts            # spec §3.2 palette
```

Stack: Expo SDK 51+ · React Native · TypeScript · Expo Router · NativeWind · Zustand · TanStack Query · React Hook Form + Zod · Expo SecureStore · MMKV · i18next · expo-localization · expo-camera (scan).

Spec fidelity:
- 5-tab bottom nav (Accueil · Produits · Mouvements · Entrepôts · Plus), brand-700 active.
- `fullScreens` set: scan, product-new, product-edit, move-new, po-new, inventory-new, pos, pos-receipt.
- All animations spec §3.5 (cubic-bezier(.2,.7,.2,1), 220–320ms) via `react-native-reanimated`.
- Phone-only UX. Tablet usable, not optimized.

---

## 8. Phase 7 — Products vertical slice (web + mobile)

**Web** (`web/src/pages/products/`):
- `list-page.tsx` — TanStack Table, server pagination, search, category filter, sort, bulk select.
- `detail-page.tsx` — view + inline edit.
- `import-wizard.tsx` — CSV/XLSX upload → preview → Zod validate → batch POST.

**Mobile** (`mobile/app/(tabs)/products/`):
- list (list+grid toggle, search, category chips, sort, FAB +).
- detail (hero stripe, gated price block, per-warehouse stock, actions).
- form new/edit (5 sections spec §7.7).

Mutations via TanStack Query; invalidate on success.

Tests:
- Web: component (List/Detail/Form/ImportWizard), Playwright (login Youssef → create → verify in list).
- Mobile: component (List/Detail/Form), hook tests for `useProducts`.

---

## 9. Phase 12 — POS deep-dive (mobile + backend)

### Backend (`backend/src/modules/pos/`)
- `POST /pos/sessions` — open day session (`S-YYYYMMDD`).
- `POST /pos/tickets` — atomic: validate stock per line at current warehouse, create `POTicket`, emit `Movement{type:'out', reason:'vente', ref:'TKT-####'}` per line, decrement stock, bump session counters. Return receipt payload with ICE, formatted lines, base64 QR (`{ticket, ice, total, date}`).
- `POST /pos/tickets/:id/park` + `POST /pos/tickets/:id/resume`.
- `GET /pos/sessions/:id` — stats.

PDF receipt via `@react-pdf/renderer` for print download.

### Mobile (`mobile/app/pos/`)
- `index.tsx` — gradient header + session stats + search + category chips + 2-col product grid + floating cart bar + parked-tickets section.
- `_components/cart-sheet.tsx` — 88% sheet, customer chip, lines with qty steppers, discount block + quick buttons (-5/-10/-20/-50), totals, "Mettre en attente" + "Vider" + "Encaisser".
- `_components/customer-picker-sheet.tsx` — search by name/ICE, "Anonyme" first.
- `_components/scan-modal.tsx` — Caméra (expo-camera) / Manuel tabs.
- `_components/payment-sheet.tsx` — 92% sheet, big total card, 4 method tiles (Espèces with quick-bills 20/50/100/200 + Arrondir 50 + Compte juste + change calc; Carte TPE-ready; Crédit gated by customer; Mixte split with remaining-to-allocate).
- `receipt.tsx` — thermal-print look, dashed sections, business+ICE+addr+phone, ticket meta, lines, totals, "Merci de votre visite · شكرا لزيارتكم", QR, action bar (Imprimer/Partager/Nouveau ticket).

Local state: Zustand `usePOSStore` (cart, discount, customer, parked).

Acceptance #3 (Maestro): login Salma → POS → add 3 → discount 10 → checkout → cash 250 → change → receipt with ICE+QR+total.

---

## 10. Phase 13 — Admin deep-dive (backend + web + mobile)

### Backend (`backend/src/modules/admin/`)
- `GET/PATCH /admin/roles` — `RoleCapability` table; built-in roles immutable except owner-blocked; custom roles via `CustomRole`.
- `GET/PATCH /admin/users/:id/overrides` — `UserOverride` rows.
- `GET /admin/sessions` + `DELETE /admin/sessions/:id` + `DELETE /admin/sessions` (all).
- `GET/PATCH /admin/security-policy` — single-row `SecurityPolicy` per business: passwordMinLen, requireUpper/Digit/Symbol, expiryDays, historyCount, twoFARequiredFor, lockAfterFailures, sessionTimeoutMin, ipAllowlist (CIDR[]), auditRetentionDays.

Role/permission change emits in-process event → bumps affected users' `tokenVersion` → invalidates their access tokens.

### Web (`web/src/pages/admin/`)
- `roles/` — TanStack Table list + drawer editor grouped by 12 domains (Dashboard/Products/Stock/Inventory/Warehouses/Users/Suppliers/Achats/Reports/Journal/Billing/Settings).
- `overrides/` — user picker + cap-by-cap segmented [Selon rôle | Accorder | Refuser].
- `sessions/` — table with revoke + "Tout révoquer".
- `policy/` — form with sections (Mot de passe / Authentification / Réseau / Conformité).

### Mobile (`mobile/app/admin/`)
Mirror spec §7.13–7.17 verbatim — same screens phone-shaped.

Acceptance #4–7 mapped 1:1.

---

## 11. Phase 15 — i18n + RTL

### Strings
`fr.ts` source of truth, `ar.ts` + `en.ts` derived. Keys: `app.*`, `auth.*`, `nav.*`, `actions.*`, `entities.product.*` (per entity), `status.*`, `roles.*`, `errors.*`. ~110 minimum (spec §11), final ~200+.

Web + mobile each keep own `fr/ar/en.ts` (different keysets — admin-only vs POS-only). Shared keys live in both; CI script `tools/check-i18n-shared-keys.ts` in backend asserts shared subset matches.

### Mobile RTL
- `i18next` + `expo-localization` detect.
- Switch to AR: `I18nManager.forceRTL(true)` → Expo Updates reload (or `DevSettings.reload()` dev).
- Font: Noto Sans Arabic for AR, Inter otherwise (Platform.select via `useFonts`).
- All layouts use `start`/`end` not `left`/`right`.

### Web RTL
- `<html dir>` toggle on switch.
- Tailwind logical-properties plugin (`ms-*`/`me-*`).

### Backend i18n
Receipt PDF + notification bodies use small server-side i18n (FR/AR/EN strings file in `backend/src/common/i18n/`).

Acceptance #8.

---

## 12. Phase 18 — E2E (the 11 acceptance criteria)

| # | Scenario | Tool | Where |
|---|---|---|---|
| 1 | Youssef → Dashboard full | Maestro + Playwright | mobile + web |
| 2 | Switch Salma hides ineligible tiles | Maestro | mobile |
| 3 | Full POS sale → receipt | Maestro | mobile |
| 4 | Manager role toggle reflected in matrix | Playwright + Maestro | web → verify mobile |
| 5 | Override grants Hassan reports.view | Playwright + Maestro | web → verify mobile |
| 6 | Revoke session | Playwright | web |
| 7 | Policy 2FA + min-len 14 saved | Playwright | web |
| 8 | FR→AR switch | Maestro | mobile |
| 9 | Permission matrix sheet | Maestro | mobile |
| 10 | "Print all" PDF export | Playwright PDF snapshot | web |
| 11 | Dev-only all-screens grid | Playwright screenshot | web (`/dev/all-screens`) |

Backend: supertest covers all endpoints × {happy, 401, 403, 400, 404} + concurrent movement test (no negative stock under race).

§13 items 10–11 reinterpreted from HTML-prototype concepts into production stack.

---

## 13. Cross-app sync mechanisms (no monorepo)

| Concern | Mechanism |
|---|---|
| API types | `pnpm gen:api` in web + mobile → `openapi-typescript` from `/api/openapi.json` |
| HTTP client | `openapi-fetch` (tiny, typed via generated.ts) |
| Role/cap matrix | `backend/tools/export-permissions.ts` writes identical `permissions.ts` into `web/src/` + `mobile/src/`. CI step `pnpm check:permissions-sync` in each app hashes + compares. Alt: skip dup, fetch `/auth/permissions` at login |
| Formatters (fmtMAD, fmtDate, formatICE) | Copy-pasted file `format.ts` in each app + same CI hash check |
| Design tokens | `tailwind.config` colors block copy-pasted; backend doesn't need |
| i18n strings | Per-app (different keysets); CI checks shared-key subset |
| Domain types beyond what OpenAPI gives | Generated types are enough; richer domain models stay in backend |

**Recommend `/auth/permissions` endpoint approach** — single source at runtime, no codegen drift, no CI hash check. Adopt unless offline-first requires baked-in matrix (then fall back to baked + endpoint-refresh).

---

## 14. Extensibility (spec §6 contract — adapted)

Add new entity (e.g. Promotions):
1. `backend/src/domain/entities/promotion.ts` + value objects.
2. Prisma model + migration.
3. `backend/src/modules/promotions/` — module folder (auto-registered via glob in `app.module.ts`).
4. Add caps `promotions.view`, `promotions.manage` to `backend/src/domain/permissions.ts`. Re-export via `tools/export-permissions.ts` → web + mobile pick up.
5. Web: `web/src/pages/promotions/` (list + detail + form).
6. Mobile: `mobile/app/promotions/` (list + detail + form).
7. Run `pnpm gen:api` in web + mobile → typed routes immediately available.

Role editor in web + mobile is data-driven from `CAPABILITIES` — picks up new caps automatically (place into "Promotions" domain group via cap-id prefix).

No core file edits.

---

## 15. Decisions to confirm

| # | Decision | Default | Confirm? |
|---|---|---|---|
| D1 | Single-tenant vs multi-tenant | Single — one Business per deploy | **Yes** |
| D2 | Receipt PDF library | `@react-pdf/renderer` server-side | No |
| D3 | QR payload format | JSON base64 (future DGI e-invoice ready) | **Yes** |
| D4 | Permissions sync mechanism | `/auth/permissions` endpoint (no codegen dup) | **Yes** |
| D5 | Mobile state | Zustand + TanStack Query + MMKV | No |
| D6 | Refresh token rotation | Rotate on every refresh, revoke old | No |
| D7 | Soft-delete UI | Web admin shows "Restore" for soft-deleted | No |
| D8 | Custom roles | Yes (spec §7.14 supports), stored in `CustomRole` | No |
| D9 | IP allowlist enforcement | `/auth/login` only, not every request | **Yes** |
| D10 | Session timeout enforcement | Short JWT exp + sliding refresh capped by policy | No |
| D11 | CNDP audit retention | Background job purges activity > `auditRetentionDays` | No |
| D12 | Umbrella git (one repo, three subdirs) vs three separate git repos | One umbrella git at `GestionStock/` | **Yes** |

Confirm D1, D3, D4, D9, D12 before phase 1.

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| Permissions matrix drift between apps | D4: `/auth/permissions` endpoint (single source at runtime) |
| API type drift | `pnpm gen:api` run pre-commit + in CI |
| RTL bugs across 24+ screens | Playwright visual regression both dirs (phase 15) |
| Movement race → negative stock | Prisma `$transaction` with row-lock on `StockLevel`; concurrent-write test |
| Expo native deps (camera) | `expo-camera` + manual fallback per spec §14 |
| Three CI pipelines diverge | Shared `.github/workflows/` patterns (install → typecheck → lint → test) per app |
| Junior dev confused by three repos | Top-level README + per-app READMEs + ADD_MODULE.md walks all three |

---

## 17. v1 cut (demoable ~7 sessions)

- Phases 1–4 (backend: bootstrap → schema → auth → products).
- Phase 5–6 (web + mobile bootstraps, login, dashboard skeletons).
- Phase 7 (Products vertical).
- Phase 8 (Movements).
- Phase 12 (POS — headline).
- Acceptance #1, #2, #3 only.

Admin + reports + AR + i18n + offline → v1.1.

---

## 18. Next step

Confirm D1/D3/D4/D9/D12 (§15), pick start:
- **A.** Full plan, sequential (~19 sessions).
- **B.** v1 cut (§17, ~7 sessions, POS-focused).
- **C.** Backend only first (phases 1–4), decide rest later.

Then phase 1 (backend bootstrap) next session.
