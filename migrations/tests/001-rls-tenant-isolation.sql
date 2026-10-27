-- Test: RLS tenant isolation works correctly
-- Verifies that business A cannot see business B's data

\unset ECHO
\set QUIET 1
SET client_min_messages TO warning;
CREATE EXTENSION IF NOT EXISTS pgtap;
RESET client_min_messages;

BEGIN;

SELECT plan(6);

-- Create fixtures (as superuser stock, before SET ROLE)
SELECT set_config('test.biz_a', tests.create_business('Business A', 'a@test.com'), false);
SELECT set_config('test.biz_b', tests.create_business('Business B', 'b@test.com'), false);

SELECT set_config('test.user_a', tests.create_user(
    current_setting('test.biz_a'), 'owner-a@test.com', 'Owner A'), false);
SELECT set_config('test.user_b', tests.create_user(
    current_setting('test.biz_b'), 'owner-b@test.com', 'Owner B'), false);

SELECT set_config('test.prod_a', tests.create_product(
    current_setting('test.biz_a'), 'Product A', 10.00), false);
SELECT set_config('test.prod_b', tests.create_product(
    current_setting('test.biz_b'), 'Product B', 20.00), false);

-- Impersonate business A (switches to tijaru_app role, RLS active)
SELECT tests.impersonate(current_setting('test.biz_a'), current_setting('test.user_a'));

SELECT ok(
    (SELECT count(*) = 1 FROM app.products WHERE id = current_setting('test.prod_a')),
    'Business A sees own product'
);

SELECT ok(
    (SELECT count(*) = 0 FROM app.products WHERE id = current_setting('test.prod_b')),
    'Business A cannot see Business B product'
);

SELECT ok(
    (SELECT count(*) = 1 FROM app_auth.users WHERE id = current_setting('test.user_a')),
    'Business A sees own user'
);

SELECT ok(
    (SELECT count(*) = 0 FROM app_auth.users WHERE id = current_setting('test.user_b')),
    'Business A cannot see Business B user'
);

-- Reset then impersonate business B
SELECT tests.reset_impersonation();
SELECT tests.impersonate(current_setting('test.biz_b'), current_setting('test.user_b'));

SELECT ok(
    (SELECT count(*) = 1 FROM app.products WHERE id = current_setting('test.prod_b')),
    'Business B sees own product'
);

SELECT ok(
    (SELECT count(*) = 0 FROM app.products WHERE id = current_setting('test.prod_a')),
    'Business B cannot see Business A product'
);

SELECT tests.reset_impersonation();
SELECT * FROM finish();
ROLLBACK;
