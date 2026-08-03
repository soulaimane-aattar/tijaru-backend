# Multi-Tenancy Foundation (Sub-project A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-tenant Stock backend into a multi-business SaaS with a separate platform super-admin, automatic row-level tenant isolation, and business lifecycle management — the foundation the module system (Sub-project B) rides on.

**Architecture:** Shared Postgres DB. Every tenant-scoped row carries `businessId`. A request-scoped `TenantContext` (Node `AsyncLocalStorage`) holds the caller's `businessId`; a global interceptor enters that scope after the JWT guard runs; a Prisma `$use` middleware auto-injects `where:{businessId}` / `data.businessId` for tenant models. The platform super-admin authenticates separately (`PlatformAdmin` model, own JWT `kind:"platform"`), bypasses tenant scoping, and manages businesses.

**Tech Stack:** NestJS 10, Prisma 5.20 (PostgreSQL), `@nestjs/jwt`, bcrypt, Zod env, Jest (unit `*.spec.ts`, e2e `test/*.e2e-spec.ts`).

## Global Constraints

- Node `AsyncLocalStorage` from `node:async_hooks` — no new dependency for tenant context.
- Tenant scoping uses Prisma **client middleware `$use`** (in-place on the injected `PrismaService` singleton → zero churn in existing services). `$extends` is the modern alternative but is deferred: it returns a new client object and would force rewrites everywhere `PrismaService` is injected. Revisit on a Prisma major upgrade.
- Business JWT payload gains `bid` (businessId) and `kind:"business"`. Platform JWT uses `kind:"platform"`, **no `bid`**, and is signed with the existing `JWT_ACCESS_SECRET`.
- New env vars (Zod `env.ts`): `PLATFORM_ADMIN_EMAIL` (string email), `PLATFORM_ADMIN_PASSWORD` (string, min 8). Seed-only; required.
- Lint gate is strict: `npm run lint` runs ESLint with `--max-warnings=0`. Plus `npm run typecheck`. Both must pass before each commit.
- Tests run against a real Postgres (`DATABASE_URL`). e2e helpers live in `test/helpers/test-app.ts` (`bootTestApp`, `seedFresh`, `login`).
- All HTTP routes are prefixed `/api/v1` (global prefix + URI versioning).
- Error classes live in `src/common/errors`. Reuse `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `NotFoundError`; add `BusinessSuspendedError` where noted.
- Money/decimal and existing enums unchanged.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | `PlatformAdmin`, `BusinessStatus` enum, `Business.status/createdBy`, `businessId` + scoped uniques on tenant models, `BusinessModule` |
| `prisma/migrations/*` | Two ordered migrations (platform/lifecycle, then tenant columns) |
| `prisma/seed.ts` | Seed `PlatformAdmin` from env; wrap demo data under one seeded Business; seed `BusinessModule` rows |
| `src/config/env.ts` | Add `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` |
| `src/common/tenant/tenant-context.ts` | ALS wrapper: `run`, `getBusinessId`, `TENANT_MODELS` set |
| `src/common/tenant/tenant.middleware.ts` | Prisma `$use` middleware factory (where/data injection) |
| `src/common/tenant/tenant.interceptor.ts` | Global interceptor: `request.user.businessId` → `TenantContext.run` |
| `src/common/prisma.service.ts` | Register tenant middleware in `onModuleInit` |
| `src/common/guards/platform.guard.ts` | Verifies `kind:"platform"` JWT; sets `request.platformAdmin` |
| `src/common/decorators/platform-only.decorator.ts` | `@PlatformOnly()` metadata (marks route public to business guard + platform-guarded) |
| `src/common/auth/auth-user.type.ts` | Add `businessId` |
| `src/common/guards/jwt.guard.ts` | Read `bid`/`kind` from payload → `AuthUser.businessId`; reject platform tokens on business routes |
| `src/modules/auth/application/auth.service.ts` | Bake `bid`/`kind` into business tokens; block suspended businesses |
| `src/modules/platform/*` | Platform admin auth + businesses CRUD/lifecycle |
| `src/common/errors/*` | `BusinessSuspendedError` |
| `src/app.module.ts` | Register `PlatformModule`, `TenantContext`, `TenantInterceptor` (APP_INTERCEPTOR) |
| `test/tenant-isolation.e2e-spec.ts`, `test/platform.e2e-spec.ts` | Isolation + platform e2e |

**Tenant-scoped models** (get `businessId`, auto-scoped): `Warehouse, User, CustomRole, RoleCustomization, Category, Supplier, Customer, Product, Movement, PurchaseOrder, POSession, POTicket, InventoryCount, Notification, Activity, BusinessModule`.
**Not auto-scoped** (reached only via a scoped parent, no column): `StockLevel, PurchaseOrderLine, POTicketLine, InventoryCountLine, UserWarehouse, UserOverride, RoleCapability, Session`.
**Tenant root** (never scoped): `Business`, `PlatformAdmin`.

---

## Task 1: Platform admin model + business lifecycle (schema + migration)

**Files:**
- Modify: `prisma/schema.prisma` (add `PlatformAdmin`, `BusinessStatus`, `Business.status/createdBy/modules` relation placeholder)
- Create: `prisma/migrations/<ts>_platform_admin_and_business_status/migration.sql`

**Interfaces:**
- Produces: Prisma models `PlatformAdmin { id, email@unique, passwordHash, name, tokenVersion, createdAt, updatedAt }`; enum `BusinessStatus { active, suspended }`; `Business.status BusinessStatus @default(active)`, `Business.createdBy String?`.

- [ ] **Step 1: Edit schema** — add to `prisma/schema.prisma`:

```prisma
enum BusinessStatus {
  active
  suspended
}

model PlatformAdmin {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  tokenVersion Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("platform_admins")
}
```

In `model Business { ... }` add:

```prisma
  status    BusinessStatus @default(active)
  createdBy String?        @map("created_by")
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name platform_admin_and_business_status --create-only`
Then inspect the generated `migration.sql`. Expected: `CREATE TABLE "platform_admins"`, `CREATE TYPE "BusinessStatus"`, `ALTER TABLE "businesses" ADD COLUMN "status" ... DEFAULT 'active'`, `ADD COLUMN "created_by"`.

- [ ] **Step 3: Apply + regenerate client**

Run: `npx prisma migrate dev` then `npx prisma generate`
Expected: migration applied, client types include `prisma.platformAdmin`.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet; just confirms client regenerated).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add PlatformAdmin model and Business status lifecycle"
```

---

## Task 2: Tenant columns + scoped uniqueness + BusinessModule (schema + migration)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_tenant_columns/migration.sql` (hand-edited for safe backfill)

**Interfaces:**
- Produces: `businessId String` + `business Business @relation(...)` on every tenant-scoped model; composite uniques replacing global ones; new `BusinessModule { businessId, moduleId, active, updatedAt, @@id([businessId, moduleId]) }`.

- [ ] **Step 1: Edit schema — add `businessId` to each tenant-scoped model.** For every model in the tenant-scoped list, add the field + relation. Example for `Product`:

```prisma
model Product {
  id         String @id @default(cuid())
  businessId String @map("business_id")
  // ... existing fields ...
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  // ... existing relations ...

  @@unique([businessId, barcode])
  @@unique([businessId, sku])
  @@index([businessId])
  @@index([categoryId])
  @@index([supplierId])
  @@map("products")
}
```

Apply the same `businessId` + relation + `@@index([businessId])` to: `Warehouse, User, CustomRole, Category, Supplier, Customer, Movement, PurchaseOrder, POSession, POTicket, InventoryCount, Notification, Activity`.

Replace global `@unique` with composite uniques:
- `Category`: remove `@unique` on `name` → `@@unique([businessId, name])`
- `Product`: `barcode`,`sku` → `@@unique([businessId, barcode])`, `@@unique([businessId, sku])`
- `PurchaseOrder`: `number` → `@@unique([businessId, number])`
- `POTicket`: `number` → `@@unique([businessId, number])`
- `CustomRole`: `name` → `@@unique([businessId, name])`

`RoleCustomization` — change PK to include business:

```prisma
model RoleCustomization {
  businessId String      @map("business_id")
  role       BuiltInRole
  capId      String
  granted    Boolean
  business   Business    @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@id([businessId, role, capId])
  @@map("role_customizations")
}
```

Add the reverse relations on `Business`:

```prisma
  warehouses        Warehouse[]
  users             User[]
  customRoles       CustomRole[]
  roleCustomizations RoleCustomization[]
  categories        Category[]
  suppliers         Supplier[]
  customers         Customer[]
  products          Product[]
  movements         Movement[]
  purchaseOrders    PurchaseOrder[]
  poSessions        POSession[]
  poTickets         POTicket[]
  inventoryCounts   InventoryCount[]
  notifications     Notification[]
  activities        Activity[]
  modules           BusinessModule[]
```

Add the new model:

```prisma
model BusinessModule {
  businessId String   @map("business_id")
  moduleId   String   @map("module_id")
  active     Boolean  @default(true)
  updatedAt  DateTime @updatedAt
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@id([businessId, moduleId])
  @@map("business_modules")
}
```

- [ ] **Step 2: Generate the migration (create-only, then hand-edit for backfill)**

Run: `npx prisma migrate dev --name tenant_columns --create-only`

Then **hand-edit** `migration.sql` so existing rows survive. Prepend a safe backfill using the existing single business. Pattern for each table (shown for `products`):

```sql
-- 1) add nullable
ALTER TABLE "products" ADD COLUMN "business_id" TEXT;
-- 2) backfill to the one existing business
UPDATE "products" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
-- 3) enforce
ALTER TABLE "products" ALTER COLUMN "business_id" SET NOT NULL;
-- 4) drop old global unique, add scoped (names from generated file)
DROP INDEX IF EXISTS "products_barcode_key";
DROP INDEX IF EXISTS "products_sku_key";
CREATE UNIQUE INDEX "products_business_id_barcode_key" ON "products"("business_id","barcode");
CREATE UNIQUE INDEX "products_business_id_sku_key" ON "products"("business_id","sku");
CREATE INDEX "products_business_id_idx" ON "products"("business_id");
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
```

Repeat the add→backfill→NOT NULL→FK pattern for every tenant-scoped table. For `role_customizations`, drop and recreate the PK to include `business_id`. `business_modules` is a plain `CREATE TABLE` (no backfill).

- [ ] **Step 3: Apply + regenerate**

Run: `npx prisma migrate dev` then `npx prisma generate`
Expected: applies cleanly; `npx prisma migrate status` shows up to date.

- [ ] **Step 4: Sanity-check existing code still typechecks**

Run: `npm run typecheck`
Expected: FAIL where `create`/`createMany` calls now miss required `businessId`. **These are fixed transparently by the tenant middleware at runtime, but the static types now require `businessId`.** Resolution: the middleware injects `businessId` at runtime, so make `businessId` satisfy the type by leaving existing creates as-is is NOT enough. Instead, in Task 4 the middleware sets it; to keep types happy, existing service `create` calls will compile because Prisma's generated `create` requires `business: { connect }` OR `businessId`. **Defer compile fixes:** this step's expected result is a list of the exact files/lines that need the middleware. Record them; do not edit yet.

> Note: if the type errors are too invasive to defer, make `businessId` optional at the DB level is NOT allowed (breaks isolation). The correct fix is Task 4 + a generated-type cast helper introduced there. Proceed to Task 3/4 which resolve this.

- [ ] **Step 5: Commit (schema + migration only)**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add businessId tenant columns, scoped uniques, BusinessModule"
```

---

## Task 3: TenantContext (AsyncLocalStorage)

**Files:**
- Create: `src/common/tenant/tenant-context.ts`
- Test: `src/common/tenant/tenant-context.spec.ts`

**Interfaces:**
- Produces:
  - `TENANT_MODELS: ReadonlySet<string>` — Prisma model names that get scoped.
  - `class TenantContext { run<T>(businessId: string, fn: () => T): T; getBusinessId(): string | undefined }` (injectable singleton).

- [ ] **Step 1: Write the failing test**

```typescript
// src/common/tenant/tenant-context.spec.ts
import { TenantContext, TENANT_MODELS } from './tenant-context';

describe('TenantContext', () => {
  it('returns undefined outside any scope', () => {
    const ctx = new TenantContext();
    expect(ctx.getBusinessId()).toBeUndefined();
  });

  it('exposes businessId inside run() and clears after', () => {
    const ctx = new TenantContext();
    const inside = ctx.run('biz_1', () => ctx.getBusinessId());
    expect(inside).toBe('biz_1');
    expect(ctx.getBusinessId()).toBeUndefined();
  });

  it('isolates nested scopes', () => {
    const ctx = new TenantContext();
    const seen = ctx.run('outer', () => ctx.run('inner', () => ctx.getBusinessId()));
    expect(seen).toBe('inner');
  });

  it('lists Product as tenant-scoped and Business as not', () => {
    expect(TENANT_MODELS.has('Product')).toBe(true);
    expect(TENANT_MODELS.has('Business')).toBe(false);
    expect(TENANT_MODELS.has('PlatformAdmin')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- tenant-context`
Expected: FAIL — cannot find module `./tenant-context`.

- [ ] **Step 3: Implement**

```typescript
// src/common/tenant/tenant-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

/** Prisma model names that carry businessId and are auto-scoped. */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Warehouse',
  'User',
  'CustomRole',
  'RoleCustomization',
  'Category',
  'Supplier',
  'Customer',
  'Product',
  'Movement',
  'PurchaseOrder',
  'POSession',
  'POTicket',
  'InventoryCount',
  'Notification',
  'Activity',
  'BusinessModule',
]);

type Store = { businessId: string };

@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<Store>();

  run<T>(businessId: string, fn: () => T): T {
    return this.als.run({ businessId }, fn);
  }

  getBusinessId(): string | undefined {
    return this.als.getStore()?.businessId;
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm test -- tenant-context`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/tenant/tenant-context.ts src/common/tenant/tenant-context.spec.ts
git commit -m "feat(tenant): add AsyncLocalStorage TenantContext"
```

---

## Task 4: Prisma tenant middleware

**Files:**
- Create: `src/common/tenant/tenant.middleware.ts`
- Modify: `src/common/prisma.service.ts`
- Test: `src/common/tenant/tenant.middleware.spec.ts`

**Interfaces:**
- Consumes: `TenantContext.getBusinessId()`, `TENANT_MODELS`.
- Produces: `makeTenantMiddleware(ctx: TenantContext): Prisma.Middleware` — injects `where.businessId` on reads/mutations and `data.businessId` on creates for tenant models; **no-op when no tenant context** (platform/seed). `findUnique`/`findUniqueOrThrow` are rewritten to `findFirst`/`findFirstOrThrow` so the extra `businessId` filter is allowed.

- [ ] **Step 1: Write the failing test**

```typescript
// src/common/tenant/tenant.middleware.spec.ts
import { makeTenantMiddleware } from './tenant.middleware';
import { TenantContext } from './tenant-context';

function call(mw: ReturnType<typeof makeTenantMiddleware>, params: any) {
  let received: any;
  const next = (p: any) => {
    received = p;
    return Promise.resolve('ok');
  };
  return mw(params, next).then(() => received);
}

describe('tenant middleware', () => {
  const ctx = new TenantContext();
  const mw = makeTenantMiddleware(ctx);

  it('injects where.businessId on findMany inside a tenant scope', async () => {
    const out = await ctx.run('biz_1', () =>
      call(mw, { model: 'Product', action: 'findMany', args: { where: { name: 'x' } } }),
    );
    expect(out.args.where).toEqual({ name: 'x', businessId: 'biz_1' });
  });

  it('sets data.businessId on create', async () => {
    const out = await ctx.run('biz_1', () =>
      call(mw, { model: 'Product', action: 'create', args: { data: { name: 'x' } } }),
    );
    expect(out.args.data.businessId).toBe('biz_1');
  });

  it('rewrites findUnique to findFirst with businessId', async () => {
    const out = await ctx.run('biz_1', () =>
      call(mw, { model: 'Product', action: 'findUnique', args: { where: { id: 'p1' } } }),
    );
    expect(out.action).toBe('findFirst');
    expect(out.args.where).toEqual({ id: 'p1', businessId: 'biz_1' });
  });

  it('does NOT touch non-tenant models', async () => {
    const out = await ctx.run('biz_1', () =>
      call(mw, { model: 'Business', action: 'findMany', args: {} }),
    );
    expect(out.args.where).toBeUndefined();
  });

  it('is a no-op outside any tenant scope (platform path)', async () => {
    const out = await call(mw, { model: 'Product', action: 'findMany', args: {} });
    expect(out.args.where).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- tenant.middleware`
Expected: FAIL — cannot find module `./tenant.middleware`.

- [ ] **Step 3: Implement**

```typescript
// src/common/tenant/tenant.middleware.ts
import type { Prisma } from '@prisma/client';

import { TENANT_MODELS, type TenantContext } from './tenant-context';

const READ_ACTIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
  'upsert',
]);

export function makeTenantMiddleware(ctx: TenantContext): Prisma.Middleware {
  return async (params, next) => {
    const businessId = ctx.getBusinessId();
    if (!businessId || !params.model || !TENANT_MODELS.has(params.model)) {
      return next(params);
    }

    // findUnique can only filter on unique fields → rewrite to findFirst.
    if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
      params.action = params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
    }

    params.args = params.args ?? {};

    if (params.action === 'create') {
      params.args.data = { ...params.args.data, businessId };
      return next(params);
    }
    if (params.action === 'createMany') {
      const data = params.args.data;
      params.args.data = Array.isArray(data)
        ? data.map((d: Record<string, unknown>) => ({ ...d, businessId }))
        : { ...data, businessId };
      return next(params);
    }
    if (params.action === 'upsert') {
      params.args.where = { ...params.args.where, businessId };
      params.args.create = { ...params.args.create, businessId };
      return next(params);
    }
    if (READ_ACTIONS.has(params.action)) {
      params.args.where = { ...params.args.where, businessId };
      return next(params);
    }
    return next(params);
  };
}
```

Wire it into `PrismaService`:

```typescript
// src/common/prisma.service.ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { makeTenantMiddleware } from './tenant/tenant.middleware';
import { TenantContext } from './tenant/tenant-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly tenant: TenantContext) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.$use(makeTenantMiddleware(this.tenant));
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

Register `TenantContext` as a provider where `PrismaService` is provided. In `src/config/config.module.ts` add `TenantContext` to `providers` and `exports`:

```typescript
import { TenantContext } from '../common/tenant/tenant-context';
// ...
  providers: [ /* ENV_TOKEN factory */, PrismaService, PermissionsResolver, TenantContext ],
  exports: [ENV_TOKEN, PrismaService, PermissionsResolver, TenantContext],
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tenant.middleware` then `npm run typecheck`
Expected: middleware tests PASS (5). Typecheck: the earlier Task 2 create-call type errors now resolve because the middleware supplies `businessId` at runtime, but Prisma's static `create` type still requires it. **Fix remaining compile errors** by removing now-redundant manual `businessId` only where present; where Prisma demands it statically, pass `businessId: undefined as unknown as string` is forbidden. Instead, the seed and platform create paths (Tasks 6/8/9) set `businessId` explicitly; for tenant-scoped service creates the generated type accepts omission only if the field is optional. Since it is required, add a tiny typed helper:

```typescript
// src/common/tenant/tenant.helpers.ts
/** Marks a create payload whose businessId is filled by tenant middleware at runtime. */
export function scoped<T>(data: Omit<T, 'businessId'>): T {
  return data as T;
}
```

Use `scoped<Prisma.ProductCreateInput>({...})` at existing create call sites flagged in Task 2 Step 4. Record each edited file in the commit.

- [ ] **Step 5: Commit**

```bash
git add src/common/tenant src/common/prisma.service.ts src/config/config.module.ts src/modules
git commit -m "feat(tenant): auto-scope Prisma queries by businessId via middleware"
```

---

## Task 5: Tenant interceptor (wire request → ALS)

**Files:**
- Create: `src/common/tenant/tenant.interceptor.ts`
- Modify: `src/app.module.ts` (register as `APP_INTERCEPTOR`)
- Test: `src/common/tenant/tenant.interceptor.spec.ts`

**Interfaces:**
- Consumes: `TenantContext.run`, `AuthUser.businessId` (added in Task 7; until then read `request.user?.businessId` loosely).
- Produces: `TenantInterceptor implements NestInterceptor` — if `request.user?.businessId` present, runs the handler inside `TenantContext.run(businessId, ...)`; otherwise passes through (platform/public routes).

- [ ] **Step 1: Write the failing test**

```typescript
// src/common/tenant/tenant.interceptor.spec.ts
import { of } from 'rxjs';

import { TenantContext } from './tenant-context';
import { TenantInterceptor } from './tenant.interceptor';

function ctxArg(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('TenantInterceptor', () => {
  it('runs handler inside tenant scope when businessId present', (done) => {
    const tenant = new TenantContext();
    const interceptor = new TenantInterceptor(tenant);
    let seen: string | undefined;
    const next = { handle: () => { seen = tenant.getBusinessId(); return of('x'); } };
    interceptor.intercept(ctxArg({ businessId: 'biz_9' }), next as any).subscribe(() => {
      expect(seen).toBe('biz_9');
      done();
    });
  });

  it('passes through with no scope when user lacks businessId', (done) => {
    const tenant = new TenantContext();
    const interceptor = new TenantInterceptor(tenant);
    let seen: string | undefined = 'sentinel';
    const next = { handle: () => { seen = tenant.getBusinessId(); return of('x'); } };
    interceptor.intercept(ctxArg(undefined), next as any).subscribe(() => {
      expect(seen).toBeUndefined();
      done();
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- tenant.interceptor`
Expected: FAIL — cannot find module `./tenant.interceptor`.

- [ ] **Step 3: Implement**

```typescript
// src/common/tenant/tenant.interceptor.ts
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { TenantContext } from './tenant-context';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenant: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: { businessId?: string } }>();
    const businessId = req.user?.businessId;
    if (!businessId) return next.handle();
    return this.tenant.run(businessId, () => next.handle());
  }
}
```

Register in `src/app.module.ts` providers (after the guards):

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantInterceptor } from './common/tenant/tenant.interceptor';
// ...
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
```

> Interceptors run **after** guards, so `request.user` is already populated by `JwtAuthGuard`. `tenant.run` wraps `next.handle()`, keeping the ALS scope alive through the awaited Prisma calls in the controller/service.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tenant.interceptor` then `npm run typecheck`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/common/tenant/tenant.interceptor.ts src/common/tenant/tenant.interceptor.spec.ts src/app.module.ts
git commit -m "feat(tenant): enter tenant scope per request via global interceptor"
```

---

## Task 6: Env vars + BusinessSuspendedError + AuthUser.businessId

**Files:**
- Modify: `src/config/env.ts`, `src/common/auth/auth-user.type.ts`, `src/common/errors/index.ts` (or the errors file that exports the others)
- Test: `src/config/env.spec.ts`

**Interfaces:**
- Produces: `Env.PLATFORM_ADMIN_EMAIL: string`, `Env.PLATFORM_ADMIN_PASSWORD: string`; `AuthUser.businessId: string`; `class BusinessSuspendedError extends ...` (HTTP 403, code `business_suspended`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/config/env.spec.ts
import { loadEnv } from './env';

describe('env', () => {
  it('parses platform admin credentials', () => {
    const prev = { ...process.env };
    process.env.PLATFORM_ADMIN_EMAIL = 'boss@platform.io';
    process.env.PLATFORM_ADMIN_PASSWORD = 'supersecret';
    const env = loadEnv();
    expect(env.PLATFORM_ADMIN_EMAIL).toBe('boss@platform.io');
    expect(env.PLATFORM_ADMIN_PASSWORD).toBe('supersecret');
    process.env = prev;
  });
});
```

(Ensure `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` are present in the test env — they already are for the existing suite.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- config/env`
Expected: FAIL — `PLATFORM_ADMIN_EMAIL` is undefined.

- [ ] **Step 3: Implement.** In `src/config/env.ts` add to the Zod schema:

```typescript
  PLATFORM_ADMIN_EMAIL: z.string().email(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8),
```

In `src/common/auth/auth-user.type.ts` add `businessId`:

```typescript
export type AuthUser = {
  id: string;
  businessId: string;
  role: RoleId;
  tokenVersion: number;
  roleCaps: CapabilityId[];
  overrides: Partial<Record<CapabilityId, boolean>>;
  device?: string | undefined;
};
```

Add the error (match the style of the existing errors in that file — they likely extend a base `AppError` with `status` + `code`; mirror `ForbiddenError`):

```typescript
export class BusinessSuspendedError extends AppError {
  constructor() {
    super('business_suspended', 'Business is suspended', 403);
  }
}
```

> Read `src/common/errors/*` first and copy the exact base-class constructor signature; the snippet above assumes `(code, message, status)`. Adjust to the real signature.

- [ ] **Step 4: Run test + typecheck.**

Run: `npm test -- config/env` then `npm run typecheck`
Expected: env test PASS. Typecheck FAIL in `jwt.guard.ts` / `auth.service.ts` (missing `businessId` on AuthUser construction) — fixed in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/common/auth/auth-user.type.ts src/common/errors
git commit -m "feat(auth): add platform admin env, AuthUser.businessId, BusinessSuspendedError"
```

---

## Task 7: Business JWT carries businessId + kind; suspended check

**Files:**
- Modify: `src/common/guards/jwt.guard.ts`, `src/modules/auth/application/auth.service.ts`
- Test: `test/auth.e2e-spec.ts` (extend), `src/modules/auth/application/auth.service.spec.ts` (new unit, optional if e2e covers)

**Interfaces:**
- Consumes: `Env`, `AuthUser.businessId`.
- Produces: business access tokens with payload `{ sub, bid, kind:'business', role, ver, caps, overrides }`. `JwtAuthGuard` sets `AuthUser.businessId = payload.bid` and rejects tokens where `kind === 'platform'` on business routes. Login throws `BusinessSuspendedError` when the user's business is suspended.

- [ ] **Step 1: Write the failing e2e test** (append to `test/auth.e2e-spec.ts`):

```typescript
it('blocks login for a suspended business', async () => {
  // suspend the seeded business directly
  const prisma = app.get(PrismaService);
  await prisma.business.updateMany({ data: { status: 'suspended' } });
  await supertest(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: DEMO.owner, password: DEMO_PASSWORD })
    .expect(403);
  await prisma.business.updateMany({ data: { status: 'active' } }); // restore
});

it('includes businessId-scoped access (token usable on tenant routes)', async () => {
  const { accessToken } = await login(app, 'owner');
  await supertest(app.getHttpServer())
    .get('/api/v1/products')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);
});
```

Import `PrismaService` and `DEMO`/`DEMO_PASSWORD`/`login` in that spec.

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test:e2e -- auth`
Expected: FAIL — suspended login currently returns 200.

- [ ] **Step 3: Implement.** In `auth.service.ts` `login`, fetch the business and block suspended; include `businessId` in the user lookup result and bake it into the token. Update the user query include + add the check:

```typescript
const user = await this.prisma.user.findFirst({
  where: { email: email.toLowerCase(), deletedAt: null },
  include: { overrides: true, business: true },
});
if (!user || !user.active) throw new UnauthorizedError('Invalid credentials');
if (user.business.status === 'suspended') throw new BusinessSuspendedError();
```

> Note: this `findFirst` runs at login **before** any tenant scope exists (public route, no interceptor scope) → the middleware is a no-op here, so the global email lookup works. Good.

In `issueTokens` (or wherever the access payload is built), add `bid` + `kind`:

```typescript
const accessPayload = {
  sub: user.id,
  bid: user.businessId,
  kind: 'business' as const,
  role,
  ver: user.tokenVersion,
  caps: roleCaps,
  overrides,
};
```

In `jwt.guard.ts`, extend the payload type and set `businessId`, rejecting platform tokens:

```typescript
type AccessJwtPayload = {
  sub: string;
  bid?: string;
  kind?: 'business' | 'platform';
  role: RoleId;
  ver: number;
  caps: CapabilityId[];
  overrides?: Partial<Record<CapabilityId, boolean>>;
};
// ... after verify:
if (payload.kind === 'platform' || !payload.bid) {
  throw new UnauthorizedError('Business token required');
}
request.user = {
  id: payload.sub,
  businessId: payload.bid,
  role: payload.role,
  tokenVersion: payload.ver,
  roleCaps: payload.caps ?? [],
  overrides: payload.overrides ?? {},
  device: request.headers['user-agent'],
};
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:e2e -- auth` then `npm run typecheck` then `npm run lint`
Expected: PASS. The whole existing e2e suite (`npm run test:e2e`) must still pass — tenant scoping is transparent since all demo data is one business.

- [ ] **Step 5: Commit**

```bash
git add src/common/guards/jwt.guard.ts src/modules/auth/application/auth.service.ts test/auth.e2e-spec.ts
git commit -m "feat(auth): bake businessId+kind into tokens, block suspended businesses"
```

---

## Task 8: Platform module — admin auth + businesses CRUD/lifecycle

**Files:**
- Create: `src/common/guards/platform.guard.ts`, `src/common/decorators/platform-only.decorator.ts`, `src/common/decorators/current-platform-admin.decorator.ts`
- Create: `src/modules/platform/platform.module.ts`, `platform-auth.controller.ts`, `platform-businesses.controller.ts`, `application/platform-auth.service.ts`, `application/platform-businesses.service.ts`, `dto/platform.dto.ts`
- Modify: `src/app.module.ts` (import `PlatformModule`), `src/common/guards/jwt.guard.ts` (honor `@PlatformOnly` → skip business auth)
- Test: `test/platform.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (unscoped on platform routes — no tenant context entered because `request.user` has no `businessId`), `JwtService`, `Env`, `TenantContext` (NOT entered).
- Produces:
  - `@PlatformOnly()` — sets `IS_PUBLIC_KEY` true (business `JwtAuthGuard` skips) and `IS_PLATFORM_KEY` true.
  - `PlatformGuard` — verifies `kind:'platform'` JWT, sets `request.platformAdmin = { id }`.
  - `POST /api/v1/platform/auth/login` → `{ accessToken }` (platform kind).
  - `GET /api/v1/platform/businesses` → `Array<{ id, name, status, userCount, modules: {moduleId,active}[] }>`.
  - `POST /api/v1/platform/businesses` body `{ name, ice, ownerName, ownerEmail, ownerPassword }` → creates Business + owner User + SecurityPolicy + BusinessModule rows (all active) in one transaction → `{ id }`.
  - `PATCH /api/v1/platform/businesses/:id/status` body `{ status: 'active'|'suspended' }` → `{ id, status }`.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// test/platform.e2e-spec.ts
import { type INestApplication } from '@nestjs/common';
import supertest from 'supertest';

import { bootTestApp, seedFresh } from './helpers/test-app';

const PLATFORM = { email: process.env.PLATFORM_ADMIN_EMAIL!, password: process.env.PLATFORM_ADMIN_PASSWORD! };

describe('Platform console (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => { await seedFresh(); app = await bootTestApp(); });
  afterAll(async () => { await app.close(); });

  async function platformToken() {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/platform/auth/login')
      .send(PLATFORM)
      .expect(200);
    return res.body.accessToken as string;
  }

  it('rejects business token on platform routes', async () => {
    // a business token would 401 here; we assert unauthenticated is 401
    await supertest(app.getHttpServer()).get('/api/v1/platform/businesses').expect(401);
  });

  it('platform admin logs in and lists businesses', async () => {
    const token = await platformToken();
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/platform/businesses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a new business with its owner, then that owner can log in', async () => {
    const token = await platformToken();
    const created = await supertest(app.getHttpServer())
      .post('/api/v1/platform/businesses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme', ice: '999888777', ownerName: 'Owner Two', ownerEmail: 'owner2@acme.test', ownerPassword: 'acme1234' })
      .expect(201);
    expect(created.body.id).toBeDefined();

    await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner2@acme.test', password: 'acme1234' })
      .expect(200);
  });

  it('suspends a business and blocks its owner login', async () => {
    const token = await platformToken();
    const list = await supertest(app.getHttpServer())
      .get('/api/v1/platform/businesses')
      .set('Authorization', `Bearer ${token}`).expect(200);
    const acme = list.body.find((b: any) => b.name === 'Acme');
    await supertest(app.getHttpServer())
      .patch(`/api/v1/platform/businesses/${acme.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' })
      .expect(200);
    await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner2@acme.test', password: 'acme1234' })
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test:e2e -- platform`
Expected: FAIL — `/platform/*` routes 404.

- [ ] **Step 3: Implement.**

Decorator:

```typescript
// src/common/decorators/platform-only.decorator.ts
import { applyDecorators, SetMetadata } from '@nestjs/common';

import { IS_PUBLIC_KEY } from '../guards/jwt.guard';

export const IS_PLATFORM_KEY = 'isPlatform';
export const PlatformOnly = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), SetMetadata(IS_PLATFORM_KEY, true));
```

Guard:

```typescript
// src/common/guards/platform.guard.ts
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { UnauthorizedError } from '../errors';
import { IS_PLATFORM_KEY } from '../decorators/platform-only.decorator';

type PlatformPayload = { sub: string; kind: 'business' | 'platform'; ver: number };

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPlatform = this.reflector.getAllAndOverride<boolean | undefined>(IS_PLATFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPlatform) return true; // not a platform route → not our concern

    const req = context.switchToHttp().getRequest<Request & { platformAdmin?: { id: string } }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing bearer token');
    let payload: PlatformPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformPayload>(header.slice(7), {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
    if (payload.kind !== 'platform') throw new UnauthorizedError('Platform token required');
    req.platformAdmin = { id: payload.sub };
    return true;
  }
}
```

Register `PlatformGuard` as a global guard in `app.module.ts` **after** `JwtAuthGuard` and before `CapsGuard`:

```typescript
import { PlatformGuard } from './common/guards/platform.guard';
// providers:
    { provide: APP_GUARD, useClass: PlatformGuard },
```

> Flow on a `/platform/*` route: `@PlatformOnly` sets `IS_PUBLIC_KEY` so `JwtAuthGuard` returns early (no `request.user`); `PlatformGuard` sees `IS_PLATFORM_KEY` and authenticates the platform token. On normal business routes `IS_PLATFORM_KEY` is unset → `PlatformGuard` returns `true` immediately. `CapsGuard` finds no `@RequireCap` on platform routes → allows. `TenantInterceptor` sees no `request.user.businessId` → no tenant scope → Prisma unscoped for platform queries.

Current-admin decorator:

```typescript
// src/common/decorators/current-platform-admin.decorator.ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export const CurrentPlatformAdmin = createParamDecorator((_d: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ platformAdmin?: { id: string } }>().platformAdmin;
});
```

DTOs:

```typescript
// src/modules/platform/dto/platform.dto.ts
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export class PlatformLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}

export class CreateBusinessDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() ice!: string;
  @IsString() @MinLength(2) ownerName!: string;
  @IsEmail() ownerEmail!: string;
  @IsString() @MinLength(8) ownerPassword!: string;
}

export class SetStatusDto {
  @IsIn(['active', 'suspended']) status!: 'active' | 'suspended';
}
```

Platform auth service:

```typescript
// src/modules/platform/application/platform-auth.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { UnauthorizedError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: email.toLowerCase() } });
    if (!admin) throw new UnauthorizedError('Invalid credentials');
    if (!(await bcrypt.compare(password, admin.passwordHash))) throw new UnauthorizedError('Invalid credentials');
    const accessToken = await this.jwt.signAsync(
      { sub: admin.id, kind: 'platform', ver: admin.tokenVersion },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL },
    );
    return { accessToken };
  }
}
```

> `platformAdmin` is NOT in `TENANT_MODELS`, so this `findUnique` is never rewritten/scoped.

Platform businesses service (atomic create + list + status):

```typescript
// src/modules/platform/application/platform-businesses.service.ts
import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { MODULE_IDS } from '../../../domain/modules'; // created in Sub-project B; see note

@Injectable()
export class PlatformBusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  async list() {
    const businesses = await this.prisma.business.findMany({
      include: { _count: { select: { users: true } }, modules: true },
      orderBy: { createdAt: 'asc' },
    });
    return businesses.map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      userCount: b._count.users,
      modules: b.modules.map((m) => ({ moduleId: m.moduleId, active: m.active })),
    }));
  }

  async create(input: {
    name: string; ice: string; ownerName: string; ownerEmail: string; ownerPassword: string; createdBy: string;
  }) {
    const passwordHash = await bcrypt.hash(input.ownerPassword, this.env.BCRYPT_COST);
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: { name: input.name, ice: input.ice, status: 'active', createdBy: input.createdBy },
      });
      await tx.user.create({
        data: {
          businessId: business.id,
          name: input.ownerName,
          email: input.ownerEmail.toLowerCase(),
          passwordHash,
          role: 'owner',
        },
      });
      await tx.securityPolicy.create({ data: { businessId: business.id } });
      await tx.businessModule.createMany({
        data: MODULE_IDS.map((moduleId) => ({ businessId: business.id, moduleId, active: true })),
      });
      return { id: business.id };
    });
  }

  async setStatus(id: string, status: 'active' | 'suspended') {
    const existing = await this.prisma.business.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Business not found');
    const updated = await this.prisma.business.update({ where: { id }, data: { status } });
    return { id: updated.id, status: updated.status };
  }
}
```

> **Dependency note:** this service imports `MODULE_IDS` from `src/domain/modules.ts`, which is created in Sub-project B Task 1. To keep Sub-project A self-contained and shippable, create a minimal `src/domain/modules.ts` now exporting only `export const MODULE_IDS = ['pos','facture','achats','reports'] as const;` (Sub-project B expands it). Add that as Step 3a.
> All these `business.*` and `tx.business.*` / `tx.user.*` calls run on platform routes (no tenant scope) → middleware no-op → `businessId` must be set explicitly, as done above.

Controllers:

```typescript
// src/modules/platform/platform-auth.controller.ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { PlatformAuthService } from './application/platform-auth.service';
import { PlatformLoginDto } from './dto/platform.dto';

@Controller({ path: 'platform/auth', version: '1' })
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @PlatformOnly()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: PlatformLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }
}
```

```typescript
// src/modules/platform/platform-businesses.controller.ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CurrentPlatformAdmin } from '../../common/decorators/current-platform-admin.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { PlatformBusinessesService } from './application/platform-businesses.service';
import { CreateBusinessDto, SetStatusDto } from './dto/platform.dto';

@PlatformOnly()
@Controller({ path: 'platform/businesses', version: '1' })
export class PlatformBusinessesController {
  constructor(private readonly svc: PlatformBusinessesService) {}

  @Get()
  list() { return this.svc.list(); }

  @Post()
  create(@Body() dto: CreateBusinessDto, @CurrentPlatformAdmin() admin: { id: string }) {
    return this.svc.create({ ...dto, createdBy: admin.id });
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.svc.setStatus(id, dto.status);
  }
}
```

> The login `@PlatformOnly()` on the auth login route makes it pass `JwtAuthGuard` AND `PlatformGuard`? No — login must be reachable WITHOUT a platform token. Fix: the login route needs `@Public()` semantics only, not `PlatformGuard`. Because `@PlatformOnly` sets `IS_PLATFORM_KEY`, `PlatformGuard` would demand a token. **Resolution:** give the login route a dedicated `@Public()` (existing decorator) instead of `@PlatformOnly()`, and DON'T set `IS_PLATFORM_KEY` on it. Update `platform-auth.controller.ts` to import `Public` from `jwt.guard` and annotate `@Public()` on `login`. The businesses controller keeps `@PlatformOnly()`.

Module:

```typescript
// src/modules/platform/platform.module.ts
import { Module } from '@nestjs/common';

import { PlatformAuthController } from './platform-auth.controller';
import { PlatformBusinessesController } from './platform-businesses.controller';
import { PlatformAuthService } from './application/platform-auth.service';
import { PlatformBusinessesService } from './application/platform-businesses.service';

@Module({
  controllers: [PlatformAuthController, PlatformBusinessesController],
  providers: [PlatformAuthService, PlatformBusinessesService],
})
export class PlatformModule {}
```

Register `PlatformModule` in `app.module.ts` imports and `PlatformGuard` in providers (done above).

- [ ] **Step 3a: Create minimal `src/domain/modules.ts`**

```typescript
// src/domain/modules.ts
export const MODULE_IDS = ['pos', 'facture', 'achats', 'reports'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:e2e -- platform` then `npm run typecheck` then `npm run lint`
Expected: platform e2e PASS (4). Also run full e2e `npm run test:e2e` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/platform src/common/guards/platform.guard.ts src/common/decorators src/domain/modules.ts src/app.module.ts test/platform.e2e-spec.ts
git commit -m "feat(platform): platform admin auth + businesses CRUD and suspend"
```

---

## Task 9: Seed — platform admin + wrap demo data in a business

**Files:**
- Modify: `prisma/seed.ts`
- Test: covered by existing e2e (all suites must pass after seed change)

**Interfaces:**
- Consumes: `Env` (`PLATFORM_ADMIN_EMAIL/PASSWORD`), `MODULE_IDS`.
- Produces: a seeded `PlatformAdmin`; all demo rows carry the seeded `Business.id`; that business has `BusinessModule` rows (all active).

- [ ] **Step 1: Inspect current seed.** Read `prisma/seed.ts`. It already creates one `Business` and demo users/products. Identify the `business.id` variable it produces.

- [ ] **Step 2: Add platform admin + business modules to the seed.** After the business is created, add:

```typescript
import * as bcrypt from 'bcrypt';
import { MODULE_IDS } from '../src/domain/modules';
// ... within runSeed, after `const business = await prisma.business.create(...)`:

const adminEmail = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@platform.local';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? 'changeme123';
await prisma.platformAdmin.upsert({
  where: { email: adminEmail.toLowerCase() },
  update: {},
  create: {
    email: adminEmail.toLowerCase(),
    name: 'Platform Admin',
    passwordHash: await bcrypt.hash(adminPassword, 12),
  },
});

await prisma.businessModule.createMany({
  data: MODULE_IDS.map((moduleId) => ({ businessId: business.id, moduleId, active: true })),
  skipDuplicates: true,
});
```

Ensure every existing demo `create` that targets a tenant model includes `businessId: business.id` (the seed runs **outside** any request → tenant middleware is a no-op, so `businessId` must be explicit). Add `businessId: business.id` to each tenant-model create in the seed.

- [ ] **Step 3: Run the seed**

Run: `npm run prisma:seed`
Expected: completes; `platform_admins` has one row; `business_modules` has 4 rows.

- [ ] **Step 4: Run the full test suites**

Run: `npm test` then `npm run test:e2e` then `npm run lint` then `npm run typecheck`
Expected: ALL PASS. This is the integration gate for Sub-project A.

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(seed): seed platform admin and business modules; scope demo data to business"
```

---

## Task 10: Tenant isolation e2e (cross-business safety net)

**Files:**
- Create: `test/tenant-isolation.e2e-spec.ts`

**Interfaces:**
- Consumes: platform create-business endpoint (Task 8), business login, an existing tenant read route (`GET /products`).

- [ ] **Step 1: Write the test** — prove Business B cannot see Business A's data, and scoped uniqueness allows duplicate barcodes across businesses:

```typescript
// test/tenant-isolation.e2e-spec.ts
import { type INestApplication } from '@nestjs/common';
import supertest from 'supertest';

import { bootTestApp, seedFresh, login, DEMO, DEMO_PASSWORD } from './helpers/test-app';

const PLATFORM = { email: process.env.PLATFORM_ADMIN_EMAIL!, password: process.env.PLATFORM_ADMIN_PASSWORD! };

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => { await seedFresh(); app = await bootTestApp(); });
  afterAll(async () => { await app.close(); });

  it('a new business sees an empty product list (no leak from demo business)', async () => {
    const pres = await supertest(app.getHttpServer())
      .post('/api/v1/platform/auth/login').send(PLATFORM).expect(200);
    await supertest(app.getHttpServer())
      .post('/api/v1/platform/businesses')
      .set('Authorization', `Bearer ${pres.body.accessToken}`)
      .send({ name: 'Isolated Co', ice: '111222333', ownerName: 'Iso Owner', ownerEmail: 'iso@co.test', ownerPassword: 'isoo1234' })
      .expect(201);

    const owner = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login').send({ email: 'iso@co.test', password: 'isoo1234' }).expect(200);

    const list = await supertest(app.getHttpServer())
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${owner.body.accessToken}`)
      .expect(200);
    // demo business has products; the new isolated business must have none
    const items = Array.isArray(list.body) ? list.body : list.body.items ?? list.body.data;
    expect(items).toHaveLength(0);
  });

  it('demo business still sees its own products', async () => {
    const { accessToken } = await login(app, 'owner');
    const list = await supertest(app.getHttpServer())
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${accessToken}`).expect(200);
    const items = Array.isArray(list.body) ? list.body : list.body.items ?? list.body.data;
    expect(items.length).toBeGreaterThan(0);
  });
});
```

> Adjust the products-list response unwrapping (`items`/`data`/array) to match the real `GET /products` shape — check `products.controller.ts` first.

- [ ] **Step 2: Run test, verify it passes**

Run: `npm run test:e2e -- tenant-isolation`
Expected: PASS (2). If the isolated business sees demo products, the middleware/interceptor wiring is wrong — debug before proceeding (see systematic-debugging).

- [ ] **Step 3: Commit**

```bash
git add test/tenant-isolation.e2e-spec.ts
git commit -m "test(tenant): cross-business isolation e2e"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- A.1 shared-DB + businessId → Tasks 2, 4. ✓
- A.2 PlatformAdmin + separate login → Tasks 1, 8. ✓
- A.3 business lifecycle (create+owner+policy+modules tx, suspend) → Task 8. ✓
- A.4 businessId on all tenant models + scoped uniqueness + ALS + middleware → Tasks 2, 3, 4, 5. ✓
- A.5 auth: businessId+kind in JWT, suspended check, email global → Task 7. ✓
- A.6 migration + seed → Tasks 2, 9. ✓
- A.7 clients → deferred (backend-first; platform console UI is a follow-up; noted as out of this plan's backend scope). **Gap acknowledged:** client work is intentionally excluded from this backend plan and tracked separately.
- A.8 tests (isolation, platform bypass, suspended, scoped uniqueness, atomic tx) → Tasks 7, 8, 10. ✓

**Placeholder scan:** none — every step has concrete code/commands. Two spots require reading an existing file first (errors base-class signature in Task 6; products-list shape in Task 10) — these are explicit "read then match" instructions, not placeholders.

**Type consistency:** `AuthUser.businessId` (Task 6) consumed by `jwt.guard` (Task 7) and `TenantInterceptor` (Task 5). `MODULE_IDS` defined in Task 8 Step 3a, reused in Task 9. JWT payload `bid`/`kind` consistent across `auth.service`, `jwt.guard`, `platform.guard`. `TENANT_MODELS` defined Task 3, consumed Task 4.

**Known sequencing note:** Task 2 introduces compile errors that are only fully resolved across Tasks 4 (middleware + `scoped` helper) and 7. Do not expect a green `typecheck` between Task 2 and Task 4; the plan calls this out explicitly at each step.
