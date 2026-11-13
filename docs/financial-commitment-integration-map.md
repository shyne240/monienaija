# Financial commitment integration map

Status: work in progress, not an approval to deploy or submit financial transactions.

## Direction and ownership

* A6 `ExternalOperation` is constrained by its database schema to resource `WITHDRAWAL`, capability `external.wallet.withdrawal.settlement`, and operation `OUTBOUND_BANK_SETTLEMENT`. Its successful settlement debits customer funds and is an outbound financial obligation. New settlement must consume the exact reservation; direct ordinary wallet debits do not establish the required financial commitment.
* A6 suspense and reference records are evidence/reconciliation paths, not authorizations to spend or to release an uncertain reservation. Rejection release requires independent outcome verification and the exact reserved commitment. Existing post-settlement compensation is a recovery path, not a new payment; commitment-linked settlements currently fail closed there until governed commitment recovery is implemented.
* A7 product financial effect accepts `virtual-account.assign` and `virtual-account.inbound-funding`, yet its current implementation maps its SETTLE decision to the outbound A6 withdrawal settlement. Assignment is not a withdrawal; inbound funding should credit the customer, not debit a wallet or require an outbound withdrawal reservation. The existing mapping is not an authoritative inbound settlement implementation. New verified A7 settlement attempts now fail closed before idempotency reservation or outbound posting; no inbound payment processor is implemented here. A dedicated independently verified inbound financial boundary is a dependency, not part of the withdrawal reservation mechanism.
* Virtual account assignment in `src/virtual-account/virtual-account.service.ts` is account lifecycle metadata, not inbound payment settlement. Customer funding has its own financial approval and ledger boundary; it is not the A6 outbound withdrawal flow.
* The generic withdrawal HTTP initiation and production partner submission remain disabled. The internal commitment initiation service is deliberately not registered as a production API.

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
has three passing and two failing suites (35 passing, 24 failing tests). The failing
legacy assertions have not been deleted or skipped. They require genuine outbound
commitment fixtures, historical recovery fixtures, or a separately authorized inbound
financial implementation as appropriate. Two governed ledger reversal PostgreSQL
regression suites passed 29 tests; this does not prove commitment recovery.
