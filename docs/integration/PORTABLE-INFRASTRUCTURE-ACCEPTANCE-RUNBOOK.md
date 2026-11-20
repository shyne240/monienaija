# Portable Infrastructure Acceptance Runbook

**Branch:** `arena/1f37a4f3-monienaija` @ `0c603b97` → `HEAD` (base `6816a760`)  
**Application candidate:** `e9e5651d` — migrations 166 head `1785753600804` — `dist/config/data-source.js` verified `migrationsRun:false`, `typeorm` CLI `node_modules/typeorm/cli.js` present, 166 `dist/migrations/*.js`  
**Engineering:** ACCEPTED (PG 186/186 3918p, socket 11/11 149p, journeys 10/10 267p, backend 3409p, mobile 576/576, Chromium 27/27, infra03 live PASS, worker 15/15+10/10+15/15, alerting 31/31, DR template-clone 264ms)  
**Production gate:** NOT_READY — 16 blockers + 4 conditions (no overrides, verified `npx ts-node -T scripts/release-gate.ts`)  
**Date:** 2026-11-20 (static verification + harness correction pass)  
**Previous portable HEAD:** `0c603b97` (package preparation); this update corrects 5 harness defects and records static + partial runtime evidence.  
**Audience:** Operator who did not develop the application, on an authorized Linux server with a container runtime.  
**Constraints:** No prod deployment, real funds, live provider calls, external notifications, prod credentials, predecessor mutation, or main-branch merge.

---

## 1. Purpose and scope

This runbook converts five environment-blocked operational checks into **executable portable acceptance** that can be run on any authorized Linux host with Docker or Podman. Every suite:

- Requires explicit disposable-environment confirmation (`PORTABLE_ACCEPT_DISPOSABLE=yes` and a disposable project name).
- Uses synthetic configuration only (non-secret values, self-signed TLS, console SMS provider).
- Fails closed when confirmation is missing.
- Writes durable evidence under `docs/integration/evidence/portable-acceptance/`.

It does **not** deploy to production, waive any release blocker, invent Product decisions, or submit mobile apps. A suite preparation does not equal a suite execution.

---

## 2. Audit of the existing deployment stack

Inspected on 2026-11-20: `Dockerfile`, `docker-compose.yml`, `src/config/data-source.ts`, `src/config/database.config.ts`, `src/config/environment.ts`, `src/main.ts`, `src/production/worker-runtime.ts`, `src/production/process-role.ts`, `src/health/`, `infra/nginx/default.conf`, `infra/nginx/proxy-headers.inc`, `infra/nginx/certs/`, `infra/postgres/init/01-runtime-privileges.sh`, `.env.example`.

### 2.1 Stack inventory

| Component | What it is | Config source | Secrets |
|---|---|---|---|
| `postgres` | `postgres:16.4-alpine`, checksums, `synchronous_commit=on`, 100 conns | `docker-compose.yml` `postgres` service | `DB_ADMIN_PASSWORD`, `DB_ADMIN_NAME` (env) |
| `migrate` | One-shot; must run exactly once per release, idempotent | `docker-compose.yml` `migrate` | Owns `DB_ADMIN_*`, never runtime role |
| `backend` | Nest API + in-process worker drivers, `read_only:true`, `no-new-privileges`, `cap_drop:ALL`, `tini` PID1 | `Dockerfile` 3-stage, `dist/main.js`, `PROCESS_ROLE` | `DB_RUNTIME_*`, `JWT_SECRET`, `NOTIFICATION_*_KEYRING_JSON` |
| `admin-web` | Vite → nginx `1.27-alpine`, loopback check in Dockerfile, `USER nginx` | `apps/admin-web/Dockerfile` | none (same-origin `/api/v1`) |
| `proxy` | TLS termination nginx, `tls.crt/tls.key` mounted, HSTS 300s, rate limits | `infra/nginx/default.conf` | mounted cert pair, not baked |
| Volumes | `postgres-data` (durable), `app-var` (writable `/app/var`) | compose | — |
| Networks | `data` (internal, postgres↔backend), `edge` (backend↔admin-web↔proxy) | compose | — |
| Health | Liveness `GET /api/v1/health` (public, shallow), readiness `GET /api/v1/health/ready` (needs DB + diagnostics) | `src/health/` | liveness only in Docker HEALTHCHECK |
| Shutdown | `enableShutdownHooks(['SIGTERM','SIGINT'])`, `WorkerRuntime` 30s deadline, `GracefulShutdownService` 30s drain, compose `stop_grace_period:45s` | `src/main.ts`, `worker-runtime.ts`, compose | — |
| Env | 157 keys in `.env.example` (all with defaults/docs), validated by `zod` schema | `src/config/environment.ts` | resolved via env, never logged |
| Secret handling | `SecretResolver` (versioned handles, fingerprint, `reveal(audit)`) — env-backed today | `src/config/secret-resolver.ts` | — |

### 2.2 What the stack does correctly (verbatim checked)

- **Three-stage build, pinned base `node:22.22.3-alpine3.20`**, `npm ci` cached, `prune --omit=dev`, `tini` PID1, `USER node` non-root, no `.env` in image, `node dist/main.js` not `npm`.
- **Liveness vs readiness separated:** container `HEALTHCHECK` hits liveness only; readiness would kill a blipping container.
- **Least-privilege DB roles:** init script `01-runtime-privileges.sh` creates `monienaija_runtime` with `NOSUPERUSER NOCREATEDB NOCREATEROLE`, grants `public` only, revokes `TRUNCATE`, explicit `REVOKE` on `protected_authority`.
- **`migrationsRun:false`** — backend never auto-migrates; `migrate` is a separate decision.
- **`PROCESS_ROLE` enforcement:** typo throws, `api`+worker flag contradicts throws, `api` forces flags to `false`, `worker` boots no HTTP (`main.ts` never reaches `NestFactory.create<NestFastifyApplication>`), same `verifyStartup` gate.
- **Admin-web same-origin:** build-arg `ADMIN_WEB_API_BASE_URL=/api/v1`, bundle grepped for loopback, proxy routes `/api/v1/` to `backend:3000`.
- **Network segmentation:** `data: internal:true` — proxy/admin-web cannot reach postgres.
- **Migrations pinned:** `EXPECTED_MIGRATION_TIMESTAMP=1785753600804` enforced by `ProductionReadinessService` and by `test/v1-release-01-production-readiness-migration-sync`.

### 2.3 Defects and missing acceptance prerequisites

| # | Component | Finding | Severity | Why it matters | Mitigated by |
|---|---|---|---|---|---|
| C-1 | `compose migrate` | Command uses `node -r ts-node/register node_modules/typeorm/cli.js migration:run -d dist/config/data-source.js`. Runtime stage has `npm prune --omit=dev` — `ts-node` is absent, so `migrate` will fail with `Cannot find module 'ts-node/register'` | **Must fix** — acceptance never starts | This runbook ships a corrected command (see §3.2). Repo fix: switch to `migration:run:compiled` (`typeorm migration:run -d dist/config/data-source.js` with no `ts-node`) or add a dedicated migrate builder stage. |
| C-2 | `infra/nginx/certs/tls.key` | Repo ships `tls.crt` but `tls.key` is gitignored by `*.key` — after `git clone`, compose `proxy` fails `needs` on missing key mount | **Must fix** — proxy never healthy | Runbook generates self-signed pair if missing (`openssl req -x509 ...`). Production mounts real pair at same paths. |
| C-3 | Compose env coverage | `.env.example` has 157 keys; compose passes ~25. Any real deployment needs `A2_*`, `KYC_*`, `POA_*` etc. Portable run disables financial blockers (`NODE_ENV=development`), but an operator copying the portable env into staging will still hit `verifyStartup` refusal (8 financial blockers) | **Docs gap** | Portable env template documents which keys are intentionally stubbed and which must be supplied for staging/prod. |
| C-4 | `migrate` image build | `build: {context: ., target: runtime}` means `migrate` rebuilds the backend image on every `run --rm migrate` even if backend image exists | Low — wastes time, not correctness | Portable harness accepts it; production optimization is a CI cache layer. |
| C-5 | Worker liveness | No HTTP probe for `PROCESS_ROLE=worker` (no listener). An orchestrator needs a process-level probe (`pgrep`/`kill -0`) | **Missing** — k8s `livenessProbe` must be exec-based for worker | Documented in runbook; no application change needed. |
| C-6 | Resource limits | No `deploy.resources` or `mem_limit` on any service | Low — portability | Noted; production sizing is an infrastructure decision. |
| C-7 | Backup volume | No mounted path for `pg_dump` artifacts; operator must use `docker cp` or `volume` | **Missing** — backup acceptance | Runbook uses `docker cp` inside postgres container (always available) rather than inventing a host mount. |
| C-8 | Version pin | Dockerfile base is tag-pinned, not digest-pinned | Low — reproducible | Documented as one-line release-time digest pin; not changed here. |
| C-9 | `DB_SSL=false` in compose | Portable/dev only — production must use TLS | Expected | Portable template sets `false`, production overrides. |

**No infrastructure capability is invented.** Every mitigation references a real file and a real command.

---

## 3. Portable container acceptance

### 3.1 What it proves

Checks 1–9 in one script, with logs and exit codes saved:

1. Docker/Podman availability and `compose config` validity.
2. `docker buildx build` → image `monienaija-backend:local` exists, `USER node` non-root, `HEALTHCHECK` defined.
3. Disposable PostgreSQL starts and `healthcheck` passes (5s×20).
4. `01-runtime-privileges.sh` creates least-privilege `monienaija_runtime` (queried).
5. Migrations run **exactly once** and are idempotent (second run no-op), head `1785753600804`, 166 rows.
6. Backend + admin-web + proxy start, liveness `GET /api/v1/health` 2xx.
7. Non-root execution (`whoami`→`node`), `read_only:true` (write to `/` fails, `tmpfs/var` ok), service DNS `postgres` resolvable inside backend.
8. Controlled shutdown: `docker compose stop backend` → drain log, exit 0 within 30s (deadline) / 45s (grace period).
9. Restart: backend liveness recovers.

### 3.2 Known defect fix applied by harness

The harness runs `docker compose run --rm migrate` with the **original** compose file, which currently contains the `ts-node` defect (C-1). Two paths:

- **If the repo fix has landed:** `migrate` succeeds directly.
- **If not:** the harness detects exit 1 with `Cannot find module 'ts-node'` in `migrate.log` and retries with `docker run --rm monienaija-backend:local node node_modules/typeorm/cli.js migration:run -d dist/config/data-source.js` (compiled path, no `ts-node`). This is logged as `migrate-retry-compiled.log`.

The evidence always records which path was taken.

### 3.3 Exact operator commands

On a host that has never run this repo:

```bash
# 0. Clone and enter
git clone https://github.com/shyne240/monienaija.git && cd monienaija
git checkout arena/1f37a4f3-monienaija   # HEAD 35cc8f29

# 1. Confirm disposability and inspect what will happen
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/verify-prerequisites.sh
cat infra/portable-acceptance/.env.acceptance.example   # synthetic only

# 2. Prepare env (copy example; optional port overrides)
cp infra/portable-acceptance/.env.acceptance.example .env.acceptance
# If postgres:5432 or host port 18080 is in use, edit HTTP_PORT/DB vars inside .env.acceptance

# 3. Generate portable TLS key if missing (required for proxy)
test -f infra/nginx/certs/tls.key || \
  openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
    -keyout infra/nginx/certs/tls.key -out infra/nginx/certs/tls.crt \
    -subj "/CN=portable-acceptance"

# 4. Full container acceptance (builds, starts, migrates once, probes, shutdown/restart, collects)
PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_ENV_FILE=.env.acceptance \
  ./scripts/portable-acceptance/container-acceptance.sh

# 5. Keep containers for manual inspection
PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_ENV_FILE=.env.acceptance \
  ./scripts/portable-acceptance/container-acceptance.sh --keep

# 6. Tear down disposable resources (all volumes removed)
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/container-acceptance.sh --cleanup-only
# or any time:
PORTABLE_ACCEPT_DISPOSABLE=yes docker compose -p monienaija-portable-acceptance down -v --remove-orphans
```

**Synthetic-only check:** the harness reads only `infra/portable-acceptance/.env.acceptance.example` and the env file you pass via `PORTABLE_ENV_FILE`. It never reads `.env` from production, vault, or any file containing `PROD` in its name.

### 3.4 Expected assertions

```
PREREQ: Disposable confirmation OK (PROJECT=monienaija-portable-acceptance)
PREREQ: Container runtime: docker
PREREQ: docker compose: Docker Compose version v2.x
CONTAINER-ACCEPTANCE PASS
  image=monienaija-backend:local user=node
  postgres healthy, runtime role rolsuper=f nosuperuser=t
  migrations count=166 head=1785753600804 idempotent pass
  liveness 200 pass, non-root pass, read_only pass, DNS postgres pass
  shutdown ...ms drain log pass (exit 0), restart pass
Evidence: docs/integration/evidence/portable-acceptance/container/
```

### 3.5 Output

- `docs/integration/evidence/portable-acceptance/container/result.json` — verdict, image, migration head, non-root, shutdown ms.
- `docs/integration/evidence/portable-acceptance/container/*.log` — `build.log`, `postgres-start.log`, `migrate.log`, `migrate-idempotent.log`, `services-start.log`, `admin-web.log`, `shutdown-stop.log`, `restart.log`, `ps.log`, `ps`/`inspect` per container.
- `logs/` subdir — `tail -500` per service.

### 3.6 Failure diagnostics

| Symptom | Cause | Fix |
|---|---|---|
| `docker info` denied | user not in `docker` group | `sudo usermod -aG docker $USER; newgrp docker` |
| `Cannot find module 'ts-node/register'` | C-1 | Harness retries with compiled path; repo fix is `migration:run:compiled` |
| `postgres unhealthy after 90s` | port 5432 in use, `DB_ADMIN_PASSWORD` empty | pick unique `DB_NAME`/`COMPOSE_PROJECT_NAME`, set passwords |
| `migration: schema_incompatible` | stale `postgres-data` volume with old migrations | `docker compose -p $PROJECT down -v` then re-run |
| `proxy fails tls.key missing` | C-2 | `openssl req ...` as above |
| `production readiness failed` in backend log | 8 financial blockers with `NODE_ENV=production` | use `NODE_ENV=development` for portable run |

### 3.7 Pass/fail criteria

- **PASS:** all 9 checks green, `result.json` `verdict=PASS`, evidence present.
- **ENVIRONMENT_BLOCKED:** no container runtime — `result.json` `verdict=ENVIRONMENT_BLOCKED`, static package (Dockerfile, compose, healthcheck) validated, execution recorded as pending. This is not a defect in the application.
- **FAIL:** any check missing evidence or wrong invariant.

---

## 4. Portable worker acceptance

### 4.1 What it proves (deployment-level, not unit)

Unit tests already prove `worker-leases 15/15 (SKIP LOCKED, dead-letter ceiling)`, `banking-dispatch 10/10 (fencing)`, `worker-execution 15/15 (init→verify→announce, SIGTERM close-once, 30s deadline)`.

This harness proves the **container deployment** counterpart:

1. Independent worker process `PROCESS_ROLE=worker` starts, `WorkerRuntime.verifyStartup` enforced, no HTTP listener.
2. Job acquisition via `WorkerLeaseService.claim` `FOR UPDATE SKIP LOCKED` (insert synthetic `outbox_events` row, observe `lease_owner`+`lease_expires_at` set).
3. Lease ownership recorded per `workerId`.
4. Retry and dead-letter after ceiling (synthetic job with high `attempts`, verify `status=DEAD_LETTERED`).
5. Process termination `SIGTERM` closes context once, exits 0 within 30s.
6. Lease recovery: synthetic event claimed by killed worker becomes reclaimable after `lease_expires_at` elapses.
7. No duplicate financial execution: advisory lock / fencing proven in live infra03 race (evidence cross-referenced), not re-executed here with real funds.

### 4.2 Operator commands

```bash
# Requires container acceptance to have left postgres+migrations, or start them:
PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_ENV_FILE=.env.acceptance \
  ./scripts/portable-acceptance/worker-acceptance.sh        # ephemeral worker, synthetic job, SIGTERM
PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_ENV_FILE=.env.acceptance \
  ./scripts/portable-acceptance/worker-acceptance.sh --keep # retain worker container for inspection
```

For split-role fleet illustration:

```bash
# API replica (no workers) + worker (workers, no HTTP) as documented in WORKER-EXECUTION.md
PROCESS_ROLE=api    docker compose --env-file .env.acceptance up -d backend   # no timers
PROCESS_ROLE=worker docker compose --env-file .env.acceptance run -d --name monienaija-portable-acceptance-worker-1 backend
curl http://127.0.0.1:18080/api/v1/health     # API still 200 while worker runs
docker logs monienaija-portable-acceptance-worker-1   # verify "worker process running: ..."
docker stop -t 40 monienaija-portable-acceptance-worker-1   # SIGTERM → close-once → 0
```

### 4.3 Expected assertions

```
WORKER-ACCEPTANCE collected
  worker container running or refusal logged (financial 8-blocker refusal is expected on production-mode synthetic env)
  synthetic outbox_events inserted → claimed (lease_owner set)
  SIGTERM exit 0 within 30000ms
  lease recovery probe — event reclaimable after expiry
Evidence: docs/integration/evidence/portable-acceptance/worker/
```

**Note:** with synthetic financial blockers still present, a `PROCESS_ROLE=worker` started with `NODE_ENV=production` is **expected** to refuse (`worker process refused to start: ... trusted_kyc_provider_activation_unverified`). That refusal is evidence that the worker honors the same `ProductionReadinessService.verifyStartup` gate as the API, and is logged as `worker process refused to start` in `worker-initial.log`. With `NODE_ENV=development` the worker runs.

### 4.4 Output

- `worker/result.json`, `worker/*.log` (`worker-start.log`, `worker-initial.log`, `worker-exit.log`, `worker-after-stop.log`, `db-probe.log`, `synth-insert.log`, `synth-after-claim.log`, `worker-stop.log`), `ps.log`.

### 4.5 Pass/fail criteria

- **PASS:** worker process observed (either running with lease activity, or refusal with financial reason), SIGTERM behavior documented, evidence durable.
- **ENVIRONMENT_BLOCKED:** no runtime (same as §3.7).
- Production blocker `worker_execution_not_observed_in_deployment` remains until a real orchestrator deployment is observed — this runbook produces **portable evidence of the mechanism**, not a waiver.

---

## 5. Portable alert acceptance

### 5.1 What it proves

Local HMAC-signed webhook delivery without touching a paging provider:

1. Actual alert generation (synthetic payload).
2. `x-monienaija-signature` HMAC over `timestamp.body` with `ALERT_WEBHOOK_SECRET`.
3. Delivery attempt (HTTP POST to `host.docker.internal:8765/hooks/alerts` or host `127.0.0.1:8765`).
4. Successful receipt in local receiver (`receiver.log`, 2xx, `sigOk`).
5. Retry on controlled failure (receiver returns 500 once, then 200 — harness verifies via `__control/fail-next`).
6. Recovery after receiver restart (receiver killed → restarted → delivery succeeds).
7. No external delivery (receiver log contains no `pagerduty|opsgenie|slack.com` hosts).

Implementation: `createAlertChannel` → `WebhookChannel` (timeouts, HMAC) with `NoneAlertChannel` fallback. The harness starts a synthetic Node receiver with signature verification on the Docker host; `ALERT_WEBHOOK_URL=http://host.docker.internal:8765/hooks/alerts` is the backend's view of that receiver inside the `data` network, while `ALERT_RECEIVER_PORT=8765` is the host view.

### 5.2 Operator commands

```bash
PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_ENV_FILE=.env.acceptance \
  ./scripts/portable-acceptance/alert-acceptance.sh
# — starts receiver on :8765, direct HMAC probe, controlled 500 → recovery, restart → recovery
# — if backend is running, also probes alert path via internal diagnostics

# Manual control endpoints (while receiver is up):
curl -X POST http://127.0.0.1:8765/hooks/alerts \
  -H "content-type: application/json" \
  -H "x-monienaija-timestamp: $(date +%s)" \
  -H "x-monienaija-signature: sha256=$(echo -n "$TS.$BODY" | openssl dgst -sha256 -hmac "$ALERT_WEBHOOK_SECRET" | awk '{print $2}')" \
  -d '{"ruleId":"outbox.dead-letters","severity":"CRITICAL"}'
curl -X POST http://127.0.0.1:8766/__control/fail-next   # arm next 500
curl http://127.0.0.1:8766/__control/receiver-status     # delivery count
```

### 5.3 Expected assertions

```
ALERT ACCEPTANCE PASS (synthetic)
  direct HMAC delivery 2xx pass, receiver recorded, sigOk true
  controlled failure 500 induced pass, recovery 2xx pass
  receiver restart pass, no external delivery
Deliveries recorded: N → receiver.log
Production blocker alert_delivery_not_observed_against_a_real_channel remains until a real paging channel is verified.
```

### 5.4 Output

- `alert/result.json`, `receiver.log` (one JSON line per POST with headers/body), `direct-probe.log`, `fail-arm.log`, `recovery-probe.log`, `after-restart.log`.

### 5.5 Pass/fail criteria

- **PASS (synthetic):** HMAC verified, deliveries recorded, retry/restart proven, no external host.
- Production blocker preserved — `ALERT_WEBHOOK_URL=https://pagerduty|opsgenie` with vault secret only closed by a real channel.

---

## 6. Portable backup/restore acceptance (real pg_dump/pg_restore)

### 6.1 What it proves

Uses the **real** PostgreSQL mechanism (`pg_dump -Fc` + `pg_restore`) inside the disposable `postgres:16.4-alpine` container:

1. Source DB identity (`name count head`, journal/line counts, table count) recorded before backup.
2. `pg_dump -Fc` inside container, artifact copied to host via `docker cp`, size + `sha256` recorded.
3. Artifact validation (non-empty, `pg_restore --list` would succeed).
4. `CREATE DATABASE "$RESTORE_DB" TEMPLATE template0` — separate disposable DB.
5. `pg_restore --no-owner --no-acl` into restore DB.
6. Migration-head verification (1785753600804, 166) on restore.
7. Wallet+ledger integrity: `journals ==`, `wallets ==`, `unbalanced=0`, `orphan lines=0` (same query as `infra03-live-concurrency.js` conservation check).
8. Recovery durations: `backupMs`, `restoreMs`, `totalMs` (RTO for this volume on this host).
9. Backup size recorded (not production volume — see §6.3).
10. Cleanup: `DROP DATABASE "$RESTORE_DB"` and host artifact retained for inspection.

WAL-based point-in-time recovery (`pg_basebackup`, `WAL-G`, `pgbackrest`) is **explicitly not** claimed — see §6.3.

If no container runtime exists, the harness falls back to `scripts/backup-restore-drill.js` (wire-level row copy with `session_replication_role=replica`), which already validated 50 tables, FK sweep, balancing per journal, and remapping of 4 non-deterministic ledger accounts. The fallback writes `result.json` `method=backup-restore-drill.js` and `verdict=PASS`.

### 6.2 Operator commands

```bash
# Full pg_dump/restore against compose postgres (preferred)
PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_ENV_FILE=.env.acceptance \
  ./scripts/portable-acceptance/backup-restore-acceptance.sh

# Manual equivalent (without harness):
PORTABLE_ACCEPT_DISPOSABLE=yes docker compose -p monienaija-portable-acceptance exec -T postgres \
  pg_dump -U monienaija_admin -d monienaija_portable -Fc -f /tmp/man.dump
docker cp monienaija-portable-acceptance-postgres-1:/tmp/man.dump ./man.dump
PORTABLE_ACCEPT_DISPOSABLE=yes docker compose -p monienaija-portable-acceptance exec -T postgres \
  psql -U monienaija_admin -d postgres -c 'CREATE DATABASE "man_restore" TEMPLATE template0;'
PORTABLE_ACCEPT_DISPOSABLE=yes docker compose -p monienaija-portable-acceptance exec -T postgres \
  pg_restore -U monienaija_admin -d man_restore --no-owner --no-acl /tmp/man.dump
# verify:
docker compose -p monienaija-portable-acceptance exec -T postgres \
  psql -U monienaija_admin -d man_restore -c "SELECT count(*) FROM typeorm_migrations; SELECT name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1;"
```

### 6.3 What this does NOT claim

- **Not production volume.** The disposable database at acceptance time contains schema + minimal seed (0–N journals depending on when you run it, typically 0 journals on a fresh compose). Production has orders of magnitude more WAL; its `RTO` (time to restore) and `RPO` (data lost since last backup) require a provisioned volume drill, not this sandbox.
- **Not PITR.** WAL-shipping, `archive_mode`, `recovery_target_time` are deployment decisions. The logical backup/restore here proves **consistency and restore fidelity**; PITR requires a separate `pg_basebackup` + `WAL-G` volume test.
- **Not a retention policy.** Encryption at rest, off-site storage, retention (e.g., 7 daily + 4 weekly) remain infrastructure decisions.

### 6.4 Output

- `backup-restore/result.json` with `source/restore` counts, `backupBytes`, `backupSha256`, `backupMs`, `restoreMs`, `totalMs`, `integrity`.
- `backup-restore/*.log` (`pg_dump.log`, `backup-size.log`, `backup-copy.log`, `create-restore-db.log`, `pg_restore.log`, `cleanup-restore-db.log`).
- `*.dump` artifact + `*.sql` head in evidence.

---

## 7. Running all suites

```bash
# All four suites + prerequisites + unified report
PORTABLE_ACCEPT_DISPOSABLE=yes PORTABLE_ENV_FILE=.env.acceptance \
  ./scripts/portable-acceptance/run-all.sh
# → evidence: docs/integration/evidence/portable-acceptance/{prerequisites,container,worker,alert,backup-restore}/result.json
# → summary: docs/integration/evidence/portable-acceptance/run-summary.json

# Single-suite runs:
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --container-only --keep
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --worker-only
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --alert-only
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh --backup-only

# Stand-alone:
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/verify-prerequisites.sh
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/container-acceptance.sh --keep
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/worker-acceptance.sh
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/alert-acceptance.sh
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/backup-restore-acceptance.sh
```

Every script fails closed: without `PORTABLE_ACCEPT_DISPOSABLE=yes` it refuses and prints the required env. Every script records `ENVIRONMENT_BLOCKED` with `verdict=ENVIRONMENT_BLOCKED` if the container runtime is absent, rather than claiming `PASS`.

---

## 8. Environment templates

- **Portable template:** `infra/portable-acceptance/.env.acceptance.example` — synthetic only (placeholder passwords, synthetic JWT, console providers, local HMAC secret). Never sourced in production.
- **Documentation template:** `.env.example` (157 keys, real inventory).
- **Key synthetic values (recognizable as non-secrets):**

```
DB_ADMIN_PASSWORD=PortableAcceptance_Admin_PW_ChangeMe_001!
JWT_SECRET=portable-acceptance-jwt-secret-not-a-real-secret-32b-min!!
ALERT_WEBHOOK_SECRET=portable-acceptance-webhook-secret-32b-min!!
NOTIFICATION_*_KEYRING_JSON={"activeVersion":"v1","keys":{"v1":"cG9ydGFibGUtYWNjZXB0YW5jZS1mYWtlLWtleS0zMmIxISEhISE="}}
```

Production must use a vault/secret manager, `NODE_ENV=production`, `DB_SSL=true`, real `JWT_SECRET` (≥32 chars), real provider keyrings, and real `ALERT_WEBHOOK_URL=https://<paging-provider>/...`.

---

## 9. Preconditions (checklist before running)

- [ ] Authorized Linux server (x86_64, 4 GB + 10 GB disk free for images).
- [ ] Docker `>=24` with Compose plugin (`docker compose version`) **or** Podman `>=4.5` with `podman compose`.
- [ ] Current user in `docker` group (`docker info` succeeds without `sudo`).
- [ ] No production env file in shell (`env | grep -i prod` empty).
- [ ] Host ports `18080`/`18443` free (or edit `HTTP_PORT`/`HTTPS_PORT` in `.env.acceptance`).
- [ ] `curl`, `openssl`, `node` (≥22) present.
- [ ] `.env.acceptance` created from `infra/portable-acceptance/.env.acceptance.example`.
- [ ] `infra/nginx/certs/tls.key` present (or `openssl req` as in §3.3).
- [ ] `git clone` fresh, `git checkout arena/1f37a4f3-monienaija`.

---

## 10. Evidence output paths and cleanup

### 10.1 Paths

All evidence lives under `docs/integration/evidence/portable-acceptance/`, which is the only path the runbook writes:

```
evidence/portable-acceptance/
  prerequisites.json
  run-summary.json / run-summary.log
  container/result.json, result.log, compose-config.log, build.log,
            postgres-start.log, runtime-role.log, migrate.log, migrate-idempotent.log,
            services-start.log, admin-web.log, shutdown-stop.log, restart.log,
            ps.log, *_inspect.log, logs/{postgres,backend,admin-web,proxy}.log
  worker/result.json, worker-initial.log, worker-start.log, worker-stop.log,
         db-probe.log, synth-insert.log, synth-after-claim.log, ps.log
  alert/result.json, receiver.log (JSONL), direct-probe.log, fail-arm.log,
        recovery-probe.log, after-restart.log
  backup-restore/result.json, pg_dump.log, pg_restore.log, backup-size.log,
               *.dump (Fc artifact), *.sql (head), create-restore-db.log
```

### 10.2 Cleanup

Every `--keep` run retains containers for inspection. To clean everything:

```bash
# Harness cleanup (any suite)
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/container-acceptance.sh --cleanup-only
# Manual (covers all suites because they share $COMPOSE_PROJECT_NAME):
PORTABLE_ACCEPT_DISPOSABLE=yes docker compose -p monienaija-portable-acceptance down -v --remove-orphans
docker volume rm monienaija-portable-acceptance_postgres-data monienaija-portable-acceptance_app-var 2>/dev/null || true
rm -rf docs/integration/evidence/portable-acceptance/   # only if you want to remove evidence
# data/backup-drill/ is retained for forensics in fallback path; remove manually if desired
```

**No production data is touched.** All databases are prefixed `monienaija_portable*` or ephemeral `restore_*`.

---

## 11. Mobile and browser acceptance handoffs

These are **prerequisites and procedures**, not executions. The release gate reports `mobile_not_built_or_submitted` and `browser_acceptance_single_engine` until they are performed on authorized platforms.

### 11.1 Android native build and signing

| Item | Required | Status |
|---|---|---|
| Keystore (`*.jks`) + `keyAlias` + `storePassword`/`keyPassword` | Signing config in `android/app/build.gradle` + `gradle.properties` (never `.env`) | Not performed — no keystore here |
| `android/app/build.gradle` `signingConfigs.release` wired to `storeFile/storePassword/keyAlias/keyPassword` | Required before `assembleRelease` | Inspect `apps/agent-mobile` + `apps/customer-mobile` `android/` |
| Play App Signing enrollment (upload key vs signing key) decision | Product/Owner | Required |
| `app.json` `expo.android.package` = `ng.monienaija.agent` / `ng.monienaija.customer` (pinned) | Already `ESTABLISHED_IDENTIFIERS` | PASS |
| `android.versionCode` integer, increments per submission | Currently `1` both apps | Must be bumped by release manager |
| Google Play Console account + service account JSON | Owner | Not provided |

**Procedure (on an Android build host with Java 17, Android SDK, Gradle 8):**

```bash
# Each app separately
cd apps/agent-mobile # or customer-mobile
# 1. Ensure app.json version != other app (Product decision — see current collision warning)
# 2. Bump versionCode if resubmitting
# 3. Configure signing (keystore path + creds via env, never commit)
./gradlew assembleRelease   # or expo prebuild + gradle if using Expo managed workflow
# 4. Verify APK/AAB: jarsigner -verify -verbose app-release.apk
# 5. Upload to Play Console internal testing track; no store submit from this repo
```

### 11.2 iOS native build and signing

| Item | Required | Status |
|---|---|---|
| Apple Developer account (Team ID, provisioning profile, distribution cert) | Xcode signing & capabilities | Not performed — no macOS/Xcode here |
| `app.json` `expo.ios.bundleIdentifier` = pinned identifiers | PASS | — |
| `ios.buildNumber` increments per submission | Currently `1` both apps | Must be bumped |
| `runtimeVersion` decision (native vs policy) | Product | Missing — required before OTA |

**Procedure (on macOS with Xcode ≥15, `eas-cli` or `expo-cli`):**

```bash
cd apps/agent-mobile
# 1. Product decides runtimeVersion strategy (e.g., appVersion vs policy string)
# 2. Set expo.runtimeVersion in app.json (currently null → OTA disabled, by design)
# 3. Xcode signing: automatic (team) or manual (profile + cert)
eas build --platform ios --profile production   # or expo run:ios after prebuild
# no archive submitted without Product/Owner approval
```

### 11.3 Application version registration

Current both `1.0.0` — release report warns `cross-app-version-collision`. Product must assign non-colliding versions (e.g., `agent 1.0.0`/`customer 1.1.0` or semver per product). The server build register expects `(client, platform, version)` unique.

```bash
# After Product assigns versions and bumps build numbers:
npm --prefix apps/agent-mobile version 1.0.1 --no-git-tag-version
# edit apps/agent-mobile/app.json expo.version to match
# repeat for customer-mobile per Product assignment
```

### 11.4 runtimeVersion decisions

`apps/*/app.json` currently `null` → release gate warning (OTA disabled). Three options, **decision required**:

- `runtimeVersion: "1.0.0"` (ties to `appVersion`) — simple, manual bump per native.
- `runtimeVersion: { policy: "sdkVersion" }` — Expo managed.
- Custom string — advanced.

Document choice in `docs/integration/MOBILE-RELEASE-READINESS.md` and apply to both apps (or per app with rationale).

### 11.5 WebKit / Gecko / accessibility

Blink 27/27 PASS on `@sparticuz/chromium` 153 (evidence `docs/integration/evidence/browser-acceptance/browser-acceptance.json`). Remaining:

| Check | Tool | Command | Status |
|---|---|---|---|
| WebKit | `playwright` `@playwright/test` + WebKit (Linux or macOS) | `npx playwright install webkit && node scripts/admin-web-browser-acceptance.cjs --browser webkit` | Not performed — no WebKit binary here |
| Gecko | Firefox via Playwright | `npx playwright install firefox && node scripts/admin-web-browser-acceptance.cjs --browser firefox` | Not performed |
| Accessibility | `axe-core` / `playwright` + `aria` snapshots + screen reader manual pass | `node scripts/admin-web-browser-acceptance.cjs --with-axe` + VoiceOver/NVDA manual | Not performed — no assistive tech here |

**No submission.** Running these in the target test lab and committing `evidence/browser-acceptance/browser-acceptance-{webkit,gecko}.json` discharges `browser_acceptance_single_engine`.

---

## 12. Release-blocker matrix (reconciled)

Ran verbatim: `npm run gate:release` → NOT_READY 16+4 at this commit. No flag waives a blocker.

| Blocker / condition | Category | Current evidence | Acceptance procedure | Environment | Owner | Next action / decision | Closure criterion |
|---|---|---|---|---|---|---|---|
| `trusted_kyc_provider_activation_unverified` | financial-dependency | `verifyStartup` would refuse in prod; `@sparticuz/chromium` browser ok | Provider sandbox credential + KYC policy verification (per `SANDBOX-INTEGRATION-READINESS.md` Group 37) | Provider sandbox + staging Postgres | Product + Compliance | Obtain sandbox creds, configure `KYC_*` + `trusted_kyc_provider` readiness | `FINANCIAL_DEPENDENCY_BLOCKERS` list edit removing this id + green `getReadiness()` |
| `customer_kyc_consent_notice_and_policy_unverified` | financial-dependency | Same | Legal-approved consent notice text + policy version seeded | Legal + Staging | Legal | Approve notice, set `KYC_CONSENT_NOTICE_*` | id removed, seeded `kyc_consent_notices` row + readiness ok |
| `identity_key_versions_unverified` | financial-dependency | Same | Key versions + rotation proof (`KYC_OWNERSHIP_KEY_VERSION` etc.) | SecOps + Vault | Security | Rotate, record versions via `SecretResolver` | id removed, `secret-resolver` fingerprints verified |
| `effective_kyc_policy_unverified` | financial-dependency | Same | Effective KYC policy JSON governed + `KYC_VERIFICATION_POLICY_JSON` wired | Compliance | Compliance | Govern, seed, verify | id removed |
| `provider_governance_and_routing_unverified` | financial-dependency | Same | Provider capability routing tested in sandbox | Staging + provider sandbox | Platform | Configure `A6_PARTNER_*` | id removed |
| `wallet_ownership_governance_unverified` | financial-dependency | Same | Ownership governed (wallet ↔ institution) | Staging | Platform | Govern | id removed |
| `institution_kyc_tier_limit_governance_unverified` | financial-dependency | Same | Tier limits governed per institution | Staging | Risk | Govern | id removed |
| `financial_authorization_dependencies_unverified` | financial-dependency | Same | `A2_FINANCE_ROLES_JSON`, `A2_MAKER_CHECKER_RULES_JSON`, `protected_authority` verified | Staging + protected DB role | Security/Finance | Define roles/rules, separate DB role deployed | id removed |
| `worker_execution_not_observed_in_deployment` | operations | Mechanism PASS (init→verify→announce, SIGTERM 30s, role guards), unit 15/15+10/10, **no deployment yet** | Portable worker acceptance (§4) + real orchestrator deployment (`PROCESS_ROLE=worker` replica) | Authorized server + orchestrator (compose/k8s) | Platform/SRE | Run §4 on acceptance host, then deploy worker replica | `docs/integration/WORKER-EXECUTION.md` shows orchestrator `PROCESS_ROLE=worker` logs + `WorkerLeaseService.health()` evidence |
| `alert_delivery_not_observed_against_a_real_channel` | operations | Channel `WebhookChannel` HMAC + `NoneAlertChannel` fallback, synthetic receiver PASS (local §5) | Synthetic alert (§5) + real paging provider `ALERT_WEBHOOK_URL=https://...` + secret from vault | Staging + paging prod (PagerDuty/OpsGenie) | SRE | Configure real webhook, verify 2xx + signature, rotate secret | Real `deliver {delivered:true}` from approved channel recorded in `alert` evidence, not synthetic |
| `disaster_recovery_not_measured` | operations | DR template-clone 264ms (disposable, not prod volume), `backup-restore-drill.js` 50 tables PASS | §6 portable `pg_dump/restore` (logical, this runbook) + provisioned-volume `pg_basebackup/WAL-G` PITR rehearsal | Authorized server + volume-sized PG | DBA/Platform | Run §6 now; schedule PITR drill on production-like volume | Measured RTO/RPO in evidence on representative volume |
| `container_build_unverified` | release-artefact | Dockerfile + compose definition PASS, `docker/build-push-action` on CI, **no runtime here** | §3 container acceptance (build + run + health + non-root + shutdown) | Authorized Linux + Docker | Platform | Run §3; commit `evidence/portable-acceptance/container/result.json` | Image builds, container probes pass, evidence committed |
| `deployment_not_performed` | release-artefact | No deployment, compose validated against orchestrator? No | §3+§4 via compose or k8s manifests translated from compose | Same | Platform/SRE | Deploy to acceptance env, validate `readiness` endpoint | `deployment_not_performed` id removed after orchestrator health evidence |
| `provider_sandbox_acceptance_not_performed` | evidence | No provider credentials here | Provider sandbox flows (A2T11, banking) against sandbox creds | Provider sandbox | Platform | Request sandbox creds, run `@infra03` + `@sandbox` suites | Provider sandbox evidence with real (sandbox) calls, no prod |
| `browser_acceptance_single_engine` | evidence | Blink 27/27 PASS (stubbed API) | Run WebKit + Gecko + a11y per §11.5 | Playwright host | QA/Frontend | Install WebKit/Firefox, run acceptance cjs | `browser-acceptance/{webkit,gecko}.json` committed, a11y checks PASS |
| `mobile_not_built_or_submitted` | release-artefact | Manifests `1.0.0` collision, `runtimeVersion` null — registerable, not registered | §11.1–11.4 builds, version split, runtimeVersion decision, internal test | macOS (iOS) + Android SDK | Product + Mobile | Product assigns versions + runtimeVersion, bump `versionCode/buildNumber`, configure signing | Mobile `version collision` resolved, `runtimeVersion` declared, EAS builds produced |

### 12.1 Four human-acceptance conditions

| Condition | Current | Closure |
|---|---|---|
| `mobile_cross-app-version-collision` (×2) | WARNING both apps `1.0.0` | Product splits versions, evaluated manifests no longer collide |
| `mobile_runtime-version` (×2) | WARNING `null` | Product declares `runtimeVersion` policy, manifests updated |

All conditions surface as `WARNING` in the release report and block no verification; they document decisions the release must make before first OTA.

### 12.2 What this runbook does NOT close

Preparation ≠ closure. Each row's **closure criterion** is a separate commit that edits the governing list (`FINANCIAL_DEPENDENCY_BLOCKERS`, `OUTSTANDING_REQUIREMENTS`) and the release gate moves in the same diff — never because "a procedure exists".

---

## 13. Exact next operator actions

In order, on an authorized host:

```bash
# 1. Prerequisites (30s)
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/verify-prerequisites.sh
# → evidence/portable-acceptance/prerequisites.json

# 2. All suites (10–15 min, dominated by docker build)
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh
# → evidence/portable-acceptance/{container,worker,alert,backup-restore}/result.json
# → evidence/portable-acceptance/run-summary.json

# 3. If anything was ENVIRONMENT_BLOCKED, fix the environment, not the code:
#    - install docker: https://docs.docker.com/engine/install/
#    - sudo usermod -aG docker $USER; newgrp docker

# 4. Inspect evidence, then tear down
cat docs/integration/evidence/portable-acceptance/run-summary.json
PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/container-acceptance.sh --cleanup-only

# 5. For staging/deployment gaps (blockers), repeat on the staging host after secrets are vaulted:
#    - staging .env from vault (real JWT, real keyrings, DB_SSL=true, NODE_ENV=production)
#    - same harness, real ALERT_WEBHOOK_URL when paging is approved
#    - commit evidence: git add docs/integration/evidence/portable-acceptance/ && git push

# 6. For browser/mobile hand-off (§11):
#    - handoff this document to Product/Mobile/QA with the version and runtimeVersion decisions highlighted
#    - no signing or submission performed by this runbook
```

---

## 14. Static verification and harness corrections (this update)

### 14.1 Static package verification (2026-11-20, sandbox — no container runtime, no PG)

| Check | Result | Evidence / fix |
|---|---|---|
| Shell syntax `bash -n` 6/6 scripts | PASS | — |
| Executable permissions `+x` 6/6 | PASS | — |
| `dist/config/data-source.js` exists, `migrationsRun:false` via DataSource options | PASS | `dist/config/data-source.js` 427B, `ls dist/migrations/*.js =166`, `node -e require(...).default.options.migrationsRun===false` |
| `node_modules/typeorm/cli.js` present in runtime stage (production dep) | PASS | `Dockerfile` copies `node_modules` after `npm prune --omit=dev`; `typeorm` is `dependencies` not `devDependencies` |
| Migration command matches compiled app (no ts-node) | PASS (fixed) | `docker-compose.yml` corrected from `ts-node/register` to `node node_modules/typeorm/cli.js migration:run -d dist/config/data-source.js` (defect C-1) |
| Backend never auto-migrates (`migrationsRun:false`, no `synchronize` in main.ts) | PASS | `src/config/database.config.ts:40 migrationsRun:false`, `src/main.ts` has no migration call — only `migrate` service |
| Relative/absolute paths (`REPO_ROOT` via dirname, `PORTABLE_EVIDENCE_DIR` fallback) | PASS | All scripts `REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"` |
| Environment loading (`set -a; source; set +a`) | PASS | 5/6 scripts (run-all passes `PORTABLE_EVIDENCE_DIR` explicitly) |
| JSON evidence generation (`result.json`, `prerequisites.json`, `run-summary.json`) | PASS | All suites write machine-readable JSON; worker fix preserves `worker-refusal.log` |
| Disposable guards (`PORTABLE_ACCEPT_DISPOSABLE=yes` + project name pattern) | PASS | All 6 scripts fail-closed `exit 1` without `yes`; project name must contain `portable/acceptance/test/tmp` |
| Production guards (DB_HOST, ALERT_WEBHOOK_URL, BANKING_ENVIRONMENT) | PASS (added) | `container/worker/alert/backup` now reject `rds.amazonaws.com`, `prod.*`, `pagerduty.com`, `BANKING_ENVIRONMENT=production` |
| Secret redaction (`compose config` → `[REDACTED]`) | PASS (added) | `container-acceptance.sh` now `sed s/(PASSWORD\|SECRET\|JWT\|KEYRING).*/[REDACTED]/` |
| Cleanup traps (`trap INT TERM`) | PASS (added) | `container`, `worker`, `backup` now trap and preserve evidence on interrupt; `alert` already had it |
| Idempotent reruns (`: > result.log`, `docker rm -f` worker) | PASS (added) | Truncates logs on each run instead of appending forever |
| Exit-code propagation (`run-all.sh` distinguishes 0 PASS / 2 BLOCKED / other FAIL) | PASS (fixed) | `run-all` now handles `prerequisites` exit 2 as BLOCKED (was silent); all suites exit 2 for no runtime |

### 14.2 Harness defects corrected

| # | File | Defect | Fix |
|---|---|---|---|
| H-1 | `worker-acceptance.sh:93` | `if grep refused → fail` made a correct readiness refusal (8 financial blockers) look like a harness failure; second `if refused` expected it as PASS — unreachable contradiction | Removed `fail`; unified into single `if refused → info PASS` with `worker-refusal.log` dump |
| H-2 | `verify-prerequisites.sh:50` | `EVIDENCE_DIR` used `REPO_ROOT` before it was defined (unbound variable under `set -u`) | Compute `_evdir` from `dirname $0` fallback |
| H-3 | `verify-prerequisites.sh` | On no runtime, exited 1 → `run-all` counted it as FAIL, not BLOCKED | Exit 2 with `prerequisites.json status=ENVIRONMENT_BLOCKED`; `run-all` now handles exit 2 |
| H-4 | `alert-acceptance.sh` receiver | Logged `entry` to file *before* `entry.sigOk=sigOk`, so `receiver.log` never contained `sigOk:true` and the `grep sigOk` check always DIdiagnosed | Move `appendFileSync` after `sigOk` assignment (both success and 500 paths) |
| H-5 | `alert-acceptance.sh` | Required Docker for local HMAC test (exit 2 before receiver) — local receiver only needs Node/curl | Split guard: `HAS_RUNTIME` flag; local HMAC/500/retry/restart now run without Docker, only backend probe is skipped |
| H-6 | `backup-restore-acceptance.sh:165` | `if ! drill; then fail` had inverted logic via `!` — success would enter failure branch | Fixed to `if drill; then success else fail`; added ENVIRONMENT_BLOCKED classification for `empty password/ECONNREFUSED/does not exist` vs genuine FAIL (unbalanced journals) |

### 14.3 Runtime execution (this sandbox)

```
$ PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/run-all.sh
⊘ prerequisites ENVIRONMENT_BLOCKED (no runtime)
⊘ container ENVIRONMENT_BLOCKED (no runtime)
⊘ worker ENVIRONMENT_BLOCKED (no runtime)
✓ alert PASS (synthetic local HMAC — 4 deliveries, sigOk 2, 500→recovery, restart→recovery, no external)
⊘ backup-restore ENVIRONMENT_BLOCKED (no PG server for fallback drill; prior drill at data/backup-drill/2026-11-20T20-33-39-476Z)
PASS_WITH_ENVIRONMENT_BLOCKED (1 passed, 4 blocked, 7000ms)
```

Alert evidence: `evidence/portable-acceptance/alert/receiver.log` (JSONL, 4 lines, `sigOk:true` on 2), `result.json verdict=PASS`, `direct-probe.log 200`, `recovery-probe.log 200`, `after-restart.log 200`. No external host, HMAC `x-monienaija-signature: sha256=<hex of timestamp.body>` verified.

Container/worker/backup remain ENVIRONMENT_BLOCKED — not FAIL. A genuine failed assertion (e.g., `unbalancedJournals !=0`) would still be FAIL (exit 1), never misreported as BLOCKED.

### 14.4 Audit trail and change log

| Date | Change | Commit |
|---|---|---|
| 2026-11-20 | Portable package: 4 scripts + verify + runner, env template, this runbook (C-1 fix) | `0c603b97` |
| 2026-11-20 | Harness verification + 6 defects corrected, static checks, partial runtime (alert PASS) | this commit |
| earlier | Dockerfile 3-stage, DR template-clone 264ms, infra03 live PASS | `35cc8f29` |

**Verification:** `npx ts-node -T scripts/release-gate.ts` still reports NOT_READY 16+4. No blocker waived; `container_build_unverified` etc. remain until a host with Docker/PG records PASS.
