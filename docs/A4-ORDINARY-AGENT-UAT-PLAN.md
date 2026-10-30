# Ordinary Agent V1 — End-to-End UAT Plan

**Owner:** ARENA 4 (UAT / integration evidence)
**Status:** Plan completed; targeted real-PostgreSQL UAT executed on integrated baseline. See [`A4-ORDINARY-AGENT-UAT-EXECUTION-20261026.md`](A4-ORDINARY-AGENT-UAT-EXECUTION-20261026.md) for exact evidence and limitations.
**Integrated baseline:** `18bfb8c6200f10e544f4c864f9b8ad2af3c20385` from `arena/8e59e188-monienaija`, incorporated by normal merge into ARENA 4 branch. The earlier inspected baseline `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` did not include either sprint.
**Safety:** Synthetic accounts and an isolated disposable database only. No production endpoints, credentials, or customer funds.

## Objective and evidence standard

Exercise Ordinary Agent V1 across real HTTP boundaries and persisted state. Each critical-path test must capture the request/response, relevant database rows, and before/after ledger/journal evidence. UI-only mocks are not sufficient evidence. The harness will use the repository's Jest/Supertest and PostgreSQL integration infrastructure where compatible with the integrated implementation. Tests must refuse to run against an explicitly production-like environment and must use isolated fixtures/database configuration.

## Scenario matrix

| Area | Planned scenarios | Required evidence / pass criteria |
|---|---|---|
| Application / activation | Submit synthetic agent application; review/approve and activate through authorized workforce workflow; reject unauthenticated and unauthorized roles | HTTP status/body; application and activation state; audit actor/action; no activation via public/readiness-only interface |
| Credentials | Issue initial credential; authenticate; rotate credential; old credential rejected, new credential accepted; revoked session rejected | Credential lifecycle records/response; session and audit persistence; secrets never logged or stored in broad audit payload |
| Authentication / MFA / PIN | Agent authentication and required MFA; setup and verify transaction PIN; incorrect and locked PIN denied | Actual auth/MFA/PIN responses and persisted state/counters; protected actions fail closed |
| Capabilities / limits | Read effective capabilities and limits; attempt operation above each applicable limit | Effective policy response and denial; no claim, reservation, or financial posting on denial |
| Funding | Submit funding request; approve with independent maker/checker; same actor cannot approve own request; insufficient authority denied | Request/approval rows, distinct maker/checker identities, audit trail, and resulting agent balance/ledger evidence |
| Cash-to-Cash success | Agent A initiates claim for synthetic customer; customer redeems into wallet; Agent B completes cash redemption | Each valid claim results in exactly one correct settlement; expected amount/currency/identities; balanced ledger lines and transaction history/receipt |
| Claim abuse | Wrong/expired OTP, replay, duplicate claim, concurrent redemption, insufficient limit, expired claim | Stable rejection; no partial journal, duplicate settlement, or unintended balance/limit movement; concurrency creates at most one successful claim |
| Ambiguous outcome / idempotency | Simulate response loss after server commit, retry same idempotency key; retry without/with conflicting key | Retry returns original outcome or safe pending state; exactly one settlement and no duplicate journal/receipt; conflicting payload rejected |
| Rollback / expiry | Expire claim and exercise settlement failure/rollback path | Correct terminal state; compensating/reversal entries only where contract requires; no orphan reservation or unbalanced journal |
| History / receipts | Agent A and B query their own history and receipts; cross-agent access denied | Response fields reconcile with persisted transaction and ledger; authorization is tenant/agent scoped |
| Admin / audit | Authorized admin monitoring and audit queries; unauthorized workforce role denied | Read-only monitoring matches transaction state; immutable/correlated audit events exist without OTP/PIN/credential secrets |
| Reconciliation | Recompute expected balances and settlement counts independently from persisted journal lines | Debits equal credits per journal/currency; wallet and agent movements conserve value; exactly one settlement per successful claim; zero postings for failed claims; no unexplained suspense/partial financial effect |

## Reusable isolated fixtures

- Disposable PostgreSQL database/schema created for the suite; migrations applied using the integrated branch's documented migration path; teardown guaranteed in `afterAll`/finally.
- Synthetic customer C with a provisioned NGN wallet and no real PII.
- Synthetic Agents A and B with distinct principals, credentials, PINs, sessions, capabilities, limits, and cash balances.
- Separate workforce maker, checker, permitted admin, and unauthorized workforce principal; maker/checker identities must be distinct.
- Deterministic OTP/MFA test adapter or test-only challenge inspection supported by the implementation. Never persist reusable production OTPs.
- Fixed clock/claim expiry controls and per-test idempotency/correlation keys.
- Ledger snapshot helper that independently sums persisted debit/credit lines and captures relevant balances, reservations, settlement records, claims, and audit rows.

Fixtures and adapters must be selected after inspecting the actual integrated implementation; this plan does not assume routes, entities, table names, or adapter seams.

## Execution gates

1. Obtain ARENA 3 integrated branch URL and full commit SHA.
2. Fetch and verify the commit from its remote; confirm it contains the completed backend and frontend sprint ancestry/content. Only fast-forward this branch if the integrated commit is a valid descendant and the operation preserves the assigned branch; never reset or alter another branch.
3. Inspect actual API contracts, migrations, test harness, and test-only seams at that commit; adapt scenario map before writing implementation-specific tests.
4. Implement test-owned harnesses/specifications and synthetic fixtures only. Do not change application financial services or product features.
5. Run unit/integration suites and the UAT suite against isolated local PostgreSQL; record exact commands/results and environment limitations.
6. Report defects with request/response, fixture, database/ledger evidence, and reproduction steps to the responsible agent. Do not claim UAT complete without real-browser/device checks where those are required and available.

## Current infrastructure observations (pre-integration)

- Root backend uses Jest (`npm test`) and has a PostgreSQL integration command (`npm run test:pg`) with `test/support/pg-harness.ts`.
- Existing integration examples include payment, transfer, workforce-session, migration-chain, and financial-invariant specs.
- Admin web and customer mobile have separate Jest suites; their existing tests are primarily component/store-oriented.
- `docker-compose.yml` provides PostgreSQL 16. All credentials/configuration in `.env.example` are local placeholders; tests must not inherit production configuration.
- No Ordinary Agent/Cash-to-Cash-specific UAT suite is present in the assigned baseline inventory.

## Blockers / non-claims

- Integrated implementation SHA and branch URL have not yet been provided; implementation-specific automation is intentionally not started.
- No tests have been executed for Ordinary Agent V1, no physical device or live browser has been tested, and no live financial environment is available or appropriate.
- This preparation plan is not UAT sign-off and does not attest that the feature exists or is launch-ready.
