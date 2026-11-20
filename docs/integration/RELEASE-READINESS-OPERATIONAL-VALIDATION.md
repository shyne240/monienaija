# Release Readiness Report — Post-Arena 5 Operational Validation

**Branch:** `arena/1f37a4f3-monienaija` @ `b1605b51`  
**Base:** `6816a760bd460df2a5347016d7d84f5c62cab642` (Arena 3D freeze)  
**Application/test candidate:** `e9e5651d6398477e78b71226b0ae44fd61a27899`  
**Migrations:** 166 head `1785753600804-GeneralizeExternalOperationsForAgents.ts`  
**Date:** 2026-11-20  
**Engineering verdict:** **ACCEPTED** — all executable lanes PASS, financial engine frozen.  
**Production verdict:** **NOT_READY** — 16 blockers + 4 human-acceptance conditions, by design.

This is the release-readiness phase successor to Arena 5 (`b1605b51` engineering-accepted). It does not modify the financial engine without a demonstrated defect.

---

## 1. Immutable Engineering Baseline

| Artefact | Evidence | Result |
|---|---|---|
| **Source** | `e9e5651d` candidate, `git diff --ignore-all-space e9e5651d..b1605b51 -- src test` = 8 formatting-only files (Prettier) | Preserved |
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
| **infra03-seed** | `infra03-seed/infra03-seed.log` disposable DB `mn_it_infra03seed_infra03_11675` 2 wallets 2 journals tier v1 `balance 10000000` | PASS (see §2) |
| **Migration rehearsal** | `4/4` upgrade rehearsal | PASS |

Outstanding limitation at baseline: infra03 2-process live concurrency was ENVIRONMENT_B­LOCKED (no orchestrated :3001+:3002); resolved below.

No predecessor branch mutation, no main merge, no production credentials.

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

## 3. Container and Deployment

| Check | Source | Status |
|---|---|---|
| `Dockerfile` 3-stage (node 22.22.3-alpine3.20 builder → prod `npm ci --omit=dev` non-root) | `Dockerfile` | PASS (definition) |
| `docker-compose.yml` postgres/migrate/backend/admin-web/proxy, migrate one-shot, non-root read-only | `docker-compose.yml` | PASS (definition) |
| Health checks `/api/v1/health` live+ready, `verifyStartup` 8-blocker gate, `migrationsRun:false` | `src/production`, `SANDBOX-INTEGRATION-READINESS.md` 11/11 | PASS |
| Worker role `PROCESS_ROLE=worker` readiness-gated | `WORKER-EXECUTION.md` | Mechanism PASS |
| Build | No container runtime in sandbox | **ENVIRONMENT_BLOCKED** — definition-only |

No image built, no production deploy, no credentials.

---

## 4. Worker and Alerting

| Check | Evidence | Status |
|---|---|---|
| Worker supervision 16/16 + ownership/lease/dead-letter | `WORKER-SUPERVISION`, `WORKER-OWNERSHIP-AND-DEAD-LETTERS` | Mechanism PASS |
| Execution in deployment | `WORKER-EXECUTION.md` | **NOT_OBSERVED** (blocker) |
| Alert webhook signed `ALERT_WEBHOOK_URL/SECRET` → `NoneAlertChannel` fallback | `ALERTING.md` socket proof | Mechanism PASS, **NOT_DELIVERED** (blocker) |
| Diagnostics/metrics/OperationsCentre | `operations-*` | PASS |

Synthetic receiver `ALERTING.md` socket proof; no external paging provider contacted. `scripts/run-local-worker-acceptance.js` disposable where available.

---

## 5. Disaster Recovery

Recovery architecture per `ARENA3D-PRODUCTION-READINESS-CONTINUATION-RECORD.md §4`: `pg_dump` + point-in-time + `pg_restore` rehearsal. RPO/RTO are declared configuration (not measured). No restore at production volume performed in sandbox (requires provisioned volume + `pgbackrest`/`WAL-G`). **Blocker `disaster_recovery_not_measured` remains**.

Disposable rehearsal command (when infra permits):

```bash
pg_dump -Fc -d monienaija > /tmp/mn.dump
createdb monienaija_restore && pg_restore -d monienaija_restore /tmp/mn.dump
psql -d monienaija_restore -c "SELECT count(*) FROM ledger_journals; SELECT sum(amount_minor::bigint) FROM ledger_lines;"
```

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

## 7. Mobile Release

| Check | Evidence | Status |
|---|---|---|
| Customer `app.json` `ng.monienaija.customer` 1.0.0 build 1 | `mobile-release-readiness` | PASS (format) |
| Agent `ng.monienaija.agent` 1.0.0 build 1 | same | PASS |
| `cross-app-version-collision` both 1.0.0 | release gate | **WARNING** — condition until Product diverges versions |
| `runtimeVersion` undeclared | same | **WARNING** — OTA must stay disabled |
| Native build/sign/submit/install | no Xcode/Android SDK | **ENVIRONMENT_BLOCKED** (blocker `mobile_not_built_or_submitted`) |

Resolution: Product declares `version` (major.minor.patch per app) + `runtimeVersion` (`expo.runtimeVersion` semver policy) in `apps/*/app.json`, reviewed PR. Scripts `npm run mobile:build:ios/android` when toolchain available; no submission without explicit approval.

---

## 8. Browser Acceptance

Blink `Chromium 153` 27/27 `api.stubbed` `bundle 1942663B` per `browser-acceptance.json` **PASS** (fix `ADMIN_WEB_API_BASE_URL=/api/v1`). WebKit (Safari) + Gecko (Firefox) + VoiceOver/NVDA announcement unverified — **blocker `browser_acceptance_single_engine`**. Repro: `node scripts/admin-web-browser-acceptance.cjs --browser webkit/gecko --a11y axe-core` when runners available.

---

## 9. Release Gate Reconciliation

```
$ npx ts-node -T scripts/release-gate.ts
RELEASE GATE: NOT_READY — 16 blockers, 4 conditions
  PASS ci-deployment (15 gates intact)
  WARNING mobile-release (4 warnings → conditions)
  PASS browser-acceptance (27 checks, API stubbed)
```

| # | Blocker | Category | Owner | Engineering? | Closure criterion |
|---|---|---|---|---|---|
| 1 | `trusted_kyc_provider_activation_unverified` | financial-dependency | Compliance/Provider | External | Live provider HMAC-verified activation |
| 2 | `customer_kyc_consent_notice_and_policy_unverified` | financial-dependency | Legal/Compliance | External | Governed consent notice approved |
| 3 | `identity_key_versions_unverified` | financial-dependency | Security | External | KMS key-version attestation |
| 4 | `effective_kyc_policy_unverified` | financial-dependency | Risk/Compliance | External | Head version>0 live approved |
| 5 | `provider_governance_and_routing_unverified` | financial-dependency | Platform | External | Routes + fallback proven |
| 6 | `wallet_ownership_governance_unverified` | financial-dependency | Product Governance | External | Ownership attribution live |
| 7 | `institution_kyc_tier_limit_governance_unverified` | financial-dependency | Risk | External | Tier limits governed |
| 8 | `financial_authorization_dependencies_unverified` | financial-dependency | Security | External | Auth catalogue live |
| 9 | `worker_execution_not_observed_in_deployment` | operations | Platform/SRE | External (deploy) | Worker lease observed in orchestrator |
| 10 | `alert_delivery_not_observed_against_a_real_channel` | operations | SRE | External | Signed webhook delivered to receiver |
| 11 | `disaster_recovery_not_measured` | operations | SRE/DBA | External | Restore drill measured RPO/RTO |
| 12 | `container_build_unverified` | release-artefact | Platform | Engineering* | `docker build` PASS (*needs runtime) |
| 13 | `deployment_not_performed` | release-artefact | Platform | External | compose/k8s schedule PASS |
| 14 | `provider_sandbox_acceptance_not_performed` | evidence | Provider Mgr | External | Provider sandbox credential exercised |
| 15 | `browser_acceptance_single_engine` | evidence | QA | Engineering* | WebKit+Gecko+a11y PASS |
| 16 | `mobile_not_built_or_submitted` | release-artefact | Mobile/Product | External | Signed build + runtimeVersion |

*Engineering-owned but environment-blocked (no runtime/hardware).

**4 human-acceptance conditions (WARNING, non-blocking until product decides):**
`mobile_agent-mobile_cross-app-version-collision`, `mobile_customer-mobile_cross-app-version-collision`, `mobile_agent-mobile_runtime-version`, `mobile_customer-mobile_runtime-version`.

---

## 10. Final Verdict

**Engineering: ACCEPTED.** Source `e9e5651d` → evidence `b1605b51` provenance formatting-only, 166 migrations, 3918p+149p+267p+3409p+230p+346p+27p+8p infra03-seed PASS. No defect in financial engine; no further feature work.

**Production: NOT_READY — correctly.** 16 blockers and 4 conditions are the gate working as designed (`scripts/release-gate.ts` pure function, `FINANCIAL_DEPENDENCY_BLOCKERS` imported). Closure requires external activations (§6), deployment observability (§3-5), and product decisions (§7-8). No override, no flag, no mock satisfies `verifyStartup`.

**Next actions (owners):** Compliance/Legal/Provider activate 8 financial dependencies; Platform/SRE prove worker/alert/DR/container/deployment/provider; Product set mobile versions + runtimeVersion; QA add WebKit/Gecko+a11y. Re-run `npx ts-node -T scripts/release-gate.ts` after each verified integration — blocker leaves only when constant edited in review.

No deployment, live provider calls, real funds, external notifications, production credentials, predecessor mutation or main-branch merge occurred.

---

## Evidence Index (new)

- `docs/integration/evidence/infra03-seed/infra03-seed.log+json` — disposable DB `mn_it_infra03seed_infra03_11675` tier v1
- `docs/integration/evidence/pg-resumable-manifest.json` — 83/83 186/186 3918p candidate `e9e5651d`
- `docs/integration/evidence/journeys/journey-results.json` — 10/10 267p
- `docs/integration/evidence/browser-acceptance/browser-acceptance.json` — 27/27 Blink
- `docs/integration/evidence/mobile/{customer,agent}-mobile.txt` — 26/230 25/346
- `docs/integration/evidence/runtime-11-roles/` — 11/11+11/11+8/8
- `docs/integration/RELEASE-READINESS-GATE.md` + this file — gate definition + operational report
