-- ARENA 3 — database-scoped provisioning that must happen before migrations run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{{MIGRATOR_ROLE}}') THEN
    RAISE EXCEPTION 'migration role {{MIGRATOR_ROLE}} is not provisioned';
  END IF;
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())
      <> '{{MIGRATOR_ROLE}}' THEN
    EXECUTE format('ALTER DATABASE %I OWNER TO %I', current_database(), '{{MIGRATOR_ROLE}}');
  END IF;
  IF (SELECT nspowner FROM pg_namespace WHERE nspname = 'public')
      <> (SELECT oid FROM pg_roles WHERE rolname = '{{MIGRATOR_ROLE}}') THEN
    EXECUTE format('ALTER SCHEMA public OWNER TO %I', '{{MIGRATOR_ROLE}}');
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION
    'provisioning requires a role able to make {{MIGRATOR_ROLE}} own the database and schema public';
END $$;

GRANT CONNECT ON DATABASE {{DATABASE_NAME}}
  TO {{RUNTIME_ROLE}}, {{AUTHORITY_ROLE}}, {{MIGRATOR_ROLE}};
GRANT USAGE ON SCHEMA public
  TO monienaija_runtime, monienaija_authority_core, {{RUNTIME_ROLE}}, {{AUTHORITY_ROLE}};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM monienaija_runtime;
REVOKE CREATE ON SCHEMA public FROM {{RUNTIME_ROLE}};
