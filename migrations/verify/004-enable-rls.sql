-- Verify 004-enable-rls: Check RLS enabled on all tenant tables
BEGIN;

DO $$
DECLARE
    tbl TEXT;
    tenant_tables TEXT[] := ARRAY[
        'activities', 'api_keys', 'attendances', 'bug_reports',
        'business_modules', 'categories', 'custom_roles', 'customers',
        'delivery_note_payments', 'delivery_notes', 'document_audits',
        'estimates', 'expense_category_defs', 'expenses',
        'inventory_counts', 'invoices', 'listings', 'movements',
        'notifications', 'po_sessions', 'po_tickets', 'price_groups',
        'products', 'purchase_orders', 'role_customizations',
        'security_policies', 'stock_levels', 'suppliers', 'users',
        'warehouses', 'webhooks'
    ];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        ASSERT EXISTS (
            SELECT 1 FROM pg_class
            WHERE relname = tbl AND relrowsecurity = true
        ), format('RLS must be enabled on %s', tbl);
    END LOOP;
END $$;

ROLLBACK;
