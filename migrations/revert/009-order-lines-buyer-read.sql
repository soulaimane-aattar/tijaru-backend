-- Revert 009-order-lines-buyer-read
BEGIN;

DROP POLICY IF EXISTS order_lines_read ON app.order_lines;
DROP POLICY IF EXISTS order_lines_insert ON app.order_lines;
DROP POLICY IF EXISTS order_lines_update ON app.order_lines;
DROP POLICY IF EXISTS order_lines_delete ON app.order_lines;
SELECT app.enable_tenant_rls('app.order_lines'::regclass);

COMMIT;
