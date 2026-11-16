-- Deploy 011-decimal-quantities
-- Products sold by weight/volume (kg, g, litre, ml) need fractional quantities
-- (1.250 kg), up to 3 decimals. Everything that feeds or mirrors stock moves
-- from integer to double precision (lossless).
--
-- Why double precision and not numeric(12,3): node-pg returns numeric as
-- text, which would turn every quantity read in the API into a string. The
-- app rounds to 3 decimals on every arithmetic write instead (StockLedger,
-- PO receive), so stored values are always exact 3-decimal doubles — the
-- same model Odoo / ERPNext use for quantities.
--
-- Marketplace (order_lines, listings, listing_tiers) stays in whole units on
-- purpose: B2B orders are per pack.
BEGIN;

-- ALTER TYPE rewrites each table under ACCESS EXCLUSIVE. If a long transaction
-- holds a lock, fail fast instead of queueing behind it and stalling every
-- query that arrives after us. Re-run `make prod-db-up` when traffic is quiet.
SET LOCAL lock_timeout = '10s';

ALTER TABLE app.products
    ALTER COLUMN "minStock" TYPE double precision,
    ALTER COLUMN "maxStock" TYPE double precision;

ALTER TABLE app.stock_levels
    ALTER COLUMN qty TYPE double precision,
    ALTER COLUMN "reservedQty" TYPE double precision;

ALTER TABLE app.movements
    ALTER COLUMN qty TYPE double precision;

ALTER TABLE app.purchase_order_lines
    ALTER COLUMN qty TYPE double precision,
    ALTER COLUMN received TYPE double precision;

ALTER TABLE app.po_ticket_lines
    ALTER COLUMN qty TYPE double precision;

ALTER TABLE app.inventory_count_lines
    ALTER COLUMN expected TYPE double precision,
    ALTER COLUMN counted TYPE double precision;

COMMIT;
