-- Verify 003-rls-helper
BEGIN;

DO $$ BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname = 'enable_tenant_rls'
    ), 'Function app.enable_tenant_rls must exist';
END $$;

ROLLBACK;
