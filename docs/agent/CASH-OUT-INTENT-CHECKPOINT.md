# Cash-out lifecycle checkpoint — incomplete, not integration-ready

The existing intent, challenge, durable execution and OTP-budget migrations 0120 and 0130–0132 remain unchanged. `MONIENAIJA` is a transitional fixture scope, **not** evidence of institutional affiliation. The injectable institution resolver fails closed in production; Arena 4 must supply authoritative membership and reconcile the current schema before production use. No institution is accepted from the request. The production trusted KYC evidence reader also remains unavailable.

A read-only receipt recovery endpoint checks the authenticated agent and current session, durable execution, posted journal, customer debit and agent credit, challenge and (when present) completed intent. It derives details from server records, never consumes OTP or posts money. It requires the institution resolver, including for historical records without an intent. It does not recover records absent durable execution evidence: those require governed reconciliation. Real PostgreSQL coverage checks recovery after idempotency record deletion, a new agent session, wrong agent, invalid session and nonexistent operation. Historical no-intent recovery and HTTP authorization isolation have not been accepted.

The mobile screen keeps the operation identifier (not OTP/PIN), offers recovery after an ambiguous outcome or restart, blocks new authorization when a pending cash-out exists, and retains cash-out pending records beyond the generic 24-hour expiration. A pending operation with different details requires return to the original details or support. This is a partial workflow: there is no independent pending-operations screen, no governed resolution when no receipt exists, and reauthentication/navigation end-to-end acceptance is still needed.

## Remaining blockers

* Authorized material-detail supersession, audit, invalidation, budgets and cancellation/execution concurrency are not implemented. Unverified cancellation was deliberately not exposed.
* Requested exhaustive real-PG wrong amount/wallet/customer/agent/operation/currency, expired/cancelled intent, superseded challenge, concurrency, cross-scope customer API, legacy receipt and mobile ambiguity acceptance are incomplete. Institutional isolation cannot be tested until Arena 4 provides authoritative membership and compatible schema.
* Reconcile migration chain with Arena 1 (0117, 0140) and Arena 4 (0118); no new migration was allocated. Shared KYC eligibility changes need Arena 1 coordination.
* Do not deploy or treat this as lifecycle acceptance. Cash-to-Cash is outside this work.
