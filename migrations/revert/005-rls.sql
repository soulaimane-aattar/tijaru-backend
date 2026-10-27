-- Revert 005-rls
BEGIN;

-- Disable RLS + drop policies on app schema tables
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE policyname LIKE '%_tenant_isolation'
          AND schemaname IN ('app', 'app_auth')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
        EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
        EXECUTE format('ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY', r.schemaname, r.tablename);
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS app.enable_tenant_rls(REGCLASS, TEXT);

COMMIT;
