-- Revert 002-auth-context
BEGIN;

DROP FUNCTION IF EXISTS app.current_user_role();
DROP FUNCTION IF EXISTS app.current_user_id();
DROP FUNCTION IF EXISTS app.current_business_id();

COMMIT;
