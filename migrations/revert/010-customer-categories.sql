-- Revert 010-customer-categories
BEGIN;
ALTER TABLE app.customers DROP COLUMN IF EXISTS category_id;
DROP TABLE IF EXISTS app.customer_categories;
COMMIT;
