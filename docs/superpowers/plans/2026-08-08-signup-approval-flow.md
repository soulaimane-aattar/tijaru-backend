# Signup + Approval + Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-serve signup from mobile with platform-admin approval gate, plus a first-launch onboarding (language pick + mini tutorial).

**Architecture:** New `pending`/`rejected` BusinessStatus values gate login. `POST /auth/register` creates Business+User in one transaction. Separate PlatformAdmin JWT auth + approval endpoints. Mobile gets onboarding screens (language → tutorial → login/register) persisted via AsyncStorage flag. Web admin gets platform-admin login + pending-approvals page.

**Tech Stack:** NestJS + Prisma (backend), Expo Router + Zustand + NativeWind (mobile), React + Vite + TanStack Query (web)

## Global Constraints

- Backend port: 3002, Postgres port: 5433
- Three separate repos: `backend/` (this repo), `../web`, `../mobile` (inside GestionStock)
- Mobile: `app/(auth)/` for auth screens, `src/` for shared code, NativeWind for styling
- Web: `src/pages/` for pages, `src/api/` for queries, `src/auth/` for auth state
- Backend test runner: Jest. Web test runner: Vitest. Mobile: no test infra yet.
- i18n: 3 languages — fr (default), en, ar. All user-facing strings in i18n files.
- Commit after each task passes its gate.

---

### Task 1: Prisma migration — BusinessStatus enum + ice optional

**Files:**
- Create: `backend/prisma/migrations/<timestamp>_signup_pending_status/migration.sql` (via `prisma migrate dev`)
- Modify: `backend/prisma/schema.prisma:15-18` (BusinessStatus enum) + `:35` (ice field)

**Interfaces:**
- Produces: `BusinessStatus.pending`, `BusinessStatus.rejected` enum values; `Business.ice` becomes nullable

- [ ] **Step 1: Update schema.prisma — add pending/rejected to BusinessStatus**

In `backend/prisma/schema.prisma`, change:

```prisma
enum BusinessStatus {
  active
  suspended
  pending
  rejected
}
```

- [ ] **Step 2: Update schema.prisma — make ice optional**

Change line 35 from:

```prisma
  ice       String         @unique
```

to:

```prisma
  ice       String?        @unique
```

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
cd backend
DATABASE_URL="postgresql://stock:stock@localhost:5433/tijaru?schema=public" npx prisma migrate dev --name signup_pending_status
```

Expected: migration created and applied, `prisma generate` runs automatically.

- [ ] **Step 4: Verify Prisma client types updated**

Run:
```bash
cd backend && npx tsc --noEmit
```

Expected: no type errors. The seed file references `ice: '001512345000078'` (a string) which stays valid since the field is now optional but still accepts strings.

- [ ] **Step 5: Commit**

```bash
cd backend
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): add pending/rejected BusinessStatus, make ice optional"
```

---

### Task 2: Backend — AuthUserView + login gate

**Files:**
- Modify: `backend/src/modules/auth/domain/auth.repository.ts` (AuthUserView type)
- Modify: `backend/src/modules/auth/infrastructure/prisma-auth.repository.ts` (include business)
- Modify: `backend/src/modules/auth/application/auth.service.ts` (login gate)
- Modify: `backend/src/common/errors.ts` (new error classes)
- Create: `backend/src/modules/auth/application/auth.service.spec.ts`

**Interfaces:**
- Consumes: `BusinessStatus` enum from Prisma
- Produces: `AuthUserView.businessStatus` field; `AuthService.login()` throws `ForbiddenError` for non-active businesses

- [ ] **Step 1: Write failing test for login gate**

Create `backend/src/modules/auth/application/auth.service.spec.ts`:

```ts
import * as bcrypt from 'bcrypt';

import { ConflictError, ForbiddenError, UnauthorizedError } from '../../../common/errors';
import type { AuthRepository, AuthUserView } from '../domain/auth.repository';

import { AuthService } from './auth.service';

const mockRepo = (): jest.Mocked<AuthRepository> =>
  ({
    findUserByEmail: jest.fn(),
    findProfile: jest.fn(),
    emailInUse: jest.fn(),
    recordLogin: jest.fn(),
    findSessionByTokenHash: jest.fn(),
    createSession: jest.fn(),
    revokeSession: jest.fn(),
    revokeSessionByTokenHash: jest.fn(),
    revokeAllSessions: jest.fn(),
    bumpTokenVersion: jest.fn(),
  }) as never;

const mockJwt = () => ({ signAsync: jest.fn().mockResolvedValue('tok') }) as never;
const mockPerms = () => ({ effectiveCapsForRole: jest.fn().mockResolvedValue([]) }) as never;
const mockEnv = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  BCRYPT_COST: 10,
} as never;

const makeUser = (overrides: Partial<AuthUserView> = {}): AuthUserView => ({
  id: 'u1',
  businessId: 'b1',
  name: 'Test',
  email: 'test@example.com',
  role: 'owner',
  active: true,
  passwordHash: '',
  tokenVersion: 0,
  overrides: [],
  businessStatus: 'active',
  ...overrides,
});

const meta = { ip: '127.0.0.1', userAgent: 'test', device: 'test' };

describe('AuthService', () => {
  describe('login gate — business status', () => {
    it('throws ForbiddenError when business is pending', async () => {
      const repo = mockRepo();
      const user = makeUser({ businessStatus: 'pending' });
      user.passwordHash = await bcrypt.hash('pass1234', 4);
      repo.findUserByEmail.mockResolvedValue(user);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      await expect(svc.login('test@example.com', 'pass1234', meta)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('throws ForbiddenError when business is rejected', async () => {
      const repo = mockRepo();
      const user = makeUser({ businessStatus: 'rejected' });
      user.passwordHash = await bcrypt.hash('pass1234', 4);
      repo.findUserByEmail.mockResolvedValue(user);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      await expect(svc.login('test@example.com', 'pass1234', meta)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('allows login when business is active', async () => {
      const repo = mockRepo();
      const user = makeUser({ businessStatus: 'active' });
      user.passwordHash = await bcrypt.hash('pass1234', 4);
      repo.findUserByEmail.mockResolvedValue(user);
      repo.createSession.mockResolvedValue(undefined);
      repo.recordLogin.mockResolvedValue(undefined);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      const result = await svc.login('test@example.com', 'pass1234', meta);
      expect(result.tokens.accessToken).toBe('tok');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/auth/application/auth.service.spec.ts --no-cache`

Expected: FAIL — `AuthUserView` has no `businessStatus` field yet.

- [ ] **Step 3: Add businessStatus to AuthUserView**

In `backend/src/modules/auth/domain/auth.repository.ts`, add to `AuthUserView`:

```ts
export interface AuthUserView {
  id: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  passwordHash: string;
  tokenVersion: number;
  overrides: { capId: string; granted: boolean }[];
  businessStatus: string;
}
```

- [ ] **Step 4: Update PrismaAuthRepository to include business status**

In `backend/src/modules/auth/infrastructure/prisma-auth.repository.ts`, update `findUserByEmail`:

```ts
async findUserByEmail(email: string): Promise<AuthUserView | null> {
  const user = await this.prisma.user.findFirst({
    where: { email, deletedAt: null },
    include: { overrides: true, business: { select: { status: true } } },
  });
  if (!user) return null;
  return { ...user, businessStatus: user.business.status };
}
```

Also update `findSessionByTokenHash` to include business status (needed for refresh-token path):

```ts
async findSessionByTokenHash(hash: string): Promise<SessionView | null> {
  const session = await this.prisma.session.findFirst({
    where: { refreshTokenHash: hash, revokedAt: null },
    include: {
      user: {
        include: {
          overrides: true,
          business: { select: { status: true } },
        },
      },
    },
  });
  if (!session) return null;
  return {
    ...session,
    user: { ...session.user, businessStatus: session.user.business.status },
  };
}
```

- [ ] **Step 5: Add login gate to AuthService.login()**

In `backend/src/modules/auth/application/auth.service.ts`, after the `!user.active` check at line 41, add:

```ts
if (user.businessStatus !== 'active') {
  const msg =
    user.businessStatus === 'pending'
      ? 'Your account is awaiting approval'
      : user.businessStatus === 'rejected'
        ? 'Your application was not approved'
        : 'Business is suspended';
  throw new ForbiddenError(msg);
}
```

Update the `ForbiddenError` constructor in `backend/src/common/errors.ts` to accept a custom message (it currently only accepts a `cap` parameter). Change:

```ts
export class ForbiddenError extends DomainError {
  constructor(detail?: string) {
    super('forbidden', detail ?? 'Forbidden', HttpStatus.FORBIDDEN);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx jest src/modules/auth/application/auth.service.spec.ts --no-cache`

Expected: all 3 tests PASS.

- [ ] **Step 7: Run full typecheck**

Run: `cd backend && npx tsc --noEmit`

Expected: PASS. Fix any downstream type errors if `ForbiddenError` constructor signature change breaks existing callers (CapsGuard passes a `cap` string — still valid with the new `detail?` signature).

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/modules/auth/ src/common/errors.ts
git commit -m "feat(auth): add business-status login gate, reject pending/rejected/suspended"
```

---

### Task 3: Backend — register endpoint

**Files:**
- Create: `backend/src/modules/auth/dto/register.dto.ts`
- Modify: `backend/src/modules/auth/application/auth.service.ts` (add register method)
- Modify: `backend/src/modules/auth/domain/auth.repository.ts` (add createBusinessWithOwner)
- Modify: `backend/src/modules/auth/infrastructure/prisma-auth.repository.ts` (implement it)
- Modify: `backend/src/modules/auth/auth.controller.ts` (add register route)
- Modify: `backend/src/modules/auth/application/auth.service.spec.ts` (add register tests)

**Interfaces:**
- Consumes: `AuthService.ensureNoConflict()`, `ForbiddenError` from Task 2
- Produces: `POST /api/v1/auth/register` → `{ status: 'pending' }`

- [ ] **Step 1: Write failing test for register**

Append to `backend/src/modules/auth/application/auth.service.spec.ts`:

```ts
describe('register', () => {
  it('throws ConflictError when email already in use', async () => {
    const repo = mockRepo();
    repo.emailInUse.mockResolvedValue(true);
    const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
    await expect(
      svc.register({
        businessName: 'Test Biz',
        ownerName: 'Owner',
        email: 'taken@example.com',
        password: 'pass1234',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('creates business with pending status and owner user', async () => {
    const repo = mockRepo();
    repo.emailInUse.mockResolvedValue(false);
    repo.createBusinessWithOwner = jest.fn().mockResolvedValue({ businessId: 'b1', userId: 'u1' });
    const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
    const result = await svc.register({
      businessName: 'New Biz',
      ownerName: 'Owner',
      email: 'new@example.com',
      password: 'pass1234',
    });
    expect(result).toEqual({ status: 'pending' });
    expect(repo.createBusinessWithOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: 'New Biz',
        status: 'pending',
        ownerName: 'Owner',
        email: 'new@example.com',
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/auth/application/auth.service.spec.ts --no-cache`

Expected: FAIL — `register` method does not exist.

- [ ] **Step 3: Create register DTO**

Create `backend/src/modules/auth/dto/register.dto.ts`:

```ts
import { z } from 'zod';

export const RegisterSchema = z.object({
  businessName: z.string().min(2),
  ownerName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
```

- [ ] **Step 4: Add createBusinessWithOwner to AuthRepository**

In `backend/src/modules/auth/domain/auth.repository.ts`, add:

```ts
export interface CreateBusinessWithOwnerData {
  businessName: string;
  phone?: string;
  status: string;
  ownerName: string;
  email: string;
  passwordHash: string;
}

export interface CreateBusinessWithOwnerResult {
  businessId: string;
  userId: string;
}
```

Add to the abstract class:

```ts
abstract createBusinessWithOwner(
  data: CreateBusinessWithOwnerData,
): Promise<CreateBusinessWithOwnerResult>;
```

- [ ] **Step 5: Implement in PrismaAuthRepository**

In `backend/src/modules/auth/infrastructure/prisma-auth.repository.ts`, add:

```ts
async createBusinessWithOwner(
  data: CreateBusinessWithOwnerData,
): Promise<CreateBusinessWithOwnerResult> {
  return this.prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name: data.businessName,
        phone: data.phone,
        status: data.status as BusinessStatus,
      },
    });
    const user = await tx.user.create({
      data: {
        businessId: business.id,
        name: data.ownerName,
        email: data.email,
        passwordHash: data.passwordHash,
        role: BuiltInRole.owner,
      },
    });
    return { businessId: business.id, userId: user.id };
  });
}
```

Add imports at top: `import { BuiltInRole, BusinessStatus } from '@prisma/client';`

- [ ] **Step 6: Add register method to AuthService**

In `backend/src/modules/auth/application/auth.service.ts`, add:

```ts
async register(input: {
  businessName: string;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
}): Promise<{ status: string }> {
  await this.ensureNoConflict(input.email);
  const passwordHash = await bcrypt.hash(input.password, this.env.BCRYPT_COST);
  await this.authRepo.createBusinessWithOwner({
    businessName: input.businessName,
    phone: input.phone,
    status: 'pending',
    ownerName: input.ownerName,
    email: input.email.toLowerCase(),
    passwordHash,
  });
  return { status: 'pending' };
}
```

- [ ] **Step 7: Add register route to AuthController**

In `backend/src/modules/auth/auth.controller.ts`, add:

```ts
import { type RegisterInput, RegisterSchema } from './dto/register.dto';

@Public()
@Post('register')
@HttpCode(201)
@UsePipes(new ZodValidationPipe(RegisterSchema))
@ApiOperation({ summary: 'Self-serve signup. Creates a pending Business + owner User.' })
async register(@Body() body: RegisterInput): Promise<{ status: string }> {
  return this.auth.register(body);
}
```

- [ ] **Step 8: Update mockRepo in spec to include createBusinessWithOwner**

In the `mockRepo()` factory at top of spec, add `createBusinessWithOwner: jest.fn()`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd backend && npx jest src/modules/auth/application/auth.service.spec.ts --no-cache`

Expected: all tests PASS.

- [ ] **Step 10: Typecheck**

Run: `cd backend && npx tsc --noEmit`

- [ ] **Step 11: Commit**

```bash
cd backend
git add src/modules/auth/
git commit -m "feat(auth): add POST /auth/register for self-serve signup"
```

---

### Task 4: Backend — PlatformAdmin auth (login + guard)

**Files:**
- Create: `backend/src/modules/platform-admin/platform-admin.module.ts`
- Create: `backend/src/modules/platform-admin/platform-admin.controller.ts`
- Create: `backend/src/modules/platform-admin/platform-admin.service.ts`
- Create: `backend/src/modules/platform-admin/platform-admin.guard.ts`
- Create: `backend/src/modules/platform-admin/dto/platform-admin-login.dto.ts`
- Create: `backend/src/modules/platform-admin/platform-admin.service.spec.ts`
- Modify: `backend/src/app.module.ts` (import PlatformAdminModule)

**Interfaces:**
- Consumes: `PrismaService` (global), `ENV_TOKEN`, JWT_ACCESS_SECRET
- Produces: `POST /api/v1/auth/platform-admin/login` → `{ accessToken }`;
  `PlatformAdminGuard` decorator for protecting admin-only routes;
  `GET /api/v1/admin/platform/businesses?status=pending`;
  `POST /api/v1/admin/platform/businesses/:id/approve`;
  `POST /api/v1/admin/platform/businesses/:id/reject`

- [ ] **Step 1: Write failing test for PlatformAdminService.login**

Create `backend/src/modules/platform-admin/platform-admin.service.spec.ts`:

```ts
import * as bcrypt from 'bcrypt';

import { UnauthorizedError } from '../../common/errors';

import { PlatformAdminService } from './platform-admin.service';

const mockPrisma = () =>
  ({
    platformAdmin: {
      findUnique: jest.fn(),
    },
    business: {
      findMany: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  }) as never;

const mockJwt = () => ({ signAsync: jest.fn().mockResolvedValue('pa-token') }) as never;

const mockEnv = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
} as never;

describe('PlatformAdminService', () => {
  it('returns accessToken on valid credentials', async () => {
    const prisma = mockPrisma();
    const hash = await bcrypt.hash('admin123', 4);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'pa1',
      email: 'admin@tijaru.com',
      passwordHash: hash,
      tokenVersion: 0,
    });
    const svc = new PlatformAdminService(prisma, mockJwt(), mockEnv);
    const result = await svc.login('admin@tijaru.com', 'admin123');
    expect(result.accessToken).toBe('pa-token');
  });

  it('throws UnauthorizedError on wrong password', async () => {
    const prisma = mockPrisma();
    const hash = await bcrypt.hash('admin123', 4);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'pa1',
      email: 'admin@tijaru.com',
      passwordHash: hash,
      tokenVersion: 0,
    });
    const svc = new PlatformAdminService(prisma, mockJwt(), mockEnv);
    await expect(svc.login('admin@tijaru.com', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('throws UnauthorizedError when admin not found', async () => {
    const prisma = mockPrisma();
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    const svc = new PlatformAdminService(prisma, mockJwt(), mockEnv);
    await expect(svc.login('ghost@tijaru.com', 'pass')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/platform-admin/platform-admin.service.spec.ts --no-cache`

Expected: FAIL — module not found.

- [ ] **Step 3: Create PlatformAdminService**

Create `backend/src/modules/platform-admin/platform-admin.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../common/prisma.service';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../common/errors';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!admin) throw new UnauthorizedError('Invalid credentials');

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) throw new UnauthorizedError('Invalid credentials');

    const accessToken = await this.jwt.signAsync(
      { sub: admin.id, type: 'platform-admin', ver: admin.tokenVersion },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL },
    );
    return { accessToken };
  }

  async listBusinesses(status?: string): Promise<unknown[]> {
    const where = status ? { status: status as never } : {};
    return this.prisma.business.findMany({
      where,
      include: {
        users: {
          where: { role: 'owner', deletedAt: null },
          select: { id: true, name: true, email: true, phone: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    if (biz.status !== 'pending') throw new ConflictError('Business is not pending');
    await this.prisma.business.update({ where: { id }, data: { status: 'active' } });
  }

  async rejectBusiness(id: string): Promise<void> {
    const biz = await this.prisma.business.findUnique({ where: { id } });
    if (!biz) throw new NotFoundError('Business', id);
    if (biz.status !== 'pending') throw new ConflictError('Business is not pending');
    await this.prisma.business.update({ where: { id }, data: { status: 'rejected' } });
  }
}
```

- [ ] **Step 4: Create PlatformAdminGuard**

Create `backend/src/modules/platform-admin/platform-admin.guard.ts`:

```ts
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { UnauthorizedError } from '../../common/errors';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

type PlatformAdminPayload = {
  sub: string;
  type: 'platform-admin';
  ver: number;
};

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing bearer token');
    }

    let payload: PlatformAdminPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformAdminPayload>(header.slice(7), {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    if (payload.type !== 'platform-admin') {
      throw new UnauthorizedError('Not a platform admin token');
    }

    return true;
  }
}
```

- [ ] **Step 5: Create DTO**

Create `backend/src/modules/platform-admin/dto/platform-admin-login.dto.ts`:

```ts
import { z } from 'zod';

export const PlatformAdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type PlatformAdminLoginInput = z.infer<typeof PlatformAdminLoginSchema>;
```

- [ ] **Step 6: Create controller**

Create `backend/src/modules/platform-admin/platform-admin.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { PlatformAdminLoginSchema, type PlatformAdminLoginInput } from './dto/platform-admin-login.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';

@ApiTags('platform-admin')
@Controller({ version: '1' })
export class PlatformAdminController {
  constructor(private readonly svc: PlatformAdminService) {}

  @Public()
  @Post('auth/platform-admin/login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(PlatformAdminLoginSchema))
  @ApiOperation({ summary: 'Platform admin login. Returns access token.' })
  async login(@Body() body: PlatformAdminLoginInput): Promise<{ accessToken: string }> {
    return this.svc.login(body.email, body.password);
  }

  @UseGuards(PlatformAdminGuard)
  @Get('admin/platform/businesses')
  @ApiOperation({ summary: 'List businesses by status (platform admin only).' })
  async listBusinesses(@Query('status') status?: string): Promise<unknown[]> {
    return this.svc.listBusinesses(status);
  }

  @UseGuards(PlatformAdminGuard)
  @Post('admin/platform/businesses/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a pending business (platform admin only).' })
  async approve(@Param('id') id: string): Promise<{ ok: true }> {
    await this.svc.approveBusiness(id);
    return { ok: true };
  }

  @UseGuards(PlatformAdminGuard)
  @Post('admin/platform/businesses/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a pending business (platform admin only).' })
  async reject(@Param('id') id: string): Promise<{ ok: true }> {
    await this.svc.rejectBusiness(id);
    return { ok: true };
  }
}
```

- [ ] **Step 7: Create module and register in AppModule**

Create `backend/src/modules/platform-admin/platform-admin.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
```

In `backend/src/app.module.ts`, add import and register:

```ts
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
```

Add `PlatformAdminModule` to the `imports` array.

- [ ] **Step 8: Run tests**

Run: `cd backend && npx jest src/modules/platform-admin/ --no-cache`

Expected: all PASS.

- [ ] **Step 9: Typecheck**

Run: `cd backend && npx tsc --noEmit`

- [ ] **Step 10: Commit**

```bash
cd backend
git add src/modules/platform-admin/ src/app.module.ts
git commit -m "feat: add PlatformAdmin login, guard, and business approval endpoints"
```

---

### Task 5: Mobile — onboarding flow (language picker + mini tutorial)

**Files:**
- Create: `mobile/app/(onboarding)/_layout.tsx`
- Create: `mobile/app/(onboarding)/language.tsx`
- Create: `mobile/app/(onboarding)/tutorial.tsx`
- Create: `mobile/src/lib/onboarding-store.ts`
- Modify: `mobile/app/_layout.tsx` (add onboarding gate)
- Modify: `mobile/src/i18n/en.ts`, `fr.ts`, `ar.ts` (add onboarding strings)

**Interfaces:**
- Consumes: `expo-router` Stack navigation, `@react-native-async-storage/async-storage`
- Produces: `hasSeenOnboarding` AsyncStorage flag; language stored in i18n; onboarding screens before auth

- [ ] **Step 1: Create onboarding store**

Create `mobile/src/lib/onboarding-store.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const KEY = 'tijaru.onboardingDone';

type OnboardingState = {
  status: 'loading' | 'pending' | 'done';
  load: () => Promise<void>;
  markDone: () => Promise<void>;
};

export const useOnboarding = create<OnboardingState>((set) => ({
  status: 'loading',
  load: async () => {
    const v = await AsyncStorage.getItem(KEY);
    set({ status: v === '1' ? 'done' : 'pending' });
  },
  markDone: async () => {
    await AsyncStorage.setItem(KEY, '1');
    set({ status: 'done' });
  },
}));
```

- [ ] **Step 2: Add i18n strings**

In `mobile/src/i18n/en.ts`, add an `onboarding` block:

```ts
onboarding: {
  chooseLanguage: 'Choose your language',
  next: 'Next',
  getStarted: 'Get started',
  skip: 'Skip',
  slide1Title: 'Manage your stock',
  slide1Desc: 'Track products, movements, and stock levels across all your warehouses.',
  slide2Title: 'Point of Sale',
  slide2Desc: 'Scan barcodes, create tickets, and process payments — right from your phone.',
  slide3Title: 'Reports & Insights',
  slide3Desc: 'See what sells, track expenses, and grow your business with data.',
},
```

Add equivalent French (primary) translations to `fr.ts`:

```ts
onboarding: {
  chooseLanguage: 'Choisissez votre langue',
  next: 'Suivant',
  getStarted: 'Commencer',
  skip: 'Passer',
  slide1Title: 'Gérez votre stock',
  slide1Desc: 'Suivez vos produits, mouvements et niveaux de stock dans tous vos dépôts.',
  slide2Title: 'Point de vente',
  slide2Desc: 'Scannez les codes-barres, créez des tickets et encaissez — depuis votre téléphone.',
  slide3Title: 'Rapports & Analyses',
  slide3Desc: 'Voyez ce qui se vend, suivez vos dépenses et développez votre activité.',
},
```

Add equivalent Arabic translations to `ar.ts`:

```ts
onboarding: {
  chooseLanguage: 'اختر لغتك',
  next: 'التالي',
  getStarted: 'ابدأ',
  skip: 'تخطي',
  slide1Title: 'أدر مخزونك',
  slide1Desc: 'تتبع المنتجات والحركات ومستويات المخزون في جميع مستودعاتك.',
  slide2Title: 'نقطة البيع',
  slide2Desc: 'امسح الباركود وأنشئ التذاكر وحصّل المدفوعات — من هاتفك.',
  slide3Title: 'التقارير والتحليلات',
  slide3Desc: 'تابع المبيعات والمصاريف وطوّر نشاطك بالبيانات.',
},
```

- [ ] **Step 3: Create onboarding layout**

Create `mobile/app/(onboarding)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
```

- [ ] **Step 4: Create language picker screen**

Create `mobile/app/(onboarding)/language.tsx`:

```tsx
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { I18nManager, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';

import { BrandMark } from '../../src/ui/brand-mark';
import { Btn } from '../../src/ui/btn';
import type { Lang } from '../../src/i18n';

const LANGUAGES: { code: Lang; label: string; flag: string }[] = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'ar', label: 'العربية', flag: '🇲🇦' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

export default function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const selectLanguage = async (lang: Lang) => {
    await i18n.changeLanguage(lang);
    const needsRTL = lang === 'ar';
    if (I18nManager.isRTL !== needsRTL) {
      I18nManager.allowRTL(needsRTL);
      I18nManager.forceRTL(needsRTL);
    }
    router.push('/(onboarding)/tutorial');
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-6">
        <BrandMark size={72} />
        <Text className="mt-4 text-xl font-bold text-ink-900">{t('app.name')}</Text>
        <Text className="mb-10 mt-2 text-base text-ink-500">{t('onboarding.chooseLanguage')}</Text>

        <View className="w-full gap-3">
          {LANGUAGES.map((lang) => (
            <Btn
              key={lang.code}
              label={`${lang.flag}  ${lang.label}`}
              variant={i18n.language === lang.code ? 'primary' : 'outline'}
              size="xl"
              onPress={() => selectLanguage(lang.code)}
            />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}
```

- [ ] **Step 5: Create tutorial screen**

Create `mobile/app/(onboarding)/tutorial.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, FlatList, Text, View, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Btn } from '../../src/ui/btn';
import { useOnboarding } from '../../src/lib/onboarding-store';

const { width } = Dimensions.get('window');

type Slide = { key: string; icon: string; titleKey: string; descKey: string };

const SLIDES: Slide[] = [
  { key: '1', icon: '📦', titleKey: 'onboarding.slide1Title', descKey: 'onboarding.slide1Desc' },
  { key: '2', icon: '🛒', titleKey: 'onboarding.slide2Title', descKey: 'onboarding.slide2Desc' },
  { key: '3', icon: '📊', titleKey: 'onboarding.slide3Title', descKey: 'onboarding.slide3Desc' },
];

export default function TutorialScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const markDone = useOnboarding((s) => s.markDone);
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]) setActiveIndex(Number(viewableItems[0].index));
    },
  ).current;

  const finish = async () => {
    await markDone();
    router.replace('/(auth)/login');
  };

  const next = () => {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
    } else {
      void finish();
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row justify-end px-6 pt-2">
        <Btn label={t('onboarding.skip')} variant="ghost" size="sm" onPress={finish} />
      </View>

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item }) => (
          <View style={{ width }} className="items-center justify-center px-10">
            <Text className="mb-4 text-6xl">{item.icon}</Text>
            <Text className="mb-3 text-center text-xl font-bold text-ink-900">
              {t(item.titleKey)}
            </Text>
            <Text className="text-center text-base leading-6 text-ink-500">
              {t(item.descKey)}
            </Text>
          </View>
        )}
        keyExtractor={(item) => item.key}
      />

      {/* Dots */}
      <View className="mb-4 flex-row justify-center gap-2">
        {SLIDES.map((_, i) => (
          <View
            key={i}
            className={`h-2 rounded-full ${i === activeIndex ? 'w-6 bg-brand-700' : 'w-2 bg-ink-200'}`}
          />
        ))}
      </View>

      <View className="px-6 pb-6">
        <Btn
          label={activeIndex === SLIDES.length - 1 ? t('onboarding.getStarted') : t('onboarding.next')}
          variant="primary"
          size="xl"
          onPress={next}
        />
      </View>
    </SafeAreaView>
  );
}
```

- [ ] **Step 6: Update root layout to gate onboarding**

In `mobile/app/_layout.tsx`:

1. Import the onboarding store: `import { useOnboarding } from '../src/lib/onboarding-store';`
2. Inside `RootLayout`, call `useOnboarding` bootstrap alongside auth bootstrap:

```tsx
const onboardingStatus = useOnboarding((s) => s.status);
const loadOnboarding = useOnboarding((s) => s.load);

useEffect(() => {
  void loadOnboarding();
}, [loadOnboarding]);
```

3. Update the `AuthGate` component to also check onboarding:

```tsx
function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const authStatus = useAuth((s) => s.status);
  const onboardingStatus = useOnboarding((s) => s.status);

  useEffect(() => {
    if (authStatus === 'loading' || onboardingStatus === 'loading') return;

    const inOnboarding = segments[0] === '(onboarding)';
    const inAuth = segments[0] === '(auth)';

    if (onboardingStatus === 'pending' && !inOnboarding) {
      router.replace('/(onboarding)/language');
    } else if (onboardingStatus === 'done' && authStatus === 'unauthenticated' && !inAuth) {
      router.replace('/(auth)/login');
    } else if (onboardingStatus === 'done' && authStatus === 'authenticated' && (inAuth || inOnboarding)) {
      router.replace('/(tabs)/home');
    }
  }, [authStatus, onboardingStatus, segments, router]);

  return null;
}
```

4. Add `(onboarding)` to the Stack:

```tsx
<Stack screenOptions={{ headerShown: false }}>
  <Stack.Screen name="(onboarding)" />
  <Stack.Screen name="(auth)" />
  <Stack.Screen name="(tabs)" />
</Stack>
```

5. Update `SplashScreen.hideAsync` condition to also wait for onboarding status:

```tsx
useEffect(() => {
  if (status !== 'loading' && onboardingStatus !== 'loading') {
    void SplashScreen.hideAsync();
  }
}, [status, onboardingStatus]);
```

- [ ] **Step 7: Test on device/simulator**

Run: `cd mobile && npx expo start`

Expected flow for fresh install: splash → language picker → tutorial (3 slides, swipeable, Skip button) → login screen. On second launch: splash → login screen directly (AsyncStorage flag persisted).

- [ ] **Step 8: Commit**

```bash
cd mobile
git add app/(onboarding)/ src/lib/onboarding-store.ts src/i18n/ app/_layout.tsx
git commit -m "feat: add first-launch onboarding (language picker + tutorial)"
```

---

### Task 6: Mobile — register screen + login wiring

**Files:**
- Create: `mobile/app/(auth)/register.tsx`
- Modify: `mobile/app/(auth)/login.tsx` (wire Pressable + handle 403)
- Modify: `mobile/src/i18n/en.ts`, `fr.ts`, `ar.ts` (add register strings)

**Interfaces:**
- Consumes: `api.post('/auth/register', ...)` → `{ status: 'pending' }`
- Produces: Register screen navigable from login, shows "pending" message on success

- [ ] **Step 1: Add i18n strings for register**

In `mobile/src/i18n/en.ts`, add to the `auth` block:

```ts
registerTitle: 'Create your account',
registerSub: 'Start managing your business',
businessName: 'Business name',
ownerName: 'Your full name',
confirmPassword: 'Confirm password',
phone: 'Phone (optional)',
register: 'Create account',
passwordMismatch: 'Passwords do not match',
passwordTooShort: 'Password must be at least 8 characters',
emailTaken: 'This email is already in use',
pendingApproval: 'Account created! Awaiting admin approval.',
pendingTitle: 'Awaiting approval',
pendingMessage: 'Your account has been created and is pending approval. You will be able to sign in once approved.',
backToLogin: 'Back to sign in',
accountPending: 'Your account is awaiting approval.',
accountRejected: 'Your application was not approved.',
```

Add equivalent translations to `fr.ts` and `ar.ts`.

- [ ] **Step 2: Create register screen**

Create `mobile/app/(auth)/register.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api } from '../../src/api/client';
import type { ApiError } from '../../src/api/client';
import { BrandMark } from '../../src/ui/brand-mark';
import { Btn } from '../../src/ui/btn';
import { Field } from '../../src/ui/field';

export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (businessName.trim().length < 2) e.businessName = t('common.required');
    if (ownerName.trim().length < 2) e.ownerName = t('common.required');
    if (!email.trim()) e.email = t('common.required');
    if (password.length < 8) e.password = t('auth.passwordTooShort');
    if (password !== confirmPassword) e.confirmPassword = t('auth.passwordMismatch');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.post(
        '/auth/register',
        {
          businessName: businessName.trim(),
          ownerName: ownerName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || undefined,
          password,
        },
        { withAuth: false },
      );
      setSuccess(true);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.code === 'conflict') {
        setErrors({ email: t('auth.emailTaken') });
      } else {
        Alert.alert(t('common.error'), t('auth.networkError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="mb-3 text-5xl">⏳</Text>
          <Text className="mb-2 text-xl font-bold text-ink-900">{t('auth.pendingTitle')}</Text>
          <Text className="mb-8 text-center text-base leading-6 text-ink-500">
            {t('auth.pendingMessage')}
          </Text>
          <Btn
            label={t('auth.backToLogin')}
            variant="primary"
            size="xl"
            onPress={() => router.replace('/(auth)/login')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6 pt-6">
            <View className="mb-6 items-center">
              <BrandMark size={48} />
            </View>

            <Text className="text-[22px] font-extrabold tracking-tight text-ink-900">
              {t('auth.registerTitle')}
            </Text>
            <Text className="mb-5 mt-1 text-[13px] text-ink-500">{t('auth.registerSub')}</Text>

            <Field
              label={t('auth.businessName')}
              required
              value={businessName}
              onChangeText={setBusinessName}
              error={errors.businessName}
              placeholder="Mon entreprise SARL"
            />
            <Field
              label={t('auth.ownerName')}
              required
              value={ownerName}
              onChangeText={setOwnerName}
              error={errors.ownerName}
              placeholder="Mohammed El Amrani"
            />
            <Field
              label={t('auth.email')}
              required
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              error={errors.email}
              placeholder="vous@example.com"
            />
            <Field
              label={t('auth.phone')}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              placeholder="+212 6XX XXX XXX"
            />
            <Field
              label={t('auth.password')}
              required
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              error={errors.password}
              placeholder="••••••••"
            />
            <Field
              label={t('auth.confirmPassword')}
              required
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={errors.confirmPassword}
              placeholder="••••••••"
            />

            <View className="mt-2">
              <Btn
                label={submitting ? t('common.loading') : t('auth.register')}
                variant="primary"
                size="xl"
                onPress={onSubmit}
                disabled={submitting}
              />
            </View>

            <View className="mt-6 flex-row justify-center pb-8">
              <Text className="text-xs text-ink-500">{t('auth.hasAccount')} </Text>
              <Btn label={t('auth.login')} variant="ghost" size="sm" onPress={() => router.back()} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

Add `hasAccount: 'Already have an account?'` to i18n `auth` blocks (en/fr/ar).

- [ ] **Step 3: Wire login.tsx — "Create an account" link + 403 handling**

In `mobile/app/(auth)/login.tsx`:

1. Add `import { useRouter } from 'expo-router';` and call `const router = useRouter();`

2. Replace the dead `<Pressable>` (lines 114-118) with:

```tsx
<Pressable onPress={() => router.push('/(auth)/register')}>
  <Text className="text-xs font-semibold text-brand-700">
    {t('auth.createAccount')}
  </Text>
</Pressable>
```

3. Update the error handler in `onSubmit` to handle 403 (pending/rejected business):

```tsx
} catch (e) {
  const err = e as { code?: string; title?: string; status?: number };
  if (err.status === 403) {
    if (err.title?.includes('awaiting')) setError(t('auth.accountPending'));
    else if (err.title?.includes('not approved')) setError(t('auth.accountRejected'));
    else setError(err.title ?? t('auth.networkError'));
  } else if (err.code === 'unauthorized') {
    setError(t('auth.invalidCredentials'));
  } else {
    setError(t('auth.networkError'));
  }
  Alert.alert(t('common.error'), error ?? t('auth.networkError'));
}
```

- [ ] **Step 4: Test on device/simulator**

Run: `cd mobile && npx expo start`

Test:
1. "Create an account" link navigates to register screen.
2. Fill form, submit → "Awaiting approval" success view.
3. Try login with the new account → "Awaiting approval" error shown.
4. Go back to login from register works.

- [ ] **Step 5: Commit**

```bash
cd mobile
git add app/(auth)/register.tsx app/(auth)/login.tsx src/i18n/
git commit -m "feat: add register screen + wire create-account link + 403 handling"
```

---

### Task 7: Web — platform-admin login + pending-approvals page

**Files:**
- Create: `web/src/platform-admin/pa-auth-store.ts`
- Create: `web/src/platform-admin/pa-client.ts`
- Create: `web/src/pages/platform-admin/PALoginPage.tsx`
- Create: `web/src/pages/platform-admin/PendingApprovalsPage.tsx`
- Modify: `web/src/App.tsx` (add routes)

**Interfaces:**
- Consumes: `POST /api/v1/auth/platform-admin/login`, `GET /api/v1/admin/platform/businesses?status=pending`, `POST /api/v1/admin/platform/businesses/:id/approve`, `POST /api/v1/admin/platform/businesses/:id/reject`
- Produces: Platform-admin login page at `/platform-admin/login`; pending approvals page at `/platform-admin/approvals`

- [ ] **Step 1: Create PA auth store**

Create `web/src/platform-admin/pa-auth-store.ts`:

```ts
import { create } from 'zustand';

import { apiFetch } from '../api/client';

const PA_TOKEN_KEY = 'tijaru.paAccessToken';

type PAAuthState = {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  token: string | null;
  bootstrap: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

export const usePAAuth = create<PAAuthState>((set) => ({
  status: 'loading',
  token: null,

  bootstrap: () => {
    const token = localStorage.getItem(PA_TOKEN_KEY);
    set({ status: token ? 'authenticated' : 'unauthenticated', token });
  },

  login: async (email, password) => {
    const res = await apiFetch<{ accessToken: string }>(
      '/auth/platform-admin/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
      { withAuth: false },
    );
    localStorage.setItem(PA_TOKEN_KEY, res.accessToken);
    set({ status: 'authenticated', token: res.accessToken });
  },

  logout: () => {
    localStorage.removeItem(PA_TOKEN_KEY);
    set({ status: 'unauthenticated', token: null });
  },
}));
```

- [ ] **Step 2: Create PA API helper**

Create `web/src/platform-admin/pa-client.ts`:

```ts
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

export async function paFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('tijaru.paAccessToken');
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { status: res.status, ...body };
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}
```

- [ ] **Step 3: Create PA login page**

Create `web/src/pages/platform-admin/PALoginPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { usePAAuth } from '../../platform-admin/pa-auth-store';
import { Btn } from '../../ui/Btn';
import { Input } from '../../ui/Input';

export function PALoginPage() {
  const navigate = useNavigate();
  const login = usePAAuth((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate('/platform-admin/approvals');
    } catch {
      setError('Invalid credentials');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-card">
        <div className="mb-6 flex flex-col items-center">
          <svg className="mb-3 h-14 w-14" viewBox="0 0 100 100" aria-label="Tijaru">
            <rect x="8" y="8" width="39" height="39" rx="9.36" fill="#0F766E" />
            <rect x="53" y="8" width="39" height="39" rx="9.36" fill="#F97316" />
            <rect x="8" y="53" width="39" height="39" rx="9.36" fill="#0F766E" />
            <rect x="53" y="53" width="39" height="39" rx="9.36" fill="#0F766E" />
          </svg>
          <div className="text-sm font-bold text-ink-900">Tijaru</div>
          <div className="text-xs text-ink-500">Platform Admin</div>
        </div>

        <h1 className="text-xl font-extrabold text-ink-900">Admin Login</h1>
        <p className="mb-6 mt-1 text-sm text-ink-500">Sign in to manage the platform</p>

        <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />

        {error ? <p className="mb-3 text-xs text-danger-600">{error}</p> : null}

        <Btn type="submit" size="xl" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Btn>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Create pending-approvals page**

Create `web/src/pages/platform-admin/PendingApprovalsPage.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

import { usePAAuth } from '../../platform-admin/pa-auth-store';
import { paFetch } from '../../platform-admin/pa-client';
import { Btn } from '../../ui/Btn';

type BusinessItem = {
  id: string;
  name: string;
  status: string;
  phone: string | null;
  createdAt: string;
  users: { id: string; name: string; email: string; phone: string | null }[];
};

function PendingTable() {
  const queryClient = useQueryClient();
  const { data: businesses = [], isLoading } = useQuery({
    queryKey: ['pa-businesses', 'pending'],
    queryFn: () => paFetch<BusinessItem[]>('/admin/platform/businesses?status=pending'),
  });

  const approve = useMutation({
    mutationFn: (id: string) => paFetch(`/admin/platform/businesses/${id}/approve`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pa-businesses'] }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => paFetch(`/admin/platform/businesses/${id}/reject`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pa-businesses'] }),
  });

  if (isLoading) return <p className="text-ink-500">Loading…</p>;

  if (businesses.length === 0) {
    return <p className="py-12 text-center text-ink-500">No pending applications</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs font-semibold text-ink-500">
            <th className="px-4 py-3">Business</th>
            <th className="px-4 py-3">Owner</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Signed up</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {businesses.map((biz) => {
            const owner = biz.users[0];
            return (
              <tr key={biz.id} className="border-b">
                <td className="px-4 py-3 font-medium text-ink-900">{biz.name}</td>
                <td className="px-4 py-3">{owner?.name ?? '—'}</td>
                <td className="px-4 py-3">{owner?.email ?? '—'}</td>
                <td className="px-4 py-3">{owner?.phone ?? biz.phone ?? '—'}</td>
                <td className="px-4 py-3 text-ink-500">
                  {new Date(biz.createdAt).toLocaleDateString()}
                </td>
                <td className="flex gap-2 px-4 py-3">
                  <Btn size="sm" onClick={() => approve.mutate(biz.id)}>
                    Approve
                  </Btn>
                  <Btn size="sm" variant="danger" onClick={() => reject.mutate(biz.id)}>
                    Reject
                  </Btn>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PendingApprovalsPage() {
  const status = usePAAuth((s) => s.status);
  const logout = usePAAuth((s) => s.logout);
  const bootstrap = usePAAuth((s) => s.bootstrap);
  const navigate = useNavigate();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (status === 'unauthenticated') navigate('/platform-admin/login');
  }, [status, navigate]);

  if (status !== 'authenticated') return null;

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Pending Approvals</h1>
            <p className="text-sm text-ink-500">Review and approve new business signups</p>
          </div>
          <Btn size="sm" variant="ghost" onClick={logout}>
            Sign out
          </Btn>
        </div>
        <div className="rounded-2xl bg-white p-1 shadow-card">
          <PendingTable />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add routes to App.tsx**

In `web/src/App.tsx`, add imports:

```tsx
import { PALoginPage } from './pages/platform-admin/PALoginPage';
import { PendingApprovalsPage } from './pages/platform-admin/PendingApprovalsPage';
```

Add routes inside `<Routes>`, outside the `ProtectedRoute` wrapper (these are standalone):

```tsx
<Route path="/platform-admin/login" element={<PALoginPage />} />
<Route path="/platform-admin/approvals" element={<PendingApprovalsPage />} />
```

- [ ] **Step 6: Add Tijaru logo to web admin login page**

Replace the inline SVG logo in both `PALoginPage.tsx` and `LoginPage.tsx` with the actual Tijaru logo (copy the logo PNG from mobile assets or use the same inline SVG). The SVG is already present in `LoginPage.tsx` — reuse the exact same `<svg>` block.

- [ ] **Step 7: Test in browser**

Run: `cd ../web && npm run dev`

Test:
1. Navigate to `/platform-admin/login` → shows PA login form.
2. Login with platform admin credentials → redirects to `/platform-admin/approvals`.
3. Pending businesses show in table with Approve/Reject buttons.
4. Approve → business disappears from list, tenant owner can now login.
5. Reject → business disappears from list, tenant owner gets "not approved" error on login.
6. Tenant `/login` page still works independently.

- [ ] **Step 8: Commit**

```bash
cd ../web
git add src/platform-admin/ src/pages/platform-admin/ src/App.tsx
git commit -m "feat: add platform-admin login + pending-approvals page"
```

---

### Task 8: Integration test — full signup → approve → login flow

**Files:**
- Modify: `backend/src/modules/auth/application/auth.service.spec.ts` (add integration-style test)

**Interfaces:**
- Consumes: all previous tasks
- Produces: confidence that the full flow works end-to-end

- [ ] **Step 1: Add end-to-end-style unit test**

Append to `backend/src/modules/auth/application/auth.service.spec.ts`:

```ts
describe('full signup → approve → login flow', () => {
  it('register creates pending business, login blocked, approve unblocks', async () => {
    const repo = mockRepo();
    repo.emailInUse.mockResolvedValue(false);
    repo.createBusinessWithOwner = jest.fn().mockResolvedValue({ businessId: 'b1', userId: 'u1' });
    const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);

    // 1. Register
    const registerResult = await svc.register({
      businessName: 'Test Biz',
      ownerName: 'Owner',
      email: 'owner@test.com',
      password: 'pass1234',
    });
    expect(registerResult.status).toBe('pending');

    // 2. Login should fail (pending)
    const pendingUser = makeUser({ email: 'owner@test.com', businessStatus: 'pending' });
    pendingUser.passwordHash = await bcrypt.hash('pass1234', 4);
    repo.findUserByEmail.mockResolvedValue(pendingUser);
    await expect(svc.login('owner@test.com', 'pass1234', meta)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // 3. After approve (business.status → active), login succeeds
    const activeUser = makeUser({ email: 'owner@test.com', businessStatus: 'active' });
    activeUser.passwordHash = pendingUser.passwordHash;
    repo.findUserByEmail.mockResolvedValue(activeUser);
    repo.createSession.mockResolvedValue(undefined);
    repo.recordLogin.mockResolvedValue(undefined);
    const loginResult = await svc.login('owner@test.com', 'pass1234', meta);
    expect(loginResult.tokens.accessToken).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run all auth tests**

Run: `cd backend && npx jest src/modules/auth/ src/modules/platform-admin/ --no-cache`

Expected: all PASS.

- [ ] **Step 3: Full typecheck across backend**

Run: `cd backend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/modules/auth/application/auth.service.spec.ts
git commit -m "test: add full signup → approve → login integration test"
```
