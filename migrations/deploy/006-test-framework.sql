-- Deploy 006-test-framework: pgTAP test helpers and fixtures
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION tests.gen_id()
RETURNS text LANGUAGE sql AS $$
    SELECT 'test_' || encode(gen_random_bytes(12), 'hex');
$$;

CREATE OR REPLACE FUNCTION tests.impersonate(
    p_business_id text,
    p_user_id text DEFAULT NULL,
    p_role text DEFAULT 'user'
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_business_id', p_business_id, true);
    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id, true);
    END IF;
    PERFORM set_config('app.current_user_role', p_role, true);
    SET LOCAL ROLE tijaru_app;
END;
$$;

CREATE OR REPLACE FUNCTION tests.reset_impersonation()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    RESET ROLE;
    PERFORM set_config('app.current_business_id', '', true);
    PERFORM set_config('app.current_user_id', '', true);
    PERFORM set_config('app.current_user_role', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION tests.create_business(
    p_name text DEFAULT 'Test Business',
    p_email text DEFAULT 'test@example.com'
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_id text;
BEGIN
    v_id := tests.gen_id();
    INSERT INTO app.businesses (id, name, status, plan, "createdAt", "updatedAt")
    VALUES (v_id, p_name, 'active', 'trial', now(), now());
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION tests.create_user(
    p_business_id text,
    p_email text DEFAULT 'user@example.com',
    p_name text DEFAULT 'Test User',
    p_role text DEFAULT 'owner'
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_id text;
BEGIN
    v_id := tests.gen_id();
    INSERT INTO app_auth.users (id, email, name, "passwordHash", role, business_id, "createdAt", "updatedAt")
    VALUES (v_id, p_email, p_name, '$2b$10$placeholder', p_role::"BuiltInRole", p_business_id, now(), now())
    ON CONFLICT DO NOTHING;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION tests.create_category(
    p_business_id text,
    p_name text DEFAULT 'Test Category'
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_id text;
BEGIN
    v_id := tests.gen_id();
    INSERT INTO app.categories (id, name, icon, tone, business_id, active)
    VALUES (v_id, p_name, '📦', '#6366f1', p_business_id, true);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION tests.create_product(
    p_business_id text,
    p_name text DEFAULT 'Test Product',
    p_price numeric DEFAULT 100.00
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_id text;
    v_cat_id text;
BEGIN
    v_id := tests.gen_id();
    v_cat_id := tests.create_category(p_business_id, 'Default Category');
    INSERT INTO app.products (id, name, barcode, sku, "categoryId", purchase, sale, vat, business_id, "createdAt", "updatedAt")
    VALUES (v_id, p_name, 'BAR-' || v_id, 'SKU-' || v_id, v_cat_id, 0, p_price, 20, p_business_id, now(), now());
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION tests.create_customer(
    p_business_id text,
    p_name text DEFAULT 'Test Customer'
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_id text;
BEGIN
    v_id := tests.gen_id();
    INSERT INTO app.customers (id, name, business_id, "createdAt", "updatedAt")
    VALUES (v_id, p_name, p_business_id, now(), now());
    RETURN v_id;
END;
$$;

COMMIT;
