-- Revert 011-decimal-quantities
-- Refuses to run once fractional quantities exist: rounding them away would
-- silently corrupt stock. Fix the data first, then revert.
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM app.products WHERE "minStock" <> trunc("minStock") OR "maxStock" <> trunc("maxStock"))
       OR EXISTS (SELECT 1 FROM app.stock_levels WHERE qty <> trunc(qty) OR "reservedQty" <> trunc("reservedQty"))
       OR EXISTS (SELECT 1 FROM app.movements WHERE qty <> trunc(qty))
       OR EXISTS (SELECT 1 FROM app.purchase_order_lines WHERE qty <> trunc(qty) OR received <> trunc(received))
       OR EXISTS (SELECT 1 FROM app.po_ticket_lines WHERE qty <> trunc(qty))
       OR EXISTS (SELECT 1 FROM app.inventory_count_lines WHERE expected <> trunc(expected) OR counted <> trunc(counted))
    THEN
        RAISE EXCEPTION 'fractional quantities present: cannot revert 011 without data loss';
    END IF;
END $$;

ALTER TABLE app.products
    ALTER COLUMN "minStock" TYPE integer,
    ALTER COLUMN "maxStock" TYPE integer;
ALTER TABLE app.stock_levels
    ALTER COLUMN qty TYPE integer,
    ALTER COLUMN "reservedQty" TYPE integer;
ALTER TABLE app.movements
    ALTER COLUMN qty TYPE integer;
ALTER TABLE app.purchase_order_lines
    ALTER COLUMN qty TYPE integer,
    ALTER COLUMN received TYPE integer;
ALTER TABLE app.po_ticket_lines
    ALTER COLUMN qty TYPE integer;
ALTER TABLE app.inventory_count_lines
    ALTER COLUMN expected TYPE integer,
    ALTER COLUMN counted TYPE integer;

COMMIT;
