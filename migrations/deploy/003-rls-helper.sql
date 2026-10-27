-- Deploy 003-rls-helper: One-liner to enable RLS + create tenant isolation policy
-- Inspired by macompta's app.enable_tenant_rls()

BEGIN;

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

    -- Enable RLS (idempotent)
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_ref);

    -- Force RLS even for table owner (stock role)
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', table_ref);

    -- Drop existing policy if any (idempotent re-run)
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', policy_name, table_ref);

    -- Create tenant isolation policy
    -- Use %s for tenant_col to support both snake_case and "camelCase" columns
    -- Caller must quote camelCase themselves: '"businessId"'
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR ALL USING (%s = app.current_business_id())',
        policy_name, table_ref, tenant_col
    );
END;
$$;

COMMENT ON FUNCTION app.enable_tenant_rls(REGCLASS, TEXT)
    IS 'Enable RLS + create tenant isolation policy on a table. Default tenant column: business_id';

COMMIT;
