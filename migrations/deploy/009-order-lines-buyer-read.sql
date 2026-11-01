-- Deploy 009-order-lines-buyer-read
-- order_lines.business_id is the SELLER (inherit trigger), so the buyer could not read their own
-- order's lines under RLS. Reads now follow the parent order (orders already has the dual
-- seller/buyer policy); writes stay seller-only exactly as before.
BEGIN;

DROP POLICY IF EXISTS order_lines_tenant_isolation ON app.order_lines;

CREATE POLICY order_lines_read ON app.order_lines FOR SELECT
    USING (
        business_id = app.current_business_id()
        OR EXISTS (
            SELECT 1 FROM app.orders o
            WHERE o.id = order_lines.order_id
              AND (o.seller_business_id = app.current_business_id()
                   OR o.buyer_business_id = app.current_business_id())
        )
    );

CREATE POLICY order_lines_insert ON app.order_lines FOR INSERT
    WITH CHECK (business_id = app.current_business_id());
CREATE POLICY order_lines_update ON app.order_lines FOR UPDATE
    USING (business_id = app.current_business_id())
    WITH CHECK (business_id = app.current_business_id());
CREATE POLICY order_lines_delete ON app.order_lines FOR DELETE
    USING (business_id = app.current_business_id());

COMMIT;
