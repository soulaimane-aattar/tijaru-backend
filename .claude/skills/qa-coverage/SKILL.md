---
name: qa-coverage
description: Use when adding QA tests or raising test coverage for Tijaru — backend (NestJS/Jest) or web (React/Vitest). Triggers on "add tests", "test coverage", "coverage report", "write unit tests", "e2e tests", untested modules, or coverage gaps after a feature lands.
---

# QA Coverage

Raise test coverage toward maximum on backend and web, driven by real coverage reports — never guess what's untested.

## Process

1. **Measure first** — run coverage, never write tests blind:
   - Backend: `cd backend && npm run test:cov`
   - Web: `cd web && npm run test:cov`
2. **Rank gaps** — sort report by uncovered lines. Prioritize: business logic (services, hooks, stores) > controllers/pages > DTOs/UI glue. Skip generated code, `main.ts`, module wiring files.
3. **Write tests per gap** using project patterns below. One describe-block per public method/behavior. Cover: happy path, each error branch, each guard/permission branch, edge values (0, empty, null tenant, expired subscription).
4. **Verify green**: run the suite for the touched app, then re-run coverage and report the before/after per-file delta.
5. **Never weaken code to make it testable** — refactor for injection only, behavior unchanged.

## Backend patterns (NestJS + Jest)

- Unit tests: `*.spec.ts` next to source (jest `rootDir: src`, `testRegex .*\.spec\.ts$`).
- Use `Test.createTestingModule` with mocked `PrismaService` (`jest.fn()` per delegate method: `prisma.product.findMany.mockResolvedValue(...)`). Never hit real DB in unit tests.
- E2E: `backend/test/*.e2e-spec.ts`, run with `npm run test:e2e`. Reuse `test/helpers/test-app.ts` for app bootstrap; supertest for HTTP. E2E hits real Postgres on **5433** — override `DATABASE_URL`, never trust `.env`.
- Assert: status codes, response shape (zod DTOs), tenant isolation (user A cannot read tenant B data), auth guards (401 without token, 403 wrong role).

## Web patterns (Vitest + Testing Library)

- Tests `*.test.ts(x)` next to source; jsdom env, setup in `src/test/setup.ts`.
- Components: render with providers (QueryClientProvider, MemoryRouter, i18n) — copy wrapper from an existing page test (e.g. `src/pages/pos/POSPage.test.tsx`).
- Mock API layer (`src/api`) with `vi.mock`, not fetch. Hooks/stores (zustand, usePosCart-style) get pure unit tests.
- Query by role/label (a11y queries), `userEvent` for interaction, assert visible outcome not implementation.
- i18n: assert via translation keys or use `t` from test i18n instance — never hardcode one locale's string if the app renders another.

## Definition of done

- Both suites green: `npm test` (backend + web), `npm run test:e2e` when API surface touched.
- Coverage delta reported per file in the summary.
- No `.only`, no skipped tests, no snapshot-only component tests.
- `npm run lint` and `npm run typecheck` pass on touched apps.
- Then invoke `document-step` (project rule).

## Common mistakes

| Mistake | Fix |
|---|---|
| Writing tests without running coverage first | Measure, rank, then write |
| Mocking Prisma at global module level, leaking between tests | `beforeEach` fresh mocks, `jest.clearAllMocks()` |
| Testing rendered French/English literals | Use i18n keys or test instance |
| E2E against wrong DB | `DATABASE_URL` → port 5433 explicitly |
| Chasing 100% on wiring files | Exclude modules/main/config; maximize logic coverage |
