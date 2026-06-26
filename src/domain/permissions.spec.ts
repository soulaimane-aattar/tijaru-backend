import { describe, expect, it } from '@jest/globals';

import {
  CAPABILITY_IDS,
  type CapabilityId,
  ROLE_IDS,
  type RoleId,
  ROLE_PERMS,
  effectiveCapabilities,
  hasPermission,
} from './permissions';

/**
 * Spec §6.2 default matrix. Keep this table in sync with the spec — it is the
 * canonical regression test for the role × capability grid.
 *   ✓ = allowed, '' = denied.
 */
const MATRIX: Record<CapabilityId, Record<RoleId, boolean>> = {
  'dashboard.view':            { owner: true, admin: true, manager: true, stockkeeper: true, cashier: true, viewer: true },
  'products.view':             { owner: true, admin: true, manager: true, stockkeeper: true, cashier: true, viewer: true },
  'products.create':           { owner: true, admin: true, manager: true, stockkeeper: false, cashier: false, viewer: false },
  'products.edit':             { owner: true, admin: true, manager: true, stockkeeper: false, cashier: false, viewer: false },
  'products.delete':           { owner: true, admin: true, manager: false, stockkeeper: false, cashier: false, viewer: false },
  'products.viewPurchasePrice':{ owner: true, admin: true, manager: true, stockkeeper: false, cashier: false, viewer: false },
  'stock.in':                  { owner: true, admin: true, manager: true, stockkeeper: true, cashier: false, viewer: false },
  'stock.out':                 { owner: true, admin: true, manager: true, stockkeeper: true, cashier: true, viewer: false },
  'stock.transfer':            { owner: true, admin: true, manager: true, stockkeeper: true, cashier: false, viewer: false },
  'inventory.count':           { owner: true, admin: true, manager: true, stockkeeper: true, cashier: false, viewer: false },
  'warehouses.manage':         { owner: true, admin: true, manager: false, stockkeeper: false, cashier: false, viewer: false },
  'users.manage':              { owner: true, admin: true, manager: false, stockkeeper: false, cashier: false, viewer: false },
  'suppliers.manage':          { owner: true, admin: true, manager: true, stockkeeper: false, cashier: false, viewer: false },
  'po.manage':                 { owner: true, admin: true, manager: true, stockkeeper: false, cashier: false, viewer: false },
  'reports.view':              { owner: true, admin: true, manager: true, stockkeeper: false, cashier: false, viewer: true },
  'activity.view':             { owner: true, admin: true, manager: false, stockkeeper: false, cashier: false, viewer: false },
  'billing.manage':            { owner: true, admin: false, manager: false, stockkeeper: false, cashier: false, viewer: false },
  'settings.manage':           { owner: true, admin: true, manager: false, stockkeeper: false, cashier: false, viewer: false },
};

describe('permissions matrix (spec §6.2)', () => {
  it.each(CAPABILITY_IDS.flatMap((cap) => ROLE_IDS.map((role) => [role, cap] as const)))(
    '%s × %s matches spec',
    (role, cap) => {
      expect(hasPermission({ role }, cap)).toBe(MATRIX[cap][role]);
    },
  );

  it('owner has all 18 capabilities', () => {
    expect(ROLE_PERMS.owner.size).toBe(CAPABILITY_IDS.length);
  });

  it('viewer has only dashboard.view, products.view, reports.view', () => {
    expect([...ROLE_PERMS.viewer].sort()).toEqual(
      ['dashboard.view', 'products.view', 'reports.view'].sort(),
    );
  });
});

describe('hasPermission overrides (spec §6.3)', () => {
  it('override wins over role default — granting', () => {
    expect(hasPermission({ role: 'stockkeeper' }, 'reports.view')).toBe(false);
    expect(
      hasPermission({ role: 'stockkeeper', overrides: { 'reports.view': true } }, 'reports.view'),
    ).toBe(true);
  });

  it('override wins over role default — denying', () => {
    expect(hasPermission({ role: 'admin' }, 'reports.view')).toBe(true);
    expect(
      hasPermission({ role: 'admin', overrides: { 'reports.view': false } }, 'reports.view'),
    ).toBe(false);
  });

  it('missing override falls back to role default', () => {
    expect(
      hasPermission({ role: 'cashier', overrides: { 'products.edit': true } }, 'stock.out'),
    ).toBe(true);
  });

  it('null/undefined user returns false', () => {
    expect(hasPermission(null, 'dashboard.view')).toBe(false);
    expect(hasPermission(undefined, 'dashboard.view')).toBe(false);
  });
});

describe('effectiveCapabilities', () => {
  it('returns full set for owner', () => {
    expect(effectiveCapabilities({ role: 'owner' })).toEqual([...CAPABILITY_IDS]);
  });

  it('applies overrides additively', () => {
    const caps = effectiveCapabilities({
      role: 'cashier',
      overrides: { 'reports.view': true },
    });
    expect(caps).toContain('reports.view');
    expect(caps).toContain('stock.out');
    expect(caps).not.toContain('stock.in');
  });
});
