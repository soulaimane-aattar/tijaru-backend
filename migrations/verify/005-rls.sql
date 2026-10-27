-- Verify 005-rls
DO $$ BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'enable_tenant_rls'
          AND pronamespace = 'app'::regnamespace
    ), 'app.enable_tenant_rls() must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_policy WHERE polname = 'products_tenant_isolation'
    ), 'products RLS policy must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_policy WHERE polname = 'users_tenant_isolation'
    ), 'users RLS policy must exist';
END $$;
ROLLBACK;
