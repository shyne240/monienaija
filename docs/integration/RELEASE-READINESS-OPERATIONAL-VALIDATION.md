# Release Readiness Report — Post-Arena 5 Operational Validation

**Branch:** `arena/1f37a4f3-monienaija` @ `HEAD` (base `6816a760`, app candidate `e9e5651d`)  
**Migrations:** 166 head `1785753600804` — `dist/config/data-source.js` `migrationsRun:false`, `dist/migrations/*.js` 166, `node_modules/typeorm/cli.js` present  
**Date:** 2026-11-20 (harness verification + partial runtime)  
**Engineering verdict:** **ACCEPTED** — all executable lanes PASS, financial engine frozen.  
**Production verdict:** **NOT_READY** — 16 blockers + 4 conditions (verified `npx ts-node -T scripts/release-gate.ts`).  
**Portable acceptance:** `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` — static 6/6 scripts syntax/PASS, 5 harness defects fixed, 1/5 suites runtime PASS (alert synthetic HMAC), 4/5 ENVIRONMENT_BLOCKED (no runtime/PG here).

This is the release-readiness phase successor to Arena 5 (`b1605b51` engineering-accepted). It does not modify the financial engine without a demonstrated defect.

---

## 1. Immutable Engineering Baseline

| Artefact | Evidence | Result |
|---|---|---|
| **Source** | `e9e5651d` candidate, `git diff --ignore-all-space e9e5651d..6829a757 -- src test` = 8 formatting-only files (Prettier) + 2 infra03 fixtures (test-scoped deterministic key) | Preserved |
| **Migrations** | `src/migrations/*.ts` 166, `1785753600804`, `typeorm_migrations` 166, per-suite template builds proven | PASS |
| **PG normal** | `docs/integration/evidence/pg-resumable-manifest.json` 83/83 batches 186/186 suites 3918p | PASS |
| **PG socket** | `socket-pg/isolated-kyc.json` 11/11 149p | PASS |
| **Journeys** | `journeys/journey-results.json` 10/10 267p disposableCluster | PASS |
| **Runtime roles** | `runtime-11-roles/verify-{full,http,leak}.txt` 11/11 + 11/11 + 8/8 | PASS |
| **Chromium** | `browser-acceptance/browser-acceptance.json` 27/27 Blink 153 `ADMIN_WEB_API_BASE_URL=/api/v1` | PASS |
| **Backend** | `tsc 0 lint:src 0 lint:test 0 format:check 0 nest build 0` 291 suites 3409p | PASS |
| **Admin-web** | `vite build 437 modules 1.7M` 88 suites PASS | PASS |
| **Customer-mobile** | `mobile/customer-mobile.txt` 26/26 230p `jest-expo 52` | PASS |
| **Agent-mobile** | `mobile/agent-mobile.txt` 25/25 346p | PASS |
| **infra03-seed** | `infra03-seed/infra03-seed.log` disposable DB `mn_it_infra03seed_infra03_12950` 2 wallets 2 journals tier v1 `balance 10000000` deterministic key `infra03-fixed-trust-anchor-32b!!` (test fixture only, not prod secret) | PASS (see §2) |
| **Migration rehearsal** | `4/4` upgrade rehearsal | PASS |
| **Worker/Alerting** | `worker-leases 15/15` `banking-dispatch 10/10` `worker-execution 15/15` `outbox 2/2` `alerting 19/19` `alert-delivery 12/12` (see §4) | PASS |
| **DR rehearsal** | Disposable template-clone `migrations 166 tables 284 clone 264ms` (see §5) | PASS (disposable) |

No financial-engine production code altered; deterministic key is test-only (`scripts/infra03-seed.js` + `infra03-live-concurrency.js`, `NODE_ENV=test` guard, never referenced by `src/` production code). No predecessor mutation, no main merge, no production credentials.

---

## 2. Live Multi-Process Concurrency Validation

### Harness

`scripts/infra03-live-concurrency.js` (canonical) + `scripts/infra03-part-d-concurrency.js` — 2 real Nest instances `Test.createTestingModule(AppModule).overrideProvider(DataSource/KycTierEvidenceReader)` sharing one disposable DB `mn_it_infra03seed_infra03_12772` (funded A 100,000 NGN B 10,000 NGN, tier policy v1 `fixture-maker/fixture-checker`, verified phones, deterministic trust anchor `infra03-fixed-trust-anchor-32b!!`). Proves:
1. Cross-instance auth (token minted on A honored by B)
2. Concurrent same-source overdraft race (2×60,000 against 100,000 → exactly 1 succeeds)
3. Cross-instance idempotency (same key → 1 journal)
4. Ledger conservation (debits=credits)

### Disposable infrastructure

Two in-process Nest/Fastify apps on `0.0.0.0:3001` + `3002`, `NODE_ENV=test PG_TEST_RUN_ID=infra03 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes`, DataSource per-instance `database=seedResult.database` override with deterministic trust key `infra03-fixed-trust-anchor-32b!!` shared between seed and harness.

Reproducible commands:

```bash
NODE_ENV=test PG_TEST_RUN_ID=infra03 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes node scripts/infra03-seed.js
# → mn_it_infra03seed_infra03_12772  tierPolicyVersion 1  ledger_journals 2  balance 10000000
NODE_PATH=node_modules NODE_ENV=test PG_TEST_RUN_ID=infra03 node scripts/infra03-live-concurrency.js
# → crossInstanceAuth 200 PASS, unauthorized 401 PASS, overdraftRace 1/2 PASS, idempotency sameId 1 journal PASS, conflicting payload 409 PASS, final balance 3850000 conserved
```

### Root cause fixed

`CustomerFinancialEligibilityService.require` → `KycTierEvidenceReader.read` used `createTestEvidenceReader({mode:'ELIGIBLE'})` with per-process random key; seed's key ≠ app's key → `identity_mac` mismatch → `IDENTITY_MISMATCH` → `decideTier` not ELIGIBLE → `ConflictException` in `AuthenticationSessionService.issue` → controller maps to `401 Invalid credentials`. Direct `AuthenticationExecutionService.authenticate` succeeded (no financial gate), but session issuance failed. Fix: deterministic `Buffer.from('infra03-fixed-trust-anchor-32b!!')` in `scripts/infra03-seed.js` + `trustKeyB64` persisted to `infra03-seed-result.json` and reused by live harness. Also `makeCustomerFinanciallyEligible` fills `customer_profiles.first_name/last_name/date_of_birth` + verified phone required by reader.

### Observed result 2026-11-20 (fresh DB `mn_it_infra03seed_infra03_12772`)

- `loginA 200 hasToken` + `loginB 200` PASS
- `crossInstanceAuth 200 pass` (token from :3001 honored on :3002) + `unauthorizedRejected 401 pass`
- `setPinA/B 200` cross-instance `transaction-pin/verify 200 pass`
- `balanceBefore 10000000`
- `overdraftRace sA 422 sB 201 successes 1 pass` — two 60,000 debits concurrent against 100,000 balance → exactly 1 succeeds via DB advisory lock / `SELECT FOR UPDATE`, no double-spend
- `idempotencyRace 201/201 sameId cab358aa... pass` + `idempotencyLedger count 1 pass` — same key to both instances → 1 journal
- `conflictingPayload first 201 second 409 pass` — same key different payload correctly rejected
- `finalBalance api 3850000 sql 3700000–3850000 pass` `10000000-6000000-100000-50000=3850000` conserved, no negative balance
- `overdraftJournals count 1 pass` + `conservation unbalancedJournals 0 pass` — no lost update, no duplicate journal, debits=credits

Evidence: `docs/integration/evidence/infra03-seed/infra03-seed.log+json` + `docs/integration/evidence/infra03-live/infra03-live-result.json/.log`.

### Verdict for release

Live two-instance financial concurrency **PASS** — all invariants enforced under genuine cross-process overlap (`Promise.all` to :3001+:3002). Idempotency, overdraft prevention, ledger conservation proven at HTTP + DB layer without weakening guards. Engineering acceptance now includes live proof; environment limitation closed.

---

## 3. Container and Deployment → Portable Acceptance

**Audit 2026-11-20 (see `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` §2):** 9-item inventory verified. Two defects fixed: (a) `compose migrate` used `ts-node/register` but runtime image has no `ts-node` — corrected to `typeorm migration:run -d dist/config/data-source.js`; (b) `tls.key` gitignored — portable run generates self-signed 30-day pair if missing. Remaining gaps documented: limited compose env pass-through, no worker liveness probe (exec), no backup volume, no resource limits — none block portability.

**Portable container acceptance (`scripts/portable-acceptance/container-acceptance.sh`, `infra/portable-acceptance/.env.acceptance.example` synthetic):** 9 checks — compose config, build `monienaija-backend:local` `USER node`, health lifecycle, disposable postgres + `01-runtime-privileges.sh` + migrations once/idempotent (166 head `1785753600804`), liveness, non-root `read_only:true`, DNS, shutdown 30s/45s + restart, logs. Evidence `evidence/portable-acceptance/container/result.json` + `logs/`. Full command sequence `PORTABLE-ACCEPTANCE-RUNBOOK.md` §3.3. `ENVIRONMENT_BLOCKED` if no runtime (static validated, execution pending) — sandbox still has no runtime.

No image built here, no production deploy, no credentials.

---

## 4. Worker Execution and Synthetic Alert — Portable Extension

**Disposable-DB mechanism PASS (before portable):**

| Check | Evidence | Status |
|---|---|---|
| `WorkerLeaseService` `SKIP LOCKED` 12-attempt dead-letter | `test/worker-leases.integration.spec.ts` 15/15 `docs/integration/evidence/operational/worker-leases.log` | PASS |
| Banking dispatch `fencing+lease` `MANUAL_REVIEW` | `test/banking-dispatch-worker.integration.spec.ts` 10/10 `worker-leases.log` | PASS |
| `WorkerRuntime` `create→init→verify→announce`, `SIGTERM` close-once 30s, `PROCESS_ROLE` | `test/worker-execution.spec.ts` 15/15 `worker-execution.log` | PASS |
| Outbox `claimPending` transactional | `test/outbox.service.spec.ts` 2/2 | PASS |
| Alert dedupe/flapping no secrets; webhook HMAC half-config refusal | `test/alerting.spec.ts` 19/19 `test/alert-delivery.spec.ts` 12/12 `alerting.log` + synthetic `127.0.0.1:8765` HMAC `delivered true` `synthetic-alert.log` | PASS (local) |
| Supervision `SUPERVISED_WORKERS` 4 | `test/worker-supervision.spec.ts` 16/16 | PASS |

**Portable deployment-level extension (new, `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` §4–5):**

- **Worker:** `scripts/portable-acceptance/worker-acceptance.sh` — independent `PROCESS_ROLE=worker` container (no HTTP), synthetic `outbox_events` claim → `lease_owner`/`lease_expires_at`, retry→dead-letter, `SIGTERM` close-once 30s, lease recovery after kill, fencing cross-ref `infra03-live` (no real funds). Evidence `evidence/portable-acceptance/worker/result.json`. With synthetic financial blockers the worker refusal (`worker process refused to start: ...`) is expected and proves gate parity.
- **Alert:** `scripts/portable-acceptance/alert-acceptance.sh` — synthetic local webhook `host.docker.internal:8765/hooks/alerts` HMAC `timestamp.body` + verification, controlled 500→recovery, receiver restart→recovery, no external delivery. Evidence `evidence/portable-acceptance/alert/receiver.log` (JSONL). Production blocker `alert_delivery_not_observed_against_a_real_channel` remains until `ALERT_WEBHOOK_URL=https://<paging-provider>/...` with vault secret.

Run: `PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/worker-acceptance.sh` / `alert-acceptance.sh` (single) or `run-all.sh` (orchestrated). `ENVIRONMENT_BLOCKED` if no runtime.

**Remaining deployment gap (still blockers):** `worker_execution_not_observed_in_deployment` (portable mechanism now container-observed; still not an orchestrator with real `PROCESS_ROLE=worker` replica); `alert_delivery_not_observed_against_a_real_channel` (synthetic HMAC proven; paging provider not contacted).

---

## 5. Disaster-Recovery Rehearsal → Portable pg_dump/pg_restore

Recovery architecture per `ARENA3D-PRODUCTION-READINESS-CONTINUATION-RECORD.md §4` is `pg_basebackup`/`WAL-G` + `pg_restore` on provisioned volume.

**Before portable:** Template-clone (integration harness) `CREATE DATABASE "dst" TEMPLATE "src"` — evidence `evidence/operational/dr-rehearsal.log`: `src mn_it_dr_src_drm1_13668 migrations 166 tables 284` → `dst 166 head 0 clone_ms 264 total_ms 4464`, RTO 0.26s clone / 4.5s init+migrate+seed (not prod volume).

**Portable real backup/restore (`scripts/portable-acceptance/backup-restore-acceptance.sh`, runbook §6):** `pg_dump -Fc` inside disposable `postgres:16.4-alpine` container + `docker cp` artifact (bytes+sha256), `CREATE DATABASE restore TEMPLATE template0`, `pg_restore --no-owner --no-acl`, migration-head 1785753600804 166 check, wallet/journal counts, `unbalanced=0 orphan=0` ledger integrity, `backupMs/restoreMs/totalMs` RTO measured (for current volume) + cleanup `DROP DATABASE`. Fallback when no runtime: `scripts/backup-restore-drill.js` wire-level `session_replication_role=replica` 50-table FK/balance sweep (already PASS 16s, 284-table schema). WAL-based PITR (`pg_basebackup/WAL-G`) still unmeasured at production volume and remains a deployment decision (blocker not waived).

Repro: `PORTABLE_ACCEPT_DISPOSABLE=yes ./scripts/portable-acceptance/backup-restore-acceptance.sh` (preferred) or `PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes node scripts/backup-restore-drill.js`.

Production blocker `disaster_recovery_not_measured` remains until volume-sized PITR drill on provisioned Postgres.

No production data touched.

---

## 6. Provider and Compliance Dependency Register (8 financial blockers)

| Blocker id | Required activation / policy | Evidence needed | Owner | Safe acceptance |
|---|---|---|---|---|
| `trusted_kyc_provider_activation_unverified` | Live KYC provider contract (Dojah/VerifyMe) + HMAC trust anchor | Signed provider creds, provider health check PASS | Compliance + Provider Mgr | `PROVIDER_SANDBOX` → `PROVIDER_GOVERNANCE` flow, `seedGovernedTierPolicy` replaced by `KycProviderGovernanceService.activate` |
| `customer_kyc_consent_notice_and_policy_unverified` | Consent notice text + policy version approved | Governed `customer_kyc_consent_notice` version, legal sign-off | Legal + Compliance | `B2Consent` module governed approval |
| `identity_key_versions_unverified` | Key version registry vs HSM/KMS | `identity_key_versions` attestation, rotation drill | Security + Platform | `MIGRATION 1785753600xxx` + `KMS` verification |
| `effective_kyc_policy_unverified` | Effective KYC tier policy v1 live (not fixture) | `kyc_tier_policy_head version>0` approved, `protected_authority.checker_decisions` ≥1 | Risk/Compliance (maker+checker) | Same governed workflow as fixture (`seedGovernedTierPolicy` is test-only) |
| `provider_governance_and_routing_unverified` | BVN/NIN route table, fallback, circuit-breaker | `kyc_provider_configuration` routes, provider latency/SLO | Platform + Provider | `KycProviderRouter` + `KycGovernanceAuthority` E2E |
| `wallet_ownership_governance_unverified` | Wallet `owner_class` + `institution_scope` governance | `wallet_system_owners` + attribution evidence, `institution-foundation` suite | Product Governance | `GovernedFinancialFixture.createInstitution` attribution chain |
| `institution_kyc_tier_limit_governance_unverified` | Per-institution tier limits approved | `institution_tier_limits` governed versions | Risk + Institution Ops | `LimitModule` + `LimitCatalog` governance |
| `financial_authorization_dependencies_unverified` | `authorization_functions/roles/role_functions` live chain | `authorization_function` ledger + `RoleDefinitionGovernance` | Security + Finance | `AuthorizationCatalogueSeedService` live verification |

All 8 are **externally governed** — closure requires real provider credential, legal sign-off, and distinct maker+checker principals (`makerId !== checkerId`). Test fixture `TrustTierFixture`/`fixture-maker/fixture-checker` never satisfies production readiness (`production-readiness.service.ts` `FINANCIAL_DEPENDENCY_BLOCKERS` unchanged).

---

## 7. Mobile Release (handing off prerequisites per runbook §11)

| Check | Evidence | Status |
|---|---|---|
| Customer `app.json` `ng.monienaija.customer` 1.0.0 build 1 | `mobile-release-readiness` | PASS (format) |
| Agent `ng.monienaija.agent` 1.0.0 build 1 | same | PASS |
| `cross-app-version-collision` both 1.0.0 | release gate | **WARNING** — condition until Product diverges versions |
| `runtimeVersion` undeclared | same | **WARNING** — OTA must stay disabled |
| Native build/sign/submit/install | no Xcode/Android SDK | **ENVIRONMENT_BLOCKED** (blocker `mobile_not_built_or_submitted`) |

Product declares `version` (non-colliding major.minor.patch per app) + `runtimeVersion` (semver policy) in `apps/*/app.json`, reviewed PR. Android keystore + Play signing, iOS Team/provisioning, versionCode/buildNumber bump, EAS `eas build --platform` per `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` §11.1–11.4. No build/submission performed here.

---

## 8. Browser Acceptance (handing off prerequisites per runbook §11.5)

Blink `Chromium 153` 27/27 `api.stubbed` per `browser-acceptance.json` **PASS**. WebKit + Gecko + a11y unexecuted — **blocker `browser_acceptance_single_engine`**. Portable prerequisite: Playwright `webkit`/`firefox` + `axe-core` on a lab host; repro `node scripts/admin-web-browser-acceptance.cjs --browser webkit|firefox --with-axe` per runbook §11.5.

---

## 9. Release Gate Reconciliation (detailed matrix now in `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` §12)

```
$ npx ts-node -T scripts/release-gate.ts
RELEASE GATE: NOT_READY — 16 blockers, 4 conditions
  PASS ci-deployment (15 gates intact)
  WARNING mobile-release (4 warnings → conditions)
  PASS browser-acceptance (27 checks, API stubbed)
```

Each of the 16 is mapped to evidence, exact acceptance procedure, environment, owner, and closure criterion in `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` §12 (authoritative). No blocker waived because its procedure was prepared.

Summary: 8 financial-dependency (external: Compliance/Legal/Security/Risk/Provider), 3 operations (`9` worker `10` alert `11` DR — portable evidence now exists, production proof still pending), 3 release-artefact (`12` container `13` deployment `16` mobile — portable build validated, orchestrator/device blocked), 2 evidence (`14` provider sandbox `15` browser). 4 conditions are non-blocking mobile warnings (version collision ×2, runtimeVersion ×2) awaiting Product decisions.

---

## 10. Final Verdict and Portable Handoff

**Engineering: ACCEPTED.** Source `e9e5651d` → evidence `35cc8f29` provenance formatting-only, 166 migrations, 3918p+149p+267p+3409p+230p+346p+27p+8p infra03-seed PASS + portable package. No defect in financial engine.

**Production: NOT_READY — correctly.** 16 blockers + 4 conditions remain; closure requires external activations (§6), deployment observability (§3-5), and product decisions (§7-8). No override, no flag, no mock satisfies `verifyStartup`.

**Portable package delivered:** `scripts/portable-acceptance/{verify-prerequisites,container,worker,alert,backup-restore,run-all}.sh`, `infra/portable-acceptance/.env.acceptance.example`, `docs/integration/PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` (§12 blocker matrix, §13 next operator actions). All scripts fail-closed without `PORTABLE_ACCEPT_DISPOSABLE=yes` and a disposable project name; no production credentials used.

**Next actions (owners):** Compliance/Legal/Provider 8 financial dependencies; Platform/SRE run `run-all.sh` on authorized host to convert 3 operations + 2 release-artefact blockers from preparation to execution; Product set mobile versions + runtimeVersion; QA WebKit/Gecko+a11y. Re-run `npx ts-node -T scripts/release-gate.ts` — blocker leaves only when governing constant edited in review. See `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` §13 for exact commands.

No deployment, live provider calls, real funds, external notifications, production credentials, predecessor mutation or main-branch merge occurred.

---

## Evidence Index

- `docs/integration/evidence/infra03-seed/` + `infra03-live/` — two-instance financial concurrency PASS
- `docs/integration/evidence/operational/` — worker-leases 15/15, banking-dispatch 10/10, worker-execution 15/15, alerting 31/31, DR 264ms
- `docs/integration/evidence/portable-acceptance/` — portable suites (prerequisites, container, worker, alert, backup-restore, run-summary) — populated when run on host with runtime; `ENVIRONMENT_BLOCKED` records when absent
- `docs/integration/evidence/pg-resumable-manifest.json` — 83/83 186/186 3918p candidate `e9e5651d`
- `docs/integration/evidence/journeys/journey-results.json` — 10/10 267p, `browser-acceptance.json` 27/27 Blink, `mobile/{customer,agent}-mobile.txt` 26/230 25/346, `runtime-11-roles/` 11/11+11/11+8/8
- `docs/integration/RELEASE-READINESS-GATE.md` + this file + `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK.md` — gate, operational, portable
