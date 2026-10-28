-- Test: orders / order_lines are visible to seller and buyer only (migration 009)

\unset ECHO
\set QUIET 1
SET client_min_messages TO warning;
CREATE EXTENSION IF NOT EXISTS pgtap;
RESET client_min_messages;

BEGIN;

SELECT plan(9);

SELECT set_config('test.seller', tests.create_business('Seller', 's@test.com'), false);
SELECT set_config('test.buyer', tests.create_business('Buyer', 'b@test.com'), false);
SELECT set_config('test.third', tests.create_business('Third', 't@test.com'), false);

-- Fixtures bypass FKs/triggers (listing, product, customer are irrelevant here); business_id is explicit.
SET LOCAL session_replication_role = replica;
INSERT INTO app.orders (id, number, seller_business_id, buyer_business_id, customer_id,
                        subtotal_ht, vat_total, total_ttc, "updatedAt")
VALUES ('t_order', 'CMD-T-0001', current_setting('test.seller'), current_setting('test.buyer'), 'x', 10, 2, 12, now());
INSERT INTO app.order_lines (id, order_id, business_id, listing_id, product_id, name, qty, unit_price, vat, total_ht)
VALUES ('t_line', 't_order', current_setting('test.seller'), 'x', 'x', 'Line', 1, 10, 20, 10);
SET LOCAL session_replication_role = origin;

SELECT tests.impersonate(current_setting('test.seller'));
SELECT ok((SELECT count(*) = 1 FROM app.orders WHERE id = 't_order'), 'Seller sees the order');
SELECT ok((SELECT count(*) = 1 FROM app.order_lines WHERE id = 't_line'), 'Seller sees the line');

SELECT tests.reset_impersonation();
SELECT tests.impersonate(current_setting('test.buyer'));
SELECT ok((SELECT count(*) = 1 FROM app.orders WHERE id = 't_order'), 'Buyer sees the order');
SELECT ok((SELECT count(*) = 1 FROM app.order_lines WHERE id = 't_line'), 'Buyer sees the line');
DELETE FROM app.order_lines WHERE id = 't_line';
UPDATE app.order_lines SET qty = 99 WHERE id = 't_line';
SELECT tests.reset_impersonation();
SELECT ok((SELECT qty = 1 FROM app.order_lines WHERE id = 't_line'), 'Buyer can neither delete nor update lines');
SELECT tests.impersonate(current_setting('test.buyer'));
SELECT throws_ok(
    $$INSERT INTO app.order_lines (id, order_id, business_id, listing_id, product_id, name, qty, unit_price, vat, total_ht)
      VALUES ('t_line2', 't_order', current_setting('test.seller'), 'x', 'x', 'Extra', 1, 1, 0, 1)$$,
    '42501', NULL, 'Buyer cannot insert lines');

SELECT tests.reset_impersonation();
SELECT tests.impersonate(current_setting('test.third'));
SELECT ok((SELECT count(*) = 0 FROM app.orders WHERE id = 't_order'), 'Third tenant cannot see the order');
SELECT ok((SELECT count(*) = 0 FROM app.order_lines WHERE id = 't_line'), 'Third tenant cannot see the line');

SELECT tests.reset_impersonation();
SELECT ok((SELECT count(*) = 1 FROM app.order_lines WHERE id = 't_line'), 'Line still intact (owner view)');

SELECT * FROM finish();
ROLLBACK;
