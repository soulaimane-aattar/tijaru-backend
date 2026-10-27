-- Deploy 001-schemas: Create schemas, roles, extensions, search_path
-- Tables live in app/app_auth schemas, not public. Public keeps platform tables only.

BEGIN;

-- Schemas
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS app_auth;
CREATE SCHEMA IF NOT EXISTS api;
CREATE SCHEMA IF NOT EXISTS tests;

-- Application role: NestJS connects as this (non-superuser, RLS applies)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tijaru_app') THEN
        CREATE ROLE tijaru_app LOGIN PASSWORD 'tijaru_app' NOSUPERUSER;
    END IF;
END $$;

-- Search path: unqualified names resolve app → app_auth → public
ALTER ROLE tijaru_app SET search_path = app, app_auth, public;
-- Dev superuser also gets the search_path for convenience
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stock') THEN
        EXECUTE 'ALTER ROLE stock SET search_path = app, app_auth, public';
    END IF;
END $$;

-- Grant schema access
GRANT USAGE ON SCHEMA public, app, app_auth, api, tests TO tijaru_app;

-- Grants on app schema (business tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO tijaru_app;

-- Grants on app_auth schema (auth tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_auth TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_auth TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth GRANT USAGE, SELECT ON SEQUENCES TO tijaru_app;

-- Grants on public (platform tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tijaru_app;

-- Extensions
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Utility: auto-update updatedAt timestamp
CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW."updatedAt" = now();
    RETURN NEW;
END;
$$;

COMMENT ON SCHEMA app IS 'Core business logic — tables, functions, triggers';
COMMENT ON SCHEMA app_auth IS 'Authentication and authorization';
COMMENT ON SCHEMA api IS 'Read-only views for reporting and dashboards';
COMMENT ON SCHEMA tests IS 'pgTAP test helpers and fixtures';

COMMIT;
