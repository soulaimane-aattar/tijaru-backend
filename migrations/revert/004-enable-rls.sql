-- Revert 004-enable-rls: Disable RLS on all tenant tables
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
    policy_name TEXT;
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        policy_name := tbl || '_tenant_isolation';
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', tbl);
    END LOOP;
END $$;

COMMIT;
