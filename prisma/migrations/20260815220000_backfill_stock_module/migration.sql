-- Backfill the 'stock' module row for every existing business so the
-- new @RequiresModule('stock') gate on /movements doesn't 403 them.
INSERT INTO business_modules (business_id, module_id, active, "updatedAt")
SELECT b.id, 'stock', true, NOW()
FROM businesses b
ON CONFLICT (business_id, module_id) DO NOTHING;
