# Unified Auth, Subscriptions & Super Admin Panel

**Date:** 2026-08-09
**Status:** Approved

## Overview

Unify login for business users and platform super admin. Add subscription management (duration-based, manual), module gating with feature limits per business, and make the web app a full-featured app (not admin-only) matching mobile capabilities.

## 1. Unified Login

### Single endpoint: `POST /auth/login`

Backend checks `PlatformAdmin` table first by email, then `User` table.

**PlatformAdmin match:**
- JWT payload: `{ sub, type: 'platform-admin', ver }`
- No `bid` (not tied to a business)
- Frontend redirects to `/platform-admin/dashboard`

**User match:**
- JWT payload: `{ sub, type: 'user', bid, role, ver, caps, overrides }` (unchanged)
- Frontend redirects to `/` (normal app)

**Constraints:**
- PlatformAdmin email must never exist in User table — enforced at seed and registration
- Rate limiting on login: 5 attempts per email per 15 minutes
- Bcrypt cost unchanged

### Web frontend changes
- Remove `/platform-admin/login` page
- `/login` handles both user types
- After login, decode JWT `type` field → redirect accordingly
- Auth store detects `type: 'platform-admin'` and sets `isSuperAdmin` flag

## 2. Subscription Model

### Schema changes on Business

```prisma
model Business {
  // ... existing fields ...
  plan             SubscriptionPlan @default(trial)
  subscriptionStart DateTime?
  subscriptionEnd   DateTime?
  maxUsers         Int              @default(5)
  maxProducts      Int              @default(100)
  maxWarehouses    Int              @default(2)
}

enum SubscriptionPlan {
  trial
  active
  expired
  suspended
}
```

No separate Subscription table. Super admin sets duration manually (1mo/3mo/6mo/1yr) via admin panel. No payment integration.

### Enforcement

**SubscriptionGuard (global, runs after JwtAuthGuard):**
- `@Public()` routes → skip
- `type: 'platform-admin'` → skip
- Check `business.subscriptionEnd >= now()`. If expired:
  - Auto-update `plan` to `expired` if still `active`
  - Return 403 with code `subscription_expired`
  - Frontend shows "Subscription expired — contact administrator" screen
- Cache business subscription status in JWT or fetch from DB (prefer DB for real-time accuracy)

**Limit enforcement at creation endpoints:**
- `POST /users` → check `count(users) < business.maxUsers`
- `POST /products` → check `count(products) < business.maxProducts`
- `POST /warehouses` → check `count(warehouses) < business.maxWarehouses`
- Return 403 with code `limit_reached` and `{ limit: 'maxUsers', current: 5, max: 5 }`

## 3. Module Gating

### Existing table: `BusinessModule`

Toggleable modules:
| moduleId | Description |
|----------|-------------|
| `pos` | Point of Sale |
| `expenses` | Expense tracking + OCR |
| `purchase-orders` | Purchase orders |
| `inventory` | Inventory counts |
| `reports` | Reports & analytics |

### Backend: `@RequiresModule('pos')` decorator + ModuleGuard

```typescript
@RequiresModule('pos')
@Controller('pos')
export class PosController { ... }
```

ModuleGuard:
- Reads `businessId` from `req.user`
- Checks `BusinessModule` for `{ businessId, moduleId, active: true }`
- Super admin → skip (always allowed)
- Missing row = disabled (default off, super admin enables)

### Frontend
- Fetch active modules on login (`GET /auth/me` includes `modules[]`)
- Hide disabled modules from sidebar/nav
- Disabled routes show "Module not enabled" if accessed directly

## 4. Guard Architecture

```
Request
  │
  ├── @Public() → skip all guards
  │
  ├── JwtAuthGuard (global, APP_GUARD)
  │     ├── type: 'user' → req.user = { id, businessId, role, caps, overrides }
  │     └── type: 'platform-admin' → req.user = { id, isSuperAdmin: true }
  │
  ├── SubscriptionGuard (global, APP_GUARD, runs after JWT)
  │     ├── super admin → skip
  │     └── user → check subscriptionEnd >= now
  │
  ├── ModuleGuard (per-route via @RequiresModule)
  │     ├── super admin → skip
  │     └── user → check BusinessModule active
  │
  └── CapabilityGuard (per-route via @RequiresCap, existing)
        ├── super admin → skip (all caps granted)
        └── user → check caps array
```

Guard execution order guaranteed by `APP_GUARD` registration order in `AppModule.providers`.

## 5. Super Admin Panel (web)

### Routes under `/platform-admin/*`

| Route | Page | Description |
|-------|------|-------------|
| `/platform-admin/dashboard` | PADashboardPage | Stats: total businesses, active/expired/pending/suspended counts, recent signups |
| `/platform-admin/businesses` | PABusinessListPage | List all businesses, filter by plan/status, search |
| `/platform-admin/businesses/:id` | PABusinessDetailPage | Edit subscription (set end date), set limits (maxUsers/Products/Warehouses), toggle modules, suspend/activate, view owner |
| `/platform-admin/approvals` | PendingApprovalsPage | Pending business approvals (exists) |

### Super admin API endpoints

All guarded by `PlatformAdminGuard` (checks `type: 'platform-admin'`):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/platform/businesses` | List businesses with stats (exists) |
| `GET` | `/admin/platform/businesses/:id` | Business detail with modules, limits, owner |
| `PATCH` | `/admin/platform/businesses/:id` | Update plan, dates, limits |
| `PATCH` | `/admin/platform/businesses/:id/modules` | Toggle modules on/off |
| `POST` | `/admin/platform/businesses/:id/suspend` | Set status=suspended |
| `POST` | `/admin/platform/businesses/:id/activate` | Set status=active |
| `POST` | `/admin/platform/businesses/:id/approve` | Approve pending (exists) |
| `POST` | `/admin/platform/businesses/:id/reject` | Reject pending (exists) |
| `POST` | `/admin/platform/businesses/:id/extend` | Extend subscription by duration (1mo/3mo/6mo/1yr) |
| `GET` | `/admin/platform/stats` | Dashboard aggregates |

## 6. Web App = Full App

Web already has most pages (products, movements, warehouses, users, expenses, reports, customers, suppliers, POS stub). It should match mobile functionality:

- **POS**: Replace stub with working POS (barcode scan via camera, cart, payment, receipt) — separate task, not in this spec
- **Dashboard**: Already functional
- **All CRUD**: Already working

This spec focuses on auth + subscriptions + admin panel. POS web implementation is a follow-up.

## 7. Security Considerations

- **Email uniqueness across tables**: Registration rejects emails that exist in PlatformAdmin table. Seed rejects emails in User table.
- **JWT type validation**: Guards explicitly check `type` field. A user JWT cannot access platform-admin routes and vice versa.
- **Rate limiting**: Login endpoint rate-limited to 5 attempts per email per 15min (use `@nestjs/throttler`).
- **Super admin bypass**: Super admin bypasses subscription/module/capability guards but NOT authentication. Token must be valid.
- **Audit trail**: All super admin actions logged to Activity table with `userId=null`, `action='pa:approve'` etc.
- **No impersonation tokens**: Super admin views business data via admin API, never by generating a user JWT. Clean separation.

## 8. Migration Plan

1. Add `plan`, `subscriptionStart`, `subscriptionEnd`, `maxUsers`, `maxProducts`, `maxWarehouses` to Business
2. Default existing businesses: `plan=active`, `subscriptionEnd=null` (no expiry = grandfathered)
3. Seed default modules for existing businesses (all active)
4. Modify `/auth/login` to check PlatformAdmin first
5. Update JwtAuthGuard to handle both token types
6. Add SubscriptionGuard + ModuleGuard
7. Build super admin web pages
8. Remove old `/platform-admin/login` endpoint + page
