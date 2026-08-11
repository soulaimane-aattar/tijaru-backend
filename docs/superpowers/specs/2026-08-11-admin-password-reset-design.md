# Admin password reset (platform-admin) — design

**Date:** 2026-08-11
**Status:** approved

## Problem

A platform super-admin can list users cross-tenant (`/platform-admin/users`) but cannot help a
locked-out user regain access. No password-reset path exists anywhere in the product: `UsersPage`
sets a password only at creation, `PAUsersPage` is read-only, and there is no forgot/reset endpoint.

The static prototype already mocks this flow (temp password + copy in `admin-users.html`). This
brings it to the real app.

## Scope

- **Platform-admin only.** Action lives on `PAUsersPage`. Merchant `UsersPage` is out of scope.
- **Temp-password on-screen.** Backend generates a one-time temp password, revokes sessions, and
  returns it once. No email/reset-link infrastructure (none exists yet).

Untouched — already correct in the real app, contrary to the old prototype screenshot:
platform-only sidebar (`AdminShell`: `groups = isSuperAdmin ? [PA_GROUP] : GROUPS`), the separate
PA pages, and the `/accueil` landing page.

## Backend (`backend/`, NestJS + Prisma)

### Service — `PlatformAdminService.resetUserPassword(userId)`

1. `user.findFirst({ where: { id: userId, deletedAt: null } })` → `NotFoundError('User', id)` if absent.
2. Read the user's business `SecurityPolicy.passwordMinLen` (default 8) to size the temp password.
3. Generate a temp password with `crypto.randomInt`:
   - Unambiguous alphabet — no `O 0 I 1 l` — from `A–Z a–z 2–9`.
   - Length = `max(10, passwordMinLen)`.
4. `bcrypt.hash(temp, env.BCRYPT_COST)`.
5. In a `$transaction`:
   - `user.update` → `{ passwordHash, tokenVersion: { increment: 1 } }` (bumps `ver`, so refresh
     rejects the old token; short-lived access token expires on its own — same mechanism as
     logout-all).
   - `session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })`
     → revokes active refresh sessions (matches the existing revoke-all pattern in
     `prisma-auth.repository.ts`; refresh checks `revokedAt: null`).
6. Return `{ tempPassword: temp }`.

`crypto` is Node built-in. `session` model already exists (`User.sessions Session[]`).

### Controller — `PlatformAdminController`

```
@Post('admin/platform/users/:id/reset-password')
@HttpCode(200)
@Public() @UseGuards(PlatformAdminGuard)   // matches every other PA route
resetUserPassword(@Param('id') id) => svc.resetUserPassword(id)
```

Returns `{ tempPassword: string }`.

### Tests — `platform-admin.service.spec.ts`

Extend the existing mock prisma with `user.findFirst`, `user.update`, `session.updateMany`,
`securityPolicy.findUnique`. Add `BCRYPT_COST: 4` to `mockEnv`.

- returns a temp password of length ≥ 10, from the unambiguous alphabet
- persists a bcrypt hash that verifies against the returned temp password
- increments `tokenVersion` and revokes sessions via `session.updateMany`
- honors a larger `passwordMinLen` when the policy sets one
- `NotFoundError` on unknown / soft-deleted user

## Frontend (`web/`, React + Vite + Tailwind)

### `pa-api.ts`

```
resetUserPassword: (id: string) =>
  api.post<{ tempPassword: string }>(`/admin/platform/users/${id}/reset-password`)
```

### `src/ui/Modal.tsx` (new — no modal primitive exists)

Backdrop, `role="dialog"` + `aria-modal`, Esc-to-close, focus trap, click-backdrop-to-close.
Props: `title`, `onClose`, `children`, optional `footer`. Reusable.

### `PAUsersPage`

- Add an **Actions** column (`th` empty header) to the users table.
- Per-row button "Réinitialiser le mot de passe".
- Click → confirm `Modal`: warns "la session en cours sera fermée", confirm/cancel.
- Confirm → `useMutation(resetUserPassword)` → on success swap to a result `Modal` showing the
  temp password in a mono field + **Copier** button (`navigator.clipboard`).
- Error → inline message in the modal.

### Tests — `PAUsersPage.test.tsx`

- row action opens the confirm modal
- confirming calls `paApi.resetUserPassword` with the row id
- success renders the returned temp password

## Security notes

- Temp password is returned exactly once, never stored in plaintext (only the bcrypt hash persists).
- Session revocation via `tokenVersion` bump + `session.updateMany(revokedAt)` matches existing logout-all.
- Endpoint is behind `PlatformAdminGuard`; no tenant-user can call it.
