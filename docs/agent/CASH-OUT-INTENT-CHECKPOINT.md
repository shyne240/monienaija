# Cash-out product acceptance checkpoint

**Production cash-out remains disabled.** Arena 4's agent affiliation does not establish institutional customer-wallet ownership or financial isolation. The local provider returns `NOT_CONFIGURED`; `MONIENAIJA` is a synthetic fixture sentinel, not an institution or production fallback. Trusted production KYC evidence also remains a fail-closed integration dependency. No deployment, real-money posting, or live-provider call was performed.

## Product behavior

* A changed amount for the same customer can be submitted as an explicit atomic replacement from the pending screen. It shows the old amount and customer ID, explains fresh authorization, persists both operation locators before calling the single supersession issuance API, and does not separately cancel and create. The server serializes replacement against execution, refuses completed intents, revokes old challenges, carries budgets forward, and audits the link.
* An ambiguous replacement leaves both locators durable. A read-only status endpoint confirms only a committed audit link; absence is never interpreted as proof of failure. The client validates the server's replacement customer, amount and currency before transitioning its stored locator. If it cannot establish the result, it retains both and offers reconciliation.
* Receipt recovery uses a current authenticated agent session, authoritative durable execution and ledger evidence, and does not ask for the old OTP. Pending cash-out state is durable on supported native secure storage and fails closed on storage errors. An unresolved item cannot be silently discarded; server-confirmed cancellation, receipt recovery, or a reconciliation handoff is required.
* `POST /agents/cash-out/reconciliation-handoff` creates one non-financial durable handoff per agent and original operation key, snapshots available intent/ledger/institution evidence and a bounded reason, and audits creation. `GET /internal/reconciliation/cash-out/:agentId/:operationKey` requires `reconciliation.view`; it returns the handoff, current status/ledger reference and relevant audit history. It performs no adjudication, refund or balance change. An operation with no server evidence is explicitly represented as unknown, not fabricated. Operations personnel must review handoffs; governed adjudication and closure are deferred.

## Acceptance matrix

`PG` below means `test/batch2c-eligibility.isolated-pg.test.ts`, test **“cash-out rolls back OTP on ledger failure and retries through the real financial boundary”**, with isolated PostgreSQL 16, synthetic data and test notification provider. Assertions are inside one test unless otherwise named.

| Scenario | Result and exact reference |
| --- | --- |
| Wrong amount, currency, wallet, customer, agent, operation | PASS — PG; mismatched-wallet and expired-intent cases use constructed synthetic data. |
| Wrong institution/unresolved/inactive | PASS — `test/cash-out-institution.spec.ts` and controlled-resolver cases in PG; not production Arena 4 integration acceptance. |
| Expired, cancelled or superseded intent/challenge | PASS — PG. |
| Cancellation vs execution, replacement vs execution, concurrent replacements | PASS — PG; whichever contender wins is checked. |
| Unauthorized replacement/cancellation | PASS — PG with another real agent session and invalid session. |
| Customer/destination/operation budgets | PASS for shared counters, budget rollback and inherited operation issuance in PG; same-operation concurrent issuance in **“concurrent cash-out challenge issuance cannot reset the persisted issuance budget”**. Exhaustive cross-destination and multi-generation cases remain untested. |
| Customer API and receipt scope isolation | PASS for intent ID rejected as customer token, valid customer denied recovery route, another agent and invalid session denied, in PG. Full customer API matrix untested. |
| Reauthentication, lost response, exactly-once recovery and resume | PASS — PG exercises the actual mobile API client and pending-state functions bridged to real Fastify routes and PostgreSQL: login, issue, execute with deliberately lost response, logout/revoke, login again, recover, check one execution/two ledger lines, clear pending and start/cancel a new operation. Transport uses `Fastify.inject`, not an emulator or device; secure-store test fallback simulates reconstructed state in-process. |
| Historical receipt and ordinary idempotency deletion | PASS — PG synthetic historical non-active challenge without intent, original execution and ledger references; no balance change. Records without authoritative ownership/evidence need reconciliation. |
| Atomic mobile replacement | PASS — `apps/agent-mobile/__tests__/wallet-to-cash.test.tsx`, **“replacement uses one atomic supersession request and fresh customer authorization”**; PG also exercises server concurrency and revocation. Mobile UI test mocks the API. |
| Ambiguous replacement | PASS — same mobile test file, **“ambiguous replacement survives remount and checks both operation locators”**, and PG verifies replacement-status linkage. This is not a real-device acceptance test. |
| Durable handoff and duplicate prevention | PASS — PG creates and repeats handoff, verifies one row and real mobile-client HTTP handoff after reauthentication. |
| Handoff authorization | PASS — PG invokes controller with and without `reconciliation.view`, and verifies agent HTTP access to internal lookup is denied. Full real-workforce-session HTTP integration is not separately tested. |
| Arena 4 resolver compatibility | PASS for a one-off TypeScript structural assignment check against the exact `ca5b38d5ae01c270ae79c17f0af05ef5cd5be172` source contract, and controlled outcome tests in `test/cash-out-institution.spec.ts`. Runtime integration, locking and revalidation against Arena 4 tables are **not** tested or wired. |
| Ledger rollback and exactly once | PASS — PG transaction rollback, concurrent execution and replay checks. |
| Mobile cancellation, storage failure and recovery | PASS — `apps/agent-mobile/__tests__/wallet-to-cash.test.tsx`, **“unresolved operation only clears after server-confirmed cancellation”**, **“durable storage failure prevents submission”**, and **“lost response then remount and reauthentication recovers without a second submission”**; these UI tests mock the API. |

## Arena 3 integration instructions and boundaries

Arena 4 candidate `ca5b38d5ae01c270ae79c17f0af05ef5cd5be172` exports `AGENT_INSTITUTION_RESOLVER` from `InstitutionModule`. Its `resolve(manager, agentId, {lock:'SHARE'})` returns a discriminated outcome with affiliation, institution and evidence fingerprint; its `revalidateInstitutionResolution` rereads context. `CashOutAgentInstitutionPort` is only a structural bridge until integration; replace the local placeholder/provider with the actual exported contract and token, bind and revalidate its evidence through intent/execution/recovery, and migrate the transitional `MONIENAIJA`-only schema. Do **not** enable production merely because an agent resolves: authoritative institutional wallet ownership, customer isolation and account/ledger enforcement must be integrated first. Arena 3 must validate the combined Arena 1/Arena 4 migration chain and coordinate shared KYC changes.

Migration `1785753600200-CashOutReconciliationHandoffs` was allocated after scanning remote branch inventories; 0120 and 0130–0132 remain unchanged. The isolated PG fixture applies the full **local** migration chain from scratch. The combined Arena 1/4 chain and real-device restart are not validated here. This is an independently testable checkpoint, not production approval.
