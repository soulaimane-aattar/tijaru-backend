-- New `multi-stock` module (extra warehouses). Backfill active so existing
-- businesses keep today's behaviour; platform admin can switch it off per business.
INSERT INTO "business_modules" ("business_id", "module_id", "active", "updated_at")
SELECT "id", 'multi-stock', true, NOW() FROM "businesses"
ON CONFLICT ("business_id", "module_id") DO NOTHING;
