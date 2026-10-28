-- Deploy 008-fix-updated-at-triggers
-- 007 attached set_updated_at() to tables that have no "updatedAt" column, so every UPDATE failed
-- with: record "new" has no field "updatedAt".
BEGIN;

DROP TRIGGER IF EXISTS set_updated_at ON app.categories;
DROP TRIGGER IF EXISTS set_updated_at ON app.activities;
DROP TRIGGER IF EXISTS set_updated_at ON app.order_lines;

COMMIT;
