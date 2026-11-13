# Cash-to-Cash lifecycle checkpoint

This is **not lifecycle completion**. The accepted Cash-Out checkpoint is unchanged. New Cash-to-Cash funding remains disabled by the production funding authority placeholder; completed initiation replays follow the existing path. Production claim issuance and settlement remain disabled because `CashToCashClaimFinancialContext` fails closed. Test dependency overrides are not production authority.

## Claim authorization implemented

Migration `1785753600201-CashToCashClaimChallengeBindings` records immutable bindings for newly issued challenges; historical unbound challenges are not retroactively trusted. The desk OTP endpoint now requires `transferId` and `redemptionMethod` for a claim. Issuance locks and reads the persisted transfer, its funding journal, unclaimed account, destination wallet and current verified recipient contact. It revalidates the agent session, eligibility, capability and financial context; it binds transfer, funding agent and journal, claimant agent and session, customer and contact, amount, currency, method and institutional evidence fingerprint. The production financial-context adapter intentionally rejects; Arena 3 must connect the actual authority and validate institutional ownership and holds, including both agents and all provided wallet and ledger accounts. No institution is inferred from the caller.

The existing MFA system remains the OTP authority. Issuance and verification use the existing Cash-Out customer, destination and operation budget rows; replacement locks the transfer, charges the existing budget and revokes the prior bound active challenge. The canonical challenge is issued before the binding transaction; failed binding may leave an undelivered, unbound orphan challenge. It cannot authorize a claim because consumption requires a matching binding. No plaintext OTP is persisted. The transaction that checks the binding and budget also consumes the challenge, posts the journal and transitions the transfer; failed OTP attempts commit their counters without a journal, while a failed posting rolls consumption back.

Real PostgreSQL 16/Fastify controlled-dependency testing covers a customer-wallet redemption and an agent-cash redemption, wrong OTP and persistent cross-reissue counters, replacement and expiry, issuance cap, a second transfer with identical recipient and amount, a changed institutional fingerprint, institution outage, eligibility withdrawal and a manual hold, unauthenticated HTTP calls, concurrent claims, injected failure after journal creation, and read-only receipt recovery after session revocation/reauthentication. The agent-cash test sends issuance, claim and receipt requests through Fastify with a real agent session; it overrides only the institutional authority and evidence reader, not claim guards. This is not proof of the production institutional implementation, every HTTP policy combination, concurrent issuance budgets or complete historic evidence handling.

Receipt recovery revalidates the agent session and requires recorded method and request hash; incomplete historical evidence goes to reconciliation instead of inventing a receipt. Claiming historical funded transfers requires a new bound challenge and authoritative context, and no automatic cancellation or release occurs. Existing clients must be updated to supply transfer and redemption method; old unbound challenges fail closed.

## Remaining lifecycle work

1. Integrate and independently test Arena 4's published financial context contract (`684271e9d972edc629d629b73e66cd719d759117`), including genuine ownership, both agents, all ledger parties, cross-institution and hold outcomes; no production default institution. Confirm the shared Cash-Out OTP budget's cross-product policy and operational limits. Complete historic claim and HTTP authorization acceptance.
2. Implement new funding with approved sender/walk-in identity policy, authoritative funding wallet and financial commitment contract coordinated with Arena 1. The production funding stop must remain until authoritative dependencies are integrated; phone matching is not verified identity. Do not treat agent funding as a customer-wallet debit.
3. Define approved cancellation, expiry and reconciliation handoff without inventing entries or restoring uncertain funds. Current expiry marks unclaimed transfers expired under row lock but does not return funds; expiry is not evidence of repayment. Preserve unresolved obligations.
4. Implement mobile initiation and claim recovery and reauthentication, durable receipts, complete PostgreSQL and HTTP acceptance, mobile harness and full regressions. No customer-wallet-funded Cash-to-Cash is introduced.

No deployment, live provider, or real financial transaction was used. Local migration inventory was rescanned before allocation; re-scan before future allocations in 0200–0299.

### Funding authorization integration seam

New initiation passes a transaction manager and material request, sender evidence reference,
agent principal and actual wallet/ledger identifiers to the funding authority before posting.
The reference and purpose are untrusted lookup inputs, not identity or authorization proof;
no sender identity policy, institution isolation, or commitment authority is supplied by this
change. The registered production implementation still rejects all new funding. Completed
idempotent replays remain available without invoking the new-funding authority. A real adapter
must resolve and lock authoritative evidence and any commitment within the same transaction,
validate the precise request and institution, and reject unavailable or stale evidence. This is
an integration contract, not proof that funding is safe to enable.

### Stage 2 funded-obligation evidence checkpoint

Migration `1785753600202` adds immutable evidence for new funding only. Within the existing
SERIALIZABLE initiation transaction the authority must return valid opaque identity, policy,
institution and funding-authorization fingerprints; the service locks the active AGENT wallet,
posts the existing agent-debit/unclaimed-liability-credit journal, inserts the transfer and
records the journal and wallet links and those fingerprints before idempotency completion.
This does not create a second debit or reservation and does not backfill historical transfers.
The production authority still rejects initiation. The test authority is controlled, not an
approved policy or evidence source. This is not a completed initiation lifecycle: authoritative
adapters and real PostgreSQL initiation/rollback/concurrency acceptance are still required.
Expiry keeps the principal in the unclaimed liability; cancellation or release cannot be
implemented safely without an approved disposition authority and accounting policy.

### Controlled HTTP funding-to-claim acceptance

The isolated PostgreSQL/Fastify test now initiates an agent-funded transfer via the real
HTTP route, issues its transfer-bound challenge, redeems it via HTTP, and recovers the
receipt. The synthetic server-side funding authority checks an explicitly provisioned
sender/recipient policy fixture and the locked agent wallet; it is not the production
identity, policy or institutional authority. Real session, PIN, service capability, claim
and HTTP guards remain in place. The test checks one original wallet debit, the linked
immutable evidence, one unclaimed-liability debit on claim, initiation replay/conflict,
insufficient balance, concurrent over-spend, failed sender policy, and rollback after
journal and evidence insertion. The complete isolated suite passes 14/14. The existing
controlled claim institution and KYC providers are likewise not production integration.
This does not establish cancellation, mobile recovery, historical recovery or the full
acceptance matrix.
