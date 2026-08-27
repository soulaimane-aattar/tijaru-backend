-- Customers/Suppliers became module-gated: backfill active rows so existing
-- businesses keep seeing them (new signups get them from the signup seed).
INSERT INTO "business_modules" ("business_id", "module_id", "active")
SELECT b."id", m."module_id", true
FROM "businesses" b
CROSS JOIN (VALUES ('customers'), ('suppliers')) AS m("module_id")
ON CONFLICT ("business_id", "module_id") DO NOTHING;
