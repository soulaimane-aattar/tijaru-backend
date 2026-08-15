/**
 * Stock — seed data (spec §5.2).
 *
 * Reproduces the demo dataset: El Amrani Distribution SARL with 3 warehouses,
 * 5 demo users (one per role bracket), 6 categories, 5 Moroccan suppliers,
 * 17 real-world SKUs with valid EAN-13 checksums, stock levels, 10 movements
 * over the last 9 days, 7 activity entries, 2 purchase orders, 4 notifications,
 * 3 customers.
 *
 * Run: `npm run prisma:seed` (after `prisma migrate dev`).
 */
import {
  BuiltInRole,
  MovementReason,
  MovementType,
  NotificationType,
  PrismaClient,
  PurchaseOrderStatus,
  Unit,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { EAN13 } from '../src/domain/value-objects/ean13';

export const DEMO_PASSWORD = 'demo1234';
const BCRYPT_COST = 10;

const prisma = new PrismaClient();

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** Build a valid EAN-13 from a 12-digit prefix. Used for seed only. */
const ean = (prefix12: string): string => prefix12 + EAN13.checksum(prefix12);

export async function runSeed(opts: { silent?: boolean } = {}): Promise<void> {
  const log = opts.silent ? () => undefined : console.log;
  log('🌱 Seeding Stock…');

  // ─── Wipe (idempotent re-runs) ──────────────────────────────────────────
  await prisma.$transaction([
    prisma.activity.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.pOTicketLine.deleteMany(),
    prisma.pOTicket.deleteMany(),
    prisma.pOSession.deleteMany(),
    prisma.inventoryCountLine.deleteMany(),
    prisma.inventoryCount.deleteMany(),
    prisma.purchaseOrderLine.deleteMany(),
    prisma.purchaseOrder.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.movement.deleteMany(),
    prisma.stockLevel.deleteMany(),
    prisma.product.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.supplier.deleteMany(),
    prisma.category.deleteMany(),
    prisma.userOverride.deleteMany(),
    prisma.userWarehouse.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
    prisma.warehouse.deleteMany(),
    prisma.securityPolicy.deleteMany(),
    prisma.businessModule.deleteMany(),
    prisma.business.deleteMany(),
  ]);

  // ─── Business ───────────────────────────────────────────────────────────
  const business = await prisma.business.create({
    data: {
      name: 'El Amrani Distribution SARL',
      ice: '001512345000078',
      rc: '123456',
      patente: '40123456',
      ifNum: '12345678',
      cnss: '7654321',
      address: 'Zone Industrielle Aïn Sebaâ, Lot 42',
      city: 'Casablanca',
      phone: '+212522123456',
    },
  });

  // Module gates (ModuleGuard 403s any @RequiresModule route without a row).
  await prisma.businessModule.createMany({
    data: ['stock', 'pos', 'expenses', 'purchase-orders', 'inventory', 'reports', 'invoices', 'delivery-notes'].map(
      (moduleId) => ({ businessId: business.id, moduleId, active: true }),
    ),
  });

  await prisma.securityPolicy.create({
    data: {
      businessId: business.id,
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
    },
  });

  // ─── Warehouses ─────────────────────────────────────────────────────────
  const wCasa = await prisma.warehouse.create({
    data: {
      businessId: business.id,
      name: 'Dépôt Principal Casablanca',
      city: 'Casablanca',
      address: 'Aïn Sebaâ, Casablanca',
      phone: '+212522555001',
      active: true,
      isDefault: true,
    },
  });
  const wMarrakech = await prisma.warehouse.create({
    data: {
      businessId: business.id,
      name: 'Magasin Marrakech Guéliz',
      city: 'Marrakech',
      address: 'Avenue Mohammed V, Guéliz',
      phone: '+212524555002',
      active: true,
      isDefault: false,
    },
  });
  const wRabat = await prisma.warehouse.create({
    data: {
      businessId: business.id,
      name: 'Entrepôt Rabat Agdal',
      city: 'Rabat',
      address: 'Agdal, Rabat',
      phone: '+212537555003',
      active: true,
      isDefault: false,
    },
  });

  // ─── Users (spec §2) ────────────────────────────────────────────────────
  const hash = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);
  const pwHash = await hash(DEMO_PASSWORD);

  const youssef = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Youssef El Amrani',
      email: 'youssef@elamrani.ma',
      phone: '+212661112233',
      passwordHash: pwHash,
      role: BuiltInRole.owner,
      lastLogin: daysAgo(0),
    },
  });
  const fatima = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Fatima Zahra Bennani',
      email: 'fatima@elamrani.ma',
      phone: '+212662223344',
      passwordHash: pwHash,
      role: BuiltInRole.admin,
      lastLogin: daysAgo(0),
    },
  });
  const karim = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Karim Tazi',
      email: 'karim@elamrani.ma',
      phone: '+212663334455',
      passwordHash: pwHash,
      role: BuiltInRole.manager,
      lastLogin: daysAgo(1),
    },
  });
  const hassan = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Hassan Alaoui',
      email: 'hassan@elamrani.ma',
      phone: '+212664445566',
      passwordHash: pwHash,
      role: BuiltInRole.stockkeeper,
      lastLogin: daysAgo(2),
    },
  });
  const salma = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Salma Idrissi',
      email: 'salma@elamrani.ma',
      phone: '+212665556677',
      passwordHash: pwHash,
      role: BuiltInRole.cashier,
      lastLogin: daysAgo(0),
    },
  });

  // assign warehouses
  await prisma.userWarehouse.createMany({
    data: [
      // Youssef + Fatima — all warehouses
      ...[wCasa.id, wMarrakech.id, wRabat.id].flatMap((wid) => [
        { userId: youssef.id, warehouseId: wid },
        { userId: fatima.id, warehouseId: wid },
      ]),
      // Karim — Marrakech
      { userId: karim.id, warehouseId: wMarrakech.id },
      // Hassan — Casablanca
      { userId: hassan.id, warehouseId: wCasa.id },
      // Salma — Marrakech (POS counter)
      { userId: salma.id, warehouseId: wMarrakech.id },
    ],
  });

  // managers on warehouses
  await prisma.warehouse.update({
    where: { id: wCasa.id },
    data: { managerId: hassan.id },
  });
  await prisma.warehouse.update({
    where: { id: wMarrakech.id },
    data: { managerId: karim.id },
  });
  await prisma.warehouse.update({
    where: { id: wRabat.id },
    data: { managerId: fatima.id },
  });

  // ─── Categories ─────────────────────────────────────────────────────────
  const [cAliment, cDrog, cCosm, cElec, cText, cBois] = await Promise.all([
    prisma.category.create({ data: { businessId: business.id, name: 'Alimentation', icon: 'basket', tone: '#10b981' } }),
    prisma.category.create({ data: { businessId: business.id, name: 'Droguerie', icon: 'package', tone: '#0ea5e9' } }),
    prisma.category.create({ data: { businessId: business.id, name: 'Cosmétiques', icon: 'star', tone: '#ec4899' } }),
    prisma.category.create({ data: { businessId: business.id, name: 'Électroménager', icon: 'cube', tone: '#8b5cf6' } }),
    prisma.category.create({ data: { businessId: business.id, name: 'Textile', icon: 'tag', tone: '#f59e0b' } }),
    prisma.category.create({ data: { businessId: business.id, name: 'Boissons', icon: 'wallet', tone: '#06b6d4' } }),
  ]);

  // ─── Suppliers ──────────────────────────────────────────────────────────
  const [sCosumar, sLesieur, sArgan, sMahdia, sTria] = await Promise.all([
    prisma.supplier.create({
      data: {
        businessId: business.id,
        name: 'Cosumar',
        contact: 'M. Bennis',
        phone: '+212522670000',
        city: 'Casablanca',
        ice: '000123456000012',
        email: 'contact@cosumar.ma',
      },
    }),
    prisma.supplier.create({
      data: {
        businessId: business.id,
        name: 'Lesieur Cristal',
        contact: 'Mme El Idrissi',
        phone: '+212522345678',
        city: 'Casablanca',
        ice: '000234567000023',
        email: 'b2b@lesieur-cristal.ma',
      },
    }),
    prisma.supplier.create({
      data: {
        businessId: business.id,
        name: 'Coopérative Argan Tiznit',
        contact: 'M. Aït Ben',
        phone: '+212528861122',
        city: 'Tiznit',
        ice: '000345678000034',
        email: 'export@argan-tiznit.ma',
      },
    }),
    prisma.supplier.create({
      data: {
        businessId: business.id,
        name: 'Mahdia Distribution',
        contact: 'M. Tahiri',
        phone: '+212522445566',
        city: 'Casablanca',
        ice: '000456789000045',
        email: 'ventes@mahdia.ma',
      },
    }),
    prisma.supplier.create({
      data: {
        businessId: business.id,
        name: 'Tria Couscous',
        contact: 'M. Berrada',
        phone: '+212522778899',
        city: 'Casablanca',
        ice: '000567890000056',
        email: 'pro@tria.ma',
      },
    }),
  ]);

  // ─── Products (17 SKUs, valid EAN-13 starting with 611x) ────────────────
  type ProductSeed = {
    name: string;
    barcodePrefix12: string;
    sku: string;
    category: string;
    purchase: number;
    sale: number;
    vat: number;
    unit: Unit;
    supplierId: string;
    minStock: number;
    maxStock: number;
    trackExpiry?: boolean;
    expiry?: Date;
    tone: string;
    stock: { casa: number; marrakech: number; rabat: number };
  };

  const products: ProductSeed[] = [
    { name: "Huile d'olive 1L",       barcodePrefix12: '611000000001', sku: 'HOL-1L',     category: cAliment.id, purchase: 38, sale: 52, vat: 20, unit: Unit.litre, supplierId: sLesieur.id, minStock: 20, maxStock: 200, trackExpiry: true, expiry: daysAgo(-180), tone: '#84cc16', stock: { casa: 124, marrakech: 48, rabat: 32 } },
    { name: 'Thé Sultan menthe',      barcodePrefix12: '611000000002', sku: 'THE-200',    category: cAliment.id, purchase: 12, sale: 18, vat: 20, unit: Unit.piece, supplierId: sMahdia.id,  minStock: 30, maxStock: 300, tone: '#22c55e', stock: { casa: 210, marrakech: 96, rabat: 64 } },
    { name: 'Sucre Cosumar lingot',   barcodePrefix12: '611000000003', sku: 'SUC-1KG',    category: cAliment.id, purchase: 9,  sale: 12, vat: 20, unit: Unit.kg,    supplierId: sCosumar.id, minStock: 40, maxStock: 400, tone: '#f59e0b', stock: { casa: 340, marrakech: 180, rabat: 120 } },
    { name: 'Couscous Tria 1kg',      barcodePrefix12: '611000000004', sku: 'CUS-1KG',    category: cAliment.id, purchase: 14, sale: 21, vat: 20, unit: Unit.kg,    supplierId: sTria.id,    minStock: 25, maxStock: 250, trackExpiry: true, expiry: daysAgo(-365), tone: '#eab308', stock: { casa: 88, marrakech: 56, rabat: 40 } },
    { name: "Huile d'argan 100ml",    barcodePrefix12: '611000000005', sku: 'ARG-100',    category: cCosm.id,    purchase: 60, sale: 110, vat: 20, unit: Unit.ml,   supplierId: sArgan.id,   minStock: 10, maxStock: 80,  trackExpiry: true, expiry: daysAgo(-90), tone: '#a16207', stock: { casa: 22, marrakech: 14, rabat: 8 } },
    { name: 'Yaourt Jaouda nature',   barcodePrefix12: '611000000006', sku: 'YAO-125',    category: cAliment.id, purchase: 2.5, sale: 4, vat: 14, unit: Unit.piece, supplierId: sMahdia.id,  minStock: 60, maxStock: 600, trackExpiry: true, expiry: daysAgo(-14), tone: '#fbbf24', stock: { casa: 6, marrakech: 4, rabat: 2 } }, // low + expiring
    { name: 'Eau Sidi Ali 1.5L',      barcodePrefix12: '611000000007', sku: 'EAU-15L',    category: cBois.id,    purchase: 3,  sale: 5,  vat: 20, unit: Unit.litre, supplierId: sMahdia.id,  minStock: 80, maxStock: 800, tone: '#0ea5e9', stock: { casa: 480, marrakech: 220, rabat: 160 } },
    { name: 'Détergent Tide 3kg',     barcodePrefix12: '611000000008', sku: 'TID-3KG',    category: cDrog.id,    purchase: 28, sale: 42, vat: 20, unit: Unit.kg,    supplierId: sMahdia.id,  minStock: 15, maxStock: 120, tone: '#3b82f6', stock: { casa: 64, marrakech: 28, rabat: 18 } },
    { name: 'Savon noir Beldi 250g',  barcodePrefix12: '611000000009', sku: 'SAV-250',    category: cCosm.id,    purchase: 8,  sale: 14, vat: 20, unit: Unit.g,     supplierId: sArgan.id,   minStock: 20, maxStock: 150, tone: '#78350f', stock: { casa: 42, marrakech: 22, rabat: 14 } },
    { name: 'Riz Basmati 5kg',        barcodePrefix12: '611000000010', sku: 'RIZ-5KG',    category: cAliment.id, purchase: 65, sale: 92, vat: 20, unit: Unit.kg,    supplierId: sMahdia.id,  minStock: 12, maxStock: 100, trackExpiry: true, expiry: daysAgo(-540), tone: '#fde68a', stock: { casa: 58, marrakech: 26, rabat: 0 } }, // rupture rabat
    { name: 'Sardines Tahiti 125g',   barcodePrefix12: '611000000011', sku: 'SAR-125',    category: cAliment.id, purchase: 6,  sale: 9,  vat: 20, unit: Unit.piece, supplierId: sMahdia.id,  minStock: 40, maxStock: 400, trackExpiry: true, expiry: daysAgo(-720), tone: '#0369a1', stock: { casa: 160, marrakech: 78, rabat: 44 } },
    { name: 'Café Sahara 250g',       barcodePrefix12: '611000000012', sku: 'CAF-250',    category: cAliment.id, purchase: 22, sale: 32, vat: 20, unit: Unit.g,     supplierId: sMahdia.id,  minStock: 20, maxStock: 150, tone: '#451a03', stock: { casa: 38, marrakech: 18, rabat: 12 } },
    { name: 'Bouilloire électrique',  barcodePrefix12: '611000000013', sku: 'BOU-EL',     category: cElec.id,    purchase: 180, sale: 290, vat: 20, unit: Unit.piece, supplierId: sMahdia.id, minStock: 5, maxStock: 30, tone: '#64748b', stock: { casa: 12, marrakech: 5, rabat: 3 } },
    { name: 'Caftan brodé femme',     barcodePrefix12: '611000000014', sku: 'CAF-FEM',    category: cText.id,    purchase: 320, sale: 580, vat: 20, unit: Unit.piece, supplierId: sMahdia.id, minStock: 3, maxStock: 20, tone: '#be185d', stock: { casa: 8, marrakech: 4, rabat: 2 } },
    { name: 'Olives vertes 500g',     barcodePrefix12: '611000000015', sku: 'OLV-500',    category: cAliment.id, purchase: 11, sale: 17, vat: 20, unit: Unit.g,     supplierId: sLesieur.id, minStock: 25, maxStock: 200, trackExpiry: true, expiry: daysAgo(-21), tone: '#15803d', stock: { casa: 0, marrakech: 12, rabat: 8 } }, // rupture casa
    { name: 'Pâte à tartiner Choco',  barcodePrefix12: '611000000016', sku: 'CHO-400',    category: cAliment.id, purchase: 18, sale: 26, vat: 20, unit: Unit.g,     supplierId: sMahdia.id,  minStock: 20, maxStock: 200, trackExpiry: true, expiry: daysAgo(-200), tone: '#7c2d12', stock: { casa: 72, marrakech: 36, rabat: 24 } },
    { name: 'Lait Centrale UHT 1L',   barcodePrefix12: '611000000017', sku: 'LAI-1L',     category: cAliment.id, purchase: 6,  sale: 8.5, vat: 14, unit: Unit.litre, supplierId: sMahdia.id, minStock: 100, maxStock: 800, trackExpiry: true, expiry: daysAgo(-28), tone: '#dbeafe', stock: { casa: 86, marrakech: 220, rabat: 140 } }, // low casa + expiring soon
  ];

  const productIdByName: Record<string, string> = {};
  for (const p of products) {
    const created = await prisma.product.create({
      data: {
        businessId: business.id,
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
        stockLevels: {
          create: [
            { businessId: business.id, warehouseId: wCasa.id, qty: p.stock.casa },
            { businessId: business.id, warehouseId: wMarrakech.id, qty: p.stock.marrakech },
            { businessId: business.id, warehouseId: wRabat.id, qty: p.stock.rabat },
          ],
        },
      },
    });
    productIdByName[p.name] = created.id;
  }

  const pid = (name: string): string => {
    const id = productIdByName[name];
    if (!id) throw new Error(`Missing product: ${name}`);
    return id;
  };

  // ─── Customers ──────────────────────────────────────────────────────────
  const [cMounir, cAicha, cRachid] = await Promise.all([
    prisma.customer.create({
      data: {
        businessId: business.id,
        name: 'Mounir Café & Co',
        phone: '+212661234567',
        city: 'Casablanca',
        ice: '000654321000087',
        purchases: 8420,
      },
    }),
    prisma.customer.create({
      data: {
        businessId: business.id,
        name: 'Aïcha Boutique',
        phone: '+212662345678',
        city: 'Marrakech',
        purchases: 2310,
      },
    }),
    prisma.customer.create({
      data: { businessId: business.id, name: 'Rachid Épicerie', phone: '+212663456789', city: 'Rabat', purchases: 1180 },
    }),
  ]);

  // ─── Movements (10 over last 9 days) ────────────────────────────────────
  await prisma.movement.createMany({
    data: [
      { type: MovementType.in,       productId: pid("Huile d'olive 1L"),     qty: 60,  warehouseId: wCasa.id,      userId: hassan.id,  date: daysAgo(9), reason: MovementReason.achat,      ref: 'BC-2026-0001' },
      { type: MovementType.in,       productId: pid('Sucre Cosumar lingot'), qty: 200, warehouseId: wCasa.id,      userId: hassan.id,  date: daysAgo(8), reason: MovementReason.achat,      ref: 'BC-2026-0002' },
      { type: MovementType.transfer, productId: pid('Thé Sultan menthe'),    qty: 48,  warehouseId: wCasa.id,      toWarehouseId: wMarrakech.id, userId: karim.id, date: daysAgo(7), reason: MovementReason.transfert },
      { type: MovementType.out,      productId: pid('Eau Sidi Ali 1.5L'),    qty: 24,  warehouseId: wMarrakech.id, userId: salma.id,   date: daysAgo(6), reason: MovementReason.vente,      ref: 'TKT-0001' },
      { type: MovementType.out,      productId: pid('Yaourt Jaouda nature'), qty: 30,  warehouseId: wMarrakech.id, userId: salma.id,   date: daysAgo(5), reason: MovementReason.vente,      ref: 'TKT-0002' },
      { type: MovementType.in,       productId: pid("Huile d'argan 100ml"),  qty: 40,  warehouseId: wCasa.id,      userId: hassan.id,  date: daysAgo(4), reason: MovementReason.achat,      ref: 'BC-2026-0003' },
      { type: MovementType.out,      productId: pid('Olives vertes 500g'),   qty: 12,  warehouseId: wCasa.id,      userId: hassan.id,  date: daysAgo(3), reason: MovementReason.peremption },
      { type: MovementType.transfer, productId: pid('Riz Basmati 5kg'),      qty: 20,  warehouseId: wCasa.id,      toWarehouseId: wRabat.id, userId: fatima.id, date: daysAgo(2), reason: MovementReason.transfert },
      { type: MovementType.out,      productId: pid('Lait Centrale UHT 1L'), qty: 18,  warehouseId: wMarrakech.id, userId: salma.id,   date: daysAgo(1), reason: MovementReason.vente,      ref: 'TKT-0003' },
      { type: MovementType.out,      productId: pid('Détergent Tide 3kg'),   qty: 4,   warehouseId: wCasa.id,      userId: hassan.id,  date: daysAgo(0), reason: MovementReason.casse },
    ].map((m) => ({ ...m, businessId: business.id })),
  });

  // ─── Purchase orders (1 sent + 1 partially received) ────────────────────
  await prisma.purchaseOrder.create({
    data: {
      businessId: business.id,
      number: 'BC-2026-0004',
      supplierId: sLesieur.id,
      warehouseId: wCasa.id,
      status: PurchaseOrderStatus.sent,
      date: daysAgo(3),
      notes: "Réappro huile d'olive + olives",
      lines: {
        create: [
          { productId: pid("Huile d'olive 1L"), qty: 120, price: 38, vat: 20, received: 0 },
          { productId: pid('Olives vertes 500g'), qty: 80, price: 11, vat: 20, received: 0 },
        ],
      },
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      businessId: business.id,
      number: 'BC-2026-0005',
      supplierId: sMahdia.id,
      warehouseId: wMarrakech.id,
      status: PurchaseOrderStatus.partiallyReceived,
      date: daysAgo(6),
      notes: 'Livraison partielle reçue',
      lines: {
        create: [
          { productId: pid('Eau Sidi Ali 1.5L'), qty: 240, price: 3, vat: 20, received: 240 },
          { productId: pid('Yaourt Jaouda nature'), qty: 120, price: 2.5, vat: 14, received: 60 },
          { productId: pid('Détergent Tide 3kg'), qty: 30, price: 28, vat: 20, received: 0 },
        ],
      },
    },
  });

  // ─── Notifications (4; first two unread) ────────────────────────────────
  await prisma.notification.createMany({
    data: [
      {
        type: NotificationType.lowStock,
        title: 'Stock faible',
        body: 'Yaourt Jaouda nature — 6 unités à Casablanca',
        date: daysAgo(0),
        read: false,
      },
      {
        type: NotificationType.expiring,
        title: 'Péremption proche',
        body: 'Olives vertes 500g — expire dans 21 jours',
        date: daysAgo(0),
        read: false,
      },
      {
        type: NotificationType.userInvited,
        title: 'Nouvel utilisateur',
        body: 'Salma Idrissi a rejoint l\'équipe (Caissier)',
        date: daysAgo(5),
        read: true,
      },
      {
        type: NotificationType.poReceived,
        title: 'BC réceptionné',
        body: 'BC-2026-0005 — réception partielle Mahdia Distribution',
        date: daysAgo(6),
        read: true,
      },
    ].map((n) => ({ ...n, businessId: business.id })),
  });

  // ─── Activity log (7 entries) ───────────────────────────────────────────
  await prisma.activity.createMany({
    data: [
      { userId: youssef.id, action: 'login',           desc: 'Connexion depuis iPhone',                       date: daysAgo(0), device: 'iPhone 15 · iOS 18' },
      { userId: salma.id,   action: 'stock.out',       desc: 'Vente TKT-0003 — 18 × Lait Centrale UHT 1L',     date: daysAgo(1), device: 'iPad mini · iPadOS' },
      { userId: fatima.id,  action: 'transfer',        desc: 'Transfert Casa → Rabat — 20 × Riz Basmati 5kg',  date: daysAgo(2), device: 'MacBook · Chrome' },
      { userId: hassan.id,  action: 'stock.in',        desc: "Entrée 40 × Huile d'argan 100ml",                date: daysAgo(4), device: 'Android · Chrome' },
      { userId: fatima.id,  action: 'product.created', desc: 'Création produit : Caftan brodé femme',          date: daysAgo(6), device: 'MacBook · Chrome' },
      { userId: youssef.id, action: 'user.invited',    desc: 'Invitation envoyée à salma@elamrani.ma',         date: daysAgo(7), device: 'iPhone 15 · iOS 18' },
      { userId: karim.id,   action: 'po.created',      desc: 'Bon de commande BC-2026-0005 créé',              date: daysAgo(6), device: 'iPhone 13 · iOS 18' },
    ].map((a) => ({ ...a, businessId: business.id })),
  });

  // ─── Summary ────────────────────────────────────────────────────────────
  const counts = await prisma.$transaction([
    prisma.business.count(),
    prisma.warehouse.count(),
    prisma.user.count(),
    prisma.category.count(),
    prisma.supplier.count(),
    prisma.customer.count(),
    prisma.product.count(),
    prisma.stockLevel.count(),
    prisma.movement.count(),
    prisma.purchaseOrder.count(),
    prisma.notification.count(),
    prisma.activity.count(),
  ]);

  log('✅ Seed complete:');
  log(`   businesses=${counts[0]}, warehouses=${counts[1]}, users=${counts[2]}`);
  log(`   categories=${counts[3]}, suppliers=${counts[4]}, customers=${counts[5]}`);
  log(`   products=${counts[6]}, stockLevels=${counts[7]}, movements=${counts[8]}`);
  log(`   purchaseOrders=${counts[9]}, notifications=${counts[10]}, activities=${counts[11]}`);
  log(`\n   Demo login: youssef@elamrani.ma / ${DEMO_PASSWORD}`);

  // Silence unused references
  void cMounir;
  void cAicha;
  void cRachid;
}

if (require.main === module) {
  runSeed()
    .catch((e) => {
      console.error('❌ Seed failed:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
