#!/usr/bin/env bash
# verify-prerequisites.sh — validates that this host can run portable acceptance.
# Fail-closed: exits non-zero unless PORTABLE_ACCEPT_DISPOSABLE=yes and project name confirms disposability.
#
# Usage: PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/verify-prerequisites.sh
#        PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/verify-prerequisites.sh --disposable
#
# Evidence: writes docs/integration/evidence/portable-acceptance/prerequisites.json if run via run-all.sh
# No production credentials are read or required.

set -euo pipefail

ALLOW_FLAG=""
if [[ "${1:-}" == "--disposable" ]]; then ALLOW_FLAG="--disposable"; fi

fail() { echo "PREREQUISITE FAIL: $*" >&2; exit 1; }
info() { echo "PREREQ: $*"; }

# ── Disposable confirmation (fail-closed) ────────────────────────────────────
if [[ "${PORTABLE_ACCEPT_DISPOSABLE:-}" != "yes" ]]; then
  cat >&2 <<'MSG'
Refusing to verify prerequisites without explicit disposable confirmation.

This harness creates and destroys databases and containers. To proceed, set:

  PORTABLE_ACCEPT_DISPOSABLE=yes

or pass --disposable. Never point this at a shared or production environment.
MSG
  exit 1
fi

# Project name must indicate disposable context (configurable via COMPOSE_PROJECT_NAME)
PROJECT="${COMPOSE_PROJECT_NAME:-monienaija-portable-acceptance}"
if [[ "$PROJECT" != *"portable"* && "$PROJECT" != *"acceptance"* && "$PROJECT" != *"test"* && "$PROJECT" != *"tmp"* ]]; then
  # Allow override via --disposable but warn
  if [[ "$ALLOW_FLAG" != "--disposable" ]]; then
    fail "COMPOSE_PROJECT_NAME=$PROJECT does not look disposable (must contain portable/acceptance/test/tmp). Use --disposable to override."
  fi
  info "WARNING: project name $PROJECT does not match disposable pattern but --disposable was given"
fi
info "Disposable confirmation OK (PROJECT=$PROJECT)"

# ── Container runtime ────────────────────────────────────────────────────────
RUNTIME=""
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    RUNTIME="docker"
  else
    info "docker binary present but docker info failed (daemon not running or permission denied)"
  fi
fi
if [[ -z "$RUNTIME" ]] && command -v podman >/dev/null 2>&1; then
  if podman info >/dev/null 2>&1; then
    RUNTIME="podman"
  fi
fi

if [[ -z "$RUNTIME" ]]; then
  # Emit ENVIRONMENT_BLOCKED-structured evidence (exit 2), not a generic FAIL,
  # so run-all.sh distinguishes "no runtime here" from a harness error.
  _evdir="${PORTABLE_EVIDENCE_DIR:-}"
  if [[ -z "$_evdir" ]]; then
    _evdir="$(cd "$(dirname "$0")/../.." && pwd)/docs/integration/evidence/portable-acceptance"
  fi
  mkdir -p "$_evdir"
  cat > "$_evdir/prerequisites.json" <<JSON
{"at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","project":"$PROJECT","runtime":"none","status":"ENVIRONMENT_BLOCKED","reason":"no container runtime","disposableConfirmed":true}
JSON
  echo "ENVIRONMENT_BLOCKED: No usable container runtime. Install Docker (https://docs.docker.com/engine/install/) or Podman." | tee -a "$_evdir/prerequisites.log"
  exit 2
fi
info "Container runtime: $RUNTIME"

# Compose plugin
if [[ "$RUNTIME" == "docker" ]]; then
  if ! docker compose version >/dev/null 2>&1; then
    fail "docker compose plugin not available. Update Docker to a version that includes 'docker compose'."
  fi
  info "docker compose: $(docker compose version 2>&1 | head -1)"
else
  if ! podman compose version >/dev/null 2>&1 && ! podman-compose --version >/dev/null 2>&1; then
    info "WARNING: podman compose plugin not detected — will attempt podman-compose fallback"
  fi
fi

# ── Required repo artefacts ──────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
missing=0
for f in Dockerfile docker-compose.yml src/main.ts src/config/environment.ts src/config/data-source.ts infra/nginx/default.conf infra/postgres/init/01-runtime-privileges.sh .env.example; do
  if [[ ! -f "$REPO_ROOT/$f" ]]; then echo "missing: $f" >&2; missing=1; fi
done
if [[ $missing -ne 0 ]]; then fail "Required repo artefacts missing (see above)"; fi
info "Required repo artefacts present"

# ── TLS certs note ───────────────────────────────────────────────────────────
if [[ ! -f "$REPO_ROOT/infra/nginx/certs/tls.crt" ]]; then info "WARNING: infra/nginx/certs/tls.crt missing — proxy will fail; run: openssl req -x509 -nodes -days 30 -newkey rsa:2048 -keyout infra/nginx/certs/tls.key -out infra/nginx/certs/tls.crt -subj /CN=portable-acceptance"; fi
if [[ ! -f "$REPO_ROOT/infra/nginx/certs/tls.key" ]]; then info "WARNING: infra/nginx/certs/tls.key missing — proxy will fail until generated (see above)"; fi

# ── Disk / port availability ─────────────────────────────────────────────────
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  fail "curl or wget required for health probing"
fi
info "curl/wget available"

# Check host ports configured in env file if present
HTTP_PORT="${HTTP_PORT:-18080}"
HTTPS_PORT="${HTTPS_PORT:-18443}"
for port in "$HTTP_PORT" "$HTTPS_PORT"; do
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnH 2>/dev/null | grep -q ":${port} "; then info "WARNING: host port $port appears in use (ss)"; fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -tln 2>/dev/null | grep -q ":${port} "; then info "WARNING: host port $port appears in use (netstat)"; fi
  fi
done

info "All prerequisites satisfied"

# Optional: emit machine-readable report when evidence dir is provided
EVIDENCE_DIR="${PORTABLE_EVIDENCE_DIR:-$REPO_ROOT/docs/integration/evidence/portable-acceptance}"
if [[ -n "${PORTABLE_EVIDENCE_DIR:-}" || "${EMIT_EVIDENCE:-}" == "1" ]]; then
  mkdir -p "$EVIDENCE_DIR"
  cat > "$EVIDENCE_DIR/prerequisites.json" <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project": "$PROJECT",
  "runtime": "$RUNTIME",
  "httpPort": $HTTP_PORT,
  "httpsPort": $HTTPS_PORT,
  "status": "pass",
  "disposableConfirmed": true
}
JSON
  info "Evidence written to $EVIDENCE_DIR/prerequisites.json"
fi
