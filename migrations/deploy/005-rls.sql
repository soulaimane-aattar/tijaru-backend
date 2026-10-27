-- Deploy 005-rls: RLS helper + enable tenant isolation on all tables
BEGIN;

-- Helper: enable RLS + create tenant isolation policy on a table
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
    -- %s for tenant_col: caller must quote camelCase (e.g. '"businessId"')
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR ALL USING (%s = app.current_business_id())',
        policy_name, table_ref, tenant_col
    );
END;
$$;

-- app schema tables (business_id)
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

-- app schema tables ("businessId" camelCase)
SELECT app.enable_tenant_rls('app.stock_levels'::regclass, '"businessId"');

-- app_auth schema tables (business_id)
SELECT app.enable_tenant_rls('app_auth.users'::regclass);
SELECT app.enable_tenant_rls('app_auth.custom_roles'::regclass);
SELECT app.enable_tenant_rls('app_auth.role_customizations'::regclass);

-- app_auth schema tables ("businessId" camelCase)
SELECT app.enable_tenant_rls('app_auth.security_policies'::regclass, '"businessId"');

COMMIT;
