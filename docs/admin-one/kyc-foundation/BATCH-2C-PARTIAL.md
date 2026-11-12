# Batch 2C: partial financial boundary — not production ready

This is **not complete Batch 2C** and must not be represented as an end-to-end financial-access boundary. The production trusted-evidence reader remains unavailable. Consequently the new checks fail closed even for otherwise approved customers; deployment would disrupt existing financial services. No provider calls, notifications, real transactions, deployment or merge were performed.

## Implemented boundaries

`CustomerFinancialEligibilityService` uses the existing tier evaluator and governed policy, locking the customer and rejecting synthetic customers, holds, identity conflicts, missing verified primary phone, unavailable evidence and missing/expired/unsupported approved assessments. Controlled evidence snapshots in isolated tests are test-only, not provider verification. Activation and wallet provisioning reuse this gate.

Migration 0116 preserves wallet and ledger rows, classifies only unambiguous canonical customer and agent UUID relationships, marks all other ownership `REVIEW`, and guards ownership against changes. Journal posting checks the actual wallet-linked ledger accounts inside its transaction, rather than trusting caller-supplied owner type: customer wallets require current eligibility; separately classified agent wallets retain their separate authorization paths; review/mismatched wallets are blocked. Cash-to-Cash cash-payout claiming separately checks the customer because its journal need not contain a customer wallet. External outbound operation creation checks that customer, wallet and ledger account match and checks current eligibility; entering `SUBMITTING` rechecks them. Recovery/status verification transitions do not require that check. The partner layer currently contains no provider dispatch call; no external provider was invoked.

OTP/passcode sign-in issues a short-lived `customer-api` session only when currently eligible; otherwise it issues the existing restricted `customer-onboarding` session. Financial session issuance, validation and rotation recheck eligibility. Mobile persists the eligible financial session. Existing expiry/revocation checks remain; conditional updates prevent a stale validation or competing rotation from resurrecting/replacing a revoked session. Onboarding-created sessions additionally recheck credential version and status. Financial operations are rechecked independently of session claims.

## Unresolved gaps and risks

- **Potential customer financial-access bypass remains:** Cash-to-Cash initiation accepts an optional sender phone and uses agent/suspense ledger accounts, without an authoritative customer relationship or customer eligibility check. The later registered-customer claim gate does not establish eligibility of a customer initiating the cash transaction. Whether and how to identify the sender without breaking legitimate assisted/unregistered workflows requires a domain decision; this path must not be considered covered.
- No authoritative system/operational wallet relationship or governed legacy resolution exists. Noncanonical references, system wallets and collisions are restricted as `REVIEW`; this may disrupt legitimate operations and needs a safe, audited migration/resolution process. Classification is not a full owner model.
- Existing ledger idempotent journal replay returns before the eligibility boundary, including unique-race recovery and reversal replay paths. It does not post another journal itself, but downstream side effects on a replay have not been proved impossible. Exact reversal support described below has focused coverage; broader refund and accounting-correction paths remain unproven.
- Full AppModule acceptance for the actual Cash-In, Cash-Out, Cash-to-Cash, Transfer, internal/admin/background, replay, reversal and session race flows has not been established. Existing legacy ledger tests use a documented no-op boundary fixture and are not evidence of KYC enforcement. Provider-evidence synchronization, lock order and revocation races require further proof.
- External-operation checks prove customer/wallet/ledger consistency, not that every supplied withdrawal resource and amount matches its originating transaction. Full authoritative transaction linkage remains necessary before any provider integration.
- Production evidence provenance, role separation, regulatory requirements, provider contract, retention, deployment and historical compatibility need independent review. New-customer production completion remains unavailable.

## Verification

Backend unit/regression Jest: 237 suites / 2,825 tests passed. Backend TypeScript and lint passed. Mobile: 14 suites / 122 tests and mobile TypeScript passed. Isolated PostgreSQL 16.14: 8 suites / 87 tests passed using a disposable cluster; focused full-AppModule eligibility tests also exercised external-operation ownership and revoked-evidence submission denial. These tests use controlled snapshots and manually approved assessments, not live KYC. Historical unknown/colliding wallet rows are preserved and restricted. Synthetic evidence remains restricted.

The standard PostgreSQL integration run was attempted against an independently verified disposable loopback cluster with a Node egress guard. It did **not** pass or finish: 21 suites failed and 7 passed before Jest exhausted its heap and aborted. Many failures arose because older fixtures assume customer-wallet provisioning succeeds without trusted evidence, which the fail-closed reader now refuses. The suite requires controlled trusted-evidence fixture adaptation and a bounded/chunked rerun; these results do not prove retained transaction safeguards. The guard is test-process protection, not OS-level network isolation.

## Consolidation increment

Authorized reversal and settlement-compensation consumers can reverse a previously posted journal after suspension only when the new journal exactly inverts every immutable original line, with the same currency and accounting unit. Ordinary posting does not acquire the recovery exemption merely from a reversal ID. Existing balance, account-active and uniqueness checks remain. Compensation also checks that operation, customer, wallet, account, amount, currency and suspense all refer to the same operation. The recovery APIs still depend on their calling domains' authorization; the generic HTTP ledger posting route is disabled and the workforce reversal route retains maker/checker approval. This does not prove that every internal consumer or non-reversal refund path is safe.

Missing or invalid governed policy now produces a fail-closed eligibility conflict; a verified mobile sign-in remains restricted rather than gaining financial scope or raising an unhandled policy error. Other unexpected infrastructure errors are not swallowed.

The real-PG full-AppModule controlled-reader fixtures for Cash-In, Cash-Out and Cash-to-Cash claiming now provide explicit test-only verified evidence and approved assessments. Controlled tests deny new existing-wallet transactions after evidence withdrawal. A separate settlement PG test verifies compensation integrity and rejects a mismatched suspense. The Cash-to-Cash initiation path is an agent-cash operation debiting an agent wallet, not a customer-wallet funded operation: its phone locator is not authenticated identity, and cannot establish customer eligibility. Customer-funded initiation, customer identity proof and a safe distinction from unregistered/assisted cash senders remain unresolved.

The standard PostgreSQL runner now defaults to single-file, single-worker batches, validates batch/concurrency parameters, and reports a terminating signal and potentially incomplete files. Batching bounds Jest/Nest heap accumulation, but does not fix obsolete fixtures or prove leak-free operation. The cluster is explicitly verified and per-process database namespaces are cleaned; an interrupted run may require cleanup.

Focused verification after these changes: backend unit regression 237 suites / 2,825 tests; mobile 14 / 122 and mobile TypeScript; backend TypeScript and lint; isolated full-AppModule PG16 8 / 88; focused standard PG A13/A14/A15/A16 4 suites / 177 tests; and settlement PG 1 / 14. The settlement fixture still uses the explicitly documented no-op wallet boundary and is not proof of KYC enforcement. The isolated PG test uses the real boundary to test replay, suspension, refund/reversal and rejection of an ordinary forged reversal payload.

### Full standard PostgreSQL run

A complete 138-file PostgreSQL 16 run used one file per Jest process and concurrency 2 against the independently verified disposable server. It finished without a reported signal or heap abort: **75 suites passed, 63 failed; 1,832 tests passed and 677 failed**. This run was before the subsequent missing-policy error normalization and three migration-head test corrections, so it is not a full regression of the final tree. No database other than `postgres`, `template0`, and `template1` remained afterward. The follow-up A8, A19 and A20 runs passed after their stale migration-head assertions were corrected; A23 was rerun and still failed 13 tests, now returning 409 rather than 500 for a missing policy.

Failure categories include legacy fixtures lacking a controlled trusted-evidence policy/assessment/verified phone; opaque wallet identifiers restricted to REVIEW; tests expecting a financial session where policy/evidence is absent (including HTTP status mismatches); migration-upgrade and head assertions that predate migrations 0104–0116; and other failures requiring individual investigation. Do not assume all 63 are fixture-only. Controlled readers were added only to the explicitly adapted suites, not globally.

Exact failed suite paths from that complete run (three later corrected as noted):

- `test/v1-hardening-01-customer-beneficiary.integration.spec.ts`
- `test/v1-commercial-accounting-01.integration.spec.ts`
- `test/v1-commission-runtime-wiring.integration.spec.ts`
- `test/v1-commercial-scenario-matrix-01.integration.spec.ts`
- `test/a23-customer-app.integration.spec.ts`
- `test/v1-customer-onboarding-01.integration.spec.ts`
- `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts`
- `test/a24-customer-transaction-pin-hardening.integration.spec.ts`
- `test/v1-commercial-decision-02-pilot-snapshot.integration.spec.ts`
- `test/a25-customer-history-hardening.integration.spec.ts`
- `test/v1-commission-settlement-01.integration.spec.ts`
- `test/transfer-notification-producer-01.integration.spec.ts`
- `test/v1-commercial-decision-03a-cash-to-wallet-snapshot.integration.spec.ts`
- `test/a12-agent-financial-execution.integration.spec.ts`
- `test/v1-commercial-decision-03d-customer-funding-snapshot.integration.spec.ts`
- `test/v1-commercial-decision-03c-cash-to-cash-snapshot.integration.spec.ts`
- `test/v1-limit-05-flow-matrix.integration.spec.ts`
- `test/hardening-04-customer-transaction-history.integration.spec.ts`
- `test/notification-reliability.integration.spec.ts`
- `test/a17-agent-cash-to-cash-expiry.integration.spec.ts`
- `test/v1-005-notification-delivery.integration.spec.ts`
- `test/v1-006-customer-notification-inbox.integration.spec.ts`
- `test/v1-fee-runtime-wiring.integration.spec.ts`
- `test/v1-001-customer-funding.integration.spec.ts`
- `test/v1-agent-history-01.integration.spec.ts`
- `test/v1-commercial-decision-03b-wallet-to-cash-snapshot.integration.spec.ts`
- `test/v1-limit-04-limit-runtime.integration.spec.ts`
- `test/v1-003-admin-operational-writes.integration.spec.ts`
- `test/a26-customer-profile-hardening.integration.spec.ts`
- `test/v1-agent-mfa-api-01.integration.spec.ts`
- `test/a14-otp-hardening.integration.spec.ts`
- `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`
- `test/sms-v1-01.integration.spec.ts`
- `test/a8-agent-lifecycle.integration.spec.ts`
- `test/mission-25g-customer-preference-authorization.integration.spec.ts`
- `test/v1-agent-05-transaction-pin-security.integration.spec.ts`
- `test/v1-customer-05-transaction-pin-security.integration.spec.ts`
- `test/batch-01-customer-servicing.integration.spec.ts`
- `test/v1-customer-credentials-01.integration.spec.ts`
- `test/v1-agent-mobile-idempotency-persistence-01.integration.spec.ts`
- `test/v1-customer-onboarding-02.integration.spec.ts`
- `test/v1-harden-01-support-adversarial.integration.spec.ts`
- `test/v1-ops-01-support-workforce-operational.integration.spec.ts`
- `test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts`
- `test/v1-admin-customer-pii-authorization-implementation-01.integration.spec.ts`
- `test/v1-w2w-recovery-audit-01.integration.spec.ts`
- `test/notification-migration-upgrade-01.integration.spec.ts`
- `test/final-integration-gates-focus.integration.spec.ts`
- `test/v1-mobile-idempotency-recovery-01.integration.spec.ts`
- `test/mission-16a-agent-read-authorization.integration.spec.ts`
- `test/v1-system-01-suspended-customer-financial-boundary.integration.spec.ts`
- `test/h04-h06-notification-upgrade.integration.spec.ts`
- `test/mission-25o-credential-binding-upgrade.integration.spec.ts`
- `test/v1-admin-authorization-customer-read-01.integration.spec.ts`
- `test/v1-admin-authorization-hardening-01.integration.spec.ts`
- `test/v1-admin-authorization-kyc-01.integration.spec.ts`
- `test/v1-007-support-ticket.integration.spec.ts`
- `test/customer-compliance-authorization.integration.spec.ts`
- `test/v1-limit-02-limit-assignment.integration.spec.ts`
- `test/v1-customer-08-limits-view.integration.spec.ts`
- `test/a20-outlets-terminals.integration.spec.ts`
- `test/p0-p1-security-remediation.integration.spec.ts`
- `test/a19-agent-funding.integration.spec.ts`

The production reader is still unavailable and no provider verification or network call was performed. The current tree still requires a full standard-suite rerun and fixture-by-fixture repairs; this run does not establish Batch 2C completion.
