-- Revert 004-tables: drop all tables in reverse dependency order
BEGIN;

-- Reset search_path
ALTER ROLE tijaru_app RESET search_path;

-- Revoke grants
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tijaru_app') THEN
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM tijaru_app';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM tijaru_app';
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app_auth FROM tijaru_app';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_auth FROM tijaru_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM tijaru_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM tijaru_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth REVOKE ALL ON TABLES FROM tijaru_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth REVOKE ALL ON SEQUENCES FROM tijaru_app';
    END IF;
END $$;

-- app_auth (leaf tables first)
DROP TABLE IF EXISTS app_auth.user_warehouses CASCADE;
DROP TABLE IF EXISTS app_auth.user_overrides CASCADE;
DROP TABLE IF EXISTS app_auth.role_customizations CASCADE;
DROP TABLE IF EXISTS app_auth.role_capabilities CASCADE;
DROP TABLE IF EXISTS app_auth.custom_roles CASCADE;
DROP TABLE IF EXISTS app_auth.security_policies CASCADE;
DROP TABLE IF EXISTS app_auth.sessions CASCADE;
DROP TABLE IF EXISTS app_auth.users CASCADE;

-- app (leaf tables first, working up to businesses)
DROP TABLE IF EXISTS app.attendance_pauses CASCADE;
DROP TABLE IF EXISTS app.attendances CASCADE;
DROP TABLE IF EXISTS app.bug_reports CASCADE;
DROP TABLE IF EXISTS app.order_lines CASCADE;
DROP TABLE IF EXISTS app.orders CASCADE;
DROP TABLE IF EXISTS app.listing_tiers CASCADE;
DROP TABLE IF EXISTS app.listings CASCADE;
DROP TABLE IF EXISTS app.webhook_deliveries CASCADE;
DROP TABLE IF EXISTS app.webhooks CASCADE;
DROP TABLE IF EXISTS app.api_keys CASCADE;
DROP TABLE IF EXISTS app.document_audits CASCADE;
DROP TABLE IF EXISTS app.business_modules CASCADE;
DROP TABLE IF EXISTS app.activities CASCADE;
DROP TABLE IF EXISTS app.notifications CASCADE;
DROP TABLE IF EXISTS app.expense_photos CASCADE;
DROP TABLE IF EXISTS app.expenses CASCADE;
DROP TABLE IF EXISTS app.expense_category_defs CASCADE;
DROP TABLE IF EXISTS app.delivery_note_payments CASCADE;
DROP TABLE IF EXISTS app.delivery_note_lines CASCADE;
DROP TABLE IF EXISTS app.delivery_notes CASCADE;
DROP TABLE IF EXISTS app.estimate_lines CASCADE;
DROP TABLE IF EXISTS app.estimates CASCADE;
DROP TABLE IF EXISTS app.invoice_lines CASCADE;
DROP TABLE IF EXISTS app.invoices CASCADE;
DROP TABLE IF EXISTS app.inventory_count_lines CASCADE;
DROP TABLE IF EXISTS app.inventory_counts CASCADE;
DROP TABLE IF EXISTS app.po_ticket_lines CASCADE;
DROP TABLE IF EXISTS app.po_tickets CASCADE;
DROP TABLE IF EXISTS app.po_sessions CASCADE;
DROP TABLE IF EXISTS app.purchase_order_lines CASCADE;
DROP TABLE IF EXISTS app.purchase_orders CASCADE;
DROP TABLE IF EXISTS app.movements CASCADE;
DROP TABLE IF EXISTS app.stock_levels CASCADE;
DROP TABLE IF EXISTS app.products CASCADE;
DROP TABLE IF EXISTS app.customers CASCADE;
DROP TABLE IF EXISTS app.price_groups CASCADE;
DROP TABLE IF EXISTS app.warehouses CASCADE;
DROP TABLE IF EXISTS app.suppliers CASCADE;
DROP TABLE IF EXISTS app.categories CASCADE;
DROP TABLE IF EXISTS app.businesses CASCADE;

-- public
DROP TABLE IF EXISTS public.platform_audit_logs CASCADE;
DROP TABLE IF EXISTS public.platform_admins CASCADE;

COMMIT;
