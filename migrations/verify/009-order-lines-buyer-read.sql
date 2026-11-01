-- Verify 009-order-lines-buyer-read
DO $$ BEGIN
    ASSERT (SELECT count(*) FROM pg_policies
            WHERE schemaname = 'app' AND tablename = 'order_lines'
              AND policyname IN ('order_lines_read', 'order_lines_insert', 'order_lines_update', 'order_lines_delete')) = 4,
        'order_lines policies missing';
    ASSERT NOT EXISTS (SELECT 1 FROM pg_policies
            WHERE schemaname = 'app' AND tablename = 'order_lines' AND policyname = 'order_lines_tenant_isolation'),
        'old order_lines_tenant_isolation still present';
END $$;
