-- Revert 003-rls-helper
BEGIN;

DROP FUNCTION IF EXISTS app.enable_tenant_rls(REGCLASS, TEXT);

COMMIT;
