-- Revert 007-security-hardening
BEGIN;

-- ── 1. Restore platform table grants ──────────────────────────────────────
GRANT INSERT, UPDATE, DELETE ON public.platform_admins TO tijaru_app;
GRANT INSERT, UPDATE, DELETE ON public.platform_audit_logs TO tijaru_app;

-- ── 2. Drop updatedAt triggers ────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at ON app.businesses;
DROP TRIGGER IF EXISTS set_updated_at ON app.categories;
DROP TRIGGER IF EXISTS set_updated_at ON app.suppliers;
DROP TRIGGER IF EXISTS set_updated_at ON app.warehouses;
DROP TRIGGER IF EXISTS set_updated_at ON app.price_groups;
DROP TRIGGER IF EXISTS set_updated_at ON app.customers;
DROP TRIGGER IF EXISTS set_updated_at ON app.products;
DROP TRIGGER IF EXISTS set_updated_at ON app.stock_levels;
DROP TRIGGER IF EXISTS set_updated_at ON app.purchase_orders;
DROP TRIGGER IF EXISTS set_updated_at ON app.invoices;
DROP TRIGGER IF EXISTS set_updated_at ON app.estimates;
DROP TRIGGER IF EXISTS set_updated_at ON app.delivery_notes;
DROP TRIGGER IF EXISTS set_updated_at ON app.activities;
DROP TRIGGER IF EXISTS set_updated_at ON app.business_modules;
DROP TRIGGER IF EXISTS set_updated_at ON app.listings;
DROP TRIGGER IF EXISTS set_updated_at ON app.orders;
DROP TRIGGER IF EXISTS set_updated_at ON app.order_lines;
DROP TRIGGER IF EXISTS set_updated_at ON app.webhooks;
DROP TRIGGER IF EXISTS set_updated_at ON app.webhook_deliveries;
DROP TRIGGER IF EXISTS set_updated_at ON app_auth.users;
DROP TRIGGER IF EXISTS set_updated_at ON app_auth.security_policies;
DROP TRIGGER IF EXISTS set_updated_at ON app_auth.custom_roles;
DROP TRIGGER IF EXISTS set_updated_at ON app.attendances;

-- ── 3. Disable RLS + drop policies on businesses and orders ───────────────
DROP POLICY IF EXISTS businesses_tenant_isolation ON app.businesses;
ALTER TABLE app.businesses DISABLE ROW LEVEL SECURITY;
ALTER TABLE app.businesses NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_tenant_isolation ON app.orders;
ALTER TABLE app.orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE app.orders NO FORCE ROW LEVEL SECURITY;

-- ── 4. Disable RLS on child tables (drop policies first) ─────────────────
DO $$
DECLARE
    child_tables text[] := ARRAY[
        'app.invoice_lines', 'app.estimate_lines', 'app.delivery_note_lines',
        'app.expense_photos', 'app.purchase_order_lines', 'app.po_ticket_lines',
        'app.inventory_count_lines', 'app.listing_tiers', 'app.order_lines',
        'app.webhook_deliveries', 'app.attendance_pauses',
        'app_auth.sessions', 'app_auth.role_capabilities',
        'app_auth.user_overrides', 'app_auth.user_warehouses'
    ];
    tbl text;
    tbl_name text;
    pol_name text;
BEGIN
    FOREACH tbl IN ARRAY child_tables LOOP
        tbl_name := split_part(tbl, '.', 2);
        pol_name := tbl_name || '_tenant_isolation';
        EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol_name, tbl);
        EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', tbl);
    END LOOP;
END $$;

-- ── 5. Drop business_id from child tables (CASCADE drops FK, index, trigger)
ALTER TABLE app.invoice_lines DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.estimate_lines DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.delivery_note_lines DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.expense_photos DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.purchase_order_lines DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.po_ticket_lines DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.inventory_count_lines DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.listing_tiers DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.order_lines DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.webhook_deliveries DROP COLUMN IF EXISTS business_id;
ALTER TABLE app.attendance_pauses DROP COLUMN IF EXISTS business_id;
ALTER TABLE app_auth.sessions DROP COLUMN IF EXISTS business_id;
ALTER TABLE app_auth.role_capabilities DROP COLUMN IF EXISTS business_id;
ALTER TABLE app_auth.user_overrides DROP COLUMN IF EXISTS business_id;
ALTER TABLE app_auth.user_warehouses DROP COLUMN IF EXISTS business_id;

-- ── 6. Drop functions ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS app.inherit_business_id() CASCADE;
DROP FUNCTION IF EXISTS app.set_updated_at_snake() CASCADE;

-- ── 7. Restore old enable_tenant_rls (without WITH CHECK) ─────────────────
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(
    table_ref REGCLASS,
    tenant_col TEXT DEFAULT 'business_id'
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    tbl_name TEXT;
    policy_name TEXT;
BEGIN
    SELECT relname INTO tbl_name FROM pg_class WHERE oid = table_ref;
    policy_name := tbl_name || '_tenant_isolation';

    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_ref);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', table_ref);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', policy_name, table_ref);
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR ALL USING (%s = app.current_business_id())',
        policy_name, table_ref, tenant_col
    );
END;
$$;

-- ── 8. Re-apply old policies (same calls as 005-rls.sql, no WITH CHECK) ──
SELECT app.enable_tenant_rls('app.activities'::regclass);
SELECT app.enable_tenant_rls('app.api_keys'::regclass);
SELECT app.enable_tenant_rls('app.attendances'::regclass);
SELECT app.enable_tenant_rls('app.bug_reports'::regclass);
SELECT app.enable_tenant_rls('app.business_modules'::regclass);
SELECT app.enable_tenant_rls('app.categories'::regclass);
SELECT app.enable_tenant_rls('app.customers'::regclass);
SELECT app.enable_tenant_rls('app.delivery_note_payments'::regclass);
SELECT app.enable_tenant_rls('app.delivery_notes'::regclass);
SELECT app.enable_tenant_rls('app.document_audits'::regclass);
SELECT app.enable_tenant_rls('app.estimates'::regclass);
SELECT app.enable_tenant_rls('app.expense_category_defs'::regclass);
SELECT app.enable_tenant_rls('app.expenses'::regclass);
SELECT app.enable_tenant_rls('app.inventory_counts'::regclass);
SELECT app.enable_tenant_rls('app.invoices'::regclass);
SELECT app.enable_tenant_rls('app.listings'::regclass);
SELECT app.enable_tenant_rls('app.movements'::regclass);
SELECT app.enable_tenant_rls('app.notifications'::regclass);
SELECT app.enable_tenant_rls('app.po_sessions'::regclass);
SELECT app.enable_tenant_rls('app.po_tickets'::regclass);
SELECT app.enable_tenant_rls('app.price_groups'::regclass);
SELECT app.enable_tenant_rls('app.products'::regclass);
SELECT app.enable_tenant_rls('app.purchase_orders'::regclass);
SELECT app.enable_tenant_rls('app.suppliers'::regclass);
SELECT app.enable_tenant_rls('app.warehouses'::regclass);
SELECT app.enable_tenant_rls('app.webhooks'::regclass);
SELECT app.enable_tenant_rls('app.stock_levels'::regclass, '"businessId"');
SELECT app.enable_tenant_rls('app_auth.users'::regclass);
SELECT app.enable_tenant_rls('app_auth.custom_roles'::regclass);
SELECT app.enable_tenant_rls('app_auth.role_customizations'::regclass);
SELECT app.enable_tenant_rls('app_auth.security_policies'::regclass, '"businessId"');

COMMIT;
