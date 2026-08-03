# Stock — Build Specification
## Inventory + POS + Admin · Moroccan SMB mobile-first app

> **How to use this document:** Paste this entire file into a coding assistant (or hand it to an engineer) along with the brief *"Build the app described below from scratch as a React-in-HTML prototype"*. The spec covers the full information architecture, every screen, every behavior, the data model, the role/permission system, the design system and the i18n strings.

---

## 1. Product overview

**Stock** is a French-first (FR/AR/EN) mobile inventory + point-of-sale app for Moroccan SMBs — distributors, neighborhood shops (*épiceries*), mini-markets, cosmetic boutiques, restaurants — that need multi-warehouse stock management, multi-role staff access, and a simple front-of-counter checkout that emits **legally-compliant ICE receipts**.

It runs as a **mobile-first React prototype** rendered inside an iPhone-style frame (390×844) so it can be shown to merchants on a desk or projected during sales calls. The codebase is plain HTML + Babel-transpiled JSX modules — no build step — and uses **Tailwind CDN** for styling.

### Why this exists
- Excel and paper notebooks lose data and don't scale to multi-store
- Existing tools (Odoo, SAGE) are too heavy and not localized for Morocco (no ICE, no MAD formatting, no Arabic)
- WhatsApp coordination between owner / magasinier / caissier is error-prone

### Positioning
Lightweight, offline-tolerant, **bilingual (FR + AR)**, looks at home in a Casablanca shop. Single subscription per *entreprise*, unlimited users, role-gated.

---

## 2. Target personas & roles

The product ships with **6 built-in roles** (the *propriétaire* is unique per tenant):

| Role | FR label | AR label | Tone | Level | Typical user |
|------|----------|----------|------|-------|--------------|
| `owner` | Propriétaire | مالك | brand (teal) | 6 | Business owner — full access incl. billing |
| `admin` | Administrateur | مدير | purple | 5 | IT / second-in-command |
| `manager` | Gestionnaire | مسؤول | blue | 4 | Store / warehouse manager |
| `stockkeeper` | Magasinier | أمين المخزن | amber | 3 | Receives goods, runs counts |
| `cashier` | Caissier | محاسب | pink | 2 | Operates the POS, can't see purchase prices |
| `viewer` | Lecture seule | قارئ فقط | gray | 1 | Accountant / read-only |

**Personas:**
- **Youssef El Amrani** — owner, 45, runs *El Amrani Distribution SARL* from Aïn Sebaâ Casablanca. Uses his iPhone to spot-check. Wants total visibility, doesn't trust the cloud yet.
- **Fatima Zahra Bennani** — admin, 32, runs day-to-day operations. Works on MacBook + phone.
- **Karim Tazi** — manager, 38, runs the Marrakech Guéliz store. iPhone only.
- **Hassan Alaoui** — magasinier, 28, receives shipments at Casa depot. Android device.
- **Salma Idrissi** — caissière, 24, runs POS at Marrakech Guéliz. Shared iPad mini at the counter.

---

## 3. Design system

### 3.1 Brand
- **Name:** Stock
- **Tagline FR:** *Gestion d'inventaire pour le Maroc*
- **Logo:** simple stacked-cube glyph in brand-700 teal
- **Voice:** confident, succinct, French first; respectful Arabic; never patronizing

### 3.2 Colors (Tailwind config)

```js
brand: { 50:'#f0fdfa', 100:'#ccfbf1', 200:'#99f6e4', 300:'#5eead4',
         400:'#2dd4bf', 500:'#14b8a6', 600:'#0d9488', 700:'#0F766E',  // primary
         800:'#115e59', 900:'#134e4a', 950:'#042f2e' }
accent: { 50:'#fff7ed', 100:'#ffedd5', 500:'#F97316', 600:'#ea580c', 700:'#c2410c' }
danger: { 50:'#fef2f2', 100:'#fee2e2', 500:'#ef4444', 600:'#DC2626', 700:'#b91c1c' }
ink:    { 50:'#F9FAFB', 100:'#f3f4f6', 200:'#e5e7eb', 300:'#d1d5db', 400:'#9ca3af',
          500:'#6b7280', 600:'#4b5563', 700:'#374151', 800:'#1f2937', 900:'#111827' }
```

- **Primary:** `brand-700` (#0F766E) — buttons, active states, KPIs
- **Background canvas:** `#eef0f3` outside the phone frame; `bg-ink-50` (#F9FAFB) inside screens
- **Surfaces:** white with `shadow-card` (subtle 2-step shadow); cards have `rounded-2xl` (16px)
- **Accent (orange):** expiry warnings, secondary CTAs, notification badges
- **Danger (red):** ruptures, suspensions, destructive actions
- **POS module:** brand-gradient header `from-brand-800 to-brand-700`
- **Admin module:** violet gradient header `from-violet-700 to-violet-800`

### 3.3 Typography

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- **Sans (LTR):** Inter (400/500/600/700/800)
- **Sans (RTL):** Noto Sans Arabic — auto-swapped via `[dir="rtl"]`
- **Mono:** JetBrains Mono — for SKUs, barcodes, phone numbers, IPs, IDs
- Type scale (no design tokens — use Tailwind classes directly):
  - Display: `text-[26px] font-extrabold tracking-tight`
  - Title: `text-[17px] font-bold`
  - Body: `text-[15px]`
  - Small: `text-xs` (12) / `text-[11px]` / `text-[10px]` (caps)
  - Numbers: always `tabular-nums` for alignment

### 3.4 Shape & elevation

- **Radii:** `rounded-xl` (12) cells · `rounded-2xl` (16) cards · `rounded-3xl` (24) sheets · circles for avatars/pills
- **Shadows:**
  - `shadow-card`: subtle list cards
  - `shadow-pop`: floating buttons, modals (teal-tinted)
  - `shadow-sheet`: bottom sheets (upward tint)

### 3.5 Motion

All animations use cubic-bezier(.2,.7,.2,1) and last 220–320ms. Disable in print mode.

- `view-enter` — sub-screens fade + slide up 8px (280ms)
- `sheet-enter` — bottom sheet slides from below (320ms)
- `pop-enter` — modals scale from .96 (220ms)
- `toast-enter` — toasts drop in from -10px (300ms)
- `skel` — shimmer for skeleton states
- `tap` — `transform: scale(.97); opacity: .85` on `:active`

### 3.6 Component library

Implement these once in `ui.jsx` and reuse everywhere:

- **`<Btn variant size icon iconRight />`** — variants: `primary | accent | secondary | ghost | danger | outline | dangerGhost`; sizes: `sm | md | lg | xl`. Rounded-2xl, focus ring brand-500/30.
- **`<Field label hint error required />`** — wraps inputs with label + helper text
- **`<Input icon suffix />`** — bordered, ink-200 → brand-700 on focus, 12px text label, 15px input
- **`<Textarea>`** — same border treatment
- **`<Select>`** — appearance-none + chevron icon
- **`<Badge tone size icon>`** — pill, tones: brand/green/amber/red/blue/purple/pink/accent/indigo/gray
- **`<Sheet open onClose title maxHeight>`** — bottom sheet w/ drag handle + close button
- **`<Modal open onClose title icon tone footer>`** — centered confirmation modal
- **`<ToastProvider> + useToast()`** — top-of-phone dark pills, auto-dismiss 2.6s
- **`<Card>`** — white surface, rounded-2xl, shadow-card
- **`<ScreenHeader title onBack right subtle />`** — sticky header bar
- **`<Segmented options value onChange>`** — pill-tab control
- **`<Confirm>`** — Modal preset for yes/no
- **`<StripePlaceholder tone label icon>`** — diagonal-stripe product image fallback
- **`<Empty icon title body action>`** — empty-state component
- **`<StatusBar />`** — iOS-style 9:41 / wifi / battery, 44px height
- **`<HomeIndicator />`** — iOS bottom bar
- **`<Avatar name size />`** — initial-circle, color hashed from name

### 3.7 Icons

Lucide-style line icons rendered as inline SVG (`Icon name size strokeWidth className`). 24×24 viewBox, currentColor, stroke-2. The icon set is hand-curated in `icons.jsx` and includes:

```
home package bell search plus minus x check
chevronLeft/Right/Down/Up more warehouse user users
settings cog scan barcode upload download
arrowUpRight arrowDownRight arrowLeftRight trendingUp
alert info clock calendar edit trash copy
eye eyeOff filter truck shopping receipt building
globe phone mail lock power logout switch shield map pin
flag star archive list grid layers qr refresh send
link share card wifi offline history sort print pdf
basket tag language cube ban pause play
calculator banknote wallet key percent
smartphone fingerprint database trash2 return stop zap bug briefcase
```

### 3.8 Localization rules

- **Currency:** MAD — format `1 250,00 MAD` (NBSP thousands, comma decimal). EN: `MAD 1,250.00`. AR: `1 250,00 د.م.`
- **Date:** `DD/MM/YYYY` everywhere
- **Phone:** `+212 6XX XX XX XX` with `mono` font
- **ICE:** 15 digits, `mono` font, never line-wrap
- **VAT rates:** 20 / 14 / 10 / 7 / 0 (Moroccan TVA)
- **RTL:** flip `dir` attribute on `<html>` when `lang==='ar'`; let CSS handle the rest

---

## 4. Information architecture

```
/ (root)
├── splash (1s logo bounce)
├── login (email/phone + password, QR code option, demo accounts)
├── onboarding (3 steps: business → first warehouse → invite team)
└── app/
    ├── home              ◀ tab
    ├── products          ◀ tab
    │   ├── product-detail/:id
    │   ├── product-new
    │   └── product-edit/:id
    ├── movements         ◀ tab
    │   └── move-new (?type=in|out|transfer)
    ├── warehouses        ◀ tab
    │   └── (warehouse-detail in sheet)
    └── more              ◀ tab
        ├── pos                       ★ Point de Vente
        │   └── pos-receipt
        ├── admin                     ★ Admin home
        │   ├── admin-roles
        │   ├── admin-overrides
        │   ├── admin-sessions
        │   └── admin-policy
        ├── users
        ├── suppliers
        │   └── supplier-detail/:id
        ├── customers
        ├── purchase_orders
        │   ├── po-detail/:id
        │   └── po-new
        ├── inventory
        │   └── inventory-new
        ├── reports
        ├── activity
        ├── scan
        └── settings
```

**5-tab bottom nav:** Accueil · Produits · Mouvements · Entrepôts · Plus. Sticky at bottom with iOS home indicator. Active tab uses brand-700, inactive uses ink-400.

Sub-screens **hide** the bottom nav when set in `fullScreens`: `scan, product-new, product-edit, move-new, po-new, inventory-new, pos, pos-receipt`.

---

## 5. Data model

All state lives in the React root; persist via in-memory + optional `localStorage`. The seed data is in `src/data.jsx`.

### 5.1 Entities

```ts
Business {
  name, ice(15), rc, patente, if, cnss, address, city, phone, logo
}

Warehouse {
  id, name, city, address, manager (User.id), phone, active, isDefault
}

User {
  id, name, email, phone, role: RoleId,
  warehouses: WarehouseId[], active, lastLogin,
  overrides?: { [capId]: boolean }  // optional per-user permission overrides
}

Category {
  id, name, icon, tone (hex)
}

Supplier {
  id, name, contact, phone, city, ice, email
}

Customer {
  id, name, phone, city, ice?, purchases (cumulative)
}

Product {
  id, name, barcode (EAN-13), sku, category (Category.id),
  purchase (HT), sale (HT), vat (% — 20|14|10|7|0), unit (pièce|kg|g|litre|ml|carton|pack),
  supplier (Supplier.id),
  trackExpiry, expiry?, batch?,
  minStock, maxStock,
  stock: { [warehouseId]: number },   // physical stock per warehouse
  notes, tone (hex for placeholder)
}

Movement {
  id, type: 'in' | 'out' | 'transfer',
  product (Product.id), qty, warehouse (Warehouse.id),
  toWarehouse?: Warehouse.id,         // only for transfer
  user (User.id), date (ISO),
  reason: 'achat'|'vente'|'transfert'|'péremption'|'ajustement'|'casse',
  ref?, batch?, expiry?
}

PurchaseOrder {
  id, number ('BC-YYYY-####'), supplier, warehouse, status,
  date, notes,
  lines: [{ product, qty, price, vat, received? }]
}
PurchaseOrderStatus = 'draft'|'sent'|'partiallyReceived'|'received'|'cancelled'

Notification {
  id, type ('lowStock'|'expiring'|'userInvited'|'poReceived'|'variance'|'outOfStock'),
  title, body, date, read
}

Activity {
  id, user (User.id), action ('login'|'logout'|'stock.in'|'stock.out'|'transfer'|
  'product.created/updated/deleted'|'user.invited/updated/deleted'|
  'warehouse.created/updated/deleted'|'po.created/received'|'inventory.applied'),
  desc, date, device
}

POSession {
  id ('S-YYYYMMDD'), openedAt, openingFloat, sales, revenue
}

POTicket {
  number ('TKT-####'), date, cashier (User), warehouse (Warehouse),
  customer? (Customer), cart: CartLine[], discount, ht, tva, total, disc, due,
  payment: PaymentInfo
}

CartLine { product, qty }

PaymentInfo =
  { method:'cash', tendered, change }
  | { method:'card' }
  | { method:'credit', customer }
  | { method:'split', cash, card }
```

### 5.2 Seed data (must include)

- 3 warehouses: Dépôt Principal **Casablanca** (default), Magasin **Marrakech Guéliz**, Entrepôt **Rabat Agdal**
- 5 users — one per role-bracket (owner, admin, manager, stockkeeper, cashier)
- 6 categories: Alimentation · Droguerie · Cosmétiques · Électroménager · Textile · Boissons
- 5 suppliers — real Moroccan brands: Cosumar, Lesieur Cristal, Coopérative Argan Tiznit, Mahdia Distribution, Tria Couscous
- **17 products** — real Moroccan SKUs with valid-looking EAN-13 (`6111…`): Huile d'olive 1L, Thé Sultan menthe, Sucre Cosumar lingot, Couscous Tria, Huile d'argan 100ml, Yaourt Jaouda, Eau Sidi Ali, Détergent Tide, Savon noir Beldi, Riz Basmati, Sardines Tahiti, Café Sahara, Bouilloire, Caftan, Olives vertes, Pâte à tartiner Choco, Lait Centrale
- 10 recent movements spanning the last 9 days (mix of in/out/transfer)
- 7 activity log entries
- 2 purchase orders (1 sent, 1 partially received)
- 4 notifications (lowStock, expiring, userInvited, poReceived) — first two unread
- 3 customers
- Business: **El Amrani Distribution SARL**, ICE 001512345000078, Aïn Sebaâ Casablanca

---

## 6. Roles & permissions

### 6.1 Capability catalog (18 caps)

```
dashboard.view              Tableau de bord
products.view               Voir produits
products.create             Créer produits
products.edit               Modifier produits
products.delete             Supprimer produits
products.viewPurchasePrice  Voir prix d'achat
stock.in                    Entrées stock
stock.out                   Sorties stock
stock.transfer              Transferts
inventory.count             Inventaire physique
warehouses.manage           Gérer entrepôts
users.manage                Gérer utilisateurs
suppliers.manage            Gérer fournisseurs
po.manage                   Bons de commande
reports.view                Rapports
activity.view               Journal d'activité
billing.manage              Facturation
settings.manage             Paramètres
```

### 6.2 Default role → capability matrix

| Capability | owner | admin | manager | stockkeeper | cashier | viewer |
|---|---|---|---|---|---|---|
| dashboard.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| products.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| products.create | ✓ | ✓ | ✓ | | | |
| products.edit | ✓ | ✓ | ✓ | | | |
| products.delete | ✓ | ✓ | | | | |
| products.viewPurchasePrice | ✓ | ✓ | ✓ | | | |
| stock.in | ✓ | ✓ | ✓ | ✓ | | |
| stock.out | ✓ | ✓ | ✓ | ✓ | ✓ | |
| stock.transfer | ✓ | ✓ | ✓ | ✓ | | |
| inventory.count | ✓ | ✓ | ✓ | ✓ | | |
| warehouses.manage | ✓ | ✓ | | | | |
| users.manage | ✓ | ✓ | | | | |
| suppliers.manage | ✓ | ✓ | ✓ | | | |
| po.manage | ✓ | ✓ | ✓ | | | |
| reports.view | ✓ | ✓ | ✓ | | | ✓ |
| activity.view | ✓ | ✓ | | | | |
| billing.manage | ✓ | | | | | |
| settings.manage | ✓ | ✓ | | | | |

### 6.3 Permission check function

```js
hasPermission(user, cap) {
  if (!user) return false;
  if (user.overrides && cap in user.overrides) return user.overrides[cap];  // override wins
  return ROLE_PERMS[user.role]?.has(cap) ?? false;
}
```

Locked tiles in More menu show grayscale `opacity-40` + a lock badge. POS quick-action on Dashboard appears only when `stock.out` is granted. Admin tile only when `users.manage`.

---

## 7. Screens — full spec

### 7.1 Splash
- 1s teal screen with the stacked-cube logo
- Auto-advances to login

### 7.2 Login
- White screen, status bar visible
- Logo + "Stock / Inventaire · Maroc" header
- **"Bon retour"** h1 + subtitle
- Inputs: email/phone (with mail icon), password (with lock icon, eye toggle)
- Row: "Se souvenir de moi" checkbox · "Mot de passe oublié ?" link
- `<Btn primary xl>` Se connecter (chevron right icon-right)
- Divider with "OU"
- Secondary CTA: **"Scanner un code de connexion"** (QR icon)
- Footer: "Pas encore de compte ? **Créer un compte**"

### 7.3 Onboarding (3-step wizard)
Step indicator (3 dots), back button, slide transitions.
- **Step 1 — Your business**: raison sociale, ICE, RC, patente, IF, CNSS, adresse, ville (Select from MOROCCAN_CITIES), téléphone
- **Step 2 — First warehouse**: name, city, address, default toggle
- **Step 3 — Invite your team**: 0..n rows of {name, email, role select}; "Ajouter un membre" button; "Passer" (skip) link

### 7.4 Home / Dashboard
Top sticky header:
- Warehouse selector pill (icon · "Entrepôt actif" eyebrow · warehouse name + chevron)
- Bell icon button (unread count badge in accent-500)
- Avatar (taps to switch-user sheet)

Body (scrollable):
- Greeting: "Bonjour," + role badge + first name in 26px extrabold
- **Stat grid (2×3 with col-span):**
  - Total produits (count)
  - Valeur du stock (MAD) — **brand-700 background, white text**
  - Stock faible (count, amber)
  - Rupture (count, red)
  - Expire bientôt (count) — full width, links to Reports/expiring tab
- **Featured POS CTA** (if `stock.out`): full-width brand-gradient card, "Caisse · Ouvrir le point de vente · Scan, panier, encaissement, ticket"
- **Quick actions** 4-tile grid (filtered by permission):
  - Ajouter produit · Entrée stock · Sortie stock · Scanner
  - + 2-tile second row: Inventaire physique · Transfert (if `inventory.count`)
- **Recent movements** — card with last 5 movements (icon left, product+context, qty right colored)
- Online status pill at bottom

### 7.5 Products list
Header: search bar + filter chip row (category filters) + sort + grid/list toggle + (+ button if `products.create`)

Each row (list view):
- StripePlaceholder thumbnail (product.tone)
- Name (bold), SKU + barcode (mono small)
- Stock status badge (OK green / Stock faible amber / Rupture red)
- Total stock count + per-warehouse breakdown sub-text
- Expiry warning (orange day-count badge if <=30 days)

Grid view: 2-col cards with image, name, price, stock count.

Tapping a row → product-detail.

### 7.6 Product detail
- Big hero stripe-placeholder
- Name, category badge, barcode (mono), SKU (mono)
- Price block: Prix d'achat HT *(hidden if no permission)* / Prix de vente HT / TVA% / TTC
- Stock per warehouse (table, with sparkline of last 30 days)
- Min/max thresholds
- Expiry & batch (if tracked)
- Supplier card (links to supplier-detail)
- Recent movements (last 5 for this product)
- Action buttons (bottom): **Entrée**, **Sortie**, **Transfert**, **Modifier**, **Dupliquer**, **Supprimer**

### 7.7 Product form (new / edit)
Full-screen, no bottom nav. Two-section form:
1. **Identité**: name, barcode (with scan button), SKU, category, unit, tone color picker
2. **Tarification**: purchase HT, sale HT, VAT segmented (20/14/10/7/0), supplier
3. **Stock**: initial stock per warehouse (table), min/max
4. **Péremption**: toggle, expiry date, batch
5. **Notes**

Footer: cancel + save button. Validation: name + price required.

### 7.8 Movements list
- Header with type filter chips (Tous / Entrée / Sortie / Transfert)
- Date range picker
- Card per movement:
  - Colored icon (green/red/blue)
  - Product name + warehouse(s) + user
  - Quantity (signed, colored)
  - Relative time

### 7.9 Movement form
- Type segmented (in/out/transfer) prefilled from query
- Product picker (sheet with search)
- Warehouse selector (+ toWarehouse if transfer)
- Quantity stepper
- Reason select (achat/vente/transfert/péremption/ajustement/casse)
- Optional ref, batch, expiry
- Bottom: Validate

### 7.10 Warehouses list
- Card per warehouse with manager avatar, city, address, phone, default badge
- "+" to create
- Tap → edit sheet
- Map preview hero placeholder

### 7.11 More menu (entry hub)
- Top: user-card (brand-gradient with avatar, name, email, role)
- **Featured rows** (full-width tiles): **Point de vente** · **Administration** with subtitles, lock-badge if not permitted
- 2-col grid of tiles: Utilisateurs · Fournisseurs · Bons de commande · Clients · Inventaire · Rapports · Journal · Paramètres
- Section: Switch user · Logout

### 7.12 POS — Point de Vente ★

**Header (brand gradient, full bleed):**
- Back chevron · "CAISSE · {city}" eyebrow · "Point de vente" title · scan button (right)
- Session stat row: Session ID (mono, e.g. `20260522`) · Ventes (12 tickets) · CA (`2 147,50`)

**Search + Category chips:**
- Search input "Nom, code-barres, SKU" + brand-700 barcode button (opens scan modal)
- Horizontal scroll category chips: Tous + each Category with color dot

**Product grid (2-col cards):**
- Square stripe-placeholder hero
- Name (line-clamp-2, 12px semibold)
- "TTC" eyebrow + bold price (2dp)
- Stock count right (×N) — colored red if 0, amber if low
- Disabled (opacity 50%) if out-of-stock

**Floating cart bar** (appears when cart > 0):
- Brand-700 bar, fixed bottom 4
- Cart icon with item count badge (accent)
- "Voir le panier" + total MAD
- Right chevron — opens cart sheet

**Tickets en attente section** below grid when any parked tickets exist.

**Cart sheet (88% maxHeight):**
- Customer chip (avatar + "Anonyme · vente comptant" or selected customer name) → tap opens Customer Picker
- Lines: stripe thumb, name, "{price} × TVA {n}%" sub, qty stepper, line TTC, trash icon
- Discount block: % icon + label + number input MAD + quick-buttons (× / -5 / -10 / -20 / -50)
- Totals card: Sous-total HT, TVA, Remise (if any in red), **Total à payer** in brand-800 18px
- Footer buttons: Mettre en attente (secondary) · Vider (danger ghost)
- **Encaisser {total} MAD** — primary xl button

**Customer Picker sheet:**
- Search by name or ICE
- "Anonyme · Vente comptant" option first
- Then list of customers (Avatar · name · city · ICE)

**Scan modal (full-screen black):**
- Tabs: Caméra | Manuel
- Camera tab: scan-frame box with animated laser line, "Positionnez le code-barres dans le cadre", "Reconnus récemment" grid of last-scanned products (2-col)
- Manual tab: white sheet with barcode input + Valider button, + "Top vendeurs" list

**Payment sheet (92% maxHeight):**
- Big brand-gradient total card at top
- 4 method tiles (2×2 grid):
  - **Espèces** (banknote, emerald) — tendered input + quick-bills (20/50/100/200) + Arrondir 50 / Compte juste + change calc
  - **Carte** (card, sky) — TPE-ready notice
  - **Crédit** (wallet, violet) — locked unless customer picked; shows customer chip
  - **Mixte** (calculator, amber) — split cash + card with remaining-to-allocate indicator
- **Valider l'encaissement** — disabled until valid

**Receipt screen (pos-receipt):**
- Pale ink-100 background
- Success header: brand-700 circle + check + "Encaissement validé" + payment summary
- Receipt body styled like thermal print (dashed-border sections):
  - Business name (uppercase), ICE, address, phone (all mono small)
  - Ticket meta grid: N°, date, caisse, caissier, client (mono)
  - Lines: name + "qty × price" / TTC
  - Totals: HT, TVA, Remise, **TOTAL TTC** (extrabold)
  - Footer: "Merci de votre visite · شكرا لزيارتكم" + QR icon
- Bottom action bar: Imprimer · Partager · Nouveau ticket

**POS state:**
- Cart, discount, customer, parked tickets — local to POSScreen
- Session info — read-only mock
- Sale completion calls `actions.recordMovement` for each line as `type:'out', reason:'vente', ref:TKT-XXXX`

### 7.13 Admin home ★

**Header (violet gradient):**
- Back · "Centre d'administration" eyebrow · "Sécurité & Rôles" title · shield icon
- Security gauge card: SVG ring chart (0-100) + "Score de sécurité" + value + "N recommandations actives"

**Body:**
- KPI tile row (3): Utilisateurs / Admins / Sessions
- 2×2 admin tile grid:
  - **Rôles & permissions** (shield, violet)
  - **Surcharges utilisateur** (key, brand)
  - **Politique de sécurité** (lock, cyan)
  - **Audit & journal** (history, orange) — links to activity log
- **Recommandations** card with 2 items (amber):
  - Activer la 2FA pour tous les admins
  - Mots de passe vieillissants
- **Événements récents** card: 4 entries with mini-badges (login_fail / role_changed / 2fa_enabled / export)
- **Sessions actives** preview (first 3) → "Gérer" link

### 7.14 Admin — Rôles & permissions
- List of all roles (built-in + custom)
- Each role card: shield-icon block tinted by role tone, name + Système/Custom badges, member count + capability count, first 4 capability tags (mono), edit pencil (locked for owner)
- "+" to create custom role → sheet with: name, color picker (6 swatches), "Hérite des capacités de" select
- Edit a role → permission editor sheet:
  - Summary card: avatar + name + N/total caps + "Tout" shortcut
  - Capabilities grouped by domain (Dashboard, Products, Stock, Inventory, Warehouses, Users, Suppliers, Achats, Reports, Journal, Billing, Settings) with per-group count
  - Each capability row: label + cap id mono + toggle
  - Warning note: changes apply to all users of the role
  - "Enregistrer" primary

### 7.15 Admin — Surcharges utilisateur
- User selector at top (all users)
- Selected user card (avatar + email + role badge)
- Info card: explains override semantics
- For each capability: card with cap label + cap id mono + effective badge (green Accordé / red Refusé) + segmented control [Selon rôle · ✓/✗ | Accorder | Refuser]
- "Enregistrer les surcharges" primary

### 7.16 Admin — Sessions actives
- Total devices count
- Top-right "Tout révoquer" (danger text button)
- Card per session: device icon (briefcase for desktop, smartphone for mobile), device name, OS, "Session active" badge if current, city + IP (mono), user mini-row, relative time, "Révoquer cette session" button (red text)

### 7.17 Admin — Politique de sécurité
Sections (each titled, card-grouped):
- **Mot de passe** — min length (number), uppercase / digit / symbol toggles, expiry days, history count
- **Authentification** — "2FA obligatoire pour" multi-select role pills (toggle by tap), lock after N failures, session timeout in min
- **Réseau & accès** — IP allowlist textarea (mono CIDRs)
- **Conformité** — audit retention days, CNDP compliance indicator card
- "Appliquer la politique" primary

### 7.18 Users
- List of users with avatar, name, email/phone, role badge, "Vous" badge for self, assigned warehouses (icon + truncated list or "Tous les entrepôts"), last login
- "+" to invite (if `users.manage`)
- Shield icon top-right opens **Permission matrix** sheet (read-only matrix view of all caps × all roles)
- Invite/edit sheet:
  - Name, email, phone (mono)
  - Role selector cards (excluding owner) with badge + role pitch + checkmark
  - Assigned warehouses checkbox list with "Tout sélectionner" toggle
  - Email invitation notice (amber info)
  - Save / Suspend toggle / Delete

### 7.19 Suppliers / Customers / PO / Inventory
- **Suppliers**: cards with contact, phone, city, ICE, email; detail page with supplied products & total purchases
- **Customers**: simple cards (name, phone, city, ICE if any, cumulative purchases)
- **Purchase orders**: list with number/status badges, supplier, warehouse, line count, total. Detail: line items table, "Réceptionner" action (creates stock-in movements for unreceived qty)
- **PO form**: number auto-generated, supplier picker, warehouse, dynamic line rows (product/qty/price/vat), notes
- **Inventory**: home with last counts; new count flow = pick warehouse → expected vs counted table → apply → creates adjustment movements

### 7.20 Reports
Tab chips at top: Stock faible · Rupture · Expire bientôt · Valeur · Top.
- Low / Out / Expiring: card lists of products
- **Valeur**: total value card + per-warehouse bar chart (value + units)
- **Top**: top 6 outbound products of last 30 days, ranked

### 7.21 Activity log
- User filter + action filter (selects)
- Timeline card: avatar + connector line, action badge (tone+icon), description, user + device, relative time

### 7.22 Notifications (sheet)
- Triggered by bell icon
- Header: unread count + "Tout marquer lu" link
- Items: icon block (toned per type), title, body, accent dot if unread, relative time

### 7.23 Settings
Sections:
- Business card (logo block + name + ICE mono + city)
- **Entreprise**: business info, users, warehouses, categories
- **Régional**: language segmented (Français / العربية / English), currency (locked MAD), default VAT
- **Synchronisation**: online indicator + sync button, backup info
- **Compte**: switch user, logout (danger)
- **À propos**: version, support phone

### 7.24 Scan screen (standalone)
Same UX as POS scan modal but as full screen with bottom action sheet ("Ouvrir le produit" once recognized).

---

## 8. Tech stack & file layout

```
project/
├── Stock.html                       # Main entry — phone frame + App
├── Stock-all-screens.html           # QA page: grid of all screens (static, no animations)
├── Stock - All Screens (standalone).html  # Self-contained inlined bundle for sharing
├── Stock-print.html                 # Print stylesheet variant
└── src/
    ├── icons.jsx        # Icon catalog + Icon + Avatar
    ├── i18n.jsx         # STRINGS + makeT + fmtMAD/Date/DateTime/relTime
    ├── data.jsx         # Roles, caps, seed data
    ├── ui.jsx           # All design-system primitives
    ├── auth.jsx         # Splash, Login, Onboarding
    ├── dashboard.jsx    # Dashboard + BottomNav + WarehouseSelector
    ├── products.jsx     # ProductList, ProductDetail, ProductForm, ProductRow
    ├── movements.jsx    # MovementList, MovementForm, ScanScreen
    ├── warehouses.jsx   # WarehouseList + WarehouseForm
    ├── users.jsx        # UserList, UserForm, PermissionMatrix, SwitchUserSheet
    ├── suppliers.jsx    # SupplierList, SupplierDetail
    ├── purchase_orders.jsx  # POList, PODetail, POForm
    ├── inventory.jsx    # InventoryHome, InventoryCount
    ├── misc.jsx         # MoreMenu, Reports, ActivityLog, Notifications, Settings, CustomerList
    ├── pos.jsx          # POSScreen, CartSheet, CustomerPicker, ScanModal, PaymentSheet, POSReceipt
    ├── admin.jsx        # AdminHome, RolesScreen, OverridesScreen, SessionsScreen, PolicyScreen
    └── app.jsx          # App root: state, routing, render
```

**Dependencies (CDN):**
- Tailwind CDN
- React 18.3.1 (dev UMD) + ReactDOM
- @babel/standalone 7.29.0
- Lucide UMD (optional; reimplemented inline)
- Google Fonts: Inter, Noto Sans Arabic, JetBrains Mono

**No build, no bundler.** Each `src/*.jsx` is loaded as `<script type="text/babel" src=…>` in dependency order. Each file ends with `Object.assign(window, { … })` to expose exports globally (Babel scripts don't share module scope otherwise).

**Critical scripts loading order in Stock.html:**
```
1. icons.jsx, i18n.jsx, data.jsx     # primitives
2. ui.jsx                            # depends on icons + i18n
3. auth.jsx, dashboard.jsx           # depend on ui
4. products.jsx, movements.jsx       # …
5. warehouses.jsx, users.jsx, suppliers.jsx, purchase_orders.jsx, inventory.jsx
6. pos.jsx, admin.jsx                # new modules
7. misc.jsx                          # depends on lots above (MoreMenu)
8. app.jsx                           # last — mounts the App
```

---

## 9. Routing model

The App keeps a single state object `route = { tab, screen, params }`. A `navigate(name, params)` helper:
- If name is one of the 5 tabs → `{tab:name, screen:null, params:{}}`
- Else → `{tab:r.tab, screen:name, params}`

`navBack()` clears the screen. Sub-screens render on top of their tab; bottom nav hides only when `fullScreens.has(screen)`.

The root renders:
```jsx
<ToastProvider>
  <div>{screenContent || tabContent}</div>
  {!hideNav && <BottomNav />}
  <WarehouseSelector .../>
  <SwitchUserSheet .../>
  <NotificationsPane .../>
</ToastProvider>
```

Screens are pure functions of `(t, lang, ctx, navigate, params, actions)`. **ctx** carries `user, users, warehouses, warehouse, products, suppliers, movements, activity, purchaseOrders, notifications, customers, business, actions, openSwitchUser, logout`.

---

## 10. Actions (mutations)

```js
actions = {
  // products
  createProduct(p), updateProduct(p), deleteProduct(id), duplicateProduct(id),
  // movements
  recordMovement(m),  // auto-adjusts stock + logs activity
  // warehouses
  createWarehouse(w), updateWarehouse(w), deleteWarehouse(id), setDefaultWarehouse(id), setWarehouse(w),
  // users
  createUser(u), updateUser(u), deleteUser(id), switchUser(u),
  // suppliers
  createSupplier(s), updateSupplier(s),
  // purchase orders
  createPO(po), receivePO(id),  // receivePO creates stock-in movements for unreceived qty
  // notifications
  markRead(id), markAllRead(),
  // inventory
  applyInventory(whId, counts),  // diff vs expected, creates adjustment movements
  // session
  logout(),
}
```

Every mutation appends to the activity log via `logActivity(action, desc)`.

---

## 11. i18n strings — partial (full list ~110 keys in i18n.jsx)

The `makeT(lang)` factory returns a `t(key)` lookup with FR fallback. Keys cover: app name, welcome, login, all nav, all action buttons, all entity field labels, all status badges, all role labels (in `ROLES[id].label`).

Formatters:
- `fmtMAD(n, lang)` → `1 250,00 MAD` / `MAD 1,250.00` / `1 250,00 د.م.`
- `fmtDate(d)` → `DD/MM/YYYY`
- `fmtDateTime(d)` → `DD/MM/YYYY HH:mm`
- `relTime(d, lang)` → `il y a 3 min` / `قبل 3 د` / `3m ago`

---

## 12. Phone frame

Wrap the app in a stylized iPhone bezel for the prototype shell:

```css
.phone {
  width: 390px; height: 844px; background: #000; border-radius: 48px;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,.35),
              0 0 0 2px #1a1a1a, 0 0 0 12px #0b0b0b;
  padding: 10px;
}
.phone::after { /* dynamic island */
  content: ""; position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  width: 110px; height: 32px; background: #000; border-radius: 24px; z-index: 50;
}
.screen { width: 100%; height: 100%; background: #F9FAFB; border-radius: 38px; overflow: hidden; }
```

Outside the phone frame, show the Stock wordmark above and a one-line "Connecté en tant que…" caption below the phone.

---

## 13. Acceptance criteria

The build is done when:

1. ✅ Logging in as **Youssef** lands on Dashboard with all 5 KPIs populated, recent movements list, and the brand POS CTA tile.
2. ✅ Switching to **Salma (Caissier)** via avatar hides ineligible Quick Actions, hides the Admin tile, and keeps the POS CTA.
3. ✅ **POS flow**: scan/search → grid → add 3 items → discount 10 → checkout → pay cash 250 → see change → receipt screen with ICE + QR + total.
4. ✅ **Admin → Rôles**: open Manager role editor, toggle off `reports.view`, save, verify the matrix sheet (Users → shield icon) reflects the change.
5. ✅ **Admin → Surcharges**: pick Hassan (stockkeeper), grant `reports.view`, verify Reports tile in More no longer locked when switching to him.
6. ✅ **Admin → Sessions**: revoke a session, list updates.
7. ✅ **Admin → Politique**: toggle 2FA for stockkeeper, set min password length 14, save.
8. ✅ **Language switch FR → AR**: html `dir="rtl"`, font swaps to Noto Sans Arabic, all visible strings translate.
9. ✅ **Permission matrix sheet** (Users top-right) shows the full grid with ✓ / — markers.
10. ✅ **Print view** (`Stock-print.html`) renders each screen on its own page, no animations, no scrollbars.
11. ✅ **All-screens view** (`Stock-all-screens.html`) shows every state in a single page for design review.

---

## 14. Out of scope (mention but don't build)

- Real backend, real auth — everything is in-memory + localStorage flags
- Real barcode scanning (camera tab is decorative; manual entry resolves via `products.find(barcode)`)
- Real CMI TPE integration
- Real printer (button only fires a toast)
- Real CNDP audit retention enforcement
- E-invoicing for the DGI Maroc submission (`Système d'horodatage`) — show as roadmap

---

## 15. Tone of voice & copy

- **French first**, always polite, never childlike. Avoid robotic phrases.
- Use Moroccan business vocab where relevant: *ICE*, *RC*, *Patente*, *IF*, *CNSS*, *MAD*, *dirham*, *TVA*, *BC* (bon de commande), *BL* (bon de livraison), *Magasin*, *Dépôt*.
- Receipt closer: "Merci de votre visite · شكرا لزيارتكم"
- Empty states are warm and instructive ("Vos mouvements de stock apparaîtront ici."), never accusatory.

---

*End of build specification.*
