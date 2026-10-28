/**
 * Stock — seed data (spec §5.2).
 *
 * Reproduces the demo dataset: El Amrani Distribution SARL with 3 warehouses,
 * 5 demo users (one per role bracket), 6 categories, 5 Moroccan suppliers,
 * 17 real-world SKUs with valid EAN-13 checksums, stock levels, 10 movements
 * over the last 9 days, 7 activity entries, 2 purchase orders, 4 notifications,
 * 3 customers.
 *
 * Run: `npm run seed` (needs the sqitch schema: `make db-up`).
 */
import * as bcrypt from 'bcrypt';
import { sql } from 'kysely';

import { newId } from '../src/database/ids';
import { EAN13 } from '../src/domain/value-objects/ean13';

import { makeSeedDb } from './db';

export const DEMO_PASSWORD = 'demo1234';
const BCRYPT_COST = 10;

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** Build a valid EAN-13 from a 12-digit prefix. Used for seed only. */
const ean = (prefix12: string): string => prefix12 + EAN13.checksum(prefix12);

export async function runSeed(opts: { silent?: boolean } = {}): Promise<void> {
  const log = opts.silent ? () => undefined : console.log;
  log('🌱 Seeding Stock…');
  const db = makeSeedDb();
  const now = new Date();
  try {
    // ─── Wipe (idempotent re-runs) ────────────────────────────────────────
    // Every tenant table cascades from businesses; platform_* tables have no FK to it and survive.
    await sql`TRUNCATE app.businesses CASCADE`.execute(db);

    // ─── Business ─────────────────────────────────────────────────────────
    const businessId = newId();
    await db
      .insertInto('app.businesses')
      .values({
        id: businessId,
        name: 'El Amrani Distribution SARL',
        ice: '001512345000078',
        rc: '123456',
        patente: '40123456',
        if_num: '12345678',
        cnss: '7654321',
        address: 'Zone Industrielle Aïn Sebaâ, Lot 42',
        city: 'Casablanca',
        phone: '+212522123456',
        // Headroom so e2e flows (extra users/warehouses/products) don't trip LimitGuard.
        max_users: 25,
        max_products: 5000,
        max_warehouses: 10,
        updatedAt: now,
      })
      .execute();

    // Module gates (ModuleGuard 403s any @RequiresModule route without a row).
    await db
      .insertInto('app.business_modules')
      .values(
        ['stock', 'multi-stock', 'pos', 'expenses', 'purchase-orders', 'inventory', 'reports', 'invoices', 'delivery-notes', 'marketplace'].map(
          (module_id) => ({ business_id: businessId, module_id, active: true, updatedAt: now }),
        ),
      )
      .execute();

    await db
      .insertInto('app_auth.security_policies')
      .values({
        id: newId(),
        businessId,
        passwordMinLen: 8,
        requireUpper: true,
        requireDigit: true,
        requireSymbol: false,
        passwordExpiryDays: 0,
        passwordHistoryCount: 3,
        twoFARequiredFor: [],
        lockAfterFailures: 5,
        sessionTimeoutMin: 60,
        ipAllowlist: [],
        auditRetentionDays: 365,
        updatedAt: now,
      })
      .execute();

    // ─── Warehouses ───────────────────────────────────────────────────────
    const wh = (name: string, city: string, address: string, phone: string, isDefault: boolean) => ({
      id: newId(),
      business_id: businessId,
      name,
      city,
      address,
      phone,
      active: true,
      isDefault,
      updatedAt: now,
    });
    const wCasa = wh('Dépôt Principal Casablanca', 'Casablanca', 'Aïn Sebaâ, Casablanca', '+212522555001', true);
    const wMarrakech = wh('Magasin Marrakech Guéliz', 'Marrakech', 'Avenue Mohammed V, Guéliz', '+212524555002', false);
    const wRabat = wh('Entrepôt Rabat Agdal', 'Rabat', 'Agdal, Rabat', '+212537555003', false);
    await db.insertInto('app.warehouses').values([wCasa, wMarrakech, wRabat]).execute();

    // ─── Expense categories (per-tenant, validated on expense writes) ─────
    await db
      .insertInto('app.expense_category_defs')
      .values(
        (
          [
            ['other', 'Autres'],
            ['supplies', 'Fournitures'],
            ['rent', 'Loyer'],
            ['utilities', 'Eau & électricité'],
            ['transport', 'Transport'],
          ] as const
        ).map(([key, label], i) => ({ id: newId(), business_id: businessId, key, label, sort_order: i, updated_at: now })),
      )
      .execute();

    // ─── Users (spec §2) ──────────────────────────────────────────────────
    const pwHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
    const user = (name: string, email: string, phone: string, role: 'owner' | 'admin' | 'manager' | 'stockkeeper' | 'cashier', lastLogin: Date) => ({
      id: newId(),
      business_id: businessId,
      name,
      email,
      phone,
      passwordHash: pwHash,
      role,
      lastLogin,
      updatedAt: now,
    });
    const youssef = user('Youssef El Amrani', 'youssef@elamrani.ma', '+212661112233', 'owner', daysAgo(0));
    const fatima = user('Fatima Zahra Bennani', 'fatima@elamrani.ma', '+212662223344', 'admin', daysAgo(0));
    const karim = user('Karim Tazi', 'karim@elamrani.ma', '+212663334455', 'manager', daysAgo(1));
    const hassan = user('Hassan Alaoui', 'hassan@elamrani.ma', '+212664445566', 'stockkeeper', daysAgo(2));
    const salma = user('Salma Idrissi', 'salma@elamrani.ma', '+212665556677', 'cashier', daysAgo(0));
    await db.insertInto('app_auth.users').values([youssef, fatima, karim, hassan, salma]).execute();

    // assign warehouses
    const uw = (u: { id: string }, w: { id: string }) => ({ business_id: businessId, userId: u.id, warehouseId: w.id });
    await db
      .insertInto('app_auth.user_warehouses')
      .values([
        // Youssef + Fatima — all warehouses
        ...[wCasa, wMarrakech, wRabat].flatMap((w) => [uw(youssef, w), uw(fatima, w)]),
        uw(karim, wMarrakech), // Karim — Marrakech
        uw(hassan, wCasa), // Hassan — Casablanca
        uw(salma, wMarrakech), // Salma — Marrakech (POS counter)
      ])
      .execute();

    // managers on warehouses
    for (const [w, m] of [[wCasa, hassan], [wMarrakech, karim], [wRabat, fatima]] as const) {
      await db.updateTable('app.warehouses').set({ managerId: m.id }).where('id', '=', w.id).execute();
    }

    // ─── Categories ───────────────────────────────────────────────────────
    const cat = (name: string, icon: string, tone: string) => ({ id: newId(), business_id: businessId, name, icon, tone });
    const cAliment = cat('Alimentation', 'basket', '#10b981');
    const cDrog = cat('Droguerie', 'package', '#0ea5e9');
    const cCosm = cat('Cosmétiques', 'star', '#ec4899');
    const cElec = cat('Électroménager', 'cube', '#8b5cf6');
    const cText = cat('Textile', 'tag', '#f59e0b');
    const cBois = cat('Boissons', 'wallet', '#06b6d4');
    await db.insertInto('app.categories').values([cAliment, cDrog, cCosm, cElec, cText, cBois]).execute();

    // ─── Suppliers ────────────────────────────────────────────────────────
    const sup = (name: string, contact: string, phone: string, city: string, ice: string, email: string) => ({
      id: newId(),
      business_id: businessId,
      name,
      contact,
      phone,
      city,
      ice,
      email,
      updatedAt: now,
    });
    const sCosumar = sup('Cosumar', 'M. Bennis', '+212522670000', 'Casablanca', '000123456000012', 'contact@cosumar.ma');
    const sLesieur = sup('Lesieur Cristal', 'Mme El Idrissi', '+212522345678', 'Casablanca', '000234567000023', 'b2b@lesieur-cristal.ma');
    const sArgan = sup('Coopérative Argan Tiznit', 'M. Aït Ben', '+212528861122', 'Tiznit', '000345678000034', 'export@argan-tiznit.ma');
    const sMahdia = sup('Mahdia Distribution', 'M. Tahiri', '+212522445566', 'Casablanca', '000456789000045', 'ventes@mahdia.ma');
    const sTria = sup('Tria Couscous', 'M. Berrada', '+212522778899', 'Casablanca', '000567890000056', 'pro@tria.ma');
    await db.insertInto('app.suppliers').values([sCosumar, sLesieur, sArgan, sMahdia, sTria]).execute();

    // ─── Products (17 SKUs, valid EAN-13 starting with 611x) ──────────────
  type ProductSeed = {
    name: string;
    barcodePrefix12: string;
    sku: string;
    category: string;
    purchase: number;
    sale: number;
    vat: number;
    unit: 'piece' | 'kg' | 'g' | 'litre' | 'ml' | 'carton' | 'pack';
    supplierId: string;
    minStock: number;
    maxStock: number;
    trackExpiry?: boolean;
    expiry?: Date;
    tone: string;
    stock: { casa: number; marrakech: number; rabat: number };
  };

  const products: ProductSeed[] = [
    { name: "Huile d'olive 1L",       barcodePrefix12: '611000000001', sku: 'HOL-1L',     category: cAliment.id, purchase: 38, sale: 52, vat: 20, unit: 'litre', supplierId: sLesieur.id, minStock: 20, maxStock: 200, trackExpiry: true, expiry: daysAgo(-180), tone: '#84cc16', stock: { casa: 124, marrakech: 48, rabat: 32 } },
    { name: 'Thé Sultan menthe',      barcodePrefix12: '611000000002', sku: 'THE-200',    category: cAliment.id, purchase: 12, sale: 18, vat: 20, unit: 'piece', supplierId: sMahdia.id,  minStock: 30, maxStock: 300, tone: '#22c55e', stock: { casa: 210, marrakech: 96, rabat: 64 } },
    { name: 'Sucre Cosumar lingot',   barcodePrefix12: '611000000003', sku: 'SUC-1KG',    category: cAliment.id, purchase: 9,  sale: 12, vat: 20, unit: 'kg',    supplierId: sCosumar.id, minStock: 40, maxStock: 400, tone: '#f59e0b', stock: { casa: 340, marrakech: 180, rabat: 120 } },
    { name: 'Couscous Tria 1kg',      barcodePrefix12: '611000000004', sku: 'CUS-1KG',    category: cAliment.id, purchase: 14, sale: 21, vat: 20, unit: 'kg',    supplierId: sTria.id,    minStock: 25, maxStock: 250, trackExpiry: true, expiry: daysAgo(-365), tone: '#eab308', stock: { casa: 88, marrakech: 56, rabat: 40 } },
    { name: "Huile d'argan 100ml",    barcodePrefix12: '611000000005', sku: 'ARG-100',    category: cCosm.id,    purchase: 60, sale: 110, vat: 20, unit: 'ml',   supplierId: sArgan.id,   minStock: 10, maxStock: 80,  trackExpiry: true, expiry: daysAgo(-90), tone: '#a16207', stock: { casa: 22, marrakech: 14, rabat: 8 } },
    { name: 'Yaourt Jaouda nature',   barcodePrefix12: '611000000006', sku: 'YAO-125',    category: cAliment.id, purchase: 2.5, sale: 4, vat: 14, unit: 'piece', supplierId: sMahdia.id,  minStock: 60, maxStock: 600, trackExpiry: true, expiry: daysAgo(-14), tone: '#fbbf24', stock: { casa: 6, marrakech: 4, rabat: 2 } }, // low + expiring
    { name: 'Eau Sidi Ali 1.5L',      barcodePrefix12: '611000000007', sku: 'EAU-15L',    category: cBois.id,    purchase: 3,  sale: 5,  vat: 20, unit: 'litre', supplierId: sMahdia.id,  minStock: 80, maxStock: 800, tone: '#0ea5e9', stock: { casa: 480, marrakech: 220, rabat: 160 } },
    { name: 'Détergent Tide 3kg',     barcodePrefix12: '611000000008', sku: 'TID-3KG',    category: cDrog.id,    purchase: 28, sale: 42, vat: 20, unit: 'kg',    supplierId: sMahdia.id,  minStock: 15, maxStock: 120, tone: '#3b82f6', stock: { casa: 64, marrakech: 28, rabat: 18 } },
    { name: 'Savon noir Beldi 250g',  barcodePrefix12: '611000000009', sku: 'SAV-250',    category: cCosm.id,    purchase: 8,  sale: 14, vat: 20, unit: 'g',     supplierId: sArgan.id,   minStock: 20, maxStock: 150, tone: '#78350f', stock: { casa: 42, marrakech: 22, rabat: 14 } },
    { name: 'Riz Basmati 5kg',        barcodePrefix12: '611000000010', sku: 'RIZ-5KG',    category: cAliment.id, purchase: 65, sale: 92, vat: 20, unit: 'kg',    supplierId: sMahdia.id,  minStock: 12, maxStock: 100, trackExpiry: true, expiry: daysAgo(-540), tone: '#fde68a', stock: { casa: 58, marrakech: 26, rabat: 0 } }, // rupture rabat
    { name: 'Sardines Tahiti 125g',   barcodePrefix12: '611000000011', sku: 'SAR-125',    category: cAliment.id, purchase: 6,  sale: 9,  vat: 20, unit: 'piece', supplierId: sMahdia.id,  minStock: 40, maxStock: 400, trackExpiry: true, expiry: daysAgo(-720), tone: '#0369a1', stock: { casa: 160, marrakech: 78, rabat: 44 } },
    { name: 'Café Sahara 250g',       barcodePrefix12: '611000000012', sku: 'CAF-250',    category: cAliment.id, purchase: 22, sale: 32, vat: 20, unit: 'g',     supplierId: sMahdia.id,  minStock: 20, maxStock: 150, tone: '#451a03', stock: { casa: 38, marrakech: 18, rabat: 12 } },
    { name: 'Bouilloire électrique',  barcodePrefix12: '611000000013', sku: 'BOU-EL',     category: cElec.id,    purchase: 180, sale: 290, vat: 20, unit: 'piece', supplierId: sMahdia.id, minStock: 5, maxStock: 30, tone: '#64748b', stock: { casa: 12, marrakech: 5, rabat: 3 } },
    { name: 'Caftan brodé femme',     barcodePrefix12: '611000000014', sku: 'CAF-FEM',    category: cText.id,    purchase: 320, sale: 580, vat: 20, unit: 'piece', supplierId: sMahdia.id, minStock: 3, maxStock: 20, tone: '#be185d', stock: { casa: 8, marrakech: 4, rabat: 2 } },
    { name: 'Olives vertes 500g',     barcodePrefix12: '611000000015', sku: 'OLV-500',    category: cAliment.id, purchase: 11, sale: 17, vat: 20, unit: 'g',     supplierId: sLesieur.id, minStock: 25, maxStock: 200, trackExpiry: true, expiry: daysAgo(-21), tone: '#15803d', stock: { casa: 0, marrakech: 12, rabat: 8 } }, // rupture casa
    { name: 'Pâte à tartiner Choco',  barcodePrefix12: '611000000016', sku: 'CHO-400',    category: cAliment.id, purchase: 18, sale: 26, vat: 20, unit: 'g',     supplierId: sMahdia.id,  minStock: 20, maxStock: 200, trackExpiry: true, expiry: daysAgo(-200), tone: '#7c2d12', stock: { casa: 72, marrakech: 36, rabat: 24 } },
    { name: 'Lait Centrale UHT 1L',   barcodePrefix12: '611000000017', sku: 'LAI-1L',     category: cAliment.id, purchase: 6,  sale: 8.5, vat: 14, unit: 'litre', supplierId: sMahdia.id, minStock: 100, maxStock: 800, trackExpiry: true, expiry: daysAgo(-28), tone: '#dbeafe', stock: { casa: 86, marrakech: 220, rabat: 140 } }, // low casa + expiring soon
  ];

  const productIdByName: Record<string, string> = {};
    for (const p of products) {
      const id = newId();
      await db
        .insertInto('app.products')
        .values({
          id,
          business_id: businessId,
          name: p.name,
          barcode: ean(p.barcodePrefix12),
          sku: p.sku,
          categoryId: p.category,
          purchase: p.purchase,
          sale: p.sale,
          vat: p.vat,
          unit: p.unit,
          supplierId: p.supplierId,
          trackExpiry: p.trackExpiry ?? false,
          expiry: p.expiry ?? null,
          minStock: p.minStock,
          maxStock: p.maxStock,
          tone: p.tone,
          updatedAt: now,
        })
        .execute();
      await db
        .insertInto('app.stock_levels')
        .values(
          (
            [
              [wCasa, p.stock.casa],
              [wMarrakech, p.stock.marrakech],
              [wRabat, p.stock.rabat],
            ] as const
          ).map(([w, qty]) => ({ businessId, productId: id, warehouseId: w.id, qty, updatedAt: now })),
        )
        .execute();
      productIdByName[p.name] = id;
    }

    const pid = (name: string): string => {
      const id = productIdByName[name];
      if (!id) throw new Error(`Missing product: ${name}`);
      return id;
    };

    // ─── Customers ────────────────────────────────────────────────────────
    await db
      .insertInto('app.customers')
      .values([
        { id: newId(), business_id: businessId, name: 'Mounir Café & Co', phone: '+212661234567', city: 'Casablanca', ice: '000654321000087', purchases: 8420, updatedAt: now },
        { id: newId(), business_id: businessId, name: 'Aïcha Boutique', phone: '+212662345678', city: 'Marrakech', purchases: 2310, updatedAt: now },
        { id: newId(), business_id: businessId, name: 'Rachid Épicerie', phone: '+212663456789', city: 'Rabat', purchases: 1180, updatedAt: now },
      ])
      .execute();

    // ─── Movements (10 over last 9 days) ──────────────────────────────────
    type Mv = {
      type: 'in' | 'out' | 'transfer';
      p: string;
      qty: number;
      from: { id: string };
      to?: { id: string };
      by: { id: string };
      days: number;
      reason: 'achat' | 'transfert' | 'vente' | 'peremption' | 'casse';
      ref?: string;
    };
    const mvs: Mv[] = [
      { type: 'in', p: "Huile d'olive 1L", qty: 60, from: wCasa, by: hassan, days: 9, reason: 'achat', ref: 'BC-2026-0001' },
      { type: 'in', p: 'Sucre Cosumar lingot', qty: 200, from: wCasa, by: hassan, days: 8, reason: 'achat', ref: 'BC-2026-0002' },
      { type: 'transfer', p: 'Thé Sultan menthe', qty: 48, from: wCasa, to: wMarrakech, by: karim, days: 7, reason: 'transfert' },
      { type: 'out', p: 'Eau Sidi Ali 1.5L', qty: 24, from: wMarrakech, by: salma, days: 6, reason: 'vente', ref: 'TKT-0001' },
      { type: 'out', p: 'Yaourt Jaouda nature', qty: 30, from: wMarrakech, by: salma, days: 5, reason: 'vente', ref: 'TKT-0002' },
      { type: 'in', p: "Huile d'argan 100ml", qty: 40, from: wCasa, by: hassan, days: 4, reason: 'achat', ref: 'BC-2026-0003' },
      { type: 'out', p: 'Olives vertes 500g', qty: 12, from: wCasa, by: hassan, days: 3, reason: 'peremption' },
      { type: 'transfer', p: 'Riz Basmati 5kg', qty: 20, from: wCasa, to: wRabat, by: fatima, days: 2, reason: 'transfert' },
      { type: 'out', p: 'Lait Centrale UHT 1L', qty: 18, from: wMarrakech, by: salma, days: 1, reason: 'vente', ref: 'TKT-0003' },
      { type: 'out', p: 'Détergent Tide 3kg', qty: 4, from: wCasa, by: hassan, days: 0, reason: 'casse' },
    ];
    await db
      .insertInto('app.movements')
      .values(
        mvs.map((m) => ({
          id: newId(),
          business_id: businessId,
          type: m.type,
          productId: pid(m.p),
          qty: m.qty,
          warehouseId: m.from.id,
          toWarehouseId: m.to?.id ?? null,
          userId: m.by.id,
          date: daysAgo(m.days),
          reason: m.reason,
          ref: m.ref ?? null,
        })),
      )
      .execute();

    // ─── Purchase orders (1 sent + 1 partially received) ──────────────────
    const po = async (
      number: string,
      supplier: { id: string },
      warehouse: { id: string },
      status: 'sent' | 'partiallyReceived',
      days: number,
      notes: string,
      lines: { p: string; qty: number; price: number; vat: number; received: number }[],
    ) => {
      const id = newId();
      await db
        .insertInto('app.purchase_orders')
        .values({ id, business_id: businessId, number, supplierId: supplier.id, warehouseId: warehouse.id, status, date: daysAgo(days), notes, updatedAt: now })
        .execute();
      await db
        .insertInto('app.purchase_order_lines')
        .values(
          lines.map((l) => ({
            id: newId(),
            business_id: businessId,
            purchaseOrderId: id,
            productId: pid(l.p),
            qty: l.qty,
            price: l.price,
            vat: l.vat,
            received: l.received,
          })),
        )
        .execute();
    };
    await po('BC-2026-0004', sLesieur, wCasa, 'sent', 3, "Réappro huile d'olive + olives", [
      { p: "Huile d'olive 1L", qty: 120, price: 38, vat: 20, received: 0 },
      { p: 'Olives vertes 500g', qty: 80, price: 11, vat: 20, received: 0 },
    ]);
    await po('BC-2026-0005', sMahdia, wMarrakech, 'partiallyReceived', 6, 'Livraison partielle reçue', [
      { p: 'Eau Sidi Ali 1.5L', qty: 240, price: 3, vat: 20, received: 240 },
      { p: 'Yaourt Jaouda nature', qty: 120, price: 2.5, vat: 14, received: 60 },
      { p: 'Détergent Tide 3kg', qty: 30, price: 28, vat: 20, received: 0 },
    ]);

    // ─── Notifications (4; first two unread) ──────────────────────────────
    await db
      .insertInto('app.notifications')
      .values(
        (
          [
            ['lowStock', 'Stock faible', 'Yaourt Jaouda nature — 6 unités à Casablanca', 0, false],
            ['expiring', 'Péremption proche', 'Olives vertes 500g — expire dans 21 jours', 0, false],
            ['userInvited', 'Nouvel utilisateur', "Salma Idrissi a rejoint l'équipe (Caissier)", 5, true],
            ['poReceived', 'BC réceptionné', 'BC-2026-0005 — réception partielle Mahdia Distribution', 6, true],
          ] as const
        ).map(([type, title, body, days, read]) => ({ id: newId(), business_id: businessId, type, title, body, date: daysAgo(days), read })),
      )
      .execute();

    // ─── Activity log (7 entries) ─────────────────────────────────────────
    await db
      .insertInto('app.activities')
      .values(
        (
          [
            [youssef, 'login', 'Connexion depuis iPhone', 0, 'iPhone 15 · iOS 18'],
            [salma, 'stock.out', 'Vente TKT-0003 — 18 × Lait Centrale UHT 1L', 1, 'iPad mini · iPadOS'],
            [fatima, 'transfer', 'Transfert Casa → Rabat — 20 × Riz Basmati 5kg', 2, 'MacBook · Chrome'],
            [hassan, 'stock.in', "Entrée 40 × Huile d'argan 100ml", 4, 'Android · Chrome'],
            [fatima, 'product.created', 'Création produit : Caftan brodé femme', 6, 'MacBook · Chrome'],
            [youssef, 'user.invited', 'Invitation envoyée à salma@elamrani.ma', 7, 'iPhone 15 · iOS 18'],
            [karim, 'po.created', 'Bon de commande BC-2026-0005 créé', 6, 'iPhone 13 · iOS 18'],
          ] as const
        ).map(([u, action, desc, days, device]) => ({ id: newId(), business_id: businessId, userId: u.id, action, desc, date: daysAgo(days), device })),
      )
      .execute();

    // ─── Summary ──────────────────────────────────────────────────────────
    const n = async (t: 'app.businesses' | 'app.warehouses' | 'app_auth.users' | 'app.categories' | 'app.suppliers' | 'app.customers' | 'app.products' | 'app.stock_levels' | 'app.movements' | 'app.purchase_orders' | 'app.notifications' | 'app.activities') =>
      Number((await db.selectFrom(t).select((eb) => eb.fn.countAll<string>().as('c')).executeTakeFirstOrThrow()).c);
    const counts = await Promise.all([
      n('app.businesses'), n('app.warehouses'), n('app_auth.users'), n('app.categories'), n('app.suppliers'), n('app.customers'),
      n('app.products'), n('app.stock_levels'), n('app.movements'), n('app.purchase_orders'), n('app.notifications'), n('app.activities'),
    ]);

    log('✅ Seed complete:');
    log(`   businesses=${counts[0]}, warehouses=${counts[1]}, users=${counts[2]}`);
    log(`   categories=${counts[3]}, suppliers=${counts[4]}, customers=${counts[5]}`);
    log(`   products=${counts[6]}, stockLevels=${counts[7]}, movements=${counts[8]}`);
    log(`   purchaseOrders=${counts[9]}, notifications=${counts[10]}, activities=${counts[11]}`);
    log(`\n   Demo login: youssef@elamrani.ma / ${DEMO_PASSWORD}`);
  } finally {
    // e2e suites import this module once per spec file; release the pool or later suites hit
    // "too many clients already".
    await db.destroy();
  }
}

if (require.main === module) {
  runSeed().catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  });
}
