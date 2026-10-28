-- Verify 007-security-hardening
DO $$ BEGIN
    -- Child tables got business_id
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'invoice_lines' AND column_name = 'business_id'
    ), 'invoice_lines missing business_id';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'order_lines' AND column_name = 'business_id'
    ), 'order_lines missing business_id';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'app_auth' AND table_name = 'sessions' AND column_name = 'business_id'
    ), 'sessions missing business_id';

    -- RLS enabled on orders + businesses
    ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.orders'::regclass),
        'orders RLS not enabled';
    ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.businesses'::regclass),
        'businesses RLS not enabled';

    -- Policies exist
    ASSERT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'orders_tenant_isolation'
    ), 'orders policy missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'businesses' AND policyname = 'businesses_tenant_isolation'
    ), 'businesses policy missing';

    -- updatedAt trigger on products
    ASSERT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'app' AND c.relname = 'products' AND t.tgname = 'set_updated_at'
    ), 'products updatedAt trigger missing';

    -- tijaru_app locked out of platform tables
    ASSERT NOT has_table_privilege('tijaru_app', 'public.platform_admins', 'INSERT'),
        'tijaru_app still has INSERT on platform_admins';
END $$;
ROLLBACK;
