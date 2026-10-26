# ARENA 1 — Ordinary Agent V1 backend sprint (2026-10-26)

## Status and scope

Partial backend hardening delivered; **not a UAT or production readiness approval**. Starting baseline: `f90f6ea9b1f90fe38dfa608710d8583e49b04d54`. Work is confined to `arena/92fd33dd-monienaija`. No app frontend files, production migrations, deployment, or other branches were changed. All database execution used the local embedded PostgreSQL integration harness and isolated test databases. The broad regression runner includes Aggregator tests; no Aggregator V2 development was undertaken.

## Delivered changes

1. A17 migration consistency: reproduced 24 passes / 2 failures against baseline. Both failures rejected actual migration `SecureAgentApplicationAccess1785753600095` because assertions stopped at `0090`. Replaced that hard-coded ceiling with exact configured/applied migration-name comparison, pending-migration checks, and explicit presence of `AddExpiryToCashToCash1785753600059`. Renamed the misleading production-readiness test to describe migration readiness only. Production migrations unchanged.
2. Cash-to-Cash claim limit failure: removed swallowed `commitReservationsWithManager` errors. A failure now rolls back the journal, transfer state, and transactional idempotency reservation rather than potentially leaving payout without committed limit usage.
3. Late expiry: the final `UNCLAIMED -> CLAIMED` SQL transition is conditional on `expires_at > clock_timestamp()`. Expiry during ledger/limit waits aborts and rolls back financial posting. `claimed_at` uses wall-clock rather than transaction-start time. This is a posting-transaction check, not a guarantee that expiry cannot pass in the tiny interval before database commit.
4. PostgreSQL regressions for both destinations: inject limit-commit failure, assert no balance change, journal, claim linkage or retained idempotency reservation; retry the same financial request/key using a fresh purpose-bound OTP and prove one journal and exact balance movement.
5. PostgreSQL late-deadline regression: move expiry shortly ahead inside the posting transaction and wait using real `pg_sleep`; assert settlement and journal roll back.
6. HTTP regression: unauthenticated claim and receipt recovery both return 401 without financial settlement.

## Files changed

- `src/agent/agent-cash-to-cash-claim.service.ts`
- `test/a16-agent-cash-to-cash-claim.integration.spec.ts`
- `test/a17-agent-cash-to-cash-expiry.integration.spec.ts`
- `docs/ARENA1-ORDINARY-AGENT-V1-BACKEND-SPRINT-20261026.md`

## Verification evidence

- `npm run build`: PASS after financial changes.
- `npm test`: PASS, 191 suites / 1,959 tests.
- A17 baseline reproduction: 24 passed / 2 failed (obsolete ceiling); corrected A17: 26/26 PASS.
- A16 + A17 after financial changes: 75/75 PASS. A16 rerun after adding explicit retry assertions: 49/49 PASS.
- Final focused HTTP/PostgreSQL run: A16, A21 Agent App, and V1 admin Cash-to-Cash operations: 3 suites / 66 tests PASS (A16 now has 50 tests).
- Broad `npm run test:pg`: **incomplete and failing**, not a passing regression gate. Logs recorded 59 PASS suite results and 30 FAIL suite results before remaining processes were terminated after exceeding the 30-minute tool wait. No final aggregate result is claimed. Observed passing suites include A7 authentication HTTP, A8 lifecycle, A11 authorization, A12 execution, A13 cash-in, A14 cash-out, A15 initiation, A19 funding, Agent PIN security, Agent MFA API, credential rotation, Agent history, mobile idempotency persistence, and Cash-to-Cash commercial snapshots.
- Broad failures include local-admin seed rejecting missing enabled `SUPER_ADMIN` configuration; funding fixtures rejected by Decision 7 `AGENT_NETWORK_MANAGER`/`agent.fund` policy; other migration ceilings and authorization-sensitive fixtures. These are observed error categories, **not proven explanations for every failed test**. Each requires isolated reproduction and baseline comparison before changing code.
- Initial environment attempts failed because dependencies were absent, embedded PostgreSQL library symlinks were missing, and direct Jest invocation lacked DB environment variables. Dependencies/local library links were prepared; tests then used explicit DB variables. An initial unit invocation combining script `maxWorkers` with `runInBand` was invalid; the normal `npm test` invocation passed. During implementation a TypeORM UPDATE result-shape error was caught by A16/A17; corrected using a returning CTE and reran successfully.

Reproduce focused PostgreSQL checks (local test PostgreSQL must be running):

```sh
DB_HOST=127.0.0.1 DB_NAME=monienaija DB_USER=monienaija \
DB_PASSWORD=monienaija-pw NODE_ENV=test PG_TEST_RUN_ID=arena1verify \
npx jest --config jest.integration.config.js --runInBand --runTestsByPath \
  test/a16-agent-cash-to-cash-claim.integration.spec.ts \
  test/a17-agent-cash-to-cash-expiry.integration.spec.ts \
  test/a21-agent-app.integration.spec.ts \
  test/v1-agent-cash-to-cash-operations.integration.spec.ts
```

## Audited existing controls and limits of the evidence

A16 exercises unclaimed-liability debit and destination credit, competing redemption methods, serializable retries, claimant phone ownership, purpose-bound OTP, rejected bare identity-document evidence, expired cash-claim KYC assessment, Agent class/lifecycle rechecks after OTP, Agent PIN denial, audit provenance, own-Agent receipt recovery, and Agent/Customer histories. These tests are evidence for those paths, not complete certification of the platform.

The service locks the transfer `FOR UPDATE` in a SERIALIZABLE posting transaction. Agent-cash lifecycle and class rows use SHARE locks. Authenticated Agent B's wallet is server-selected; client-selected settlement accounts are not accepted. Cash payout uses a current approved KYC assessment, and SERVICE provenance is explicitly retained without claiming human-supervisor verification. Wallet mode requires authoritative APPROVED customer status rather than accepting submitted document rows.

## API handoff for ARENA 2

No endpoint, DTO, response-field, fee, or commission contract was added or removed.

- Late expiry continues to return HTTP 409 with `Transfer has expired and cannot be claimed`.
- Limit-commit errors now fail instead of returning apparent settlement success. UI must not infer success from OTP consumption.
- Existing recovery endpoint: `GET /api/v1/agents/cash-to-cash/claims/:transferId`, authenticated as the same Agent recorded on the claim audit. Successful recovery returns the existing claim result with `status: REPLAYED` and `replayed: true`. A 404 is not itself evidence that a still-running request cannot commit.
- OTP is consumed outside the financial transaction. If settlement definitely rolled back, obtain a fresh claim-purpose OTP and retain the original financial idempotency key and unchanged request fields. Never silently switch redemption method, destination or key after an uncertain response. First attempt committed-claim recovery.
- Existing `AGENT_CASH` mode requires Agent PIN; `CUSTOMER_WALLET` rejects an Agent PIN. This sprint did not change that policy.

## Remaining security/policy blockers and recommended next sprint

1. Establish a reproducible workforce test configuration and triage all broad PostgreSQL failures against baseline. Do not bypass maker-checker or authorization to repair fixtures. Rerun in bounded sequential batches with process supervision; the full run exhausted the practical verification window.
2. Review session/credential revocation and PIN rotation during an in-flight claim: HTTP authentication and cash PIN checks occur before OTP/posting; no transaction-bound Agent session revalidation was added here. Add real authenticated HTTP claim/recovery races, especially credential reissue and logout while OTP is being processed.
3. Review wallet-mode KYC policy: unlike cash mode it checks authoritative APPROVED status but not current-assessment expiry. Decide whether expiry is mandatory for wallet redemption, then implement a consistent gate without inventing a freshness window. Review assessment/customer row locking and expiry passing during ledger waits for cash mode.
4. Review transfer-code attempt counting under simultaneous bad-code submissions: existing pre-check reads attempts then writes an absolute increment. Add concurrency tests and atomic lockout accounting; current coverage does not certify parallel brute-force resistance.
5. Confirm approved physical-handover controls and required human review for AGENT_CASH. A SERVICE-approved assessment is not human-supervisor inspection. Do not authorize UAT cash payout on that assumption. No new handover policy was invented or marked satisfied.
6. Expired-fund disposition, refund authority, fees and commissions require explicit product/compliance decisions. Existing expiry tests establish that liability is retained rather than automatically refunded; this is not a new disposition policy. Keep undefined mandatory operations unavailable rather than manufacturing defaults.
7. Add end-to-end authenticated HTTP positive claims for both methods, response-loss recovery, and reconciliation assertions spanning ledger, limits, history, receipts and audit. Existing service-level tests do not replace a full Mobile/Admin workflow UAT.
8. Verify funding/defunding maker-checker and Agent class changes with correct workforce roles and baseline fixtures, then rerun credential invalidation, financial-position and Admin monitoring flows together.

## Pushed milestones

- `d461915`: stale A17 ceiling replaced, 26/26 A17 passing.
- `073c226a0686b3398b984f5aadbc4237af1f3424`: claim limit rollback and final deadline gate, with PostgreSQL regressions.
- Final HTTP regression and this report are delivered in the subsequent commit on the same assigned branch. Consult `git log` for its SHA.
