-- One-time adoption of the legacy Prisma layout (everything in `public`) into the
-- sqitch layout from 004-tables. Moves tables/enums, keeps all rows (SET SCHEMA is
-- catalog-only). Run AFTER sqitch 001-003 (schemas, role, empty enums exist) and
-- BEFORE `sqitch deploy --log-only --to 004-tables`. Single transaction; any error rolls back.
-- public.platform_admins / platform_audit_logs and public._prisma_migrations stay put.
BEGIN;

DO $$
BEGIN
    IF to_regclass('app.businesses') IS NOT NULL THEN
        RAISE EXCEPTION 'already adopted: app.businesses exists';
    END IF;
    IF to_regclass('public.businesses') IS NULL THEN
        RAISE EXCEPTION 'not a legacy DB: public.businesses missing';
    END IF;
    -- 004-tables mirrors the schema as of this Prisma migration; an older DB would miss columns.
    IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE migration_name = '20261027140000_platform_admin_mfa' AND finished_at IS NOT NULL) THEN
        RAISE EXCEPTION 'legacy DB is behind: last Prisma migration 20261027140000_platform_admin_mfa not applied';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') THEN
        RAISE EXCEPTION 'schema app missing: run sqitch deploy --to 003-types first';
    END IF;
END $$;

-- Enums: 003 created empty copies in app; drop them (fails if anything uses them)
-- and move the real ones so existing columns keep their type.
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
    LOOP
        EXECUTE format('DROP TYPE IF EXISTS app.%I', r.typname);
        EXECUTE format('ALTER TYPE public.%I SET SCHEMA app', r.typname);
    END LOOP;
END $$;

-- Tables (mapping = deploy/004-tables.sql)
DO $$
DECLARE
    app_tables text[] := ARRAY[
        'activities','api_keys','attendance_pauses','attendances','bug_reports','business_modules',
        'businesses','categories','customers','delivery_note_lines','delivery_note_payments',
        'delivery_notes','document_audits','estimate_lines','estimates','expense_category_defs',
        'expense_photos','expenses','inventory_count_lines','inventory_counts','invoice_lines',
        'invoices','listing_tiers','listings','movements','notifications','order_lines','orders',
        'po_sessions','po_ticket_lines','po_tickets','price_groups','products','purchase_order_lines',
        'purchase_orders','stock_levels','suppliers','warehouses','webhook_deliveries','webhooks'];
    auth_tables text[] := ARRAY[
        'custom_roles','role_capabilities','role_customizations','security_policies','sessions',
        'user_overrides','user_warehouses','users'];
    t text;
BEGIN
    FOREACH t IN ARRAY app_tables  LOOP EXECUTE format('ALTER TABLE public.%I SET SCHEMA app', t); END LOOP;
    FOREACH t IN ARRAY auth_tables LOOP EXECUTE format('ALTER TABLE public.%I SET SCHEMA app_auth', t); END LOOP;
END $$;

-- Only structural delta vs 004 for tables that existed in Prisma: this FK (aborts the
-- whole adoption if orphan business_id rows exist, which is the safe outcome).
ALTER TABLE ONLY app.delivery_note_payments ADD CONSTRAINT delivery_note_payments_business_id_stub FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- Same grants as the tail of 004-tables (covers the moved tables regardless of when 001 ran).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO tijaru_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_auth TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_auth TO tijaru_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tijaru_app;

COMMIT;
