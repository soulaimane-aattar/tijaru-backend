-- Deploy 001-schemas: Create schemas, roles, extensions
-- Existing tables stay in public (Prisma baseline).
-- New DB objects go into app/app_auth/api/tests schemas.

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

-- Grant access to all schemas + public tables
GRANT USAGE ON SCHEMA public, app, app_auth, api, tests TO tijaru_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tijaru_app;

-- Extensions
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pgTAP: installed separately via custom postgres image (see docker/postgres/)
-- CREATE EXTENSION IF NOT EXISTS pgtap; -- done in 005-test-framework when available

-- Utility: auto-update updated_at timestamp
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
