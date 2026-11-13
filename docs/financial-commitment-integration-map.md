# Financial commitment integration map

Status: work in progress, not an approval to deploy or submit financial transactions.

## Direction and ownership

* A6 `ExternalOperation` is constrained by its database schema to resource `WITHDRAWAL`, capability `external.wallet.withdrawal.settlement`, and operation `OUTBOUND_BANK_SETTLEMENT`. Its successful settlement debits customer funds and is an outbound financial obligation. New settlement must consume the exact reservation; direct ordinary wallet debits do not establish the required financial commitment.
* A6 suspense and reference records are evidence/reconciliation paths, not authorizations to spend or to release an uncertain reservation. Rejection release requires independent outcome verification and the exact reserved commitment. Existing post-settlement compensation is a recovery path, not a new payment; commitment-linked settlements currently fail closed there until governed commitment recovery is implemented.
* A7 product financial effect accepts `virtual-account.assign` and `virtual-account.inbound-funding`, yet its current implementation maps its SETTLE decision to the outbound A6 withdrawal settlement. Assignment is not a withdrawal; inbound funding should credit the customer, not debit a wallet or require an outbound withdrawal reservation. The existing mapping is not an authoritative inbound settlement implementation. New verified A7 settlement attempts now fail closed before outbound posting; its temporary idempotency reservation rolls back with the transaction. An isolated inbound receipt prototype now exists, but is not connected to A7 or any production module and does not complete that lifecycle. It is not part of the withdrawal reservation mechanism.
* Virtual account assignment in `src/virtual-account/virtual-account.service.ts` is account lifecycle metadata, not inbound payment settlement. Customer funding has its own financial approval and ledger boundary; it is not the A6 outbound withdrawal flow.
* Generic withdrawal HTTP initiation remains disabled. The dedicated customer-self `POST /customers/me/withdrawal-commitments` now routes through the authenticated session, PIN, beneficiary, eligibility, limit, operation and reservation lifecycle. It does not submit to a provider. The registered execution authority is unavailable by default: without both authoritative institutional entitlement and independent destination ownership evidence, the endpoint fails closed before financial execution. The test-only authority is not a production approval.

## Inbound receipt prototype (not accepted or production enabled)

Migration `1785753600142` adds immutable receipt/review evidence and a ledger direction check. The internal `InboundFundingService` has no API, module registration, live provider, or A7 integration. A controlled test verifier models an independently confirmed receipt; it is not provider verification. For a confirmed, eligible test receipt the prototype debits the existing `PAYMENT-SETTLEMENT_ASSET-NGN` asset and credits the recipient wallet liability; for an ineligible or unknown destination, a controlled **test-only** policy allows credit to the existing `PAYMENT-SYSTEM_SUSPENSE-NGN` liability instead. Both entries are balanced, atomic with receipt/audit/outbox, and keyed by provider and reference. A receipt-linked journal cannot be generically reversed without a future governed inbound recovery contract; unrelated governed reversal remains unchanged.

Neither the institution authorization nor suspense policy stub is a production approval. The default implementations of the verifier, institutional authority and suspense policy return unavailable. Before any wiring, Arena 4 must supply authoritative, transaction-fresh settlement-account and destination institution/product authorization (including how unknown destinations are attributed) without provider/aggregator inference. An independently approved suspense policy, its case ownership and resolution lifecycle, and authenticated receipt verification bound to the destination, amount, currency and reference are also required. Currently unavailable/denied authority or policy aborts rather than posting; it does not durably reconcile that confirmed receipt, so this is a known gap. Unknown provider outcomes and conflicting evidence create review evidence, but broader reconciliation, institutional isolation and resolution remain unfinished. In particular, a test-only policy cannot establish approved handling of arrived but uncreditable real funds.

The receipt records cannot be treated as a complete A7 operation lifecycle: assignment is metadata, and a valid funding receipt needs an atomic binding to the corresponding A7 command/lifecycle and its replay semantics. Integration must not reinterpret an assignment as a debit or fabricate an outbound commitment. Review routing must also account for missing or inconsistent evidence and authorize access by institution.

## Historical obligations

Do not backfill authorizations, PIN audit events, destination bindings, or reservations for historical operations. Preserve completed settlement, journal, suspense, and audit records unchanged. A completed operation remains historical evidence; neither the existence of the operation nor a provider reference proves a new obligation.

Pending historical operations without a destination-bound commitment, including those made before migration 0141, cannot be automatically settled or released by the new commitment boundary. Independently established obligations require controlled reconciliation and an approved recovery procedure before any financial action. Pending operations without sufficient evidence remain unresolved. An uncertain provider outcome, including retry exhaustion, is not proof of rejection and cannot by itself release funds. No migration automatically debits a wallet or fabricates an obligation.

## Destination and institution

Migration `1785753600141` records immutable destination evidence for newly created commitments, bound to an active customer-owned bank beneficiary, its version, an active NIP-supported directory bank, and the operation's target reference. The server computes the target reference; a caller cannot supply a preselected target hash. The customer PIN request hash also binds the wallet, customer, amount, currency, and target. The transaction rereads and locks the beneficiary after PIN verification. New commitments require destination evidence at transaction commit. Existing commitments are not retrospectively populated and need reconciliation.

The snapshot intentionally stores an opaque destination reference rather than copying account numbers. A future provider submission must independently resolve the original account and recompute the reference; if the beneficiary has changed or the original destination cannot be safely recovered, submission must fail closed. Beneficiary `verified` is an existing internal record flag and is **not** independent provider verification of account ownership. No provider submission is enabled.

The old `financial_authorizations.institution` value `MONIENAIJA` was a product/operator placeholder, not an authoritative institution. Historical values are preserved as evidence, but must not be interpreted as institutional authority. New internal test-path authorizations store NULL. The eventual shared institutional foundation must supply the legally responsible institution, relevant operator/authority, principal-to-institution entitlement, destination and product scope, and any applicable institution-specific policy and controls. No institution ID, aggregator-as-institution, or default institution is inferred here. Production financial execution must remain unavailable until that integration and trusted destination/provider dependencies are established.

## Latest regression status

After the direction guard, the complete backend run has 236 passing and two failing
suites (18 failing tests). The original 15 A6 fake-fixture failures remain; three
additional A7 unit tests still assert that virtual-account effects post outbound
withdrawals. The complete targeted A6/A7 + commitment/schema/readiness PostgreSQL run
has three passing and two failing suites (36 passing, 24 failing tests). The failing
legacy assertions have not been deleted or skipped. They require genuine outbound
commitment fixtures, historical recovery fixtures, or a separately authorized inbound
financial implementation as appropriate. Two governed ledger reversal PostgreSQL
regression suites passed 29 tests; this does not prove commitment recovery.

A7 replay handling now rejects missing or mismatched stored effect bodies rather than
constructing a synthetic SETTLEMENT_POSTED result. An exact existing replay is
read before the new direction guard, but other existing authority and duplicate checks
may still prevent particular historical replays; preservation of rows is not a claim
that every legacy retry path is operational.

A settled commitment is deliberately not automatically refunded by the current code.
The verifier contract distinguishes settlement and rejection but does not establish
that a previously settled provider payment was later returned or that external funds
are available for restoration. Maker-checker alone is not evidence of such a return.
A safe integration needs a separately authenticated, operation- and amount-bound return
or recovery outcome and an approved accounting policy, composed atomically with the
existing approval, ledger reversal, reserve release, settlement/suspense and execution
records. Until that boundary exists, generic reversals and A6 compensation reject
commitment-linked settled journals rather than restoring funds twice or minting value.

## Inbound prototype checkpoint verification

The full backend run after the prototype still reports 2,824 passed and 18 failed
(236 passed suites, two failed). The targeted A6/A7 plus commitment/schema/readiness
PostgreSQL run reports 43 passed and 24 failed; the 24 legacy A6/A7 failures remain
unresolved. The subsequent focused commitment/schema/migration-readiness PostgreSQL
run passed 35 tests, including inbound exactly-once, eligibility hold, unknown target,
policy/authority/verifier unavailable, conflict, rollback/retry and reversal guard.
Governed ledger reversal PostgreSQL suites passed 29 tests. Full lint and TypeScript
passed; none of these results establishes A7 integration or mission acceptance.

## Stage 1 A6 integration checkpoint

The customer-self withdrawal commitment endpoint and module use the actual commitment
service and server-resolved destination. The new `WithdrawalExecutionAuthority` port is
called while the destination rows are locked, before any new commitment or reservation,
and binds the customer, wallet, beneficiary version, bank/account, target, amount and
currency. Its registered production default returns unavailable; controlled tests override
it. Arena 4 and the destination verification integration must supply independently
authenticated, transaction-fresh authority and a durable institutional binding before any
production execution is enabled. A Boolean authorization alone and the existing NULL
institution column are not a complete institutional foundation. No live submission is
wired or enabled by this change.

The A6 PostgreSQL and commitment/schema/readiness run passed 54 tests, including real
HTTP customer-self initiation, default 503, genuine PIN/session/eligibility/reservation,
replay, wallet substitution, settlement, and rollback. The A6-related unit regression
passed 173 tests across eight suites; its commitment and ledger are service-boundary doubles, not financial
acceptance. Full backend regression has 3 failing A7 unit tests (2,840 passed). The
most recent combined targeted PostgreSQL run before the wiring has 12 A7 failures.
The A6 checkpoint is not overall mission acceptance.
