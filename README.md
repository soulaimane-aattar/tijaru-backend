# Stock — Backend

NestJS + Prisma + PostgreSQL API for the **Stock** inventory + POS + admin platform.
Source of truth for entities, role/capability matrix, business rules. Web + mobile consume via REST.

See repository-root `Stock-build-spec.md` for product spec and `IMPLEMENTATION_PLAN.md` for the phase plan.

## Stack

- **NestJS 10** (modular, DI, decorators)
- **Prisma 5** + **PostgreSQL 16**
- **JWT** access (15 min) + refresh (7 d) with rotation
- **Zod** validation via `nestjs-zod`
- **Pino** structured logging
- **Swagger / OpenAPI 3.1** — `/api/docs`, `/api/openapi.json`
- **Helmet** + **Throttler** (rate-limit `/auth/login` 5/min/IP)

## Architecture

Clean Architecture, per module:

```
modules/<x>/
├── <x>.controller.ts      thin HTTP layer
├── application/           use cases — one class per
├── infrastructure/        prisma-<x>.repository.ts
├── dto/                   Zod schemas + inferred types
└── <x>.module.ts
```

Domain layer (`src/domain/`) is framework-free: entities, value objects, `permissions.ts` (single source of truth for the role × capability matrix — spec §6.2).

## Local setup

Prereqs: Node 20+, Docker.

```bash
cp .env.example .env
npm install
docker compose up -d           # postgres on :5432
npx prisma migrate dev         # creates schema
npm run prisma:seed            # spec §5.2 demo data
npm run start:dev              # http://localhost:3000/api
```

Swagger UI → http://localhost:3000/api/docs

## Demo accounts (after seed)

Password for all: `demo1234`

| Role | Email | Name |
|------|-------|------|
| owner | youssef@elamrani.ma | Youssef El Amrani |
| admin | fatima@elamrani.ma | Fatima Zahra Bennani |
| manager | karim@elamrani.ma | Karim Tazi |
| stockkeeper | hassan@elamrani.ma | Hassan Alaoui |
| cashier | salma@elamrani.ma | Salma Idrissi |

## Tests

```bash
npm test            # unit
npm run test:e2e    # functional (supertest)
npm run test:cov    # coverage
```

Target: ≥85% coverage on `domain/` and `application/`.

## Adding a new module

1. `src/domain/entities/<name>.ts` — entity + invariants.
2. Add Prisma model + migration: `npx prisma migrate dev --name add-<name>`.
3. `src/modules/<name>/` — module, controller, use cases, repository, DTOs.
4. Add capability ids to `src/domain/permissions.ts` (e.g. `<name>.view`, `<name>.manage`). Web + mobile pick them up automatically via `/auth/permissions`.

Module is auto-discovered by `AppModule` glob — no core file edit needed.

## Permissions

`GET /auth/permissions` returns the full role × capability matrix for client apps to cache.
The matrix lives at `src/domain/permissions.ts` and is reflected verbatim by both web and mobile.
