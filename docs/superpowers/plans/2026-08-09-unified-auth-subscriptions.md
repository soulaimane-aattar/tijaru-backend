# Unified Auth, Subscriptions & Super Admin Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify login for business users and platform super admin, add subscription + module management, and build super admin web panel — while making the web app a full-featured app matching mobile.

**Architecture:** Single `/auth/login` endpoint checks PlatformAdmin table first, then User table. JWT carries `type: 'platform-admin' | 'user'`. Global SubscriptionGuard blocks expired businesses. Per-route ModuleGuard gates features. Super admin bypasses all non-auth guards.

**Tech Stack:** NestJS + Prisma (backend at `backend/`), React + Vite + Zustand (web at `web/`)

## Global Constraints

- Backend port: 3002 (dev), 3000 (prod container)
- Postgres port: 5433 (dev — `.env DATABASE_URL` may point at wrong project DB, always override)
- Web port: 5174 (Vite dev)
- Zod for DTO validation (not class-validator)
- Guards registered via `APP_GUARD` in `app.module.ts`, order matters
- All controller routes use `@Controller({ version: '1' })` → prefix `/api/v1/`
- Existing tests use Jest + supertest in `test/*.e2e-spec.ts`
- Unit tests colocated: `*.spec.ts` next to source

---

### Task 1: Prisma Schema — Add subscription fields to Business

**Files:**
- Modify: `backend/prisma/schema.prisma` (Business model, add SubscriptionPlan enum)
- Create: `backend/prisma/migrations/<auto>/migration.sql` (generated)

**Interfaces:**
- Produces: `SubscriptionPlan` enum (`trial | active | expired | suspended`), Business fields `plan`, `subscriptionStart`, `subscriptionEnd`, `maxUsers`, `maxProducts`, `maxWarehouses`

- [ ] **Step 1: Add SubscriptionPlan enum and Business fields to schema.prisma**

In `backend/prisma/schema.prisma`, add before the `BusinessStatus` enum:

```prisma
enum SubscriptionPlan {
  trial
  active
  expired
  suspended
}
```

Add to the `Business` model, after the `status` field:

```prisma
  plan              SubscriptionPlan @default(trial)
  subscriptionStart DateTime?        @map("subscription_start")
  subscriptionEnd   DateTime?        @map("subscription_end")
  maxUsers          Int              @default(5)  @map("max_users")
  maxProducts       Int              @default(100) @map("max_products")
  maxWarehouses     Int              @default(2)  @map("max_warehouses")
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd backend
npx prisma migrate dev --name add_subscription_fields
```

Verify migration SQL sets defaults: existing businesses get `plan=trial`, nulls for dates, limits 5/100/2.

- [ ] **Step 3: Generate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): add subscription plan, limits to Business"
```

---

### Task 2: Unified Login — Backend

**Files:**
- Modify: `backend/src/modules/auth/application/auth.service.ts` (add `loginUnified` method)
- Modify: `backend/src/modules/auth/auth.controller.ts` (update login endpoint)
- Modify: `backend/src/common/auth/auth-user.type.ts` (add `isSuperAdmin` field)
- Modify: `backend/src/common/guards/jwt.guard.ts` (handle `type: 'platform-admin'`)
- Modify: `backend/src/common/guards/caps.guard.ts` (super admin bypass)
- Modify: `backend/src/modules/auth/domain/auth.repository.ts` (add `findPlatformAdminByEmail`)
- Modify: `backend/src/modules/auth/infrastructure/prisma-auth.repository.ts` (implement it)
- Test: `backend/src/modules/auth/application/auth.service.spec.ts`

**Interfaces:**
- Consumes: `PlatformAdmin` model (Prisma), existing `AuthService.login()`
- Produces: Updated `AuthUser` type with optional `isSuperAdmin: boolean`, unified login that returns `{ type: 'platform-admin' | 'user', ... }`

- [ ] **Step 1: Update AuthUser type**

In `backend/src/common/auth/auth-user.type.ts`:

```typescript
import type { CapabilityId, RoleId } from '../../domain/permissions';

export type AuthUser = {
  id: string;
  businessId: string;
  role: RoleId;
  tokenVersion: number;
  roleCaps: CapabilityId[];
  overrides: Partial<Record<CapabilityId, boolean>>;
  device?: string | undefined;
  isSuperAdmin?: boolean;
};
```

- [ ] **Step 2: Add findPlatformAdminByEmail to auth repository**

In `backend/src/modules/auth/domain/auth.repository.ts`, add to the abstract class:

```typescript
abstract findPlatformAdminByEmail(email: string): Promise<{
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  tokenVersion: number;
} | null>;
```

In `backend/src/modules/auth/infrastructure/prisma-auth.repository.ts`, implement:

```typescript
async findPlatformAdminByEmail(email: string) {
  return this.prisma.platformAdmin.findUnique({ where: { email } });
}
```

- [ ] **Step 3: Add loginPlatformAdmin to AuthService**

In `backend/src/modules/auth/application/auth.service.ts`, add method:

```typescript
async loginPlatformAdmin(
  email: string,
  password: string,
): Promise<{ accessToken: string; type: 'platform-admin' }> {
  const admin = await this.authRepo.findPlatformAdminByEmail(email.toLowerCase());
  if (!admin) return null as never; // caller checks null
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) throw new UnauthorizedError('Invalid credentials');

  const accessToken = await this.jwt.signAsync(
    { sub: admin.id, type: 'platform-admin', ver: admin.tokenVersion },
    { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL },
  );
  return { accessToken, type: 'platform-admin' };
}
```

- [ ] **Step 4: Update auth controller login to try PlatformAdmin first**

In `backend/src/modules/auth/auth.controller.ts`, update the `login` method:

```typescript
@Public()
@Post('login')
@HttpCode(200)
@UsePipes(new ZodValidationPipe(LoginSchema))
@ApiOperation({ summary: 'Unified login — checks platform admin first, then business user.' })
async login(@Body() body: LoginInput, @Req() req: Request): Promise<unknown> {
  // Try platform admin first
  const pa = await this.auth.loginPlatformAdmin(body.email, body.password).catch(() => null);
  if (pa) {
    return { accessToken: pa.accessToken, type: 'platform-admin' };
  }

  // Fall through to business user login
  const result = await this.auth.login(body.email, body.password, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    device: req.headers['user-agent'],
  });
  return {
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    refreshExpiresAt: result.tokens.refreshExpiresAt,
    user: result.user,
    capabilities: result.capabilities,
    type: 'user',
  };
}
```

- [ ] **Step 5: Update JwtAuthGuard to handle both token types**

In `backend/src/common/guards/jwt.guard.ts`, update the payload handling after `verifyAsync`:

```typescript
type AccessJwtPayload = {
  sub: string;
  type?: 'platform-admin' | 'user';
  role?: RoleId;
  ver: number;
  caps?: CapabilityId[];
  overrides?: Partial<Record<CapabilityId, boolean>>;
  bid?: string;
};

// Inside canActivate, after payload is verified:
if (payload.type === 'platform-admin') {
  request.user = {
    id: payload.sub,
    businessId: '',
    role: 'owner' as RoleId,
    tokenVersion: payload.ver,
    roleCaps: [...CAPABILITY_IDS],
    overrides: {},
    isSuperAdmin: true,
    device: request.headers['user-agent'],
  };
} else {
  request.user = {
    id: payload.sub,
    businessId: payload.bid ?? '',
    role: payload.role!,
    tokenVersion: payload.ver,
    roleCaps: payload.caps ?? [],
    overrides: payload.overrides ?? {},
    device: request.headers['user-agent'],
  };
}
```

Add import at top: `import { CAPABILITY_IDS } from '../../domain/permissions';`

- [ ] **Step 6: Update CapsGuard to bypass for super admin**

In `backend/src/common/guards/caps.guard.ts`, add bypass at the top of `canActivate` after getting user:

```typescript
const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
if (!user) throw new UnauthorizedError();
if (user.isSuperAdmin) return true;
```

- [ ] **Step 7: Update loginPlatformAdmin to return null when not found (not throw)**

In `auth.service.ts`, change `loginPlatformAdmin` to return `null` when admin not found instead of throwing:

```typescript
async loginPlatformAdmin(
  email: string,
  password: string,
): Promise<{ accessToken: string; type: 'platform-admin' } | null> {
  const admin = await this.authRepo.findPlatformAdminByEmail(email.toLowerCase());
  if (!admin) return null;
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return null;

  const accessToken = await this.jwt.signAsync(
    { sub: admin.id, type: 'platform-admin', ver: admin.tokenVersion },
    { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL },
  );
  return { accessToken, type: 'platform-admin' };
}
```

And update controller:

```typescript
const pa = await this.auth.loginPlatformAdmin(body.email, body.password);
if (pa) {
  return { accessToken: pa.accessToken, type: 'platform-admin' };
}
```

- [ ] **Step 8: Update auth.service.spec.ts with unified login tests**

Add tests for:
- Platform admin login returns `type: 'platform-admin'`
- User login returns `type: 'user'`
- Unknown email returns 401
- Wrong password for platform admin falls through to user check

- [ ] **Step 9: Run tests**

```bash
cd backend && npm test -- --testPathPattern auth.service
```

- [ ] **Step 10: Commit**

```bash
git add src/common/ src/modules/auth/
git commit -m "feat(auth): unified login — platform admin + business user via single endpoint"
```

---

### Task 3: SubscriptionGuard — Backend

**Files:**
- Create: `backend/src/common/guards/subscription.guard.ts`
- Modify: `backend/src/app.module.ts` (register guard)
- Test: `backend/src/common/guards/subscription.guard.spec.ts`

**Interfaces:**
- Consumes: `AuthUser.isSuperAdmin`, `AuthUser.businessId`, `PrismaService`, `IS_PUBLIC_KEY`
- Produces: Global guard that blocks expired subscriptions with 403 `subscription_expired`

- [ ] **Step 1: Create SubscriptionGuard**

Create `backend/src/common/guards/subscription.guard.ts`:

```typescript
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { ForbiddenError } from '../errors';
import { PrismaService } from '../prisma.service';
import { IS_PUBLIC_KEY } from './jwt.guard';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.isSuperAdmin) return true;
    if (!user.businessId) return true;

    const business = await this.prisma.business.findUnique({
      where: { id: user.businessId },
      select: { plan: true, subscriptionEnd: true },
    });

    if (!business) throw new ForbiddenError('Business not found');

    if (business.subscriptionEnd && business.subscriptionEnd < new Date()) {
      if (business.plan === 'active') {
        await this.prisma.business.update({
          where: { id: user.businessId },
          data: { plan: 'expired' },
        });
      }
      throw new ForbiddenError('subscription_expired');
    }

    if (business.plan === 'suspended') {
      throw new ForbiddenError('business_suspended');
    }

    return true;
  }
}
```

- [ ] **Step 2: Register in app.module.ts**

Add import and register AFTER `JwtAuthGuard`, BEFORE `CapsGuard`:

```typescript
import { SubscriptionGuard } from './common/guards/subscription.guard';

// In providers array, between JwtAuthGuard and CapsGuard:
{ provide: APP_GUARD, useClass: JwtAuthGuard },
{ provide: APP_GUARD, useClass: SubscriptionGuard },
{ provide: APP_GUARD, useClass: CapsGuard },
```

- [ ] **Step 3: Write unit test**

Create `backend/src/common/guards/subscription.guard.spec.ts` testing:
- Public routes skip guard
- Super admin skips guard
- Active subscription with future end date passes
- Null subscriptionEnd (no expiry) passes
- Expired subscription throws `subscription_expired`
- Suspended business throws `business_suspended`

- [ ] **Step 4: Run tests**

```bash
cd backend && npm test -- --testPathPattern subscription.guard
```

- [ ] **Step 5: Commit**

```bash
git add src/common/guards/subscription.guard.ts src/common/guards/subscription.guard.spec.ts src/app.module.ts
git commit -m "feat: add SubscriptionGuard — block expired businesses"
```

---

### Task 4: ModuleGuard + @RequiresModule decorator — Backend

**Files:**
- Create: `backend/src/common/decorators/require-module.decorator.ts`
- Create: `backend/src/common/guards/module.guard.ts`
- Modify: `backend/src/app.module.ts` (register guard)
- Modify: `backend/src/modules/pos/pos.controller.ts` (add `@RequiresModule('pos')`)
- Modify: `backend/src/modules/expenses/expenses.controller.ts` (add `@RequiresModule('expenses')`)
- Modify: `backend/src/modules/purchase-orders/po.controller.ts` (add `@RequiresModule('purchase-orders')`)
- Modify: `backend/src/modules/inventory/inventory.controller.ts` (add `@RequiresModule('inventory')`)
- Modify: `backend/src/modules/reports/reports.controller.ts` (add `@RequiresModule('reports')`)
- Test: `backend/src/common/guards/module.guard.spec.ts`

**Interfaces:**
- Consumes: `AuthUser.isSuperAdmin`, `AuthUser.businessId`, `BusinessModule` model
- Produces: `@RequiresModule(moduleId)` decorator, `ModuleGuard` that checks `BusinessModule.active`

- [ ] **Step 1: Create RequiresModule decorator**

Create `backend/src/common/decorators/require-module.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const REQUIRE_MODULE_KEY = 'requireModule';

export const RequiresModule = (moduleId: string): ClassDecorator & MethodDecorator =>
  SetMetadata(REQUIRE_MODULE_KEY, moduleId);
```

- [ ] **Step 2: Create ModuleGuard**

Create `backend/src/common/guards/module.guard.ts`:

```typescript
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { ForbiddenError } from '../errors';
import { PrismaService } from '../prisma.service';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleId = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleId) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.isSuperAdmin) return true;

    const mod = await this.prisma.businessModule.findUnique({
      where: { businessId_moduleId: { businessId: user.businessId, moduleId } },
    });

    if (!mod?.active) {
      throw new ForbiddenError(`module_disabled:${moduleId}`);
    }

    return true;
  }
}
```

- [ ] **Step 3: Register in app.module.ts**

Add after SubscriptionGuard, before CapsGuard:

```typescript
import { ModuleGuard } from './common/guards/module.guard';

{ provide: APP_GUARD, useClass: SubscriptionGuard },
{ provide: APP_GUARD, useClass: ModuleGuard },
{ provide: APP_GUARD, useClass: CapsGuard },
```

- [ ] **Step 4: Add @RequiresModule to controllers**

Add to each controller class:

```typescript
// pos.controller.ts
@RequiresModule('pos')
@Controller({ path: 'pos', version: '1' })

// expenses.controller.ts
@RequiresModule('expenses')
@Controller({ path: 'expenses', version: '1' })

// po.controller.ts
@RequiresModule('purchase-orders')
@Controller({ path: 'purchase-orders', version: '1' })

// inventory.controller.ts
@RequiresModule('inventory')
@Controller({ path: 'inventory', version: '1' })

// reports.controller.ts
@RequiresModule('reports')
@Controller({ path: 'reports', version: '1' })
```

- [ ] **Step 5: Write unit test for ModuleGuard**

Test: module not set → pass, super admin → pass, module active → pass, module missing/inactive → 403.

- [ ] **Step 6: Run tests**

```bash
cd backend && npm test -- --testPathPattern module.guard
```

- [ ] **Step 7: Commit**

```bash
git add src/common/decorators/require-module.decorator.ts src/common/guards/module.guard.ts src/common/guards/module.guard.spec.ts src/app.module.ts src/modules/pos/ src/modules/expenses/ src/modules/purchase-orders/ src/modules/inventory/ src/modules/reports/
git commit -m "feat: add ModuleGuard + @RequiresModule decorator for feature gating"
```

---

### Task 5: Limit enforcement — Backend

**Files:**
- Create: `backend/src/common/guards/limit.guard.ts`
- Create: `backend/src/common/decorators/enforce-limit.decorator.ts`
- Modify: `backend/src/modules/users/users.controller.ts` (add limit check)
- Modify: `backend/src/modules/products/products.controller.ts` (add limit check)
- Modify: `backend/src/modules/warehouses/warehouses.controller.ts` (add limit check)
- Test: `backend/src/common/guards/limit.guard.spec.ts`

**Interfaces:**
- Consumes: `AuthUser.businessId`, `Business.maxUsers`, `Business.maxProducts`, `Business.maxWarehouses`
- Produces: `@EnforceLimit('users')` decorator + `LimitGuard`

- [ ] **Step 1: Create EnforceLimit decorator**

Create `backend/src/common/decorators/enforce-limit.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const ENFORCE_LIMIT_KEY = 'enforceLimit';
export type LimitResource = 'users' | 'products' | 'warehouses';

export const EnforceLimit = (resource: LimitResource): MethodDecorator =>
  SetMetadata(ENFORCE_LIMIT_KEY, resource);
```

- [ ] **Step 2: Create LimitGuard**

Create `backend/src/common/guards/limit.guard.ts`:

```typescript
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { ForbiddenError } from '../errors';
import { PrismaService } from '../prisma.service';
import { ENFORCE_LIMIT_KEY, type LimitResource } from '../decorators/enforce-limit.decorator';

const LIMIT_CONFIG: Record<LimitResource, {
  countModel: 'user' | 'product' | 'warehouse';
  maxField: 'maxUsers' | 'maxProducts' | 'maxWarehouses';
}> = {
  users: { countModel: 'user', maxField: 'maxUsers' },
  products: { countModel: 'product', maxField: 'maxProducts' },
  warehouses: { countModel: 'warehouse', maxField: 'maxWarehouses' },
};

@Injectable()
export class LimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.get<LimitResource | undefined>(
      ENFORCE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!resource) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.isSuperAdmin) return true;

    const config = LIMIT_CONFIG[resource];
    const business = await this.prisma.business.findUnique({
      where: { id: user.businessId },
      select: { [config.maxField]: true },
    });
    if (!business) return true;

    const max = (business as Record<string, number>)[config.maxField];
    const current = await (this.prisma[config.countModel] as any).count({
      where: { businessId: user.businessId, ...(resource === 'users' ? { deletedAt: null } : resource === 'products' ? { deletedAt: null } : { deletedAt: null }) },
    });

    if (current >= max) {
      throw new ForbiddenError(`limit_reached:${resource}`);
    }

    return true;
  }
}
```

- [ ] **Step 3: Register in app.module.ts after ModuleGuard**

```typescript
import { LimitGuard } from './common/guards/limit.guard';

{ provide: APP_GUARD, useClass: ModuleGuard },
{ provide: APP_GUARD, useClass: LimitGuard },
{ provide: APP_GUARD, useClass: CapsGuard },
```

- [ ] **Step 4: Add @EnforceLimit to creation endpoints**

```typescript
// users.controller.ts — on the POST/create method
@EnforceLimit('users')
@Post()

// products.controller.ts — on the POST/create method
@EnforceLimit('products')
@Post()

// warehouses.controller.ts — on the POST/create method
@EnforceLimit('warehouses')
@Post()
```

- [ ] **Step 5: Write unit tests**

Test: no decorator → pass, super admin → pass, under limit → pass, at limit → 403 `limit_reached`.

- [ ] **Step 6: Run tests and commit**

```bash
cd backend && npm test -- --testPathPattern limit.guard
git add src/common/decorators/enforce-limit.decorator.ts src/common/guards/limit.guard.ts src/common/guards/limit.guard.spec.ts src/app.module.ts src/modules/users/ src/modules/products/ src/modules/warehouses/
git commit -m "feat: add LimitGuard — enforce maxUsers/maxProducts/maxWarehouses per business"
```

---

### Task 6: Super Admin API endpoints — Backend

**Files:**
- Modify: `backend/src/modules/platform-admin/platform-admin.service.ts` (add CRUD + subscription methods)
- Modify: `backend/src/modules/platform-admin/platform-admin.controller.ts` (add endpoints)
- Create: `backend/src/modules/platform-admin/dto/update-business.dto.ts`
- Create: `backend/src/modules/platform-admin/dto/extend-subscription.dto.ts`
- Create: `backend/src/modules/platform-admin/dto/update-modules.dto.ts`
- Test: `backend/src/modules/platform-admin/platform-admin.service.spec.ts` (update)

**Interfaces:**
- Consumes: `Business` model with subscription fields, `BusinessModule` model, `PlatformAdminGuard`
- Produces: REST endpoints for business management, subscription, module toggling

- [ ] **Step 1: Create DTOs**

`dto/update-business.dto.ts`:
```typescript
import { z } from 'zod';

export const UpdateBusinessSchema = z.object({
  maxUsers: z.number().int().min(1).optional(),
  maxProducts: z.number().int().min(1).optional(),
  maxWarehouses: z.number().int().min(1).optional(),
});
export type UpdateBusinessInput = z.infer<typeof UpdateBusinessSchema>;
```

`dto/extend-subscription.dto.ts`:
```typescript
import { z } from 'zod';

export const ExtendSubscriptionSchema = z.object({
  duration: z.enum(['1mo', '3mo', '6mo', '1yr']),
});
export type ExtendSubscriptionInput = z.infer<typeof ExtendSubscriptionSchema>;
```

`dto/update-modules.dto.ts`:
```typescript
import { z } from 'zod';

export const UpdateModulesSchema = z.object({
  modules: z.record(z.string(), z.boolean()),
});
export type UpdateModulesInput = z.infer<typeof UpdateModulesSchema>;
```

- [ ] **Step 2: Add service methods**

In `platform-admin.service.ts`, add:

```typescript
async getBusinessDetail(id: string) {
  const biz = await this.prisma.business.findUnique({
    where: { id },
    include: {
      users: {
        where: { role: 'owner', deletedAt: null },
        select: { id: true, name: true, email: true, phone: true },
        take: 1,
      },
      modules: true,
    },
  });
  if (!biz) throw new NotFoundError('Business', id);
  return biz;
}

async updateBusiness(id: string, data: { maxUsers?: number; maxProducts?: number; maxWarehouses?: number }) {
  const biz = await this.prisma.business.findUnique({ where: { id } });
  if (!biz) throw new NotFoundError('Business', id);
  return this.prisma.business.update({ where: { id }, data });
}

async extendSubscription(id: string, duration: '1mo' | '3mo' | '6mo' | '1yr') {
  const biz = await this.prisma.business.findUnique({ where: { id } });
  if (!biz) throw new NotFoundError('Business', id);

  const durations: Record<string, number> = {
    '1mo': 30, '3mo': 90, '6mo': 180, '1yr': 365,
  };
  const days = durations[duration];
  const start = new Date();
  const end = new Date(start.getTime() + days * 86_400_000);

  return this.prisma.business.update({
    where: { id },
    data: { plan: 'active', subscriptionStart: start, subscriptionEnd: end },
  });
}

async suspendBusiness(id: string) {
  const biz = await this.prisma.business.findUnique({ where: { id } });
  if (!biz) throw new NotFoundError('Business', id);
  await this.prisma.business.update({ where: { id }, data: { status: 'suspended', plan: 'suspended' } });
}

async activateBusiness(id: string) {
  const biz = await this.prisma.business.findUnique({ where: { id } });
  if (!biz) throw new NotFoundError('Business', id);
  await this.prisma.business.update({ where: { id }, data: { status: 'active', plan: 'active' } });
}

async updateModules(id: string, modules: Record<string, boolean>) {
  const biz = await this.prisma.business.findUnique({ where: { id } });
  if (!biz) throw new NotFoundError('Business', id);

  const upserts = Object.entries(modules).map(([moduleId, active]) =>
    this.prisma.businessModule.upsert({
      where: { businessId_moduleId: { businessId: id, moduleId } },
      update: { active },
      create: { businessId: id, moduleId, active },
    }),
  );
  await this.prisma.$transaction(upserts);
}

async getStats() {
  const [total, active, expired, pending, suspended] = await Promise.all([
    this.prisma.business.count(),
    this.prisma.business.count({ where: { plan: 'active' } }),
    this.prisma.business.count({ where: { plan: 'expired' } }),
    this.prisma.business.count({ where: { status: 'pending' } }),
    this.prisma.business.count({ where: { plan: 'suspended' } }),
  ]);
  return { total, active, expired, pending, suspended };
}
```

- [ ] **Step 3: Add controller endpoints**

Add to `platform-admin.controller.ts`:

```typescript
@Public()
@UseGuards(PlatformAdminGuard)
@Get('admin/platform/stats')
async stats() { return this.svc.getStats(); }

@Public()
@UseGuards(PlatformAdminGuard)
@Get('admin/platform/businesses/:id')
async getBusinessDetail(@Param('id') id: string) { return this.svc.getBusinessDetail(id); }

@Public()
@UseGuards(PlatformAdminGuard)
@Patch('admin/platform/businesses/:id')
@UsePipes(new ZodValidationPipe(UpdateBusinessSchema))
async updateBusiness(@Param('id') id: string, @Body() body: UpdateBusinessInput) {
  return this.svc.updateBusiness(id, body);
}

@Public()
@UseGuards(PlatformAdminGuard)
@Post('admin/platform/businesses/:id/extend')
@HttpCode(200)
@UsePipes(new ZodValidationPipe(ExtendSubscriptionSchema))
async extend(@Param('id') id: string, @Body() body: ExtendSubscriptionInput) {
  await this.svc.extendSubscription(id, body.duration);
  return { ok: true };
}

@Public()
@UseGuards(PlatformAdminGuard)
@Post('admin/platform/businesses/:id/suspend')
@HttpCode(200)
async suspend(@Param('id') id: string) {
  await this.svc.suspendBusiness(id);
  return { ok: true };
}

@Public()
@UseGuards(PlatformAdminGuard)
@Post('admin/platform/businesses/:id/activate')
@HttpCode(200)
async activate(@Param('id') id: string) {
  await this.svc.activateBusiness(id);
  return { ok: true };
}

@Public()
@UseGuards(PlatformAdminGuard)
@Patch('admin/platform/businesses/:id/modules')
@UsePipes(new ZodValidationPipe(UpdateModulesSchema))
async updateModules(@Param('id') id: string, @Body() body: UpdateModulesInput) {
  await this.svc.updateModules(id, body.modules);
  return { ok: true };
}
```

Add imports for `Patch` from `@nestjs/common` and the new DTOs.

- [ ] **Step 4: Remove old PA login endpoint**

Delete the `login` method and `auth/platform-admin/login` route from `platform-admin.controller.ts`. Login now goes through unified `/auth/login`.

- [ ] **Step 5: Update tests and run**

```bash
cd backend && npm test -- --testPathPattern platform-admin
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/platform-admin/
git commit -m "feat(platform-admin): add subscription, module, limit management endpoints"
```

---

### Task 7: Web — Unified auth store + login redirect

**Files:**
- Modify: `web/src/auth/auth-store.ts` (handle `type` in login response)
- Modify: `web/src/api/types.ts` (update LoginResponse type)
- Modify: `web/src/pages/LoginPage.tsx` (redirect based on type)
- Delete: `web/src/platform-admin/pa-auth-store.ts` (merge into main auth store)
- Delete: `web/src/pages/platform-admin/PALoginPage.tsx`
- Modify: `web/src/App.tsx` (remove PA login route)

**Interfaces:**
- Consumes: Updated login response `{ type: 'platform-admin' | 'user', ... }`
- Produces: Unified auth store with `isSuperAdmin` flag

- [ ] **Step 1: Update LoginResponse type**

In `web/src/api/types.ts`, update:

```typescript
export type LoginResponse = {
  accessToken: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
  user?: { id: string; name: string; email: string; role: RoleId };
  capabilities?: CapabilityId[];
  type: 'platform-admin' | 'user';
};
```

- [ ] **Step 2: Update auth store**

In `web/src/auth/auth-store.ts`, add `isSuperAdmin` to state and handle both login types:

```typescript
type AuthState = {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: { id: string; name: string; email: string; role: RoleId } | null;
  capabilities: Set<CapabilityId>;
  isSuperAdmin: boolean;

  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<'user' | 'platform-admin'>;
  logout: () => Promise<void>;
  hasCap: (cap: CapabilityId) => boolean;
};
```

Update `login` method to return type and handle PA token (no refresh token):

```typescript
login: async (email, password) => {
  const res = await api.post<LoginResponse>('/auth/login', { email, password }, { withAuth: false });

  if (res.type === 'platform-admin') {
    saveTokens(res.accessToken, '');
    set({
      status: 'authenticated',
      user: { id: '', name: 'Platform Admin', email, role: 'owner' },
      capabilities: new Set(),
      isSuperAdmin: true,
    });
    return 'platform-admin';
  }

  saveTokens(res.accessToken, res.refreshToken!);
  const me = await api.get<MeResponse>('/auth/me');
  set({
    status: 'authenticated',
    user: { id: me.id, name: me.name, email: me.email, role: me.role },
    capabilities: new Set(me.capabilities),
    isSuperAdmin: false,
  });
  return 'user';
},
```

- [ ] **Step 3: Update LoginPage to redirect by type**

In `web/src/pages/LoginPage.tsx`, update `attemptLogin`:

```typescript
const loginResult = await login(e, p);
if (loginResult === 'platform-admin') {
  navigate('/platform-admin/dashboard');
} else {
  navigate('/');
}
```

- [ ] **Step 4: Remove old PA login page and auth store**

Delete `web/src/platform-admin/pa-auth-store.ts`.
Delete `web/src/pages/platform-admin/PALoginPage.tsx`.
Remove the `PALoginPage` import and route from `web/src/App.tsx`.

Update `PendingApprovalsPage.tsx` to use main auth store + `isSuperAdmin` check instead of `usePAAuth`.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/auth/ src/api/types.ts src/pages/LoginPage.tsx src/App.tsx src/pages/platform-admin/
git rm src/platform-admin/pa-auth-store.ts src/pages/platform-admin/PALoginPage.tsx
git commit -m "feat(web): unified login — redirect PA to admin panel, users to dashboard"
```

---

### Task 8: Web — Super Admin Panel pages

**Files:**
- Create: `web/src/pages/platform-admin/PADashboardPage.tsx`
- Create: `web/src/pages/platform-admin/PABusinessListPage.tsx`
- Create: `web/src/pages/platform-admin/PABusinessDetailPage.tsx`
- Create: `web/src/platform-admin/pa-api.ts` (API calls for PA endpoints)
- Modify: `web/src/pages/platform-admin/PendingApprovalsPage.tsx` (use main auth)
- Modify: `web/src/App.tsx` (add routes)
- Modify: `web/src/layouts/AdminShell.tsx` (add PA nav items when super admin)

**Interfaces:**
- Consumes: PA API endpoints from Task 6, `useAuth().isSuperAdmin`
- Produces: Full super admin panel with dashboard, business list, business detail (subscription + modules + limits)

- [ ] **Step 1: Create PA API client**

Create `web/src/platform-admin/pa-api.ts`:

```typescript
import { api } from '../api/client';

export type PAStats = {
  total: number; active: number; expired: number; pending: number; suspended: number;
};

export type PABusiness = {
  id: string; name: string; status: string; plan: string;
  subscriptionStart: string | null; subscriptionEnd: string | null;
  maxUsers: number; maxProducts: number; maxWarehouses: number;
  users: { id: string; name: string; email: string; phone: string | null }[];
  modules: { moduleId: string; active: boolean }[];
};

export const paApi = {
  stats: () => api.get<PAStats>('/admin/platform/stats'),
  businesses: (status?: string) =>
    api.get<PABusiness[]>(`/admin/platform/businesses${status ? `?status=${status}` : ''}`),
  business: (id: string) => api.get<PABusiness>(`/admin/platform/businesses/${id}`),
  updateBusiness: (id: string, data: Partial<Pick<PABusiness, 'maxUsers' | 'maxProducts' | 'maxWarehouses'>>) =>
    api.patch(`/admin/platform/businesses/${id}`, data),
  extend: (id: string, duration: '1mo' | '3mo' | '6mo' | '1yr') =>
    api.post(`/admin/platform/businesses/${id}/extend`, { duration }),
  suspend: (id: string) => api.post(`/admin/platform/businesses/${id}/suspend`),
  activate: (id: string) => api.post(`/admin/platform/businesses/${id}/activate`),
  approve: (id: string) => api.post(`/admin/platform/businesses/${id}/approve`),
  reject: (id: string) => api.post(`/admin/platform/businesses/${id}/reject`),
  updateModules: (id: string, modules: Record<string, boolean>) =>
    api.patch(`/admin/platform/businesses/${id}/modules`, { modules }),
};
```

- [ ] **Step 2: Create PADashboardPage**

Stats cards: total businesses, active, expired, pending, suspended. Quick links to business list and approvals.

- [ ] **Step 3: Create PABusinessListPage**

Table with business name, owner, status, plan, subscription end date. Filter tabs: all/active/expired/pending/suspended. Click row → detail page.

- [ ] **Step 4: Create PABusinessDetailPage**

Sections:
- Business info (name, owner, status)
- Subscription: current plan, start/end dates, extend button (dropdown: 1mo/3mo/6mo/1yr)
- Limits: editable fields for maxUsers/maxProducts/maxWarehouses with save
- Modules: toggle switches for each module (pos, expenses, purchase-orders, inventory, reports)
- Actions: suspend/activate/approve/reject buttons based on current status

- [ ] **Step 5: Update App.tsx routes**

Add new routes:
```typescript
<Route path="/platform-admin/dashboard" element={<PADashboardPage />} />
<Route path="/platform-admin/businesses" element={<PABusinessListPage />} />
<Route path="/platform-admin/businesses/:id" element={<PABusinessDetailPage />} />
```

- [ ] **Step 6: Add PA nav to AdminShell when super admin**

In sidebar, when `isSuperAdmin`, show platform admin section with links to dashboard, businesses, approvals.

- [ ] **Step 7: Test in browser**

Start dev server, login as platform admin, verify:
- Redirect to `/platform-admin/dashboard`
- Stats load
- Business list shows
- Business detail allows editing subscription/limits/modules

- [ ] **Step 8: Commit**

```bash
cd web
git add src/platform-admin/ src/pages/platform-admin/ src/App.tsx src/layouts/
git commit -m "feat(web): super admin panel — dashboard, business management, subscription + module control"
```

---

### Task 9: Registration — email conflict check + default modules seeding

**Files:**
- Modify: `backend/src/modules/auth/application/auth.service.ts` (check PA table on register)
- Modify: `backend/src/modules/auth/infrastructure/prisma-auth.repository.ts` (seed default modules on business create)

**Interfaces:**
- Consumes: `PlatformAdmin` model, `BusinessModule` model
- Produces: Registration rejects PA emails, new businesses get default modules seeded

- [ ] **Step 1: Check PlatformAdmin table in ensureNoConflict**

In `auth.service.ts`, update `ensureNoConflict`:

```typescript
async ensureNoConflict(email: string): Promise<void> {
  const lower = email.toLowerCase();
  if (await this.authRepo.emailInUse(lower)) {
    throw new ConflictError('Email already in use');
  }
  if (await this.authRepo.findPlatformAdminByEmail(lower)) {
    throw new ConflictError('Email already in use');
  }
}
```

- [ ] **Step 2: Seed default modules when creating business**

In `prisma-auth.repository.ts`, in `createBusinessWithOwner`, after creating business + user, add:

```typescript
const defaultModules = ['pos', 'expenses', 'purchase-orders', 'inventory', 'reports'];
await this.prisma.businessModule.createMany({
  data: defaultModules.map((moduleId) => ({
    businessId: business.id,
    moduleId,
    active: true,
  })),
});
```

- [ ] **Step 3: Run tests and commit**

```bash
cd backend && npm test
git add src/modules/auth/
git commit -m "feat(auth): block PA emails at registration, seed default modules for new businesses"
```

---

### Task 10: Auth `/me` endpoint — include modules + subscription info

**Files:**
- Modify: `backend/src/modules/auth/application/auth.service.ts` (`me` method)
- Modify: `web/src/api/types.ts` (update MeResponse)
- Modify: `web/src/auth/auth-store.ts` (store modules)

**Interfaces:**
- Consumes: `BusinessModule`, Business subscription fields
- Produces: `/auth/me` returns `modules[]` and `subscription` info

- [ ] **Step 1: Update auth service me()**

Include modules and subscription in the response:

```typescript
const business = await this.authRepo.findBusinessById(profile.businessId);
const modules = await this.authRepo.findBusinessModules(profile.businessId);

return {
  ...profile,
  capabilities: [...effective],
  modules: modules.filter(m => m.active).map(m => m.moduleId),
  subscription: business ? {
    plan: business.plan,
    end: business.subscriptionEnd,
  } : null,
};
```

- [ ] **Step 2: Add repository methods**

Add `findBusinessById` and `findBusinessModules` to auth repository.

- [ ] **Step 3: Update web types and auth store**

Add `modules: string[]` and `subscription` to `MeResponse`. Store in auth state. Expose `hasModule(id)` helper.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/auth/ web/src/api/types.ts web/src/auth/auth-store.ts
git commit -m "feat: include modules + subscription in /auth/me response"
```

---

### Task 11: Frontend module gating + subscription expired screen

**Files:**
- Modify: `web/src/layouts/AdminShell.tsx` (hide disabled modules from nav)
- Create: `web/src/pages/SubscriptionExpiredPage.tsx`
- Modify: `web/src/api/client.ts` (intercept 403 subscription_expired)
- Modify: `web/src/App.tsx` (add expired route)

**Interfaces:**
- Consumes: `useAuth().hasModule()`, API 403 `subscription_expired` code
- Produces: Nav hides disabled modules, expired subscription shows renewal screen

- [ ] **Step 1: Create SubscriptionExpiredPage**

Simple page: "Your subscription has expired. Contact your administrator to renew." + logout button.

- [ ] **Step 2: Intercept 403 in API client**

In `web/src/api/client.ts`, in `apiFetch`, after receiving 403:

```typescript
if (problem.code === 'subscription_expired') {
  window.location.href = '/subscription-expired';
  throw problem;
}
```

- [ ] **Step 3: Hide disabled modules in sidebar**

In `AdminShell.tsx`, filter nav items based on `hasModule()` from auth store.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/layouts/ src/pages/SubscriptionExpiredPage.tsx src/api/client.ts src/App.tsx
git commit -m "feat(web): subscription expired screen + hide disabled modules from nav"
```

---

### Task 12: Deploy migration + seed existing businesses

**Files:**
- Create: `backend/prisma/seed-default-modules.ts` (one-time script)

**Interfaces:**
- Consumes: Existing businesses without subscription/module data
- Produces: All existing businesses get `plan=active`, null dates (no expiry), all modules active

- [ ] **Step 1: Create migration seed script**

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MODULES = ['pos', 'expenses', 'purchase-orders', 'inventory', 'reports'];

async function main() {
  const businesses = await prisma.business.findMany({ select: { id: true } });
  for (const biz of businesses) {
    await prisma.business.update({
      where: { id: biz.id },
      data: { plan: 'active' },
    });
    for (const moduleId of MODULES) {
      await prisma.businessModule.upsert({
        where: { businessId_moduleId: { businessId: biz.id, moduleId } },
        update: {},
        create: { businessId: biz.id, moduleId, active: true },
      });
    }
  }
  console.log(`Seeded ${businesses.length} businesses with default modules`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add npm script**

In `package.json`:
```json
"seed:default-modules": "tsx prisma/seed-default-modules.ts"
```

- [ ] **Step 3: Commit**

```bash
git add prisma/seed-default-modules.ts package.json
git commit -m "chore: add seed script for default modules on existing businesses"
```

- [ ] **Step 4: Deploy**

```bash
make deploy
# Inside container: npx tsx prisma/seed-default-modules.ts
```
