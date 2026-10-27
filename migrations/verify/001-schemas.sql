-- Verify 001-schemas
BEGIN;

DO $$ BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app'),
        'Schema app must exist';
    ASSERT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app_auth'),
        'Schema app_auth must exist';
    ASSERT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api'),
        'Schema api must exist';
    ASSERT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tests'),
        'Schema tests must exist';
    ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citext'),
        'Extension citext must exist';
    ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'),
        'Extension pgcrypto must exist';
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname = 'set_updated_at'
    ), 'Function app.set_updated_at must exist';
    ASSERT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tijaru_app'),
        'Role tijaru_app must exist';
END $$;

ROLLBACK;
