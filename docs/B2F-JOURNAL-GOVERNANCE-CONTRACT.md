# B2F05 — Finance Journal Governance and Controlled A5 Posting Interface

- **Platform:** B2 — Finance Platform
- **Contract:** `B2F-JOURNAL-GOVERNANCE` v1
- **ADR:** [`ADR-0086 — B2 Finance Journal Governance and Controlled A5 Posting`](ADR/ADR-0086-B2-Finance-Journal-Governance-and-Controlled-A5-Posting.md)
- **Status:** Internal runtime implemented; no public API
- **Migration:** `1785753600047-CreateB2FFinanceJournalGovernance.ts`

## 1. Purpose and authority

B2F05 implements Finance journal governance and provenance around the existing A5 `LedgerService.postJournal()` boundary. B2 records accounting intent, source, period, classifications, approval, request hashes, state, and the resulting A5 journal reference. A5 alone creates the journal/lines of record, changes financial value, derives balances, enforces posting invariants, and executes reversal.

`b2f_finance_journal_governance` is explicitly a **Finance governance record**, not a ledger journal or second journal of record. It stores immutable submitted line intent as JSON for control/provenance but has no balance and cannot be posted directly.

## 2. Existing A5 interface decision

The existing A5 interface is sufficient for this bounded task:

- `LedgerService.getAccount()` validates canonical A5 UUID/type/normal balance/currency/unit/active state.
- `LedgerService.postJournal()` accepts an idempotency key, dimensions, provenance metadata, and balanced line commands.
- A5 compares a deterministic request fingerprint on retry and returns the original durable journal for the same idempotency key/payload.
- A5 rejects changed payload, invalid/inactive accounts, dimensional mismatch, unbalanced lines, insufficient balance, and duplicate reversal.
- A5 returns canonical journal ID, posted time, and lines.

A5 does not expose lookup by posting idempotency key. B2F05 therefore resolves an uncertain result by retrying the **same semantic A5 request with the same deterministic A5 idempotency key**. A5's existing replay behavior prevents double posting. No A5 rewrite is required.

## 3. Runtime artifacts

- `src/policy/b2f-finance-journal.entity.ts`
- `src/policy/b2f-journal-governance.types.ts`
- `src/policy/b2f-journal-governance.service.ts`
- `src/policy/b2f-journal-governance.module.ts`
- migration `1785753600047-CreateB2FFinanceJournalGovernance.ts`
- focused tests `test/b2f-journal-governance.*.spec.ts`
- internal module registration in `src/app.module.ts`

No controller, route, public API, webhook, partner call, or frontend is introduced.

## 4. Frozen scope and journal request

Every governance record is fixed to:

```text
book:         finance.book.ng.primary / 1
legal entity: finance.legal-entity.ng.primary
basis:        ACCRUAL
currency:     NGN
unit:         CUSTOMER_FUNDS
```

The request contains deterministic Finance reference/version, classification, period/version, accounting date, description, source-document kind/owner/reference/version/hash/time, ordered debit/credit lines, canonical A5 UUIDs, Finance classification/mapping references, approval, correlation/causation, and hashes.

Random database IDs, generated references, and timestamps are excluded from semantic create hashes.

## 5. Validation and classification

Before persistence, B2F05 enforces:

- source reference and SHA-256 provenance;
- at least two lines;
- unique line numbers;
- positive integer minor units;
- at least one debit and one credit;
- equal debit/credit totals;
- canonical UUID-shaped A5 account IDs;
- Finance classification keys and mapping references;
- A5 account existence/active state;
- exact Finance class to A5 type/normal-balance compatibility;
- NGN and `CUSTOMER_FUNDS` compatibility;
- B2F04 period admission and accounting date.

### Mapping limitation

B2F03 did not implement a durable mapping registry. B2F05 validates mapping-reference shape and rechecks the canonical A5 account against Finance classification semantics, but cannot independently resolve an approved persisted B2F03 mapping record. This is **NOT VERIFIED / REQUIRES REVIEW** before production posting. The implementation does not invent or persist a second account authority; a future mapping consumer port must replace/strengthen this contract check without changing A5 identity.

## 6. Governance states

States are:

- `DRAFT`
- `PENDING_APPROVAL`
- `APPROVED`
- `REJECTED`
- `POSTING_REQUESTED`
- `POSTED`
- `FAILED`
- `POSTING_UNKNOWN`

Implemented flow:

```text
DRAFT -> PENDING_APPROVAL -> APPROVED -> POSTING_REQUESTED -> POSTED
                         |                                  -> FAILED
                         |                                  -> POSTING_UNKNOWN -> POSTING_REQUESTED
                         -> REJECTED
```

`POSTED` requires an A5 journal UUID and posted timestamp. `REJECTED` and `FAILED` cannot post. `POSTING_UNKNOWN` never claims value movement and can retry only through the same A5 request/idempotency identity.

Final materiality thresholds are **NOT VERIFIED / REQUIRES REVIEW** for B2F06. Structurally every posting requires privileged approval.

## 7. Approval and segregation

Posting consumes `PrivilegedActionApprovalService` action `FINANCE_JOURNAL_POST`, resource type `B2F_FINANCE_JOURNAL_GOVERNANCE`, exact governance UUID, and a fingerprint over reference/version, semantic hashes, period/date, lines, and totals. A materially different journal cannot reuse approval. A2 remains authorization authority; B9 later administers IAM.

Approval rejection moves the governance record to `REJECTED`, audits the outcome, and never calls A5.

## 8. A5 posting request

After approval B2 submits exactly one semantic request to A5 containing:

- deterministic `b2f-a5-<Finance request hash>` idempotency key;
- NGN/customer-funds dimensions;
- Finance reference/description/correlation;
- minimized provenance metadata;
- canonical A5 account UUID, direction, and minor-unit amount per line.

Finance classification keys are not A5 posting targets. A5 UUIDs are.

A5 response ID/time are persisted as provenance. A5 lines remain the financial lines of record; Finance JSON lines remain governance intent only.

## 9. Idempotency, replay, and concurrency

Shared Operations scopes:

```text
b2.finance.journal.create.idempotency.v1
b2.finance.journal.lifecycle.idempotency.v1
b2.finance.journal.post.idempotency.v1
```

Create/lifecycle/post commands run in serializable transactions. Governance rows use pessimistic write locks, expected record versions, and optimistic version columns. Same key/hash replays; changed payload conflicts. A unique A5 journal ID prevents one A5 journal being claimed by two governance records.

A5 idempotency is independent and also honored. Unknown-result retry uses the original A5 key and payload.

## 10. Failure and unknown outcomes

- Validation/period/mapping failure: rejected before A5.
- Approval failure: `REJECTED`, no A5 call.
- A5 `HttpException`: `FAILED` with `A5_REJECTED`.
- Timeout/unclassified error: `POSTING_UNKNOWN` with `A5_RESULT_UNKNOWN`.
- Duplicate Finance request: shared replay.
- Changed idempotency payload: conflict.
- Stale/concurrent request: rejected by lock/version/state.
- Partial B2 persistence failure: transaction rollback; A5 uncertainty is never represented as `POSTED`.

No automatic compensating journal is created. Corrections/reversals remain future controlled governance using A5's existing reversal authority.

## 11. Audit and outbox

Shared `AuditService` records creation, approval request, approval/rejection, posting request, A5 posted result, failed/unknown result, and lifecycle rejection/provenance.

`B2FFinanceJournalPosted` is enqueued only after A5 confirms a canonical posted journal. It carries Finance/A5 references and hashes, not financial authority or external instructions. No success event is emitted for `FAILED` or `POSTING_UNKNOWN`.

## 12. Consumer port

The internal read-only consumer port exposes:

- journal governance status;
- A5 posting result reference/failure;
- source/request/decision provenance;
- contract identity.

It exposes no HTTP route and is intended for B2F09 and later Finance reconciliation.

## 13. Authority boundaries

B2F05 does not:

- insert/update A5 account/journal/line tables directly;
- calculate or store a balance;
- implement posting algorithms or reversal;
- mutate B1 decisions, A6 settlement, or A7 products;
- implement Treasury, Reporting, Statements, IAM, Developer APIs, or frontend;
- communicate with external partners.

`LedgerService.postJournal()` is the only financial-value call.

## 14. Persistence and migration

Migration `0047` creates only `b2f_finance_journal_governance`, references B2F04 periods and canonical A5 journal IDs, and creates state/period/A5 provenance indexes. It creates no line, account, balance, AR/AP, reporting, statement, or Treasury table.

## 15. Verification

- [x] Balanced request and source/period/account/classification checks implemented.
- [x] Approval and governance state machine implemented.
- [x] Successful A5 posting preserves canonical result.
- [x] A5 rejection and unknown result are distinct.
- [x] Unknown retry uses the same A5 idempotency key.
- [x] Finance/shared idempotency, audit, outbox, locks, and versions reused.
- [x] Read-only consumer status/provenance port implemented.
- [x] No controller/public API or external communication introduced.
- [x] No second ledger, balance, journal-of-record, B1 decision, or settlement authority introduced.
- [x] Durable mapping verification and final materiality thresholds remain explicit follow-up items.

### B2F05 result

> **Finance journal governance and controlled A5 posting implemented; A5 remains sole posting/value authority, and production use remains blocked on durable B2F03 mapping verification and B2F06 controls.**
