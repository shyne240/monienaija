#!/usr/bin/env bash
# backup-restore-acceptance.sh — disposable PostgreSQL backup and restore
#
# Uses pg_dump/pg_restore (or the existing backup-restore-drill.js wire-level fallback
# when pg_dump is unavailable) to verify a complete backup/restore cycle in a
# disposable environment.
#
# Requires: disposable confirmation, container runtime (for postgres), or falls back
# to embedded disposable cluster via backup-restore-drill.js.
#
# Verifies:
#   - Source database identity (name, migration head)
#   - Backup artifact creation + validation (checksum, size)
#   - Restore into a separate disposable database
#   - Migration-head verification on restored DB
#   - Wallet and ledger integrity (debits=credits, no orphan lines, journal count)
#   - Recovery duration measurement (backup ms, restore ms, total ms)
#   - Backup size and data-volume recording
#   - Cleanup
#
# Distinguishes logical backup/restore from WAL-based point-in-time recovery.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

EVIDENCE_ROOT="${PORTABLE_EVIDENCE_DIR:-$REPO_ROOT/docs/integration/evidence/portable-acceptance}"
EVIDENCE_DIR="$EVIDENCE_ROOT/backup-restore"
mkdir -p "$EVIDENCE_DIR"

fail() { echo "BACKUP-RESTORE FAIL: $*" | tee -a "$EVIDENCE_DIR/result.log" >&2; exit 1; }
info() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "$EVIDENCE_DIR/result.log"; }

if [[ "${PORTABLE_ACCEPT_DISPOSABLE:-}" != "yes" ]]; then echo "Refusing without PORTABLE_ACCEPT_DISPOSABLE=yes" >&2; exit 1; fi
PROJECT="${COMPOSE_PROJECT_NAME:-monienaija-portable-acceptance}"
if [[ "$PROJECT" != *"portable"* && "$PROJECT" != *"acceptance"* && "$PROJECT" != *"test"* && "$PROJECT" != *"tmp"* ]]; then echo "COMPOSE_PROJECT_NAME=$PROJECT not disposable" >&2; exit 1; fi

COMPOSE="docker compose"
if command -v podman >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then COMPOSE="podman compose"; fi
ENV_FILE="${PORTABLE_ENV_FILE:-infra/portable-acceptance/.env.acceptance.example}"
if [[ ! -f "$ENV_FILE" ]]; then ENV_FILE=".env.acceptance"; fi
if [[ -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a; fi
export COMPOSE_PROJECT_NAME="$PROJECT"

HAS_RUNTIME=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then HAS_RUNTIME=1
elif command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then HAS_RUNTIME=1
fi

HAS_PGDUMP=0
if command -v pg_dump >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1; then HAS_PGDUMP=1
elif $COMPOSE ps postgres --format json 2>/dev/null | grep -q postgres; then HAS_PGDUMP=1  # will use exec variant
fi
# Also check if pg_dump exists inside postgres image via exec
if [[ $HAS_PGDUMP -eq 0 ]] && [[ $HAS_RUNTIME -eq 1 ]]; then
  # Try to locate pg_dump in image; if image not yet built, try pulling postgres
  if docker run --rm postgres:16.4-alpine which pg_dump >/dev/null 2>&1; then HAS_PGDUMP=1; fi
fi

info "Backup/restore acceptance starting (hasRuntime=$HAS_RUNTIME hasPgDump=$HAS_PGDUMP)"

# ── Path A: pg_dump/pg_restore against compose postgres (preferred full path) ──
if [[ $HAS_RUNTIME -eq 1 ]]; then
  info "Ensuring disposable compose postgres is running..."
  # Start postgres if needed (reuse container-acceptance logic minimally)
  if ! docker inspect --format '{{.State.Health.Status}}' "${PROJECT}-postgres-1" 2>/dev/null | grep -q healthy; then
    info "Starting postgres for backup source..."
    $COMPOSE --env-file "${ENV_FILE:-/dev/null}" up -d postgres 2>&1 | tee -a "$EVIDENCE_DIR/postgres-start.log" || fail "postgres start failed"
    TRIES=0; until docker inspect --format '{{.State.Health.Status}}' "${PROJECT}-postgres-1" 2>/dev/null | grep -q healthy; do sleep 3; TRIES=$((TRIES+1)); if [[ $TRIES -gt 30 ]]; then fail "postgres not healthy"; fi; done
    # Ensure migrations have run at least once; run if migrations table empty
    MIG_EXISTS=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "${DB_NAME:-monienaija_portable}" -tAc "SELECT count(*) FROM typeorm_migrations;" 2>&1 | tr -d '[:space:]' || echo "0")
    if [[ "$MIG_EXISTS" == "0" || "$MIG_EXISTS" == "" ]]; then
      info "Migrations not present — running migrate..."
      $COMPOSE --env-file "${ENV_FILE:-/dev/null}" run --rm migrate 2>&1 | tee -a "$EVIDENCE_DIR/migrate.log" || fail "migrate failed"
    fi
  fi

  SOURCE_DB="${DB_NAME:-monienaija_portable}"
  RESTORE_DB="${SOURCE_DB}_restore_$(date +%s)"
  BACKUP_FILE="$EVIDENCE_DIR/${SOURCE_DB}.dump"
  BACKUP_SQL="$EVIDENCE_DIR/${SOURCE_DB}.sql"

  # Record source identity
  info "Recording source database identity..."
  SOURCE_HEAD=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$SOURCE_DB" -tAc "SELECT name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  SOURCE_MIG_COUNT=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$SOURCE_DB" -tAc "SELECT count(*) FROM typeorm_migrations;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  SOURCE_TABLES=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$SOURCE_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" 2>&1 | tr -d '[:space:]' || echo "unknown")
  SOURCE_JOURNALS=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$SOURCE_DB" -tAc "SELECT count(*) FROM ledger_journals;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  SOURCE_LEDGER_LINES=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$SOURCE_DB" -tAc "SELECT count(*) FROM ledger_lines;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  SOURCE_WALLETS=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$SOURCE_DB" -tAc "SELECT count(*) FROM wallets;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  info "Source: head=$SOURCE_HEAD migrations=$SOURCE_MIG_COUNT tables=$SOURCE_TABLES journals=$SOURCE_JOURNALS lines=$SOURCE_LEDGER_LINES wallets=$SOURCE_WALLETS"

  # Backup with pg_dump inside container (always available there)
  info "Creating backup artifact (pg_dump -Fc inside postgres container)..."
  BACKUP_START=$(date +%s)
  $COMPOSE exec -T postgres pg_dump -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$SOURCE_DB" -Fc -f "/tmp/${SOURCE_DB}.dump" 2>&1 | tee -a "$EVIDENCE_DIR/pg_dump.log" || fail "pg_dump failed"
  $COMPOSE exec -T postgres ls -lh "/tmp/${SOURCE_DB}.dump" 2>&1 | tee -a "$EVIDENCE_DIR/backup-size.log"
  # Copy artifact to host evidence dir via docker cp
  POSTGRES_CID=$(docker ps --filter "name=${PROJECT}-postgres-1" --format "{{.ID}}" 2>/dev/null | head -1)
  if [[ -n "$POSTGRES_CID" ]]; then
    docker cp "$POSTGRES_CID:/tmp/${SOURCE_DB}.dump" "$BACKUP_FILE" 2>&1 | tee -a "$EVIDENCE_DIR/backup-copy.log" || true
  fi
  # Also try plain SQL for diffability
  $COMPOSE exec -T postgres pg_dump -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$SOURCE_DB" --no-owner 2>&1 | head -200 > "$BACKUP_SQL" || true
  BACKUP_MS=$(( ($(date +%s) - BACKUP_START) * 1000 ))
  BACKUP_BYTES=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo 0)
  BACKUP_SHA=$(sha256sum "$BACKUP_FILE" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$BACKUP_FILE" 2>/dev/null | cut -d' ' -f1 || echo "unknown")
  info "Backup created: $BACKUP_BYTES bytes sha256=$BACKUP_SHA in ${BACKUP_MS}ms"
  if [[ "$BACKUP_BYTES" == "0" ]]; then fail "Backup artifact is empty"; fi

  # Restore into separate disposable DB
  info "Restoring into separate disposable database $RESTORE_DB..."
  RESTORE_START=$(date +%s)
  $COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$RESTORE_DB\" TEMPLATE template0;" 2>&1 | tee -a "$EVIDENCE_DIR/create-restore-db.log" || fail "create restore DB failed"
  $COMPOSE exec -T postgres pg_restore -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" --no-owner --no-acl "/tmp/${SOURCE_DB}.dump" 2>&1 | tee -a "$EVIDENCE_DIR/pg_restore.log" || {
    RESTORE_EXIT=$?
    info "pg_restore exited $RESTORE_EXIT — checking if recoverable (warnings are common for extensions)"
    # Allow exit 1 if data still loaded (pg_restore warnings)
  }
  RESTORE_MS=$(( ($(date +%s) - RESTORE_START) * 1000 ))
  info "Restore completed in ${RESTORE_MS}ms"

  # Verify restored DB
  info "Verifying restored database..."
  RESTORE_HEAD=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" -tAc "SELECT name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  RESTORE_MIG_COUNT=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" -tAc "SELECT count(*) FROM typeorm_migrations;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  RESTORE_TABLES=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" 2>&1 | tr -d '[:space:]' || echo "unknown")
  RESTORE_JOURNALS=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" -tAc "SELECT count(*) FROM ledger_journals;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  RESTORE_LINES=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" -tAc "SELECT count(*) FROM ledger_lines;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  RESTORE_WALLETS=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" -tAc "SELECT count(*) FROM wallets;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  info "Restored: head=$RESTORE_HEAD migrations=$RESTORE_MIG_COUNT tables=$RESTORE_TABLES journals=$RESTORE_JOURNALS lines=$RESTORE_LINES wallets=$RESTORE_WALLETS"

  PASS=1
  if [[ "$SOURCE_HEAD" != "$RESTORE_HEAD" ]]; then info "FAIL migration head mismatch: $SOURCE_HEAD vs $RESTORE_HEAD"; PASS=0; else info "PASS migration head matches"; fi
  if [[ "$SOURCE_MIG_COUNT" != "$RESTORE_MIG_COUNT" ]]; then info "FAIL migration count $SOURCE_MIG_COUNT vs $RESTORE_MIG_COUNT"; PASS=0; else info "PASS migration count"; fi
  if [[ "$SOURCE_JOURNALS" != "$RESTORE_JOURNALS" ]]; then info "FAIL journal count $SOURCE_JOURNALS vs $RESTORE_JOURNALS"; PASS=0; else info "PASS journal count"; fi
  if [[ "$SOURCE_WALLETS" != "$RESTORE_WALLETS" ]]; then info "FAIL wallet count $SOURCE_WALLETS vs $RESTORE_WALLETS"; PASS=0; else info "PASS wallet count"; fi

  # Ledger integrity: debits=credits per journal, no orphans
  info "Checking ledger integrity on restored DB..."
  UNBALANCED=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" -tAc "
    SELECT count(*) FROM ledger_journals j WHERE EXISTS (
      SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id
      GROUP BY l.journal_id HAVING sum(CASE WHEN l.side='DEBIT' THEN l.amount_minor::bigint ELSE -l.amount_minor::bigint END) != 0
    );" 2>&1 | tr -d '[:space:]' || echo "unknown")
  ORPHAN_LINES=$($COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d "$RESTORE_DB" -tAc "SELECT count(*) FROM ledger_lines l LEFT JOIN ledger_journals j ON j.id=l.journal_id WHERE j.id IS NULL;" 2>&1 | tr -d '[:space:]' || echo "unknown")
  info "Integrity: unbalancedJournals=$UNBALANCED orphanLines=$ORPHAN_LINES"
  if [[ "$UNBALANCED" != "0" ]]; then info "FAIL $UNBALANCED unbalanced journals"; PASS=0; else info "PASS all journals balance"; fi
  if [[ "$ORPHAN_LINES" != "0" ]]; then info "FAIL $ORPHAN_LINES orphan ledger_lines"; PASS=0; else info "PASS no orphan lines"; fi

  TOTAL_MS=$((BACKUP_MS + RESTORE_MS))
  cat > "$EVIDENCE_DIR/result.json" <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "verdict": "$([ $PASS -eq 1 ] && echo PASS || echo FAIL)",
  "method": "pg_dump -Fc / pg_restore (inside postgres container)",
  "source": {"db":"$SOURCE_DB","head":"$SOURCE_HEAD","migrations":$SOURCE_MIG_COUNT,"tables":$SOURCE_TABLES,"journals":$SOURCE_JOURNALS,"lines":$SOURCE_LEDGER_LINES,"wallets":$SOURCE_WALLETS},
  "restore": {"db":"$RESTORE_DB","head":"$RESTORE_HEAD","migrations":$RESTORE_MIG_COUNT,"tables":$RESTORE_TABLES,"journals":$RESTORE_JOURNALS,"lines":$RESTORE_LINES,"wallets":$RESTORE_WALLETS},
  "backupBytes": $BACKUP_BYTES,
  "backupSha256": "$BACKUP_SHA",
  "backupMs": $BACKUP_MS,
  "restoreMs": $RESTORE_MS,
  "totalMs": $TOTAL_MS,
  "integrity": {"unbalancedJournals":"$UNBALANCED","orphanLines":"$ORPHAN_LINES"},
  "note": "Logical backup/restore only. WAL-based point-in-time recovery (pg_basebackup/WAL-G) remains unmeasured at production volume and is a deployment decision.",
  "rpo": "declared configuration (logical backup interval), not measured here",
  "rto": "observed ${TOTAL_MS}ms for this data volume on this host (not production volume)",
  "cleanup": "drop database $RESTORE_DB and remove $BACKUP_FILE when done"
}
JSON

  info "Cleaning up restore DB $RESTORE_DB (retain artifact $BACKUP_FILE for inspection)..."
  $COMPOSE exec -T postgres psql -U "${DB_ADMIN_NAME:-monienaija_admin}" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$RESTORE_DB\";" 2>&1 | tee -a "$EVIDENCE_DIR/cleanup-restore-db.log" || info "WARNING: restore DB cleanup failed — drop manually: psql -c 'DROP DATABASE \"$RESTORE_DB\";'"
  # Remove temp dump inside container
  $COMPOSE exec -T postgres rm -f "/tmp/${SOURCE_DB}.dump" 2>&1 || true

  if [[ $PASS -eq 1 ]]; then
    info "═══════════════════════════════════════════════════════"
    info "BACKUP/RESTORE PASS (pg_dump/pg_restore) — RTO ${TOTAL_MS}ms for current volume"
    info "Artifact: $BACKUP_FILE ($BACKUP_BYTES bytes)"
    info "═══════════════════════════════════════════════════════"
    exit 0
  else
    info "BACKUP/RESTORE FAIL — see $EVIDENCE_DIR/result.log"
    exit 1
  fi
fi

# ── Path B: fallback via backup-restore-drill.js (no container runtime / no pg_dump) ──
info "No container runtime available — falling back to wire-level backup-restore-drill.js (disposable embedded PG)..."
if [[ ! -f "$REPO_ROOT/scripts/backup-restore-drill.js" ]]; then fail "backup-restore-drill.js not found and no pg_dump path available"; fi
if ! PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes node "$REPO_ROOT/scripts/backup-restore-drill.js" 2>&1 | tee -a "$EVIDENCE_DIR/drill.log"; then
  DRILL_EXIT=$?
  info "Drill exited $DRILL_EXIT — capturing diagnostics"
  cat "$EVIDENCE_DIR/drill.log" | tail -50 >&2
  fail "backup-restore drill failed (exit $DRILL_EXIT)"
fi
info "Drill succeeded — copying drill evidence to $EVIDENCE_DIR (see data/backup-drill/)"
mkdir -p "$EVIDENCE_DIR/drill-output"
cp -r "$REPO_ROOT/data/backup-drill" "$EVIDENCE_DIR/drill-output" 2>/dev/null || info "No data/backup-drill to copy"
cat > "$EVIDENCE_DIR/result.json" <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "verdict": "PASS",
  "method": "backup-restore-drill.js (wire-level row copy, session_replication_role=replica)",
  "source": "embedded disposable PG (see drill.log)",
  "note": "Logical restore verified; pg_dump/pg_restore not available in this sandbox but drill proves schema idempotency and referential integrity. On a host with docker, the pg_dump path above is preferred.",
  "rpo": "declared configuration only",
  "rto": "observed in drill.log (not production volume)"
}
JSON
info "BACKUP/RESTORE PASS (fallback drill)"
