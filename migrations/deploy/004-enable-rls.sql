-- Deploy 004-enable-rls: Enable RLS on all tenant tables
-- Tables live in public schema (Prisma baseline). RLS policies reference app.current_business_id().

BEGIN;

-- Tables with business_id column (snake_case, 29 tables)
SELECT app.enable_tenant_rls('public.activities'::regclass);
SELECT app.enable_tenant_rls('public.api_keys'::regclass);
SELECT app.enable_tenant_rls('public.attendances'::regclass);
SELECT app.enable_tenant_rls('public.bug_reports'::regclass);
SELECT app.enable_tenant_rls('public.business_modules'::regclass);
SELECT app.enable_tenant_rls('public.categories'::regclass);
SELECT app.enable_tenant_rls('public.custom_roles'::regclass);
SELECT app.enable_tenant_rls('public.customers'::regclass);
SELECT app.enable_tenant_rls('public.delivery_note_payments'::regclass);
SELECT app.enable_tenant_rls('public.delivery_notes'::regclass);
SELECT app.enable_tenant_rls('public.document_audits'::regclass);
SELECT app.enable_tenant_rls('public.estimates'::regclass);
SELECT app.enable_tenant_rls('public.expense_category_defs'::regclass);
SELECT app.enable_tenant_rls('public.expenses'::regclass);
SELECT app.enable_tenant_rls('public.inventory_counts'::regclass);
SELECT app.enable_tenant_rls('public.invoices'::regclass);
SELECT app.enable_tenant_rls('public.listings'::regclass);
SELECT app.enable_tenant_rls('public.movements'::regclass);
SELECT app.enable_tenant_rls('public.notifications'::regclass);
SELECT app.enable_tenant_rls('public.po_sessions'::regclass);
SELECT app.enable_tenant_rls('public.po_tickets'::regclass);
SELECT app.enable_tenant_rls('public.price_groups'::regclass);
SELECT app.enable_tenant_rls('public.products'::regclass);
SELECT app.enable_tenant_rls('public.purchase_orders'::regclass);
SELECT app.enable_tenant_rls('public.role_customizations'::regclass);
SELECT app.enable_tenant_rls('public.suppliers'::regclass);
SELECT app.enable_tenant_rls('public.users'::regclass);
SELECT app.enable_tenant_rls('public.warehouses'::regclass);
SELECT app.enable_tenant_rls('public.webhooks'::regclass);

-- Tables with "businessId" column (camelCase — Prisma legacy)
SELECT app.enable_tenant_rls('public.security_policies'::regclass, '"businessId"');
SELECT app.enable_tenant_rls('public.stock_levels'::regclass, '"businessId"');

COMMIT;
