-- Deploy 002-auth-context: Session context functions
-- NestJS middleware calls SET LOCAL before each query via Kysely.
-- These functions read those session variables for RLS policies.

BEGIN;

-- Returns current tenant business ID (set by NestJS middleware)
-- IDs are text (cuid/uuid) in this schema
CREATE OR REPLACE FUNCTION app.current_business_id()
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_business_id', true), '');
$$;

-- Returns current user ID (set by NestJS middleware)
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_user_id', true), '');
$$;

-- Returns current user role (set by NestJS middleware)
CREATE OR REPLACE FUNCTION app.current_user_role()
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_user_role', true), '');
$$;

COMMENT ON FUNCTION app.current_business_id() IS 'Tenant ID from NestJS session — used by RLS policies';
COMMENT ON FUNCTION app.current_user_id() IS 'User ID from NestJS session — used by RLS policies';
COMMENT ON FUNCTION app.current_user_role() IS 'User role from NestJS session — used by RLS policies';

COMMIT;
