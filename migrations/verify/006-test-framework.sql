-- Verify 006-test-framework
DO $$ BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'gen_id' AND pronamespace = 'tests'::regnamespace
    ), 'tests.gen_id() must exist';
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'impersonate' AND pronamespace = 'tests'::regnamespace
    ), 'tests.impersonate() must exist';
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'create_business' AND pronamespace = 'tests'::regnamespace
    ), 'tests.create_business() must exist';
END $$;
ROLLBACK;
