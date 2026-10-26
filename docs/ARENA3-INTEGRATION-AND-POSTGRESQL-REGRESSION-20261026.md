# ARENA 3 — Integration and PostgreSQL Regression Report (2026-10-26)

Agent: ARENA 3 (integration & PostgreSQL regression), MonieNaija Ordinary Agent V1.
Assigned branch: `arena/8e59e188-monienaija` (pinned; all work committed and pushed there only).
Verified original baseline: `f90f6ea9b1f90fe38dfa608710d8583e49b04d54`.

## 1. Integrated branch URL and SHA

- Branch: https://github.com/shyne240/monienaija/tree/arena/8e59e188-monienaija
- Integration merge commits:
  - `065b356` — merge of ARENA 1 backend sprint (`arena/92fd33dd-monienaija`, tip `92ea4a5`)
  - `29cb5e8` — merge of ARENA 2 frontend sprint (`arena/ea070127-monienaija`, tip `f9ebe04`)
- Fix commits (Phase 2):
  - `28c0dd4` — PostgreSQL regression fixture/config repairs + product-catalog lost-update fix
  - `a0835d1` — two authorization-proof fixture alignments
  - this report commit (see `git log` for SHA)

## 2. Evidence both agents' commits are included

`git log --oneline --graph` on this branch contains, in ancestry:

- ARENA 1: `d461915` (A17 migration-ceiling fix), `073c226` (claim fail-closed + late-expiry gate), `92ea4a5` (claim HTTP auth verification + report).
- ARENA 2: `473fe82` (agent-mobile hardening), `f9ebe04` (admin-web Ordinary Agent V1).
- Shared verified baseline chain: `f90f6ea` → `98c8f24` → `be85e16` → `3d05aae`.

Both merges were `--no-ff` and conflict-free: ARENA 1 touched only `src/agent/agent-cash-to-cash-claim.service.ts`, `test/a16-*`, `test/a17-*`, `docs/ARENA1-*`; ARENA 2 touched only `apps/admin-web/**` and `apps/agent-mobile/**`. Zero file overlap; neither agent's work was altered or discarded. No other branch was reset, force-pushed, rewritten, or modified.

## 3. Build and test results on the integrated branch

| Gate | Result |
| --- | --- |
| Backend `npm run build` (nest) | PASS (before and after Phase 2 src change) |
| Backend `npm test` (unit) | PASS — 191 suites / 1,959 tests (identical to ARENA 1's evidence) |
| Agent Mobile `tsc` | PASS |
| Agent Mobile `npm test` | PASS — 18 suites / 279 tests |
| Admin Web `tsc` | PASS |
| Admin Web `vite build` | PASS |
| Admin Web `npm test` | PASS — 23 suites / 154 tests |
| PostgreSQL battery `npm run test:pg` (113 suites) | **113/113 suites PASS after fixes** (see §4–6); 2,162 tests |

## 4. PostgreSQL failures grouped by root cause

Pre-fix full sequential run on the integrated tree (embedded PostgreSQL 18.4, `PG_TEST_CONCURRENCY=1`, bare environment): **82 PASS / 31 FAIL of 113 suites** — closely matching ARENA 1's aborted observation (59/30 before termination). All 31 failing suites were classified; none is caused by ARENA 1 or ARENA 2 work.

### Group 1 — Missing workforce test-environment configuration (13 suites)
`ForbiddenException: SUPER_ADMIN role is disabled or undefined in configuration`, `Workforce authentication disabled`, and downstream 401s. These suites deliberately boot the real AppModule without overriding `A2_WORKFORCE_CONFIG` and require the documented local-dev `.env` (enabled five-role `A2_FINANCE_ROLES_JSON`, maker-checker rules, rate limits). `.env` is git-ignored and was absent; `.env.example`'s commented sample additionally predates the required fifth role (`ADMINISTRATOR`).
Suites: v1-admin-local-login-01, v1-admin-authorization-{hardening,kyc,customer-read,read-surface}-01, v1-admin-configurable-dashboard-platform-01, v1-admin-customer-pii-authorization-implementation-01, v1-admin-full-surface-audit-01-auth-propagation, v1-admin-p1-authorization-hardening, v1-admin-role-definition-governance-implementation-01, v1-administrator-role-and-assignment-implementation-01, v1-commercial-rule-governance (P0-A), v1-ledger-reversal-governance (P0-B).

### Group 2 — Decision 7 funding fixtures with PASSWORD assurance (6 suites)
`ForbiddenException: Decision 7 requires AGENT_NETWORK_MANAGER with agent.fund to initiate agent funding`. Fixtures modelled the funding maker with `assuranceLevel: 'PASSWORD'`; the service (correctly, since before baseline) requires an MFA-assured, non-SUPER_ADMIN `AGENT_NETWORK_MANAGER`. A22 additionally initiated funding via `POST /internal/agents/:id/fund`, which now (correctly) requires an approved fingerprint-bound `approvalId` — the maker endpoint is `/fund-request` — and reused the funding-maker token for a `reconciliation.view` read that Decision 6 reserves to TREASURY.
Suites: v1-commission-runtime-wiring, v1-commercial-scenario-matrix-01, v1-commission-settlement-01, v1-limit-05-flow-matrix (50 tests), v1-001-customer-funding (test 23), a22-admin-foundation (test 10).

### Group 3 — Stale migration ceilings (9 suites)
Hard-coded heads/counts pinned at `1785753600090` / 91 while the configured chain legitimately advanced through `SecureAgentApplicationAccess1785753600095` (96 migrations) in `be85e16` — before the verified baseline. Same defect class ARENA 1 fixed for A17 in `d461915`.
Suites: a18-aggregator-foundation (21/22), v1-001-customer-funding (count), v1-005-notification-delivery, v1-006-customer-notification-inbox, v1-capability-registry, v1-limit-01-limit-catalogue, v1-limit-03-limit-usage, v1-hardening-07-admin-agent-financial-position, v1-hardening-09-admin-notification-delivery-diagnostics.

### Group 4 — Invalid synthetic PII fixtures vs hardened field policy (5 suites)
Hardened customer field policy (present at baseline) correctly rejects: `+234000000xxxx` and `0850xxxxxxx` phone numbers (not valid Nigerian mobiles), `postalCode '00000'` (NG codes are six digits), NIN document numbers that are not exactly 11 digits. Some fixtures also still expected pre-hardening behaviour: client-supplied audit `actor` (now session-attributed) and unmasked audit `reference` (now `mn-••••NNNN`).
Suites: v1-customer-onboarding-02, batch-01-customer-servicing, batch-2a-customer-registration, v1-admin-authorization-customer-read-01 (A12), v1-admin-authorization-hardening-01 (G1 — session-establishment now fails closed for a legacy FINANCE_ADMIN-only principal, a strictly earlier enforcement of the same Task-22 invariant).

### Group 5 — VERIFIED APPLICATION DEFECT: product-catalogue lost update (1 suite)
V1-COMMERCIAL-02 test 08 (`concurrent updates: exactly one writer wins per version`) failed deterministically: TypeORM's `@VersionColumn` is **not** enforced by `repo.save()` (it only increments; `OptimisticLockVersionMismatchError` is raised solely on explicitly version-locked reads). Two concurrent `updateProduct` writers presenting the same expected version could both commit — observed: both fulfilled at versions n+1 and n+2, first writer's change lost. The read → assertVersion → save sequence was not atomic.

### Group 6 — Runner/environment (infrastructure)
At the runner default `PG_TEST_CONCURRENCY=2`, batch processes were OOM-killed on this 3.9 GB sandbox (batches exiting with a null code; ARENA 1's run was similarly degraded). All ARENA 3 measurements used `PG_TEST_CONCURRENCY=1`, which completed cleanly. This likely inflated ARENA 1's failing count with killed batches.

## 5. Classification (A–E) and baseline-versus-new comparison

| Group | Classification |
| --- | --- |
| 1 | **A** (existing baseline failure) + **C** (test-environment configuration defect) |
| 2 | **A** + **C** (test fixture defect; application control correct) |
| 3 | **A** + **C** (test fixture defect; migration chain correct) |
| 4 | **A** + **C** (test fixture defect; validation/actor-attribution controls correct) |
| 5 | **A** (existed at baseline) + **D** (legitimate application defect — fixed) |
| 6 | **E** (environmental/infrastructure — documented, mitigated) |

Baseline-versus-new proof: `git diff f90f6ea..29cb5e8 -- src/ test/` shows the **only** backend changes between the verified baseline and the integration merge are ARENA 1's `src/agent/agent-cash-to-cash-claim.service.ts`, `test/a16-*`, `test/a17-*` (both suites PASS in every run). ARENA 2 changed only `apps/**` (no PostgreSQL suite touches them). All 31 failing suite files and all implicated `src/` files are byte-identical to baseline. Therefore **zero new regressions were introduced by the integration**; every failure reproduced the baseline state under the same bare environment. Migration `…0095`, the Decision-7 MFA requirement, `establish()` fail-closed, and the field-policy hardening all exist at `f90f6ea` (introduced in ancestor `be85e16`).

## 6. Fixes completed (all verified by rerun against real PostgreSQL)

1. **Reproducible test environment** — new `scripts/prepare-pg-test-env.js` composes the local git-ignored `.env` from `.env.example` + the committed `docs/deployment/config/v1-workforce-bootstrap.env.template` (exact five-role vocabulary, maker-checker rules, rate limits, embedded-PG DB credentials; public placeholders only). README documents the battery procedure and the `PG_TEST_CONCURRENCY=1` requirement on <8 GB runners. `.env.example` annotated about its stale four-role sample.
2. **Decision 7 fixtures** — maker principals now model real MFA-assured sessions (`assuranceLevel: 'MFA'`) in 5 suites; A22's role-scoped mock session issues MFA assurance, initiates via the real maker endpoint `/fund-request` (with required `reason`), and performs the reconciliation read with a TREASURY token. **No control was weakened**: the service's MFA/role/scope checks are untouched and now genuinely exercised.
3. **Migration ceilings** — 9 suites converted to the ARENA 1/A17 configured-chain pattern: applied migrations must equal the configured chain exactly and `showMigrations()` must be false; explicit presence checks retained for suite-relevant migrations (0067/0069/0090/0095).
4. **Synthetic PII fixtures** — valid Nigerian mobile ranges (`+234811…`, `0811…`), valid Abuja postal code `900211`, valid 11-digit synthetic NIN; mask/actor/reference expectations aligned with the hardened behaviour (`+234*****NNNN` masks, session-attributed audit actor, `mn-••••NNNN` audit reference); G1 asserts the fail-closed session-establishment refusal for the legacy FINANCE_ADMIN role.
5. **Application defect fix (Group 5)** — `ProductCatalogService.updateProduct` now performs the version check and write inside one transaction under a `pessimistic_write` row lock, so the documented optimistic-concurrency contract is deterministic: exactly one writer wins per version; the loser receives the same 409 as the sequential stale-version replay. Audit behaviour unchanged. This **strengthens** a governance control.

Verification evidence:
- Targeted reruns: every fixed suite PASSes (fixrun1–fixrun5 logs; e.g. a22 15/15, onboarding-02 12/12, commercial-02 incl. test 08, P0-A/P0-B governance, admin-local-login, limit-05 flow matrix 90+ tests).
- Full battery (`PG_TEST_RUN_ID=final3`, concurrency 1): **111/113 suites PASS** (2,160/2,162 tests); the only 2 failures were the two suites whose fixtures were repaired while the run was already in flight — both re-verified green immediately after (`final3b`: 90/90 tests). Effective result: **113/113 suites, 2,162/2,162 tests PASS**.
- Backend unit battery rerun after the `src/product-catalog` change: 191 suites / 1,959 tests PASS; `nest build` PASS.
- Pre-existing repo lint debt unchanged: eslint reports the same error counts on touched test files before and after edits (verified against baseline worktree); `format:check` already failed on these files at baseline. No new lint/format regressions introduced.

## 7. Exact files changed (Phase 2 fix commits)

`28c0dd4`:
- `scripts/prepare-pg-test-env.js` (new)
- `README.md`, `.env.example`
- `src/product-catalog/product-catalog.service.ts`
- `test/a18-aggregator-foundation.integration.spec.ts`
- `test/a22-admin-foundation.integration.spec.ts`
- `test/batch-01-customer-servicing.integration.spec.ts`
- `test/batch-2a-customer-registration.integration.spec.ts`
- `test/v1-001-customer-funding.integration.spec.ts`
- `test/v1-005-notification-delivery.integration.spec.ts`
- `test/v1-006-customer-notification-inbox.integration.spec.ts`
- `test/v1-capability-registry.integration.spec.ts`
- `test/v1-commercial-scenario-matrix-01.integration.spec.ts`
- `test/v1-commission-runtime-wiring.integration.spec.ts`
- `test/v1-commission-settlement-01.integration.spec.ts`
- `test/v1-customer-onboarding-02.integration.spec.ts`
- `test/v1-hardening-07-admin-agent-financial-position.integration.spec.ts`
- `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts`
- `test/v1-limit-01-limit-catalogue.integration.spec.ts`
- `test/v1-limit-03-limit-usage.integration.spec.ts`
- `test/v1-limit-05-flow-matrix.integration.spec.ts`

`a0835d1`:
- `test/v1-admin-authorization-customer-read-01.integration.spec.ts`
- `test/v1-admin-authorization-hardening-01.integration.spec.ts`

Report commit: `docs/ARENA3-INTEGRATION-AND-POSTGRESQL-REGRESSION-20261026.md` (this file).

## 8. Remaining blockers / caveats

1. **No blockers to the combined development baseline.** The integrated branch builds and passes backend unit, mobile, admin-web, and the full 113-suite PostgreSQL battery.
2. `PG_TEST_CONCURRENCY=2` (runner default) is unsafe on <8 GB runners — keep 1 there; a runner-default change was intentionally NOT made because it is machine-dependent (documented in README instead).
3. `.env` is (correctly) git-ignored: every fresh environment must run `node scripts/prepare-pg-test-env.js` before `npm run test:pg`, or Group-1 suites fail closed by design.
4. ARENA 1's carried-forward security/policy items (credential-revocation races during in-flight claims, wallet-mode KYC expiry policy, transfer-code attempt atomicity, expired-fund disposition, physical-handover human review) remain open by design — they need product/compliance decisions, not test fixes; see `docs/ARENA1-ORDINARY-AGENT-V1-BACKEND-SPRINT-20261026.md`.
5. Pre-existing repo-wide lint/format debt in several integration specs was left untouched (out of integration scope; unchanged from baseline).
6. The product-catalogue fix changes runtime locking for `updateProduct` (row lock during version-checked writes). This is required for correctness; other suites exercising product governance all pass with it.
7. Not done (per mission): no merge to `main`, no deployment, no production data or migration changes.

## 9. Instructions for ARENA 4

1. Base all verification on branch `arena/8e59e188-monienaija` (tip = this report commit; integration merge `29cb5e8`, fixes `28c0dd4` + `a0835d1`). Do not rebase or rewrite it.
2. Environment: Node 22, `npm ci` at root; `npm install` inside `apps/agent-mobile` and `apps/admin-web`.
3. PostgreSQL battery:
   ```bash
   node scripts/prepare-pg-test-env.js     # writes local .env (git-ignored)
   node scripts/embedded-pg.js &           # or docker compose up postgres
   PG_TEST_CONCURRENCY=1 npm run test:pg   # mandatory on <8GB RAM; ~25 min
   ```
   Expected: 113/113 suites, 2,162 tests. Any Group-1-style failure (`SUPER_ADMIN … disabled or undefined`) means `.env` is missing — regenerate it; do not "fix" the suites.
4. Other gates: `npm run build`, `npm test` (191/1,959), mobile `npm run ts:check && npm test` (18/279), admin-web `npm run ts:check && npm run build && npm test` (23/154).
5. Do not weaken Decision 7 (MFA-assured AGENT_NETWORK_MANAGER maker / independent FINANCE_CONTROLLER checker), the maker-checker rules, the field-policy validators, or the product-catalogue version lock to make anything pass; fixtures already model the correct identities.
6. `lint`/`format:check` have pre-existing baseline debt in integration specs; gate on unchanged-error-count rather than absolute zero unless the team decides otherwise.
