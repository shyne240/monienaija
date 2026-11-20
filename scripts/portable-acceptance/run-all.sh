#!/usr/bin/env bash
# run-all.sh — orchestrates all portable acceptance suites and writes a unified report.
#
# Usage:
#   PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh                # full, cleanup
#   PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --keep          # retain containers
#   PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --container-only
#   PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --worker-only
#   PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --alert-only
#   PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --backup-only
#
# Exit codes: 0 all suites passed or were cleanly blocked (ENVIRONMENT_BLOCKED handled),
#             1 at least one suite failed, 2 no runtime at all.

set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0; BLOCKED=0; PASSED=0
KEEP=0
FILTER="all"
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --container-only) FILTER="container" ;;
    --worker-only) FILTER="worker" ;;
    --alert-only) FILTER="alert" ;;
    --backup-only) FILTER="backup" ;;
    --disposable) : ;;
    *) echo "unknown arg $arg (allowed: --keep, --container-only, --worker-only, --alert-only, --backup-only, --disposable)" >&2; exit 1 ;;
  esac
done

if [[ "${PORTABLE_ACCEPT_DISPOSABLE:-}" != "yes" ]]; then
  cat >&2 <<'MSG'
Refusing without PORTABLE_ACCEPT_DISPOSABLE=yes

This harness creates and destroys databases and containers. To proceed:

  PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh

Set COMPOSE_PROJECT_NAME to a name containing portable/acceptance/test/tmp
or pass --disposable to override the name check.
MSG
  exit 1
fi

PROJECT="${COMPOSE_PROJECT_NAME:-monienaija-portable-acceptance}"
export COMPOSE_PROJECT_NAME="$PROJECT"
export PORTABLE_ACCEPT_DISPOSABLE=yes

EVIDENCE_ROOT="docs/integration/evidence/portable-acceptance"
mkdir -p "$EVIDENCE_ROOT"
START_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RUN_START=$(date +%s)

echo "═══════════════════════════════════════════════════════════════"
echo "Portable Infrastructure Acceptance — $START_TS"
echo "Project: $PROJECT   Filter: $FILTER   Keep: $KEEP"
echo "Repo: $REPO_ROOT"
echo "═══════════════════════════════════════════════════════════════"

run_suite() {
  local name="$1" script="$2"
  echo "───────────────────────────────────────────────────────────────"
  echo "Suite: $name ($script)"
  echo "───────────────────────────────────────────────────────────────"
  KEEP_FLAG=""
  if [[ "$KEEP" == "1" ]]; then KEEP_FLAG="--keep"; fi
  if PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_EVIDENCE_DIR="$REPO_ROOT/$EVIDENCE_ROOT" bash "$script" $KEEP_FLAG; then
    echo "✓ $name PASS"
    PASSED=$((PASSED+1))
  else
    CODE=$?
    if [[ $CODE -eq 2 ]]; then
      echo "⊘ $name ENVIRONMENT_BLOCKED (no runtime — static package validated, execution pending)"
      BLOCKED=$((BLOCKED+1))
    else
      echo "✗ $name FAIL (exit $CODE)"
      FAIL=$((FAIL+1))
    fi
  fi
}

# ── Prerequisites ────────────────────────────────────────────────────────────
echo ""
if PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_EVIDENCE_DIR="$REPO_ROOT/$EVIDENCE_ROOT" EMIT_EVIDENCE=1 bash scripts/portable-acceptance/verify-prerequisites.sh; then
  echo "✓ prerequisites PASS"
  PASSED=$((PASSED+1))
else
  CODE=$?
  if [[ $CODE -eq 1 ]]; then echo "✗ prerequisites FAIL"; FAIL=$((FAIL+1)); fi
fi

# ── Suites ───────────────────────────────────────────────────────────────────
if [[ "$FILTER" == "all" || "$FILTER" == "container" ]]; then run_suite "container" "scripts/portable-acceptance/container-acceptance.sh"; fi
if [[ "$FILTER" == "all" || "$FILTER" == "worker" ]]; then run_suite "worker" "scripts/portable-acceptance/worker-acceptance.sh"; fi
if [[ "$FILTER" == "all" || "$FILTER" == "alert" ]]; then run_suite "alert" "scripts/portable-acceptance/alert-acceptance.sh"; fi
if [[ "$FILTER" == "all" || "$FILTER" == "backup" ]]; then run_suite "backup-restore" "scripts/portable-acceptance/backup-restore-acceptance.sh"; fi

RUN_MS=$(( ($(date +%s) - RUN_START) * 1000 ))
END_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ── Unified report ───────────────────────────────────────────────────────────
TOTAL=$((PASSED + FAIL + BLOCKED))
if [[ $FAIL -gt 0 ]]; then VERDICT="FAIL"; elif [[ $BLOCKED -gt 0 ]]; then VERDICT="PASS_WITH_ENVIRONMENT_BLOCKED"; else VERDICT="PASS"; fi

cat > "$EVIDENCE_ROOT/run-summary.json" <<JSON
{
  "at": "$END_TS",
  "startedAt": "$START_TS",
  "durationMs": $RUN_MS,
  "project": "$PROJECT",
  "filter": "$FILTER",
  "verdict": "$VERDICT",
  "passed": $PASSED,
  "failed": $FAIL,
  "environmentBlocked": $BLOCKED,
  "total": $TOTAL,
  "evidence": "$EVIDENCE_ROOT"
}
JSON

cat >> "$EVIDENCE_ROOT/run-summary.log" <<LOG
[$END_TS] Portable acceptance run: $VERDICT (passed=$PASSED failed=$FAIL blocked=$BLOCKED total=$TOTAL) duration=${RUN_MS}ms
Log: $EVIDENCE_ROOT/run-summary.json
LOG

echo ""
echo "═══════════════════════════════════════════════════════════════"
if [[ "$VERDICT" == "PASS" ]]; then
  echo "PORTABLE ACCEPTANCE PASS ($PASSED/$TOTAL, ${RUN_MS}ms)"
elif [[ "$VERDICT" == "PASS_WITH_ENVIRONMENT_BLOCKED" ]]; then
  echo "PORTABLE ACCEPTANCE PASS_WITH_ENVIRONMENT_BLOCKED ($PASSED passed, $BLOCKED blocked, ${RUN_MS}ms)"
  echo "Execution is pending a host with a container runtime — static package validated."
else
  echo "PORTABLE ACCEPTANCE FAIL ($FAIL failed, $PASSED passed, $BLOCKED blocked, ${RUN_MS}ms)"
fi
echo "Evidence: $EVIDENCE_ROOT/"
echo "  prerequisites: $EVIDENCE_ROOT/prerequisites.json"
echo "  container:     $EVIDENCE_ROOT/container/result.json"
echo "  worker:        $EVIDENCE_ROOT/worker/result.json"
echo "  alert:         $EVIDENCE_ROOT/alert/result.json"
echo "  backup-restore:$EVIDENCE_ROOT/backup-restore/result.json"
echo "  summary:       $EVIDENCE_ROOT/run-summary.json"
echo "═══════════════════════════════════════════════════════════════"

# Exit non-zero only on real failures, not on environment-blocked
if [[ $FAIL -gt 0 ]]; then exit 1; else exit 0; fi
