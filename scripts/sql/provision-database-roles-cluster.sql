-- ARENA 3 protected checker authority — cluster-scoped provisioning (safe to re-run).
-- Creates the NOINHERIT group roles that own protected authority and represent ordinary runtime
-- access, plus the three login roles. No password is stored in this repository: the placeholders
-- are replaced by scripts/provision-database-roles.js from operator-supplied env values.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monienaija_authority_core') THEN
    CREATE ROLE monienaija_authority_core NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monienaija_runtime') THEN
    CREATE ROLE monienaija_runtime NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{{RUNTIME_ROLE}}') THEN
    CREATE ROLE {{RUNTIME_ROLE}} LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{{AUTHORITY_ROLE}}') THEN
    CREATE ROLE {{AUTHORITY_ROLE}} LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{{MIGRATOR_ROLE}}') THEN
    CREATE ROLE {{MIGRATOR_ROLE}} LOGIN;
  END IF;
END $$;

ALTER ROLE {{RUNTIME_ROLE}}
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD {{RUNTIME_PASSWORD}};
ALTER ROLE {{AUTHORITY_ROLE}}
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD {{AUTHORITY_PASSWORD}};
ALTER ROLE {{MIGRATOR_ROLE}}
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD {{MIGRATOR_PASSWORD}};

-- The ordinary runtime login is exactly the runtime group and nothing else. It can never SET ROLE
-- to the protected authority, and repeated provisioning removes an accidental grant.
REVOKE monienaija_authority_core FROM {{RUNTIME_ROLE}};
GRANT monienaija_runtime TO {{RUNTIME_ROLE}};
GRANT monienaija_authority_core TO {{AUTHORITY_ROLE}};
GRANT monienaija_authority_core TO {{MIGRATOR_ROLE}};
