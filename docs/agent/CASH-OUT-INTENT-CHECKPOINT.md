# Cash-out lifecycle acceptance checkpoint

**Not production accepted.** The default `CashOutInstitutionResolver` rejects; `MONIENAIJA` is only a controlled test scope and is not proof of institutional affiliation. Arena 4 must supply authoritative institution and affiliation resolution and reconcile the scope schema. The trusted production KYC evidence reader also fails closed. No new migration was added. The local full migration chain is applied from scratch in the PostgreSQL fixture; the combined Arena 1/4 integration chain is not validated here.

## Behavior

The OTP issuance API accepts an explicit `supersedesOperationKey` on a replacement cash-out. The authenticated agent, customer, transitional institution, active old intent, changed material details and new operation key are checked. Cancellation, challenge revocation, replacement creation, budget inheritance and audit are in one transaction; execution and challenge issuance lock the same intent. Agent cancellation of an unresolved operation is also transactional and cannot cancel completed executions. The client clears a pending submission only after recovery or server-confirmed cancellation. When neither is possible, it links to a prefilled support ticket and retains the pending state for reconciliation.

Recovery is read-only and derives the outcome from durable execution, journal, ledger lines and challenge evidence, including a pre-intent challenge; no original OTP or active historical challenge is required. Absent authoritative evidence, ordinary retrieval is denied. A support ticket is not itself a governed reconciliation decision, and there is no automated support adjudication that clears a record without server-confirmed cancellation or receipt.

Cash-out persistence uses valid Expo SecureStore key characters and fails closed on storage errors rather than silently using volatile memory. No OTP or PIN is stored. A web client without durable native storage fails closed. The mobile recovery UI still depends on the agent re-entering the original customer and amount to display a receipt; a mismatched entry offers cancellation or support. Material replacement is available in the server contract but is not wired as an atomic replacement UX in mobile.

## Scenario matrix

The principal PostgreSQL test reference below is `test/batch2c-eligibility.isolated-pg.test.ts`, test **“cash-out rolls back OTP on ledger failure and retries through the real financial boundary”**, unless otherwise named. It runs against isolated PostgreSQL 16 with synthetic data and a test notification provider. Several scenarios are assertions inside this single test, not individually named tests.

| Scenario | Status and exact reference |
| --- | --- |
| Wrong amount, currency, customer, operation, agent and wallet | PASS, principal PostgreSQL test; wallet is a deliberately constructed synthetic mismatched intent. |
| Wrong institution, unresolved affiliation, suspended institution | PASS for controlled resolver rejections in principal PostgreSQL test. These are not Arena 4 integration acceptance. |
| Expired intent, cancelled intent, superseded challenge | PASS, principal PostgreSQL test (synthetic expired intent and revoked challenge). |
| Cancellation vs execution; supersession vs execution; concurrent supersessions | PASS, principal PostgreSQL test. Outcomes are asserted for whichever contender wins. |
| Unauthorized cancellation/supersession | PASS, principal PostgreSQL test with another authenticated agent and invalid session. |
| Customer, destination and operation OTP budgets | PASS for shared counters and inherited operation issuance in principal PostgreSQL test; same-operation concurrent issuance in **“concurrent cash-out challenge issuance cannot reset the persisted issuance budget”**. Exhaustive cross-destination substitution and every supersession-chain budget permutation are not covered. |
| Scoped authorization isolation | PASS for intent identifier rejected on a customer HTTP route, and valid customer session rejected on the agent recovery HTTP route; principal PostgreSQL test. Full customer API matrix is not covered. |
| Reauthentication and unauthorized receipt retrieval | PASS for a newly inserted authenticated agent session through the recovery HTTP route and another agent/invalid session denial in principal PostgreSQL test. Actual login-to-mobile-to-backend end-to-end automation is not covered. |
| Historical pre-intent receipt | PASS for a synthetic historical session/challenge derived from an existing durable execution in principal PostgreSQL test; no balance change. Other historical records without the durable binding require governed reconciliation. |
| Ordinary idempotency-record deletion | PASS, principal PostgreSQL test. |
| Rollback and exactly-once | PASS for ledger failure rollback, successful concurrent execution and replay in principal PostgreSQL test. |
| Mobile ambiguity, remount and recovery | PASS, `apps/agent-mobile/__tests__/wallet-to-cash.test.tsx`, **“lost response then remount and reauthentication recovers without a second submission”** and **“2. restart recovers the original receipt without new authorization”**. These mock the mobile API and simulate reauthentication; they are not a real-device or full-stack end-to-end test. |
| Mobile controlled cancellation and durable storage failure | PASS, same file, **“unresolved operation only clears after server-confirmed cancellation”** and **“durable storage failure prevents submission”**. Missing-intent reconciliation adjudication is not implemented. |

No Cash-to-Cash work, deployment, real money movement or live provider calls were performed. Shared KYC eligibility changes require Arena 1 coordination.
