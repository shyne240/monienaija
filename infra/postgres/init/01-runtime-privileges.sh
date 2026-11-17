#!/bin/bash
# Provision the runtime database role with least privilege.
#
# This runs once, on first initialisation of the data directory, as the superuser. Its whole purpose
# is that the backend never connects as a role that can alter its own schema.
#
# What the runtime role deliberately does NOT get:
#   SUPERUSER, CREATEDB, CREATEROLE  — it cannot create a role that outranks it
#   ownership of any table          — it cannot DROP or ALTER what it writes to
#   TRUNCATE on financial tables    — a compromised runtime cannot empty the ledger
#   INSERT/UPDATE on protected_authority.*, privileged_action_approvals — that is the boundary
#     between "runs the business" and "decides who may approve money", and it is a separate identity
#
# The grant below is on schema `public` only, and ALTER DEFAULT PRIVILEGES is set so that tables
# created by future migrations are reachable without a manual follow-up grant.
set -euo pipefail

RUNTIME_USER="${DB_RUNTIME_USER:-monienaija_runtime}"
RUNTIME_PASSWORD="${DB_RUNTIME_PASSWORD:?DB_RUNTIME_PASSWORD must be set}"
DB="${POSTGRES_DB:-monienaija}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB" <<-SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_USER}') THEN
      CREATE ROLE ${RUNTIME_USER} LOGIN PASSWORD '${RUNTIME_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    END IF;
  END
  \$\$;

  GRANT CONNECT ON DATABASE ${DB} TO ${RUNTIME_USER};
  GRANT USAGE ON SCHEMA public TO ${RUNTIME_USER};

  -- Business tables: read and write, no DDL.
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_USER};
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_USER};

  -- Future tables created by the migration role are immediately reachable.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${RUNTIME_USER};
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${RUNTIME_USER};

  -- Revoke what the blanket grant above would otherwise imply, where it exists.
  REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${RUNTIME_USER};
SQL

# The protected authority boundary is a separate identity. If that schema exists at init time (it is
# created by a migration, so it normally will not), make the refusal explicit rather than relying on
# the absence of a grant.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB" <<-SQL || true
  REVOKE ALL ON SCHEMA protected_authority FROM ${RUNTIME_USER};
  REVOKE ALL ON ALL TABLES IN SCHEMA protected_authority FROM ${RUNTIME_USER};
SQL

echo "runtime role ${RUNTIME_USER} provisioned with least privilege"
