# ARENA 4 — Ordinary Agent V1 UAT Execution Evidence

**Date:** 2026-10-26  
**Assigned branch:** `arena/870f970d-monienaija`  
**Integrated baseline verified:** `18bfb8c6200f10e544f4c864f9b8ad2af3c20385` from `arena/8e59e188-monienaija`  
**ARENA 4 integration merge:** `a667cad` (full SHA recorded in git history)  
**Purpose:** Record the bounded real-PostgreSQL Ordinary Agent V1 integration/UAT run. This is not production, mobile-device, or browser UAT sign-off.

## Baseline incorporation

The exact ARENA 3 SHA was fetched from `origin/arena/8e59e188-monienaija` and matched the supplied full SHA. ARENA 4's pre-existing plan was committed first as `b41a986`. Since local history had diverged after that plan commit, the baseline was incorporated using a normal non-fast-forward merge, not reset/rebase/force-push. The resulting merge's second parent is exactly `18bfb8c6200f10e544f4c864f9b8ad2af3c20385`; `git merge-base HEAD <integrated-SHA>` confirms the integrated SHA is an ancestor of ARENA 4 HEAD. Integrated backend, frontend, and ARENA 3 stabilization changes are therefore present without altering the upstream branch.

## Test environment and exact command

- Node `v22.22.3`, npm `10.9.8`.
- Installed root dependencies with `npm ci --ignore-scripts` (979 packages; audit reported zero vulnerabilities).
- Generated the local, ignored `.env` with `node scripts/prepare-pg-test-env.js`.
- Used repository-provided embedded PostgreSQL 18.4 at loopback port 5432, configured with the synthetic local test account from the ignored test environment file. A loader-library search-path workaround was required because the sandbox lacks system `libpq`/ICU soname links; the repository's embedded server then started successfully. No external or production database was contacted.
- Ran sequentially with the ARENA 3 runner and isolated per-suite databases under a dedicated namespace:

```bash
PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=8 PG_TEST_RUN_ID=uat26agent \
  npm run test:pg -- \
  --testPathPatterns='test/(a[0-9]+-agent|v1-agent|agent-application-access).*integration.spec.ts'
```

**Result:** 20 PostgreSQL integration suites passed; 382 tests passed, 0 failed. The runner executed three sequential batches (8 + 8 + 4 files). Tests use real HTTP endpoints (Supertest/Nest in-process HTTP) where provided and real PostgreSQL persistence. This is not an external live-browser test.

Additional gates actually executed after dependency installation:

- Backend `npm run build`: PASS.
- Backend `npx jest --runInBand`: 191 suites / 1,959 tests PASS.
- Agent mobile `npm test -- --runInBand`: 18 suites / 279 tests PASS; `npm run ts:check`: PASS.
- Admin web `npm test -- --runInBand`: 23 suites / 154 tests PASS; `npm run ts:check`: PASS; `npm run build`: PASS.
- `npm ci` reported dependency audit findings in the app lockfiles (agent-mobile: 6 vulnerabilities; admin-web: 34 vulnerabilities). These are dependency-audit alerts, not vulnerabilities independently triaged by ARENA 4. They should be reviewed by the frontend owners; dependency upgrades were not attempted in this UAT task.

## Coverage evidenced by the executed suites

The 20 passing suites were:

- `test/a7-agent-authentication-http.integration.spec.ts`
- `test/a8-agent-lifecycle.integration.spec.ts`
- `test/a9-agent-receiving-number.integration.spec.ts`
- `test/a10-agent-service-capability.integration.spec.ts`
- `test/a11-agent-transaction-authorization.integration.spec.ts`
- `test/a12-agent-financial-execution.integration.spec.ts`
- `test/a13-agent-cash-in.integration.spec.ts`
- `test/a14-agent-cash-out.integration.spec.ts`
- `test/a15-agent-cash-to-cash.integration.spec.ts`
- `test/a16-agent-cash-to-cash-claim.integration.spec.ts`
- `test/a17-agent-cash-to-cash-expiry.integration.spec.ts`
- `test/a19-agent-funding.integration.spec.ts`
- `test/a21-agent-app.integration.spec.ts`
- `test/agent-application-access-migration-upgrade.integration.spec.ts`
- `test/v1-agent-05-transaction-pin-security.integration.spec.ts`
- `test/v1-agent-cash-to-cash-operations.integration.spec.ts`
- `test/v1-agent-credentials-01.integration.spec.ts`
- `test/v1-agent-history-01.integration.spec.ts`
- `test/v1-agent-mfa-api-01.integration.spec.ts`
- `test/v1-agent-mobile-idempotency-persistence-01.integration.spec.ts`

Together these exercise HTTP authentication/session behavior, application/lifecycle and credential controls, MFA and PIN security, capabilities/authorization, funding governance, cash operations, customer-wallet and agent-cash claims, claims/expiry, recovery/idempotency, history/receipts, operational monitoring, and database effects. `a16` specifically includes unauthenticated HTTP claim/receipt recovery rejection, credential/session and PIN requirements for payout, wrong/expired/replayed OTP paths, wrong claimant identity, suspended/ineligible claimant, concurrent/replay races, expiry under lock, and exact-once settlement assertions. `a17` covers expiry and rollback behavior. No test bypassed or weakened production authorization/financial service behavior to pass.

## Financial invariants observed

The executed Cash-to-Cash claim tests assert real persisted state, not just UI mocks:

- Successful customer-wallet or Agent B cash claim transitions a transfer once and posts the intended destination settlement.
- Persisted journal lines balance; the settlement amount, currency, source/unclaimed liability, destination wallet/agent float, and claim journal identity are checked.
- Repeated/replayed claims, same-key idempotent retries, conflicting idempotency requests, and concurrent customer-wallet versus agent-cash claims converge to at most one successful financial effect.
- Rejected OTP, invalid identity/phone, locked transfer, expired claim, missing capability/PIN, ineligible/suspended customer, and other failed claim paths assert no partial financial mutation where covered.
- Agent histories and customer history are checked against the persisted settlement in applicable scenarios.

These are integration-test findings for the executed synthetic cases, not an assertion that every accounting scenario or every possible interleaving has been mathematically exhausted.

## Defects and security observations

- **No new defect was discovered in these 20 targeted suites.** All passed against the integrated branch.
- The claim tests explicitly validate important auth, OTP, replay, expiry and concurrency denials. This run does not constitute independent security review or penetration testing.
- ARENA 1's own sprint report carries forward policy/review items including credential-revocation races during in-flight claims, wallet-mode KYC expiry policy, transfer-code attempt atomicity, expired-fund disposition, and human review around physical cash handover. The targeted green tests do not close these product/security decisions; they remain follow-up blockers for sign-off where relevant. See `docs/ARENA1-ORDINARY-AGENT-V1-BACKEND-SPRINT-20261026.md`.

## Limitations and remaining UAT blockers

- No physical Android/iOS device or emulator was exercised. Agent/customer frontend unit/component tests were not run in this focused PostgreSQL run.
- No external browser/E2E automation was run; `Supertest` drives real app HTTP handlers in-process.
- No live partner, production workforce IdP, SMS provider, customer data, or production funds were used.
- This targeted run is not the full 113-suite regression run. ARENA 3 reports the complete stabilized baseline at 113/113 suites and 2,162/2,162 tests; that result is upstream evidence, not re-executed by ARENA 4.
- Before release/UAT sign-off, run the frontend suites and browser/device journey tests, review outstanding operational/policy items with their owners, and execute the complete PostgreSQL battery on an appropriately sized runner with `PG_TEST_CONCURRENCY=1` when below 8 GB RAM.

## Files changed by ARENA 4

- `docs/A4-ORDINARY-AGENT-UAT-PLAN.md` — preparation scenario and fixture plan.
- `docs/A4-ORDINARY-AGENT-UAT-EXECUTION-20261026.md` — this execution record.

No application service, controller, schema, migration, or pre-existing test implementation was changed by ARENA 4. The automated UAT evidence uses existing integrated test suites; no new feature or financial behavior was introduced.
