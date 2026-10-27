-- Verify 005-test-framework
BEGIN;

DO $$ BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgtap'),
        'Extension pgtap must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tests' AND p.proname = 'impersonate'
    ), 'Function tests.impersonate must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tests' AND p.proname = 'reset_impersonation'
    ), 'Function tests.reset_impersonation must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tests' AND p.proname = 'create_business'
    ), 'Function tests.create_business must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tests' AND p.proname = 'create_user'
    ), 'Function tests.create_user must exist';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tests' AND p.proname = 'gen_id'
    ), 'Function tests.gen_id must exist';
END $$;

ROLLBACK;
