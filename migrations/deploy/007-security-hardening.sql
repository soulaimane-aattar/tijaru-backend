-- Deploy 007-security-hardening: WITH CHECK on all RLS policies, business_id
-- on child tables, updatedAt triggers, platform table lockdown
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Update enable_tenant_rls helper (add WITH CHECK)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(
    table_ref REGCLASS,
    tenant_col TEXT DEFAULT 'business_id'
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    tbl_name TEXT;
    policy_name TEXT;
BEGIN
    SELECT relname INTO tbl_name FROM pg_class WHERE oid = table_ref;
    policy_name := tbl_name || '_tenant_isolation';

    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_ref);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', table_ref);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', policy_name, table_ref);
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR ALL USING (%s = app.current_business_id()) WITH CHECK (%s = app.current_business_id())',
        policy_name, table_ref, tenant_col, tenant_col
    );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Generic business_id inheritance trigger function
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app.inherit_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_fk_val text;
    v_biz_col text := COALESCE(TG_ARGV[3], 'business_id');
BEGIN
    EXECUTE format('SELECT ($1).%I', TG_ARGV[2]) INTO v_fk_val USING NEW;
    IF v_fk_val IS NOT NULL THEN
        EXECUTE format(
            'SELECT %I FROM %I.%I WHERE id = $1',
            v_biz_col, TG_ARGV[0], TG_ARGV[1]
        ) INTO NEW.business_id USING v_fk_val;
    END IF;
    RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Add business_id to child tables + backfill + FK + index + inherit trigger
--    Safe for tables WITH existing data: add nullable → backfill → set NOT NULL
-- ═══════════════════════════════════════════════════════════════════════════

-- app.invoice_lines
ALTER TABLE app.invoice_lines ADD COLUMN business_id text;
UPDATE app.invoice_lines c SET business_id = p.business_id
    FROM app.invoices p WHERE p.id = c.invoice_id;
ALTER TABLE app.invoice_lines ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.invoice_lines ADD CONSTRAINT invoice_lines_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX invoice_lines_business_id_idx ON app.invoice_lines(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.invoice_lines
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'invoices', 'invoice_id');

-- app.estimate_lines
ALTER TABLE app.estimate_lines ADD COLUMN business_id text;
UPDATE app.estimate_lines c SET business_id = p.business_id
    FROM app.estimates p WHERE p.id = c.estimate_id;
ALTER TABLE app.estimate_lines ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.estimate_lines ADD CONSTRAINT estimate_lines_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX estimate_lines_business_id_idx ON app.estimate_lines(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.estimate_lines
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'estimates', 'estimate_id');

-- app.delivery_note_lines
ALTER TABLE app.delivery_note_lines ADD COLUMN business_id text;
UPDATE app.delivery_note_lines c SET business_id = p.business_id
    FROM app.delivery_notes p WHERE p.id = c.delivery_note_id;
ALTER TABLE app.delivery_note_lines ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.delivery_note_lines ADD CONSTRAINT delivery_note_lines_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX delivery_note_lines_business_id_idx ON app.delivery_note_lines(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.delivery_note_lines
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'delivery_notes', 'delivery_note_id');

-- app.expense_photos
ALTER TABLE app.expense_photos ADD COLUMN business_id text;
UPDATE app.expense_photos c SET business_id = p.business_id
    FROM app.expenses p WHERE p.id = c.expense_id;
ALTER TABLE app.expense_photos ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.expense_photos ADD CONSTRAINT expense_photos_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX expense_photos_business_id_idx ON app.expense_photos(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.expense_photos
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'expenses', 'expense_id');

-- app.purchase_order_lines
ALTER TABLE app.purchase_order_lines ADD COLUMN business_id text;
UPDATE app.purchase_order_lines c SET business_id = p.business_id
    FROM app.purchase_orders p WHERE p.id = c."purchaseOrderId";
ALTER TABLE app.purchase_order_lines ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.purchase_order_lines ADD CONSTRAINT purchase_order_lines_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX purchase_order_lines_business_id_idx ON app.purchase_order_lines(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.purchase_order_lines
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'purchase_orders', 'purchaseOrderId');

-- app.po_ticket_lines
ALTER TABLE app.po_ticket_lines ADD COLUMN business_id text;
UPDATE app.po_ticket_lines c SET business_id = p.business_id
    FROM app.po_tickets p WHERE p.id = c."ticketId";
ALTER TABLE app.po_ticket_lines ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.po_ticket_lines ADD CONSTRAINT po_ticket_lines_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX po_ticket_lines_business_id_idx ON app.po_ticket_lines(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.po_ticket_lines
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'po_tickets', 'ticketId');

-- app.inventory_count_lines
ALTER TABLE app.inventory_count_lines ADD COLUMN business_id text;
UPDATE app.inventory_count_lines c SET business_id = p.business_id
    FROM app.inventory_counts p WHERE p.id = c."countId";
ALTER TABLE app.inventory_count_lines ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.inventory_count_lines ADD CONSTRAINT inventory_count_lines_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX inventory_count_lines_business_id_idx ON app.inventory_count_lines(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.inventory_count_lines
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'inventory_counts', 'countId');

-- app.listing_tiers
ALTER TABLE app.listing_tiers ADD COLUMN business_id text;
UPDATE app.listing_tiers c SET business_id = p.business_id
    FROM app.listings p WHERE p.id = c.listing_id;
ALTER TABLE app.listing_tiers ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.listing_tiers ADD CONSTRAINT listing_tiers_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX listing_tiers_business_id_idx ON app.listing_tiers(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.listing_tiers
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'listings', 'listing_id');

-- app.order_lines (parent biz col = seller_business_id)
ALTER TABLE app.order_lines ADD COLUMN business_id text;
UPDATE app.order_lines c SET business_id = p.seller_business_id
    FROM app.orders p WHERE p.id = c.order_id;
ALTER TABLE app.order_lines ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.order_lines ADD CONSTRAINT order_lines_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX order_lines_business_id_idx ON app.order_lines(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.order_lines
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'orders', 'order_id', 'seller_business_id');

-- app.webhook_deliveries
ALTER TABLE app.webhook_deliveries ADD COLUMN business_id text;
UPDATE app.webhook_deliveries c SET business_id = p.business_id
    FROM app.webhooks p WHERE p.id = c.webhook_id;
ALTER TABLE app.webhook_deliveries ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.webhook_deliveries ADD CONSTRAINT webhook_deliveries_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX webhook_deliveries_business_id_idx ON app.webhook_deliveries(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.webhook_deliveries
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'webhooks', 'webhook_id');

-- app.attendance_pauses
ALTER TABLE app.attendance_pauses ADD COLUMN business_id text;
UPDATE app.attendance_pauses c SET business_id = p.business_id
    FROM app.attendances p WHERE p.id = c.attendance_id;
ALTER TABLE app.attendance_pauses ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app.attendance_pauses ADD CONSTRAINT attendance_pauses_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX attendance_pauses_business_id_idx ON app.attendance_pauses(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app.attendance_pauses
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app', 'attendances', 'attendance_id');

-- app_auth.sessions
ALTER TABLE app_auth.sessions ADD COLUMN business_id text;
UPDATE app_auth.sessions c SET business_id = p.business_id
    FROM app_auth.users p WHERE p.id = c."userId";
ALTER TABLE app_auth.sessions ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app_auth.sessions ADD CONSTRAINT sessions_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX sessions_business_id_idx ON app_auth.sessions(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app_auth.sessions
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app_auth', 'users', 'userId');

-- app_auth.role_capabilities
ALTER TABLE app_auth.role_capabilities ADD COLUMN business_id text;
UPDATE app_auth.role_capabilities c SET business_id = p.business_id
    FROM app_auth.custom_roles p WHERE p.id = c."customRoleId";
ALTER TABLE app_auth.role_capabilities ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app_auth.role_capabilities ADD CONSTRAINT role_capabilities_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX role_capabilities_business_id_idx ON app_auth.role_capabilities(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app_auth.role_capabilities
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app_auth', 'custom_roles', 'customRoleId');

-- app_auth.user_overrides
ALTER TABLE app_auth.user_overrides ADD COLUMN business_id text;
UPDATE app_auth.user_overrides c SET business_id = p.business_id
    FROM app_auth.users p WHERE p.id = c."userId";
ALTER TABLE app_auth.user_overrides ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app_auth.user_overrides ADD CONSTRAINT user_overrides_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX user_overrides_business_id_idx ON app_auth.user_overrides(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app_auth.user_overrides
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app_auth', 'users', 'userId');

-- app_auth.user_warehouses
ALTER TABLE app_auth.user_warehouses ADD COLUMN business_id text;
UPDATE app_auth.user_warehouses c SET business_id = p.business_id
    FROM app_auth.users p WHERE p.id = c."userId";
ALTER TABLE app_auth.user_warehouses ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE app_auth.user_warehouses ADD CONSTRAINT user_warehouses_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON DELETE CASCADE;
CREATE INDEX user_warehouses_business_id_idx ON app_auth.user_warehouses(business_id);
CREATE TRIGGER inherit_business_id BEFORE INSERT ON app_auth.user_warehouses
    FOR EACH ROW EXECUTE FUNCTION app.inherit_business_id('app_auth', 'users', 'userId');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Re-apply RLS on all existing tables (now gets WITH CHECK)
-- ═══════════════════════════════════════════════════════════════════════════

-- app schema (business_id)
SELECT app.enable_tenant_rls('app.activities'::regclass);
SELECT app.enable_tenant_rls('app.api_keys'::regclass);
SELECT app.enable_tenant_rls('app.attendances'::regclass);
SELECT app.enable_tenant_rls('app.bug_reports'::regclass);
SELECT app.enable_tenant_rls('app.business_modules'::regclass);
SELECT app.enable_tenant_rls('app.categories'::regclass);
SELECT app.enable_tenant_rls('app.customers'::regclass);
SELECT app.enable_tenant_rls('app.delivery_note_payments'::regclass);
SELECT app.enable_tenant_rls('app.delivery_notes'::regclass);
SELECT app.enable_tenant_rls('app.document_audits'::regclass);
SELECT app.enable_tenant_rls('app.estimates'::regclass);
SELECT app.enable_tenant_rls('app.expense_category_defs'::regclass);
SELECT app.enable_tenant_rls('app.expenses'::regclass);
SELECT app.enable_tenant_rls('app.inventory_counts'::regclass);
SELECT app.enable_tenant_rls('app.invoices'::regclass);
SELECT app.enable_tenant_rls('app.listings'::regclass);
SELECT app.enable_tenant_rls('app.movements'::regclass);
SELECT app.enable_tenant_rls('app.notifications'::regclass);
SELECT app.enable_tenant_rls('app.po_sessions'::regclass);
SELECT app.enable_tenant_rls('app.po_tickets'::regclass);
SELECT app.enable_tenant_rls('app.price_groups'::regclass);
SELECT app.enable_tenant_rls('app.products'::regclass);
SELECT app.enable_tenant_rls('app.purchase_orders'::regclass);
SELECT app.enable_tenant_rls('app.suppliers'::regclass);
SELECT app.enable_tenant_rls('app.warehouses'::regclass);
SELECT app.enable_tenant_rls('app.webhooks'::regclass);

-- app schema ("businessId" camelCase)
SELECT app.enable_tenant_rls('app.stock_levels'::regclass, '"businessId"');

-- app_auth (business_id)
SELECT app.enable_tenant_rls('app_auth.users'::regclass);
SELECT app.enable_tenant_rls('app_auth.custom_roles'::regclass);
SELECT app.enable_tenant_rls('app_auth.role_customizations'::regclass);

-- app_auth ("businessId" camelCase)
SELECT app.enable_tenant_rls('app_auth.security_policies'::regclass, '"businessId"');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Enable RLS on new child tables (all use business_id snake_case)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT app.enable_tenant_rls('app.invoice_lines'::regclass);
SELECT app.enable_tenant_rls('app.estimate_lines'::regclass);
SELECT app.enable_tenant_rls('app.delivery_note_lines'::regclass);
SELECT app.enable_tenant_rls('app.expense_photos'::regclass);
SELECT app.enable_tenant_rls('app.purchase_order_lines'::regclass);
SELECT app.enable_tenant_rls('app.po_ticket_lines'::regclass);
SELECT app.enable_tenant_rls('app.inventory_count_lines'::regclass);
SELECT app.enable_tenant_rls('app.listing_tiers'::regclass);
SELECT app.enable_tenant_rls('app.order_lines'::regclass);
SELECT app.enable_tenant_rls('app.webhook_deliveries'::regclass);
SELECT app.enable_tenant_rls('app.attendance_pauses'::regclass);
SELECT app.enable_tenant_rls('app_auth.sessions'::regclass);
SELECT app.enable_tenant_rls('app_auth.role_capabilities'::regclass);
SELECT app.enable_tenant_rls('app_auth.user_overrides'::regclass);
SELECT app.enable_tenant_rls('app_auth.user_warehouses'::regclass);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Special policies: orders (dual seller/buyer), businesses (own)
-- ═══════════════════════════════════════════════════════════════════════════

-- orders: visible to both seller and buyer
ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_tenant_isolation ON app.orders;
CREATE POLICY orders_tenant_isolation ON app.orders FOR ALL
    USING (seller_business_id = app.current_business_id() OR buyer_business_id = app.current_business_id())
    WITH CHECK (seller_business_id = app.current_business_id() OR buyer_business_id = app.current_business_id());

-- businesses: tenant sees only own business
ALTER TABLE app.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.businesses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS businesses_tenant_isolation ON app.businesses;
CREATE POLICY businesses_tenant_isolation ON app.businesses FOR ALL
    USING (id = app.current_business_id())
    WITH CHECK (id = app.current_business_id());

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. updatedAt triggers (uses app.set_updated_at() from 001-schemas)
-- ═══════════════════════════════════════════════════════════════════════════

-- app schema
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.businesses
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.categories
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.suppliers
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.warehouses
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.price_groups
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.customers
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.products
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.stock_levels
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.invoices
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.estimates
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.delivery_notes
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.activities
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.business_modules
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.listings
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.orders
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.order_lines
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.webhooks
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.webhook_deliveries
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- app_auth schema
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_auth.users
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_auth.security_policies
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_auth.custom_roles
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ponytail: attendances uses snake_case updated_at — separate trigger function
CREATE OR REPLACE FUNCTION app.set_updated_at_snake()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.attendances
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at_snake();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Restrict platform table access (SELECT only for tijaru_app)
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM tijaru_app;
REVOKE INSERT, UPDATE, DELETE ON public.platform_audit_logs FROM tijaru_app;

COMMIT;
