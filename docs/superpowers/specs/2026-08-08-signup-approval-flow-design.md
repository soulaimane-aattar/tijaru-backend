# Self-serve signup + platform-admin approval — design

## Problem

Tijaru is currently platform-admin-provisioned only: no way for a new SMB to
create their own Business + owner account. Mobile login screen has a
"Create an account" link that does nothing (`app/(auth)/login.tsx:114`).

## Goal

Let a prospective customer sign up from the mobile app (business name + owner
details), landing in a `pending` state that blocks login until a platform
admin reviews and approves (or rejects) the application from the web admin.

## Data model

`prisma/schema.prisma`:

```prisma
enum BusinessStatus {
  active
  suspended
  pending    // new — awaiting platform-admin review
  rejected   // new — reviewed and declined
}
```

`Business.ice` (Moroccan tax ID, currently `String @unique` required) becomes
optional: `ice String? @unique` — signup doesn't collect it (minimal-fields
decision below); filled in later from business settings. Postgres unique
constraints allow multiple `NULL`s, so this is safe.

No changes to `User` — the approval gate lives entirely on `Business.status`,
not on the user, so there's only one flag to keep in sync.

## Signup — what it creates

One `$transaction`, creates:
- `Business` — `name`, `phone` (optional), `status: pending`, `ice: null`
  (all other Moroccan legal fields — rc/patente/ifNum/cnss/address/city —
  left null, filled in later via business settings).
- `User` — `role: owner`, linked to the new business, `name`, `email`,
  `phone` (optional), `passwordHash`.

No tokens are issued on signup (nothing to log into yet while pending).
Response: `{ status: 'pending' }`.

### Signup fields (mobile form)

- Business name (required)
- Owner name (required)
- Email (required, must be unique — reuse `AuthService.ensureNoConflict`)
- Phone (optional)
- Password (required, min 8 — matches `PLATFORM_ADMIN_PASSWORD` schema rule)
- Confirm password (client-only, not sent to API)

## Backend

### `POST /auth/register` (`@Public()`)

```ts
RegisterSchema = z.object({
  businessName: z.string().min(2),
  ownerName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
})
```

`AuthService.register()`:
1. `ensureNoConflict(email)` → 409 if email already in use.
2. `$transaction`: create `Business` (`status: pending`), create `User`
   (`role: owner`).
3. Return `{ status: 'pending' }` — no tokens.

### Login gate

`AuthService.login()`, after resolving the user (repo query now includes
`business` relation): if `user.business.status !== 'active'`, throw
`ForbiddenException` with a message keyed on status:
- `pending` → "Your account is awaiting approval."
- `rejected` → "Your application was not approved."
- `suspended` → existing suspended-business message (if any exists today;
  otherwise same generic pattern).

This check happens *before* password comparison is wasted on a business that
can't log in anyway — right after `findUserByEmail`, alongside the existing
`!user.active` check.

### Platform-admin auth (new `PlatformAdminModule`)

Separate identity space from tenant auth — `PlatformAdmin` isn't in
`TENANT_MODELS` and carries no `businessId`.

- `POST /auth/platform-admin/login` (`@Public()`) — email+password against
  `PlatformAdmin.passwordHash`. Issues a JWT signed with the same
  `JWT_ACCESS_SECRET`, but with a distinguishing claim: `{ sub, type:
  'platform-admin', ver: tokenVersion }`. No `bid`/`role`/`caps` claims —
  tenant `JwtAuthGuard`/`CapsGuard` reject it structurally, no denylist code
  needed. No refresh token for v1 — re-login when the access token expires.
- `PlatformAdminGuard` — decodes the token, requires `type ===
  'platform-admin'` and `ver` matches the current `PlatformAdmin.tokenVersion`
  (mirrors the tenant token-version bump-to-invalidate pattern).

### Approval endpoints (behind `PlatformAdminGuard`)

- `GET /admin/platform/businesses?status=pending` — list businesses by
  status, each with owner user summary (name, email, phone) and
  `createdAt`.
- `POST /admin/platform/businesses/:id/approve` — `pending → active`. 409 if
  business isn't currently `pending`.
- `POST /admin/platform/businesses/:id/reject` — `pending → rejected`. Same
  409 guard. Data is kept (not deleted) for audit — login stays blocked with
  the "not approved" message.

## Mobile (`app/(auth)/`)

- New route `register.tsx` — form per the fields above, Zod-mirrored client
  validation, matches the existing login screen's visual style.
- `login.tsx:114` — the dead `<Pressable>` gets `onPress={() =>
  router.push('/(auth)/register')}`.
- On signup success: show "Account pending approval" and route back to
  login (no auto-login — nothing to log into).
- Login screen's existing error-display path surfaces the backend's 403
  message verbatim when the business is pending/rejected/suspended.

## Web admin (`../web`)

Standalone route tree, deliberately separate from the tenant `src/auth`
module (different token, different API base path, different login page):

- `src/platform-admin/` — `login` page + `pending-approvals` page (table:
  business name, owner email, created date, Approve/Reject buttons).
- Platform-admin token stored under its own storage key so it can never
  collide with a tenant session in the same browser.

## Error handling

- Signup: duplicate email → 409; weak password → 400 (Zod).
- Login against non-active business → 403, status-keyed message.
- Approve/reject a non-pending business → 409.

## Testing

- Unit: `AuthService.register()` creates a pending Business + owner User;
  `AuthService.login()` gate for all four `BusinessStatus` values; guard
  rejects cross-type tokens (tenant guard rejects platform-admin token and
  vice versa); approve/reject state-transition guards.
- E2E: signup → blocked login → platform-admin approve → login succeeds.
