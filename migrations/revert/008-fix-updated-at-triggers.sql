-- Revert 008-fix-updated-at-triggers
-- Intentionally a no-op: the dropped triggers were broken (column does not exist).
BEGIN;
COMMIT;
