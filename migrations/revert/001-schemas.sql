-- Revert 001-schemas
BEGIN;

DROP FUNCTION IF EXISTS app.set_updated_at();

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tijaru_app') THEN
        -- Revoke all privileges before dropping
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tijaru_app';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM tijaru_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM tijaru_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM tijaru_app';
        EXECUTE 'REVOKE USAGE ON SCHEMA public FROM tijaru_app';
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') THEN
            EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM tijaru_app';
            EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM tijaru_app';
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM tijaru_app';
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM tijaru_app';
            EXECUTE 'REVOKE USAGE ON SCHEMA app FROM tijaru_app';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app_auth') THEN
            EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app_auth FROM tijaru_app';
            EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_auth FROM tijaru_app';
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth REVOKE ALL ON TABLES FROM tijaru_app';
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth REVOKE ALL ON SEQUENCES FROM tijaru_app';
            EXECUTE 'REVOKE USAGE ON SCHEMA app_auth FROM tijaru_app';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api') THEN
            EXECUTE 'REVOKE USAGE ON SCHEMA api FROM tijaru_app';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tests') THEN
            EXECUTE 'REVOKE USAGE ON SCHEMA tests FROM tijaru_app';
        END IF;
        DROP ROLE tijaru_app;
    END IF;
END $$;

DROP EXTENSION IF EXISTS pgcrypto;
DROP EXTENSION IF EXISTS citext;
DROP SCHEMA IF EXISTS tests;
DROP SCHEMA IF EXISTS api;
DROP SCHEMA IF EXISTS app_auth;
DROP SCHEMA IF EXISTS app;

COMMIT;
