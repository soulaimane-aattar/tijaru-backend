-- Verify 002-auth-context
BEGIN;

DO $$ BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname = 'current_business_id'
    ), 'Function app.current_business_id must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname = 'current_user_id'
    ), 'Function app.current_user_id must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname = 'current_user_role'
    ), 'Function app.current_user_role must exist';
END $$;

ROLLBACK;
