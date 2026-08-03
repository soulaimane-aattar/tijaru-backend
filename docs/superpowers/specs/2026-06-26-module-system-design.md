# Multi-Tenant Platform + Module System — Design

**Date:** 2026-06-26
**Status:** Approved design, pending implementation plan
**Supersedes:** the single-tenant draft of this file.

This is **two sequential sub-projects**. Each gets its own implementation plan.

- **Sub-project A — Multi-tenancy foundation.** Turn the single-tenant app into a multi-business SaaS with a platform super-admin. **Blocker for B.**
- **Sub-project B — Module system.** Odoo-style per-business app activation, controlled by the super-admin, gating capabilities.

**Out of scope:** building the Facture/invoicing feature itself (separate spec). POS / Achats / Reports backends already exist and are only _wired_ to the module gate.

---

## Glossary

- **Platform super-admin** — a single account (you), above all businesses. Logs into a platform console. Not a business user.
- **Business / tenant** — one customer company. Has its own staff, data, dashboard.
- **Business user / staff** — `User` rows belonging to exactly one business; governed by the existing role × capability system.
- **Module** — a named bundle of capabilities (POS, Facture, Achats, Reports) that the super-admin activates per business.

---

# Sub-project A — Multi-tenancy foundation

## A.1 Isolation strategy

**Shared database, `businessId` column on every tenant-scoped row, automatic row-level scoping.** One Postgres DB (unchanged infra). The platform super-admin is un-scoped and sees across all businesses.

## A.2 Platform super-admin

New model, fully separate from business `User`:

```prisma
model PlatformAdmin {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String
  tokenVersion Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@map("platform_admins")
}
```

- Separate login: `POST /platform/auth/login` → JWT with claim `kind: "platform"`, **no `businessId`**.
- Seeded once from env (`PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`) — that's you.
- A `PlatformGuard` admits only `kind: "platform"` tokens. Platform endpoints bypass tenant scoping.

## A.3 Business lifecycle

`Business` gains:

```prisma
status    BusinessStatus @default(active)   // enum: active | suspended
createdBy String?                            // PlatformAdmin id
```

Platform console endpoints (all behind `PlatformGuard`):

- `GET  /platform/businesses` — list all (with status, module summary, user count).
- `POST /platform/businesses` — create a business **+ its initial owner user** (email/password) **+ default `SecurityPolicy` + default `BusinessModule` rows (all active)** in one transaction.
- `PATCH /platform/businesses/:id` — edit profile.
- `PATCH /platform/businesses/:id/status` — `active | suspended`. **Suspended → all staff login blocked** (checked in business login).
- (Module activation endpoints — see Sub-project B.)

## A.4 Tenant scoping (the core mechanism)

**`businessId` is added to every top-level tenant-scoped model:**

`Warehouse, User, CustomRole, RoleCustomization, Category, Supplier, Customer, Product, Movement, PurchaseOrder, POSession, POTicket, InventoryCount, Notification, Activity`.

`SecurityPolicy` already has `businessId`. Child tables (`StockLevel`, `*Line`, `Session`) inherit the tenant through their parent — they are reached only via a scoped parent, so they don't each need a column (decision: keep them column-free to limit churn; revisit only if a query hits them without a parent join).

**Scoped uniqueness** — every currently-global `@unique` that is tenant data becomes a composite unique with `businessId`:

| Model.field | was | becomes |
|---|---|---|
| `User.email` | `@unique` global | **stays global `@unique`** (see A.5) |
| `Category.name` | `@unique` | `@@unique([businessId, name])` |
| `Product.barcode` | `@unique` | `@@unique([businessId, barcode])` |
| `Product.sku` | `@unique` | `@@unique([businessId, sku])` |
| `PurchaseOrder.number` | `@unique` | `@@unique([businessId, number])` |
| `POTicket.number` | `@unique` | `@@unique([businessId, number])` |
| `CustomRole.name` | `@unique` | `@@unique([businessId, name])` |

**Automatic scoping — `TenantContext` + Prisma `$extends`:**

- `TenantContext` uses Node `AsyncLocalStorage` to hold the current request's `businessId`.
- A `TenantGuard` (runs after `JwtGuard`) reads `businessId` from the business JWT and enters the ALS scope for the request.
- `PrismaService` is wrapped with a `$extends` query extension: for every tenant-scoped model, it auto-injects `where: { businessId }` on reads and sets `data.businessId` on creates, pulling the id from `TenantContext`. **When no tenant context is set (platform requests / seed), the extension is bypassed** so the super-admin sees everything.
- Net effect: existing service code (`prisma.product.findMany(...)`) becomes tenant-safe **without** rewriting every query. New code can't accidentally leak across tenants.

> Defense-in-depth: services that already filter explicitly keep working; the extension is additive (`AND businessId`).

## A.5 Auth changes

- **Business login** (`POST /auth/login`, unchanged route): `User.email` stays globally unique, so the email resolves to exactly one user → one business. No business-picker UI. Login additionally checks `user.business.status === active`, else `403 business_suspended`.
- JWT for business users gains `businessId` + `kind: "business"`. `AuthUser` type gains `businessId: string`.
- Platform login is separate (A.2).
- `GET /auth/permissions` continues to return the caller's effective caps (now also filtered by active modules — Sub-project B).

## A.6 Migration & seed

- Additive Prisma migration: add columns nullable → backfill the existing single Business's id into all rows → set `NOT NULL` → add composite uniques (after dropping old globals). Document as an ordered migration so existing data survives.
- `seed.ts`: create `PlatformAdmin` from env; wrap existing demo data under one seeded Business; seed that Business's `BusinessModule` rows.

## A.7 Clients (web + mobile)

- Business apps: unchanged UX; they just carry a tenant-scoped token. Login error surfaces `business_suspended`.
- **New platform console** (can be a minimal protected section of web, or a separate route group): super-admin login → businesses list → create business → suspend/activate → manage modules (Sub-project B). Minimal CRUD UI; no tenant data browsing required for v1.

## A.8 Tests (A)

- Tenant isolation: user of Business X cannot read/write Business Y rows (extension blocks even a crafted id).
- Platform token bypasses scoping; business token cannot hit `/platform/*`.
- Suspended business → login blocked.
- Scoped uniqueness: two businesses may both have a product barcode `X`.
- Create-business transaction is atomic (rolls back fully on failure).

---

# Sub-project B — Module system (rides on A)

## B.1 Module catalog (domain)

New `src/domain/modules.ts`, mirroring `permissions.ts`:

```
MODULE_IDS = ['pos','facture','achats','reports']  // activatable apps
MODULES: Record<ModuleId, { id, labelFr, labelAr, caps: CapabilityId[] }> = {
  facture: { caps: ['billing.manage'] },
  achats:  { caps: ['po.manage','suppliers.manage'] },
  reports: { caps: ['reports.view','activity.view'] },
  pos:     { caps: [] },   // gated at controller level (shares core stock.out)
}
capModule(cap) -> ModuleId | null   // null = core, never gated
```

**Core, always-on:** `dashboard.*, products.*, stock.*, inventory.*, warehouses.*, users.manage, settings.manage`.

POS note: POS reuses the core `stock.out` cap, so POS is **not** gated by stripping a cap (that would break core stock-out). Instead the whole POS controller carries `@RequireModule('pos')`, and POS nav keys off the active-module list.

**Invariant (unit-tested):** each cap belongs to ≤1 module; module caps are disjoint from core; no orphan caps.

## B.2 Data (already tenant-scoped)

```prisma
model BusinessModule {
  businessId String
  moduleId   String
  active     Boolean  @default(true)
  updatedAt  DateTime @updatedAt
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@id([businessId, moduleId])
  @@map("business_modules")
}
```

- **Default: all modules active** when a business is created (seeded in the create-business transaction, A.3).
- Missing row treated as **active** (fail-open to installed); toggles upsert.

## B.3 Who toggles — the super-admin

**Module activation is a platform-console action** (matches "I enable modules for them"), gated by `PlatformGuard` — _not_ a business capability. Business owners consume active modules but cannot self-activate.

- `GET   /platform/businesses/:id/modules` — catalog + per-module `{active}`.
- `PATCH /platform/businesses/:id/modules/:moduleId` `{active}` — toggle for that business; writes an `Activity` row scoped to the business (`module.enabled` / `module.disabled`); validates `moduleId ∈ MODULE_IDS`.

## B.4 Enforcement (business side, server-authoritative)

- **`ModuleService`** — `getActiveModules(businessId)`, cached per business, invalidated on toggle. State lives outside the JWT → toggling takes effect immediately, **no re-login**.
- **`CapsGuard` upgrade** — a required cap is denied when its `capModule(cap)` is inactive for the caller's business (`403 module_disabled`) **or** the user lacks the cap (`403 forbidden`, existing).
- **`@RequireModule(moduleId)` + `ModuleGuard`** — coarse gate for whole controllers (e.g. POS). `403 module_disabled` when off.
- **`GET /auth/permissions`** — payload gains `activeModules: ModuleId[]`, and the returned effective caps already exclude inactive-module caps → clients hide nav without knowing the cap→module map.

## B.5 Clients

- Business web/mobile read `activeModules` from `/auth/permissions`; hide nav/routes for inactive modules; deep-link to a hidden route → redirect to dashboard.
- Platform console: per-business **Modules** toggle grid (label, description, switch) → `GET/PATCH /platform/businesses/:id/modules`.
- No inline seed/mock data in screens (project convention) — lists come from the API.

## B.6 Tests (B)

- Domain: `capModule`, catalog integrity invariant, `moduleCaps`.
- `CapsGuard`: {cap present/absent} × {module active/inactive/core} → allow / forbidden / module_disabled.
- `ModuleGuard`: active vs inactive.
- `ModuleService`: toggle busts cache; missing row = active; cache is per-business.
- e2e: super-admin disables POS for Business X → X's POS endpoints 403 + POS gone from `/auth/permissions`; Business Y unaffected; business owner cannot call `/platform/*` toggle (403).

---

## File touch list (anticipated)

| Area | Files |
|------|-------|
| Domain | `src/domain/modules.ts` (+ `.spec.ts`); `permissions.ts` (no new cap needed for B) |
| Prisma | `schema.prisma` (`PlatformAdmin`, `BusinessStatus`, `BusinessModule`, `businessId` on tenant models, scoped uniques); ordered migration; `seed.ts` |
| Tenant core | `common/tenant-context.ts` (ALS), `common/guards/tenant.guard.ts`, `common/guards/platform.guard.ts`, `common/prisma.service.ts` (`$extends`) |
| Auth | `modules/auth` (businessId + kind in JWT, suspended check), `common/auth/auth-user.type.ts` |
| Platform | new `modules/platform` (admin auth + businesses CRUD + modules toggle) |
| Module enforcement | `common/guards/caps.guard.ts`, new `common/guards/module.guard.ts`, new `common/decorators/require-module.decorator.ts`, new `modules/modules/module.service.ts` |
| POS | controller `@RequireModule('pos')` |
| Clients | web platform-console screens + business nav reacting to `activeModules`; mobile nav reacting to `activeModules` |

## Open assumptions (flag if wrong)

1. `User.email` globally unique → one user = one business, no business-picker at login.
2. Platform console is a protected route group in the existing web app (not a separate deployment) for v1.
3. Module activation is platform-admin-only; business owners cannot self-toggle.
4. Default module state on business creation = all active.
