# ADR-0086 — B2 Finance Journal Governance and Controlled A5 Posting

- **ADR ID:** ADR-0086
- **Platform:** B2 — Finance Platform
- **Task:** B2F05
- **Status:** Accepted; bounded internal runtime implemented
- **Contract:** [`docs/B2F-JOURNAL-GOVERNANCE-CONTRACT.md`](../B2F-JOURNAL-GOVERNANCE-CONTRACT.md)
- **Migration:** `1785753600047-CreateB2FFinanceJournalGovernance.ts`

## Context

A5 already provides safe canonical posting through `LedgerService.postJournal()`: balanced immutable journals/lines, canonical account validation, deterministic idempotency, locking, balance invariants, and durable replay. B2F04 provides Finance period admission. B2F03 defines classification/mapping semantics but has no durable mapping registry.

Finance needs governance, source/period/classification validation, approval, provenance, unknown-outcome handling, and an explicit A5 boundary without becoming a ledger.

## Decision

1. Persist `b2f_finance_journal_governance` as a Finance control/provenance record, not a journal of record.
2. Use states `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `POSTING_REQUESTED`, `POSTED`, `FAILED`, and `POSTING_UNKNOWN`.
3. Validate source hash/reference, balanced positive minor-unit lines, A5 UUID/account compatibility, Finance classification/mapping-reference shape, frozen dimensions, and B2F04 admission before persistence.
4. Consume A2 privileged approval bound to exact journal fingerprint before A5 posting.
5. Call only `LedgerService.postJournal()` for value movement; persist A5 journal ID/time as provenance.
6. Use deterministic A5 idempotency key derived from immutable Finance request hash. Resolve unknown outcomes by retrying the same A5 semantic request/key.
7. Use shared Operations idempotency, audit, and outbox. Publish posted event only after A5 confirmation.
8. Use serializable transactions, pessimistic locks, expected versions, optimistic versions, and unique A5 provenance.
9. Expose only an internal read-only status/result/provenance consumer port.
10. Create no controller, public API, balance, ledger line, account, reversal, external communication, or later-platform behavior.

The existing A5 interface is sufficient; no A5 change is required. It lacks direct lookup by idempotency key, but same-key replay safely returns the durable journal.

B2F03 mapping limitation remains: B2F05 checks mapping-reference shape and A5/classification compatibility but cannot resolve a persisted approved mapping. Production use is blocked pending a durable mapping consumer. Final materiality thresholds remain B2F06 work.

## Consequences

- A5 remains the sole journal/value/balance authority.
- Finance can distinguish intent, approval, submission, confirmed posting, rejection, and unknown outcome.
- Retry after timeout cannot double-post if A5 semantics remain unchanged.
- Governance JSON line intent is not financial truth; A5 lines are authoritative.
- Successful posting is auditable and emits an internal outbox fact only after confirmation.
- Production activation requires durable mapping verification and final Finance controls.

## Alternatives rejected

- Direct inserts into A5 tables: duplicates/bypasses A5.
- A second Finance journal/line ledger: competing value authority.
- Mark timeout as failed or posted: fabricates certainty.
- Generate compensating journal automatically: bypasses correction governance.
- Public controller/API: belongs to B10 and is unnecessary.
- New audit/idempotency stores: duplicates Operations.

## Verification

- [x] ADR-0086 follows ADR-0085; no renumbering.
- [x] A5 posting boundary is called rather than reimplemented.
- [x] Period, source, classification/account, approval, balance structure, replay, unknown result, audit, outbox, and concurrency controls implemented.
- [x] No balance or second journal-of-record exists.
- [x] No B1/A6/A7/Treasury/Reporting/Statement/IAM/API/frontend authority introduced.
