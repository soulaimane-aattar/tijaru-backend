-- Deploy 010-customer-categories
-- Per-tenant customer categories: label + colour + optional debt ceiling.
-- customers.credit_limit (own override) wins over the category limit.
BEGIN;

CREATE TABLE app.customer_categories (
    id text PRIMARY KEY,
    business_id text NOT NULL REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE,
    label text NOT NULL,
    color text NOT NULL DEFAULT '#2563eb' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    credit_limit numeric(12,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
    created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX customer_categories_business_label_key ON app.customer_categories (business_id, lower(label));

ALTER TABLE app.customers
    ADD COLUMN category_id text REFERENCES app.customer_categories(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX customers_category_id_idx ON app.customers (category_id);

SELECT app.enable_tenant_rls('app.customer_categories'::regclass);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.customer_categories TO tijaru_app;

COMMIT;
