-- Revert 005-test-framework
BEGIN;

DROP FUNCTION IF EXISTS tests.create_customer(text, text);
DROP FUNCTION IF EXISTS tests.create_category(text, text);
DROP FUNCTION IF EXISTS tests.create_product(text, text, numeric);
DROP FUNCTION IF EXISTS tests.create_user(text, text, text, text);
DROP FUNCTION IF EXISTS tests.create_business(text, text);
DROP FUNCTION IF EXISTS tests.reset_impersonation();
DROP FUNCTION IF EXISTS tests.impersonate(text, text, text);
DROP FUNCTION IF EXISTS tests.gen_id();
DROP EXTENSION IF EXISTS pgtap;

COMMIT;
