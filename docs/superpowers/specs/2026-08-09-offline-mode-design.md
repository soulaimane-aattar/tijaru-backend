# Offline Mode + Auto-Sync — Design Spec

## Goal

Mobile app (Expo) works without internet for POS, expenses, and stock modules. Writes queue locally and sync automatically when connectivity returns. Last-write-wins conflict resolution. No web/PWA scope.

## Architecture

**Approach:** Operation Queue + React Query Persist. Offline writes go into a persistent queue (AsyncStorage). On reconnect, queue replays against existing REST API in FIFO order. React Query cache persisted to disk for offline reads. Minimal backend changes (idempotency keys only).

**Platforms:** Mobile only (Expo/React Native).

**Modules with offline support:** POS, Expenses, Stock (adjustments/movements).

**Modules online-only:** Reports, user management, platform admin, settings (except sync status), purchase orders.

## 1. Connectivity Detection

### NetInfo Provider

Use `@react-native-community/netinfo` to detect connectivity changes. Wrap app in `<ConnectivityProvider>` exposing:

- `isOnline: boolean` — current state
- `subscribe(callback)` — change listener

### React Query Integration

- `onlineManager.setOnline(false)` when offline — stops background refetches
- `onlineManager.setOnline(true)` on reconnect — resumes refetches

### Offline Banner

Global banner component rendered below header when offline:

- **Offline:** "Mode hors ligne — les données seront synchronisées automatiquement"
- **Syncing:** "Synchronisation en cours... (3/12)"
- **Back online:** banner disappears after sync completes

## 2. React Query Persistence (Read Cache)

Wire up `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` (both already in `package.json`).

### Cached Queries (available offline)

| Query | Key pattern | Stale time |
|-------|-------------|------------|
| Products list | `['products', businessId]` | 5 min |
| Product detail | `['products', id]` | 5 min |
| Categories | `['categories', businessId]` | 30 min |
| Warehouses | `['warehouses', businessId]` | 30 min |
| Customers | `['customers', businessId]` | 5 min |
| POS session | `['pos-session', businessId]` | 1 min |
| Recent tickets | `['pos-tickets', businessId]` | 5 min |
| Expenses list | `['expenses', businessId]` | 5 min |
| Stock levels | `['stock-levels', warehouseId]` | 5 min |

### Cache Config

- **Max cache age:** 7 days (`gcTime: 7 * 24 * 60 * 60 * 1000`)
- **Stale time online:** per-query (table above)
- **Stale time offline:** `Infinity` (never refetch while offline)
- **Persister:** AsyncStorage with key `REACT_QUERY_OFFLINE_CACHE`
- **Buster:** app version string (cache invalidated on app update)

### Online-Only Screens

Modules without offline support show a full-screen placeholder: "Connexion requise pour accéder à cette fonctionnalité" with a retry button.

## 3. Operation Queue (Offline Writes)

### Queue Entry Schema

```typescript
type QueueEntry = {
  id: string;           // client-generated UUID (also used as idempotency key)
  type: 'create' | 'update' | 'delete';
  module: 'pos' | 'expenses' | 'stock';
  endpoint: string;     // e.g. '/api/v1/pos/tickets'
  method: 'POST' | 'PATCH' | 'DELETE';
  body: Record<string, unknown>;
  createdAt: number;    // Date.now()
  status: 'pending' | 'syncing' | 'failed' | 'done';
  retries: number;
  error?: string;
};
```

### Storage

- AsyncStorage key: `OFFLINE_QUEUE`
- Format: JSON array of `QueueEntry`
- Cap: 500 entries max. At cap, new writes blocked with user warning.
- Completed entries (`done`) pruned after each sync cycle.

### Optimistic Updates

When a mutation is queued offline, the React Query cache is also updated optimistically so the UI reflects the change immediately:

- **Create:** insert into list cache with temporary client UUID as ID
- **Update:** patch existing entry in cache
- **Delete:** remove from cache

On sync, server response replaces optimistic data (e.g., server-assigned ID replaces client UUID).

### useMutation Wrapper

`useOfflineMutation(options)` — wraps `useMutation`:

- **Online:** calls API directly (normal behavior)
- **Offline:** adds to queue + optimistic cache update + returns immediately

## 4. Sync Engine

### Trigger

1. NetInfo fires `isConnected: true`
2. Debounce 2 seconds (avoid flapping)
3. Start sync if queue has pending entries

### Replay Flow

1. Read queue from AsyncStorage
2. Filter entries with `status: 'pending'` or `status: 'failed' && retries < 3`
3. Process sequentially (FIFO by `createdAt`)
4. For each entry:
   - Set `status: 'syncing'`
   - Call API with `X-Idempotency-Key: entry.id` header
   - On success: set `status: 'done'`, update React Query cache with server response
   - On 4xx (validation/not-found): set `status: 'failed'`, store error message, do not retry
   - On 5xx/network error: increment `retries`, set `status: 'failed'`, retry with backoff
5. Prune `done` entries from queue
6. Persist updated queue to AsyncStorage
7. Invalidate all React Query caches (trigger fresh fetch from server)

### Retry Policy

- Max 3 retries per entry
- Exponential backoff: 1s, 4s, 16s
- 4xx errors (client errors) are not retried — they indicate bad data
- After 3 failed retries: entry stays `failed`, user must handle manually

### Progress

Sync engine emits progress via Zustand store:

```typescript
type SyncState = {
  isSyncing: boolean;
  total: number;
  completed: number;
  failed: number;
};
```

Banner reads this state for "Synchronisation 3/12..." display.

## 5. Backend Changes

### Idempotency Decorator

New `@Idempotent()` method decorator for POST endpoints that create resources.

**Mechanism:**
- Client sends `X-Idempotency-Key` header (UUID)
- Server checks `IdempotencyKey` table: `{ key: string, businessId: string, response: JSON, createdAt: Date }`
- Key found → return cached response (200, not 201)
- Key not found → execute handler, store response with key, return 201
- Keys expire after 24 hours (cron or DB TTL)

**Endpoints decorated:**
- `POST /pos/tickets` — create POS ticket
- `POST /expenses` — create expense
- `POST /inventory/movements` — create stock movement

### Prisma Migration

New table:

```prisma
model IdempotencyKey {
  key        String   @id
  businessId String   @map("business_id")
  statusCode Int      @map("status_code")
  response   Json
  createdAt  DateTime @default(now()) @map("created_at")
  business   Business @relation(fields: [businessId], references: [id])

  @@index([createdAt])
  @@map("idempotency_keys")
}
```

### Cleanup

Scheduled task (NestJS `@Cron`) runs daily, deletes keys older than 24 hours.

## 6. Module-Specific Offline Behavior

### POS

| Action | Offline behavior |
|--------|-----------------|
| Browse products | From cache (read-only) |
| Create ticket | Queued. Client UUID as temp ticket number. |
| Ticket lines | Included in ticket body, queued together |
| Payment method | Cash only. Card terminal needs network. |
| Print receipt | Works (local Bluetooth, no server needed) |
| View recent tickets | From cache + optimistic entries |

### Expenses

| Action | Offline behavior |
|--------|-----------------|
| List expenses | From cache + optimistic entries |
| Create expense | Queued. Manual entry only. |
| Edit expense | Queued as PATCH op |
| Receipt OCR scan | **Unavailable** (needs `ocr:8000`). Camera captures image, stored locally. OCR runs on first sync. |
| Delete expense | Queued as DELETE op |

### Stock

| Action | Offline behavior |
|--------|-----------------|
| View stock levels | From cache (banner: "Niveaux de stock potentiellement obsolètes") |
| Stock adjustment (in/out) | Queued as movement creation |
| Transfer between warehouses | Queued |
| View movements | From cache + optimistic entries |

### Online-Only

- Reports (need server aggregation)
- Purchase orders (complex multi-step, low offline urgency)
- User management
- Platform admin panel
- Settings (except sync status)
- OCR receipt scanning

## 7. Failed Sync UI

### Sync Status Screen

Accessible from **Settings → Synchronisation**.

**Contents:**
- Last successful sync timestamp
- Queue count (pending / failed)
- List of failed operations with:
  - Module icon + operation type
  - Error message from server
  - "Réessayer" button per entry
  - "Supprimer" button with confirmation dialog
- "Tout réessayer" button at top
- "Tout supprimer" button (with confirmation: "Supprimer toutes les opérations échouées ? Cette action est irréversible.")

### Badge

Settings tab icon shows red badge with count when `failed > 0`.

## 8. Security Considerations

- Offline queue contains business data in AsyncStorage — encrypted at rest by OS on modern devices
- Auth tokens refreshed on reconnect before sync starts; if refresh fails, sync pauses and user re-authenticates
- Idempotency keys scoped to `businessId` — one tenant cannot replay another's key
- Queue entries never contain raw passwords or sensitive auth data
- 500-entry cap prevents storage abuse from stuck queues

## 9. Scope Exclusions

- No web/PWA offline support (mobile only)
- No bi-directional sync (server is source of truth, queue is one-way push)
- No real-time sync (polling/websockets) — sync only on reconnect
- No offline-first architecture (online is default, offline is fallback)
- No conflict UI (last-write-wins, silent)
- No partial sync (all or nothing per queue entry)
- No background sync when app is closed (only foreground)
