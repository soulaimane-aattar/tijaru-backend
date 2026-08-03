/**
 * Stock — role × capability matrix.
 *
 * Source of truth for backend, web, mobile.
 * Spec §6.1 (capability catalog), §6.2 (default matrix), §6.3 (hasPermission).
 *
 * Clients fetch the matrix at runtime via GET /auth/permissions.
 * Do not duplicate this file in web/mobile — they receive it from the API.
 */

export const ROLE_IDS = ['owner', 'admin', 'manager', 'stockkeeper', 'cashier', 'viewer'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export type RoleMeta = {
  id: RoleId;
  level: number;
  tone: string;
  labelFr: string;
  labelAr: string;
};

export const ROLES: Record<RoleId, RoleMeta> = {
  owner: { id: 'owner', level: 6, tone: 'brand', labelFr: 'Propriétaire', labelAr: 'مالك' },
  admin: { id: 'admin', level: 5, tone: 'purple', labelFr: 'Administrateur', labelAr: 'مدير' },
  manager: { id: 'manager', level: 4, tone: 'blue', labelFr: 'Gestionnaire', labelAr: 'مسؤول' },
  stockkeeper: { id: 'stockkeeper', level: 3, tone: 'amber', labelFr: 'Magasinier', labelAr: 'أمين المخزن' },
  cashier: { id: 'cashier', level: 2, tone: 'pink', labelFr: 'Caissier', labelAr: 'محاسب' },
  viewer: { id: 'viewer', level: 1, tone: 'gray', labelFr: 'Lecture seule', labelAr: 'قارئ فقط' },
};

export const CAPABILITY_IDS = [
  'dashboard.view',
  'products.view',
  'products.create',
  'products.edit',
  'products.delete',
  'products.viewPurchasePrice',
  'stock.in',
  'stock.out',
  'stock.transfer',
  'inventory.count',
  'warehouses.manage',
  'users.manage',
  'suppliers.manage',
  'po.manage',
  'expenses.view',
  'expenses.create',
  'expenses.edit',
  'expenses.delete',
  'reports.view',
  'activity.view',
  'billing.manage',
  'settings.manage',
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type CapabilityMeta = {
  id: CapabilityId;
  domain:
    | 'dashboard'
    | 'products'
    | 'stock'
    | 'inventory'
    | 'warehouses'
    | 'users'
    | 'suppliers'
    | 'achats'
    | 'expenses'
    | 'reports'
    | 'journal'
    | 'billing'
    | 'settings';
  labelFr: string;
};

export const CAPABILITIES: Record<CapabilityId, CapabilityMeta> = {
  'dashboard.view': { id: 'dashboard.view', domain: 'dashboard', labelFr: 'Tableau de bord' },
  'products.view': { id: 'products.view', domain: 'products', labelFr: 'Voir produits' },
  'products.create': { id: 'products.create', domain: 'products', labelFr: 'Créer produits' },
  'products.edit': { id: 'products.edit', domain: 'products', labelFr: 'Modifier produits' },
  'products.delete': { id: 'products.delete', domain: 'products', labelFr: 'Supprimer produits' },
  'products.viewPurchasePrice': {
    id: 'products.viewPurchasePrice',
    domain: 'products',
    labelFr: "Voir prix d'achat",
  },
  'stock.in': { id: 'stock.in', domain: 'stock', labelFr: 'Entrées stock' },
  'stock.out': { id: 'stock.out', domain: 'stock', labelFr: 'Sorties stock' },
  'stock.transfer': { id: 'stock.transfer', domain: 'stock', labelFr: 'Transferts' },
  'inventory.count': { id: 'inventory.count', domain: 'inventory', labelFr: 'Inventaire physique' },
  'warehouses.manage': { id: 'warehouses.manage', domain: 'warehouses', labelFr: 'Gérer entrepôts' },
  'users.manage': { id: 'users.manage', domain: 'users', labelFr: 'Gérer utilisateurs' },
  'suppliers.manage': { id: 'suppliers.manage', domain: 'suppliers', labelFr: 'Gérer fournisseurs' },
  'po.manage': { id: 'po.manage', domain: 'achats', labelFr: 'Bons de commande' },
  'expenses.view': { id: 'expenses.view', domain: 'expenses', labelFr: 'Voir dépenses' },
  'expenses.create': { id: 'expenses.create', domain: 'expenses', labelFr: 'Créer dépenses' },
  'expenses.edit': { id: 'expenses.edit', domain: 'expenses', labelFr: 'Modifier dépenses' },
  'expenses.delete': { id: 'expenses.delete', domain: 'expenses', labelFr: 'Supprimer dépenses' },
  'reports.view': { id: 'reports.view', domain: 'reports', labelFr: 'Rapports' },
  'activity.view': { id: 'activity.view', domain: 'journal', labelFr: "Journal d'activité" },
  'billing.manage': { id: 'billing.manage', domain: 'billing', labelFr: 'Facturation' },
  'settings.manage': { id: 'settings.manage', domain: 'settings', labelFr: 'Paramètres' },
};

/**
 * Default role → capability matrix (spec §6.2).
 * Keep insertion order = display order in admin role editor.
 */
export const ROLE_PERMS: Record<RoleId, ReadonlySet<CapabilityId>> = {
  owner: new Set<CapabilityId>(CAPABILITY_IDS),
  admin: new Set<CapabilityId>([
    'dashboard.view',
    'products.view',
    'products.create',
    'products.edit',
    'products.delete',
    'products.viewPurchasePrice',
    'stock.in',
    'stock.out',
    'stock.transfer',
    'inventory.count',
    'warehouses.manage',
    'users.manage',
    'suppliers.manage',
    'po.manage',
    'expenses.view',
    'expenses.create',
    'expenses.edit',
    'expenses.delete',
    'reports.view',
    'activity.view',
    'settings.manage',
  ]),
  manager: new Set<CapabilityId>([
    'dashboard.view',
    'products.view',
    'products.create',
    'products.edit',
    'products.viewPurchasePrice',
    'stock.in',
    'stock.out',
    'stock.transfer',
    'inventory.count',
    'suppliers.manage',
    'po.manage',
    'expenses.view',
    'expenses.create',
    'expenses.edit',
    'reports.view',
  ]),
  stockkeeper: new Set<CapabilityId>([
    'dashboard.view',
    'products.view',
    'stock.in',
    'stock.out',
    'stock.transfer',
    'inventory.count',
  ]),
  cashier: new Set<CapabilityId>(['dashboard.view', 'products.view', 'stock.out']),
  viewer: new Set<CapabilityId>([
    'dashboard.view',
    'products.view',
    'expenses.view',
    'reports.view',
  ]),
};

export type PermissionSubject = {
  role: RoleId;
  overrides?: Partial<Record<CapabilityId, boolean>>;
};

/**
 * hasPermission — spec §6.3.
 * Per-user override (if present for the cap) wins over the role default.
 */
export function hasPermission(user: PermissionSubject | null | undefined, cap: CapabilityId): boolean {
  if (!user) return false;
  const override = user.overrides?.[cap];
  if (override !== undefined) return override;
  return ROLE_PERMS[user.role]?.has(cap) ?? false;
}

/** Effective capability set for a user (role + overrides applied). */
export function effectiveCapabilities(user: PermissionSubject): CapabilityId[] {
  return CAPABILITY_IDS.filter((cap) => hasPermission(user, cap));
}
