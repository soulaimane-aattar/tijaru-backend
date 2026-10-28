-- Verify 008-fix-updated-at-triggers
DO $$ BEGIN
    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'set_updated_at' AND NOT tgisinternal
          AND tgrelid IN ('app.categories'::regclass, 'app.activities'::regclass, 'app.order_lines'::regclass)
    ), 'broken set_updated_at trigger still present';
END $$;
