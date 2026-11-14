# Institutional consolidation — status and final acceptance (ARENA 3)

Status: **Phase 5 complete on this branch.** Institutional Phases 1–4 and the consolidated
Phase 5 acceptance matrix are accepted at the local/disposable-PostgreSQL level behind
`arena/8e59e188-monienaija`.

This document is **not** deployment evidence. No production database was provisioned, no
production credential was activated, no live provider was called and no real financial
transaction was performed. Production roles and grants remain **NOT VERIFIED** until an operator
runs the provisioning in §7 against the real database and production readiness reports `verified`.

Companion documents: `PROTECTED-AUTHORITY.md` (implementation record), `MIGRATION-ALLOCATION.md`
(migration register), `phase5-evidence/` (per-group acceptance summaries), and the superseded
historical records listed in §12.

---

## 1. Checkpoint register

| Item | Value |
| ---- | ----- |
| Branch | `arena/8e59e188-monienaija` |
| Branch base | `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` |
| Previous accepted application baseline | `1acdf5085c77b3b299dea24f2b3eed614efeb8a1` |
| **Phase 5 accepted application checkpoint** | **`a52602d056521fa4e78cd77e1a3735a6a1ccf9ed`** |
| Head migration | `1785753600502-ProtectedAuthorityInstitutionalOwnership` |

### Application checkpoints

| Phase | Commit | Scope |
| ----- | ------ | ----- |
| 1 | `2cfeda63d19a7bf84871ed83fec0df682b41a3ea` | Protected checker authority boundary |
| 2 | `7452867c8d153b6887683d2b99fb0ac2c8cc9793` | Institutional financial ownership and ledger isolation |
| 3 | `c167d234e5cab624c043928d0fff85692f51ae12` | Institution administration console |
| 4 | `a52602d056521fa4e78cd77e1a3735a6a1ccf9ed` | Complete migration inventory at readiness |
| 5 | this commit (documentation + acceptance) | Consolidated regression acceptance |

### Documentation checkpoints

| Commit | Documents |
| ------ | --------- |
| `d013ddf8dde5f8587620add22b3036119bfcf32c` | `PHASE-1-BLOCKED.md`, reproduction patch, WIP results |
| `11d745e827b0f707d8ad40a01a40786c1f72c126` | `MIGRATION-ALLOCATION.md`, `REMEDIATION-WIP.md`, candidate patch |
| `2cfeda6…` (Phase 1) | `PROTECTED-AUTHORITY.md`, `PROTECTED-AUTHORITY-WIP.md` |
| `7452867…` (Phase 2) | `ARENA4-INSTITUTIONAL-FINANCIAL-OWNERSHIP-IMPLEMENTATION-20261113.md` |
| `c167d23…` (Phase 3) | `ARENA4-ADMINISTRATION-CONSOLE-IMPLEMENTATION-20261113.md` |
| `a52602d…` (Phase 4) | readiness/inventory sections of `PROTECTED-AUTHORITY.md` |
| Phase 5 commit (this document) | This status document, `phase5-evidence/*`, supersede banners |

---

## 2. Phase completion status

| Phase | Status | Evidence |
| ----- | ------ | -------- |
| 1 — Institutional foundation and security remediation | **PASS** (local) | `institution-foundation` 32/32, boundary 7/7, wallet 21/21, migration-chain 20/20 |
| 2 — Institutional financial ownership and ledger isolation | **PASS** (local) | Phase 2 integration 16/16, unit 11/11, chain 20/20 |
| 3 — Institution administration console | **PASS** | Console 6/6, admin-web 85 suites / 868 tests, TypeScript and build clean |
| 4 — Migration readiness and historical upgrades | **PASS** | Inventory 4/4, readiness real-PG 6/6, full-inventory fail-closed proven |
| 5 — Consolidated regression acceptance | **PASS** (local) | §4 matrix; every executed group exit 0 |

---

## 3. Protected authority — what is implemented

Migration `1785753600501` creates schema `protected_authority`, owned by
`monienaija_authority_core`, containing:

- `checker_decisions` — append-only checker decision bound to approval id, action type, action
  fingerprint, server-computed payload digest, checker principal and session, MFA assurance,
  decision time and approval expiry;
- `approval_consumptions` — append-only record of execution;
- `approval_payload_digest(uuid)` — derives the digest from the locked approval row in SQL; the
  caller never supplies a digest, checker id, MFA flag or entitlement treated as authority;
- `approval_authority_guard()` — BEFORE INSERT/UPDATE trigger on `privileged_action_approvals`
  requiring matching protected evidence for `APPROVED`/`CONSUMED` on protected actions;
- `protected_evidence_immutable()` — refuses UPDATE/DELETE on protected evidence, including for
  the authority role;
- row level security (enabled **and forced**) on `privileged_action_approvals` with five
  policies; runtime keeps DML for unprotected action types only.

Workforce authentication evidence is protected by revoking ordinary runtime writes on
`a2_workforce_sessions`, `a2_finance_role_assignments`, the authorization catalogue,
bootstrap/recovery consumption tables and the execution-evidence tables, and by moving the 0500
evidence trigger functions into `protected_authority` as `SECURITY DEFINER` functions owned by
`monienaija_authority_core`. Session issuance, validation, revocation, role/catalogue writes,
approval decisions/consumption and the institutional execution transactions run on a
credential-separated authority connection.

### Protected action allow-list — six actions

`src/authorization/protected-authority.actions.ts`:

1. `FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE`
2. `INSTITUTION_AGENT_AFFILIATION_CHANGE`
3. `WALLET_OWNERSHIP_RESOLUTION`
4. `LEDGER_JOURNAL_REVERSAL`
5. `WALLET_INSTITUTION_ATTRIBUTION` (Phase 2, extended by migration `0502`)
6. `CUSTOMER_INSTITUTION_ENROLMENT_CHANGE` (Phase 2, extended by migration `0502`)

Other governed actions (notifications, agent funding, B2F policy, role-definition proposals) keep
their prior behaviour and are **not** claimed as protected by this boundary.

### The four original failing reproductions — all pass

| Reproduction | Suite | Result |
| ------------ | ----- | ------ |
| Direct-SQL checker approval forgery from the application connection | `institution-foundation` | PASS |
| Checker forgery by a non-owner SQL role with application DML | `institution-foundation` | PASS |
| MFA checker impersonation by mutating the session hash | `institution-foundation` | PASS |
| Wallet-ownership approval forgery by runtime SQL | `wallet-ownership-resolution` | PASS |

None of these is skipped or marked todo.

---

## 4. Phase 5 acceptance results

Tested commit: **`a52602d056521fa4e78cd77e1a3735a6a1ccf9ed`**. Every group ran sequentially on a
disposable PostgreSQL 18.4 cluster with synthetic data.

| Group | Check | Suites | Tests | Exit | Result |
| ----- | ----- | ------ | ----- | ---- | ------ |
| B | Full repository PostgreSQL integration suite (24 batches, concurrency 1) | 144 | 2,604 | 0 | PASS — 0 failed, 0 without result, 0 crashes, 0 memory failures |
| A | Backend unit suite | 241 | 2,869 | 0 | PASS |
| C | Isolated KYC acceptance suite (own disposable cluster) | 9 | 98 | 0 | PASS |
| A | Backend `tsc --noEmit` | — | — | 0 | PASS |
| A | Backend production build (`nest build`) | — | — | 0 | PASS |
| A | Repository-wide ESLint (`npm run lint`) | — | — | 0 | PASS |
| A | Repository-wide Prettier (`npm run format:check`) | — | — | **1** | **Pre-existing failure, see below** |
| D | Admin web install / TypeScript / jest / vite build | 85 | 868 | 0 | PASS |
| E | Agent mobile install / TypeScript / jest | 20 | 297 | 0 | PASS |
| F | Customer mobile install / TypeScript / jest | 14 | 125 | 0 | PASS (with pre-existing `npm ci` caveat) |
| G | Protected authority + migration + readiness targeted regression | 7 | 108 | 0 | PASS |

Full PostgreSQL discovery: **144 files, 144 reported, 144 passed, 0 failed, 0 without a result.**
The runner also reported 5 "failure category" lines; each is expected negative-path console
output captured by the runner's log classifier (a daily-limit-exceeded message, two simulated SMS
notifications, an intentional duplicate-key migration probe, and a `M19A_LIVE_HTTP` self-revoke
line). **They are not test failures** — `suitesFailed = 0` and `failures` is a log-line list, not
a Jest failure list.

### Known non-blocking defects found in Phase 5

- **`npm run format:check` fails on 30 files.** None of the 30 is touched by this mission; their
  last commits are from 2026-11-12, before the institutional work began. Every file this mission
  changed passes Prettier. A repo-wide reformat was deliberately **not** performed: it is
  unrelated churn and outside this mission's scope. Tracked for a scoped cleanup.
- **`apps/customer-mobile` `npm ci` fails with `EUSAGE`.** `package-lock.json` is out of sync
  with `package.json` (missing `@babel/*` entries). This is **pre-existing**: the lockfile was
  last changed by `d4db6be` (2026-11-13 12:22), before this mission, and no checkpoint touches
  `apps/customer-mobile`. Tests were run via `npm install` and the committed lockfile was
  restored afterwards, leaving a clean tree. A lockfile refresh is required before release.

### Migration inventory, historical upgrades and readiness

- `migration-inventory` unit suite 4/4: complete published institutional chain in order, no
  duplicated identifier, no fabricated `0117` or `0120–0132`, terminates at `0502`.
- `migration-chain` 20/20: fresh chain from empty, historical upgrade
  `0400 → 0401 → 0500 → 0501 → 0502`, historical approval reservations, and the `0401`/`0500`
  ordering probe in both directions.
- `v1-release-01-production-readiness-migration-sync` 6/6: a fully migrated database is
  schema-compatible, deleting an earlier applied row (for example `0400` while `0401` is present)
  fails closed as `schema_incompatible`, restoring it passes, and startup stays closed without
  protected authority.

### Protected authority security acceptance

The boundary suite (7/7) runs the real `AppModule` as the provisioned **runtime login** against a
**migrator-owned** database with a distinct authority login, and proves: three distinct
non-privileged logins; the authority is the only writer of protected evidence; the runtime
credential is denied every protected write path (session hash, role assignments, catalogue,
protected decisions/consumptions, execution evidence, `SET ROLE`, `TRUNCATE`); a protected
approval cannot be manufactured, updated, consumed or executed by runtime SQL; a legitimate
authenticated MFA checker flow records immutable evidence and executes; an identical authorized
replay is idempotent; a newly approved transition still works; production readiness reports
`verified`; and readiness fails closed without a separate authority credential.

---

## 5. Institution administration parity

The Phase 3 console adds **two read-only endpoints only**:

- `GET /internal/institutions/:institutionId/pending-approvals` — institution-scoped governed
  approval queue (`institution.view` plus institution scope);
- `GET /internal/institution-agent-directory` — platform-only agent/affiliation directory
  (`institution.attribution.view`).

The console test suite asserts that the directory "never exposes financial data or writes
anything". No previously accepted administrative capability was removed; the governed mutation
surface remains available through its existing authorized interfaces:

| Controller | Governed mutations retained |
| ---------- | --------------------------- |
| `institution.controller.ts` | `POST /internal/institutions` (register), `POST :id/evidence`, `POST :id/lifecycle/request`, `POST :id/lifecycle` (execute approved), `POST/DELETE :id/aggregators`, `POST/DELETE :id/workforce` |
| `institution.controller.ts` (affiliations) | `POST /internal/agent-affiliations/:agentId/request`, `POST /internal/agent-affiliations/:agentId/execute` |
| `financial-ownership.controller.ts` | `POST :id/enrolments`, `POST :id/enrolments/execute`, `POST :id/wallet-attributions`, `POST :id/wallet-attributions/execute`, `POST :id/ledger-accounts`, `POST /internal/institution-ledger/platform-accounts`, `POST /internal/financial-context/validate` |

Read surfaces (`GET :id`, `GET :id/affiliations`, `GET :id/workforce`, `GET :id/enrolments`,
`GET :id/wallet-attributions`, `GET :id/ledger-accounts`, coverage/unattributed/gaps reports) are
unchanged. Admin-web tests cover request → independent MFA checker approval → confirmed
execution through the existing `POST /internal/a2/workforce/approvals/:id/approve` endpoint, so
the console and the governed workflows remain coupled to the same maker-checker stack.

**No integration regression was found**, so no corrective change was made.

---

## 6. Ledger reversal — integration dependency (recorded, not redesigned)

Arena 1 has already implemented atomic governed ledger reversals, including checkpoint
`413055f094e6b74c6786b7e6146367d586caa5c9` *"Execute governed ledger reversals atomically"* (2026-11-13),
which adds `src/migrations/1785753600117-CreateGovernedLedgerReversalExecutions.ts` together with
`ledger-reversal-governance.service.ts` and `ledger.service.ts` changes and an isolated-PG suite.

On this branch `LEDGER_JOURNAL_REVERSAL` is inside the protected allow-list, so the checker
decision and consumption are protected by the shared authority. The reversal execution itself was
**not** redesigned here: `LedgerReversalGovernanceService` consumes the approval and then posts
the reversal, preserving the pre-existing two-step lifecycle.

**Recorded requirement for the subsequent A6/A7 consolidation:** reconcile Arena 1's atomic
approval consumption, reversal posting and immutable execution evidence with the protected
authority transaction boundary, so that the reversal and its protected evidence commit as one
unit. This consolidation must also resolve the migration-identifier collision described in §11
before either side is released.

---

## 7. Database role provisioning and readiness requirements

Provisioning is executable and secret-free; the SQL the tests execute is the SQL an operator runs.

```bash
export DB_HOST=... DB_PORT=5432 DB_NAME=... DB_USER=<admin> DB_PASSWORD=<admin secret>
export RUNTIME_DB_USER=monienaija_runtime_app   RUNTIME_DB_PASSWORD=<secret>
export AUTHORITY_DB_USER=monienaija_authority_app AUTHORITY_DB_PASSWORD=<secret>
export MIGRATOR_DB_USER=monienaija_migrator     MIGRATOR_DB_PASSWORD=<secret>

node scripts/provision-database-roles.js --phase=cluster
node scripts/provision-database-roles.js --phase=before-migrations
npm run migration:run          # executed as MIGRATOR_DB_USER
node scripts/provision-database-roles.js --phase=after-migrations
```

| Role | Purpose and attributes |
| ---- | ---------------------- |
| `…_migrator` | owns the database, schema `public` and migrations; NOSUPERUSER/NOCREATEDB/NOCREATEROLE |
| `…_runtime` | the Nest application's ordinary connection; no superuser/DDL attributes |
| `…_authority` | the protected authority component; no superuser/DDL attributes |
| `monienaija_authority_core` | NOLOGIN NOINHERIT; owns `protected_authority` and the guard/evidence functions |
| `monienaija_runtime` | NOLOGIN NOINHERIT; carries the ordinary application grants |

Application environment: `DB_USER`/`DB_PASSWORD` = the runtime login;
`PROTECTED_AUTHORITY_DB_USER`/`PROTECTED_AUTHORITY_DB_PASSWORD` = the authority login. The two
must be different logins. `PROTECTED_AUTHORITY_DB_*` is optional only for local single-role
development; production readiness fails closed without it.

`ProductionReadinessService` is available only when `ProtectedAuthorityService.inspect()` returns
`verified`: distinct authority login; no superuser/createrole/createdb/replication/bypassrls; no
database or `public` ownership; required authority membership and protected writes; protected
schema/tables/trigger present; no runtime protected-schema usage or function execute; no runtime
protected writes; RLS enabled and forced with five policies; `TRUNCATE` denied. Readiness also
requires the **complete migration inventory** to match the shipped migration classes. There is no
environment override.

---

## 8. Threat model and limitations

The boundary is against an attacker holding **only ordinary database credentials** or ordinary
runtime SQL. It is not a defense against:

- **Application-process compromise** — the authority credential is available inside the same Node
  process, because the approval service must use it synchronously.
- **Database owner or superuser** — such an actor can disable triggers, rewrite
  `protected_authority`, take over the authority role or alter provisioning. Readiness refuses to
  run production on such a runtime role but cannot make an owner safe.
- **Stolen live bearer tokens** — a stolen ACTIVE token is a live credential; forgery and session
  rewriting are prevented, replay of a stolen token is not. Revocation and expiry remain enforced.

Other documented limits:

- Protected approvals created before `0501` have no trustworthy protected decision and are
  non-executable; a fresh request is required. No historical checker evidence is fabricated.
- Ledger reversal remains consume-then-post (§6).
- Upstream OIDC/identity-provider compromise is out of scope; the boundary starts at the workforce
  session and role records.
- Unprotected governed actions keep their previous approval-write behaviour.
- Local-admin credentials are a development/test-only store, 404-gated in production.

---

## 9. Supported migration ordering

Published order: `1785753600400 → 1785753600401 → 1785753600500 → 1785753600501 → 1785753600502`.

- Migration identifiers already published are **never** renumbered or rewritten.
- Arena 3 allocation is `1785753600300–1785753600399`; Arena 4 owns
  `1785753600400–1785753600499`; use of `1785753600500–1785753600599` is a user-authorized
  exception for the institutional correction that depends on `0400`.
- `1785753600117` and the `0120–0132` range are intentionally absent on this branch and must not
  be fabricated; see §11 for the reason `0117` now matters.
- `0501` issues conditional revokes so historical fixtures lacking later tables still upgrade;
  `0502` extends the guard and RLS to the two Phase 2 actions.
- Readiness enforces the whole inventory, not only the head: a skipped earlier identifier fails
  closed.

---

## 10. Outstanding production dependencies

1. Provision the three logins and two group roles in the target environment (§7), then confirm
   production readiness reports `verified` — currently **NOT VERIFIED**.
2. Keep the authority credential out of the runtime credential's scope and out of ordinary
   operators' hands; rotate it independently.
3. Recheck the migration register and all live Arena branch heads before release (§11).
4. Refresh `apps/customer-mobile/package-lock.json` so `npm ci` works in CI.
5. Scoped Prettier cleanup of the 30 pre-existing unformatted files.
6. Complete the A6/A7 reversal consolidation described in §6.

---

## 11. Subsequent integration conflict areas

- **Migration `1785753600117`.** Arena 1's atomic reversal checkpoint `413055f` ships
  `CreateGovernedLedgerReversalExecutions` at exactly this identifier, while this branch
  deliberately excludes `0117` and every migration allow-list and the inventory test assert its
  absence. Consolidation must adopt Arena 1's `0117` as a published identifier and update the
  allow-lists, `test/migration-inventory.spec.ts`, the readiness expectation and the admission
  tests together. It must not be renumbered.
- **Protected authority vs. Arena 1 atomic reversal.** Both sides change how approval consumption
  relates to posting. The 0501/0502 guard, `approval_consumptions` and Arena 1's
  `governed_ledger_reversal_executions` must be reconciled into one transaction (§6).
- **`0500`–`0599` exception.** Reserved for this institutional correction only; it is not a
  general-purpose allocation and must be re-checked against Arena 1/2/4 heads.
- **Unprotected governed actions.** Notifications, agent funding, B2F policy and role-definition
  approvals still write approvals under the previous contract; extending the boundary to them is
  a follow-up that must not be assumed.
- **Arena 2 Cash-Out and Arena 4 customer onboarding/dashboard** remain excluded until this
  consolidation is accepted; merging them must not import their migration ranges or their
  competing approval paths.

---

## 12. Superseded historical artifacts

The following are preserved for provenance and are **superseded** by this acceptance. They must
not be cited as current evidence:

| Artifact | Why superseded |
| -------- | -------------- |
| `PHASE-1-BLOCKED.md` | Describes the pre-remediation blocked state; closed by `2cfeda6` |
| `ROLE-BOUNDARY-BLOCKER.md` | Pre-remediation SQL-forgery blocker; closed by `2cfeda6` |
| `REMEDIATION-WIP.md` | Unaccepted WIP plan; Phase 1 accepted at `2cfeda6` |
| `PROTECTED-AUTHORITY-WIP.md` | Interim interlock (`5b6659e`) history; replaced by real inspection |
| `phase1-targeted-results.json` | WIP candidate run (7 suites / 127 tests); superseded by §4 |
| `phase1-approval-integrity-repro.patch` | Reproduction patch against the pre-fix candidate |
| `phase1-remediation-WIP.patch` | Candidate diff; never integrated |
| `phase2-order-probe.spec.txt` | Temporary probe; superseded by `migration-chain` 20/20 |

---

## 13. Reproducing the acceptance run

```bash
# disposable PostgreSQL on 127.0.0.1:5432, synthetic data only
node scripts/prepare-pg-test-env.js --create-if-missing

npm ci && npx tsc --noEmit -p tsconfig.json && npm run build && npm run lint
npm test                                        # 241 suites / 2869 tests
NODE_ENV=test DB_HOST=127.0.0.1 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
  PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560 \
  node scripts/run-pg-integration-tests.js      # 144 suites / 2604 tests
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes node scripts/run-isolated-kyc-tests.js   # 9 / 98

(cd apps/admin-web && npm ci && npx tsc --noEmit && npm test && npm run build)
(cd apps/agent-mobile && npm ci && npx tsc --noEmit && npm test)
(cd apps/customer-mobile && npm install && npx tsc --noEmit && npm test)
```

Resource-intensive suites must run sequentially on the 2-vCPU sandbox used for this acceptance.
