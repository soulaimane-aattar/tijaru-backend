-- Verify 011-decimal-quantities
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND data_type = 'double precision'
      AND (table_name, column_name) IN (
        ('products', 'minStock'), ('products', 'maxStock'),
        ('stock_levels', 'qty'), ('stock_levels', 'reservedQty'),
        ('movements', 'qty'),
        ('purchase_order_lines', 'qty'), ('purchase_order_lines', 'received'),
        ('po_ticket_lines', 'qty'),
        ('inventory_count_lines', 'expected'), ('inventory_count_lines', 'counted'));
    IF n <> 10 THEN
        RAISE EXCEPTION 'expected 10 double precision quantity columns, found %', n;
    END IF;
END $$;
