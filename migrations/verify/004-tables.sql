-- Verify 004-tables
DO $$ BEGIN
    -- app schema tables
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'businesses');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'products');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'categories');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'warehouses');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'invoices');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'delivery_notes');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'expenses');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'orders');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'webhooks');

    -- app_auth schema tables
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_auth' AND table_name = 'users');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_auth' AND table_name = 'sessions');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_auth' AND table_name = 'security_policies');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_auth' AND table_name = 'custom_roles');

    -- public schema tables
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_admins');
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_audit_logs');

    -- tijaru_app role has search_path set
    ASSERT EXISTS (
        SELECT 1 FROM pg_catalog.pg_db_role_setting s
        JOIN pg_catalog.pg_roles r ON s.setrole = r.oid
        WHERE r.rolname = 'tijaru_app'
    );
END $$;
ROLLBACK;
