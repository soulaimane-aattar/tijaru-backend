-- ============================================================================
-- Remove demo account and all its data
-- Run: docker exec -i stock-postgres psql -v ON_ERROR_STOP=1 -U stock -d stock < scripts/unseed-demo-account.sql
-- ============================================================================

BEGIN;

-- Delete children with RESTRICT FKs on users/products first
DELETE FROM app.expenses        WHERE business_id = 'cdemo_biz_001';
DELETE FROM app.invoice_lines   WHERE business_id = 'cdemo_biz_001';
DELETE FROM app.invoices        WHERE business_id = 'cdemo_biz_001';
DELETE FROM app.delivery_note_lines WHERE business_id = 'cdemo_biz_001';
DELETE FROM app.delivery_notes  WHERE business_id = 'cdemo_biz_001';
DELETE FROM app.movements       WHERE business_id = 'cdemo_biz_001';
DELETE FROM app.po_ticket_lines WHERE business_id = 'cdemo_biz_001';
DELETE FROM app.po_tickets      WHERE business_id = 'cdemo_biz_001';
DELETE FROM app.po_sessions     WHERE business_id = 'cdemo_biz_001';
-- Now CASCADE handles the rest (products, customers, stock_levels, categories, etc.)
DELETE FROM app.businesses      WHERE id = 'cdemo_biz_001';

COMMIT;
