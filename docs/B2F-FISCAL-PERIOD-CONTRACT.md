# B2F04 — Finance Fiscal Year and Accounting Period Runtime Contract

- **Platform:** B2 — Finance Platform
- **Task:** B2F04 — Finance Fiscal Year and Accounting Period Runtime
- **Contract:** `B2FFiscalPeriodContractV1`
- **Contract name:** `B2F-FISCAL-PERIOD`
- **Contract version:** `1`
- **ADR:** [`ADR-0085 — B2 Finance Fiscal Year and Accounting Period Runtime`](ADR/ADR-0085-B2-Finance-Fiscal-Year-and-Accounting-Period-Runtime.md)
- **Status:** Implemented as an internal runtime authority; no public API and no Finance posting
- **Book scope:** `finance.book.ng.primary` v1
- **Migration:** `1785753600046-CreateB2FFinanceFiscalPeriodTables.ts`
- **Depends on:** [`B2F-ACCOUNTING-MODEL-CONTRACT.md`](B2F-ACCOUNTING-MODEL-CONTRACT.md), [`B2F-CHART-CLASSIFICATION-CONTRACT.md`](B2F-CHART-CLASSIFICATION-CONTRACT.md), shared Operations, and A2 privileged approval

## 1. Purpose and implementation boundary

B2F04 implements the bounded B2 Finance authority for fiscal-year definitions, twelve monthly accounting-period definitions, period lifecycle state, Finance period admission/lock decisions, version/effective metadata, audit, idempotency, and concurrency control.

It does not implement B2F05 posting. Period state is a B2 Finance admission boundary only and does not globally lock A5.

The runtime contains:

- `src/policy/b2f-fiscal-year.entity.ts`
- `src/policy/b2f-accounting-period.entity.ts`
- `src/policy/b2f-fiscal-period.constants.ts`
- `src/policy/b2f-fiscal-period.types.ts`
- `src/policy/b2f-fiscal-period.repository.ts`
- `src/policy/b2f-fiscal-period.service.ts`
- `src/policy/b2f-fiscal-period.module.ts`
- migration `src/migrations/1785753600046-CreateB2FFinanceFiscalPeriodTables.ts`
- focused tests `test/b2f-fiscal-period.*.spec.ts`

`B2FFiscalPeriodModule` is wired into `src/app.module.ts` but exports no controller or route.

## 2. Frozen scope

The runtime rejects definitions outside:

```text
bookKey:              finance.book.ng.primary
bookVersion:          1
legalEntityReference: finance.legal-entity.ng.primary
jurisdiction:         NG
accountingBasis:      ACCRUAL
functionalCurrency:   NGN
accountingUnit:       CUSTOMER_FUNDS
calendarKey:          finance.calendar.ng.gregorian
calendarVersion:      1
calendar boundary:    Gregorian monthly UTC
```

No multi-book, multi-entity, FX, consolidation, or another accounting unit/currency is represented.

## 3. Persistence model

### 3.1 Fiscal years

`b2f_finance_fiscal_years` stores:

- deterministic reference/key and version;
- numeric fiscal year;
- current fiscal-year state;
- frozen book/legal entity/jurisdiction/basis/currency/unit/calendar scope;
- January 1 start and following January 1 exclusive end;
- deterministic definition hash;
- creator/correlation metadata;
- optimistic `record_version`;
- creation/update timestamps.

The fiscal-year state vocabulary is `PLANNED`, `ACTIVE`, `CLOSED`, and `RETIRED`. It summarizes period state and is not an A5 ledger state.

### 3.2 Accounting periods

`b2f_finance_accounting_periods` stores:

- deterministic reference/key/version;
- fiscal-year foreign key/reference;
- period number 1–12 and `YYYY-MM` label;
- start date, exclusive end date, and UTC cutoff instant;
- lifecycle state and state version;
- definition and last-decision hashes;
- open/soft-close/hard-close/reopen/retire timestamps;
- reopen expiry;
- last privileged approval, reason, control evidence, correlation, and request metadata;
- optimistic `record_version`;
- creation/update timestamps.

It contains no ledger account, journal line, posting, or balance.

### 3.3 History preservation

Current state is version-protected in the period row. Every creation and lifecycle outcome is written through shared `AuditService`, including previous/new state and decision/control metadata. Idempotency responses preserve the original deterministic result. No lifecycle operation deletes a fiscal year or period.

The migration uses `ON DELETE RESTRICT` from periods to fiscal years. Runtime exposes no delete method.

## 4. Fiscal-year creation

`createFiscalYear()`:

1. validates year, actor, request context, and idempotency key;
2. computes a deterministic semantic request hash;
3. reserves shared idempotency scope;
4. rejects a duplicate fiscal-year key under a different request;
5. generates one fiscal year and exactly twelve periods;
6. persists all records in one `SERIALIZABLE` transaction;
7. audits fiscal-year and period creation;
8. completes the shared idempotency result.

References and definition hashes derive deterministically from semantic keys. Random database UUIDs and timestamps are excluded from request/definition hashes.

Fiscal-year creation produces `PLANNED` periods. It does not activate the book, ratify the legal entity, open a period, or post value.

## 5. Monthly boundaries

For year `YYYY`:

- fiscal year starts `YYYY-01-01`;
- fiscal year ends exclusively `(YYYY+1)-01-01`;
- each period starts on the first day of its month;
- each period ends exclusively on the first day of the next month;
- `cutoffAt` is the exclusive end at `00:00:00.000Z`.

Leap-year behavior follows JavaScript/Gregorian calendar date construction and explicit month boundaries. No local-time or DST conversion is applied.

The B2F02 unresolved statutory UTC-versus-Africa/Lagos review remains open. Runtime implements UTC exactly as frozen; it does not silently change the contract.

## 6. State machine

The implemented period states are:

- `PLANNED`
- `OPEN`
- `SOFT_CLOSED`
- `HARD_CLOSED`
- `REOPENED`
- `RETIRED`

Allowed transitions:

```text
PLANNED -> OPEN
PLANNED -> RETIRED
OPEN -> SOFT_CLOSED
OPEN -> RETIRED
SOFT_CLOSED -> OPEN
SOFT_CLOSED -> HARD_CLOSED
SOFT_CLOSED -> RETIRED
HARD_CLOSED -> REOPENED
HARD_CLOSED -> RETIRED
REOPENED -> SOFT_CLOSED
```

`RETIRED` is terminal. `HARD_CLOSED -> OPEN` and `REOPENED -> OPEN` are prohibited. Arbitrary state assignment is not exposed.

Each successful transition increments `stateVersion`, persists a deterministic decision hash, records lifecycle timestamps/control metadata, and increments the TypeORM optimistic record version.

## 7. Lifecycle control evidence

Every transition requires:

- legal-entity ratification reference;
- accounting-policy approval reference;
- reason;
- expected record version;
- dedicated lifecycle idempotency key;
- privileged approval bound to exact action fingerprint;
- request/correlation context.

Hard close additionally requires:

- reconciliation reference;
- close-checklist reference.

Reopen additionally requires:

- correction scope;
- future reopen-expiry instant.

### Current evidence limitation

No canonical legal-entity registry or Finance accounting-policy runtime exists yet. B2F04 preserves approval-bound reference strings but cannot independently resolve their business contents. Production activation of an `OPEN` period therefore remains `NOT VERIFIED / REQUIRES REVIEW` until those authorities/references are ratified and connected. The runtime does not invent a legal-entity or policy authority.

## 8. Privileged actions

Transitions use `PrivilegedActionApprovalService.consume()` with:

- action type derived from target state;
- resource type `B2F_ACCOUNTING_PERIOD`;
- exact period UUID;
- deterministic action fingerprint over period, target, expected version, reason, and control evidence.

Actions are:

- `FINANCE_PERIOD_OPEN`
- `FINANCE_PERIOD_SOFT_CLOSE`
- `FINANCE_PERIOD_HARD_CLOSE`
- `FINANCE_PERIOD_REOPEN`
- `FINANCE_PERIOD_RETIRE`

A2 remains authorization/approval authority. B2F04 stores approval correlation only and creates no IAM role/credential/session authority. The existing approval service enforces expiry, resource/fingerprint matching, assurance, scope, and consumption semantics.

## 9. Idempotency and replay

B2F04 reuses shared `IdempotencyService` and creates no idempotency table.

Scopes:

```text
creation:  b2.finance.fiscal-period.create.idempotency.v1
lifecycle: b2.finance.fiscal-period.lifecycle.idempotency.v1
```

Retention is 86,400 seconds for operational replay. Durable fiscal-year/period/audit history is independent of idempotency-record expiry.

Rules:

- same scope/key/hash returns the original result with replay indication;
- same scope/key/different hash conflicts;
- lifecycle replay does not consume privileged approval twice;
- failed lifecycle decisions are persisted as failed idempotency responses and replay deterministically;
- generated references and `createdAt` are excluded from request hashes.

## 10. Concurrency

- Creation and transitions run in `SERIALIZABLE` transactions.
- Lifecycle lookup uses `pessimistic_write` row locking.
- Commands require `expectedRecordVersion`.
- TypeORM `@VersionColumn` protects persisted record evolution.
- A stale command returns `B2F_FISCAL_PERIOD_VERSION_CONFLICT` without changing state.
- Database uniqueness protects year/key/version and period/key/year-number identities.

Two concurrent contradictory transitions cannot both apply to the same observed period version.

## 11. Audit

B2F04 reuses shared `AuditService`.

Recorded successful actions include:

- `FISCAL_YEAR_CREATED`
- `ACCOUNTING_PERIOD_CREATED`
- `ACCOUNTING_PERIOD_OPENED`
- `ACCOUNTING_PERIOD_SOFT_CLOSED`
- `ACCOUNTING_PERIOD_HARD_CLOSED`
- `ACCOUNTING_PERIOD_REOPENED`
- `ACCOUNTING_PERIOD_RETIRED`
- `FISCAL_YEAR_STATE_SYNCHRONIZED`

Rejected transition attempts against an existing period record:

- `ACCOUNTING_PERIOD_TRANSITION_REJECTED`

Audit records include minimal prior/new state, versions, hashes, approval/control references, actor, request, and correlation metadata. Audit does not become authorization or posting proof.

## 12. Fiscal-year state synchronization

After a successful period transition:

- any non-`PLANNED` period makes the fiscal year `ACTIVE`, unless closure/retirement rules apply;
- all periods `HARD_CLOSED` or `RETIRED` make the fiscal year `CLOSED`;
- all periods `RETIRED` make the fiscal year `RETIRED`.

This summary is audited and versioned. It does not close A5 or stop non-Finance A5 transaction modules.

## 13. Lookup and compatibility

The internal service exposes:

- fiscal-year lookup by numeric year;
- period lookup by exact period key;
- deterministic definition/version fields;
- compatibility and admission decision through consumer ports.

No controller or public API is implemented.

## 14. Read-only admission consumer port

`B2FFiscalPeriodConsumerPortsV1` is intended for later B2F05. It exposes:

- `getPeriodByKey()`;
- `checkAdmission()`;
- contract version and lifecycle scope.

Admission kinds:

| Kind                | Admissible state                    |
| ------------------- | ----------------------------------- |
| `ORDINARY`          | `OPEN`                              |
| `CLOSE_ADJUSTMENT`  | `SOFT_CLOSED`                       |
| `REOPEN_CORRECTION` | `REOPENED` and before reopen expiry |

The decision also validates book/version/legal-entity/currency/accounting-unit and accounting date within the period. It returns `readOnly: true` and does not reserve idempotency, mutate a period, call A5, or post.

The consumer port is an admission decision only. B2F05 must still define Finance treatment, chart mapping, approval, and A5 posting correlation.

## 15. A5 authority boundary

B2F04 imports/injects no `LedgerService`, ledger entity, journal entity, or balance service. It:

- creates no A5 account;
- posts no journal;
- writes no journal line;
- reads/mutates no A5 balance;
- reverses no journal;
- changes no A5 invariant;
- globally locks no A5 operation.

Period state blocks only future B2 Finance admission. Existing A5 transaction modules remain governed by their existing contracts until a future explicit integration.

## 16. Other authority boundaries

B2F04:

- does not read/write/recalculate B1 commercial decisions;
- does not execute A6 settlement/suspense;
- does not mutate A7 products;
- does not implement B3 Treasury;
- does not implement B5 Merchant;
- does not implement B6 Reporting or B7 Statements;
- does not create B8 configuration authority;
- does not create B9 IAM authority;
- does not create B10 API/developer behavior;
- does not create C2 observability platform behavior;
- exposes no frontend/public route.

## 17. Failure behavior

Implemented failures include invalid command/scope, duplicate year, missing year/period, invalid transition, version conflict, missing/denied approval, missing hard-close/reopen evidence, invalid reopen, replay conflict, and query unavailability.

Failures do not:

- choose another period;
- change state;
- delete history;
- mutate A5/B1/A6/A7;
- fabricate posting success.

A hard-closed period remains readable. Reopen is additive: `hardClosedAt` is preserved while `reopenedAt`/expiry/control evidence are added.

## 18. Migration and rollback

Migration `1785753600046` follows existing contiguous ordering after `0045`. It creates only:

- `b2f_finance_fiscal_years`
- `b2f_finance_accounting_periods`

The down migration drops periods before fiscal years. No existing table, account, journal, line, B1 decision, A6 settlement, or historical B2 artifact is modified.

Production migration execution is not claimed by this task.

## 19. Retention and classification

Fiscal definitions, period state, approval/control metadata, deterministic hashes, and audit references are Finance-confidential governance data. Exact retention durations remain `NOT VERIFIED / REQUIRES REVIEW`; no destructive cleanup is introduced. Shared audit/idempotency retention continues under existing Operations controls. Legal hold design remains future Finance data-control work.

## 20. Test evidence

Focused B2F04 tests cover:

- deterministic fiscal-year/period identities and hashes;
- twelve monthly UTC periods including year boundary;
- frozen book/legal entity/basis/currency/unit/calendar;
- allowed and invalid transitions;
- hard-close and reopen evidence;
- idempotent creation/lifecycle replay and changed-payload conflict;
- stale-version/concurrency protection and pessimistic locking;
- privileged approval denial;
- additive hard-close/reopen history;
- audit evidence;
- read-only admission consumer port;
- absence of Ledger/B1 providers from the bounded module/service.

## 21. Explicit non-goals

B2F04 does not implement:

- B2F05 journal governance/posting;
- chart mappings or A5 accounts;
- balances or financial value;
- AR/AP;
- B1 calculations;
- A6 settlement;
- Treasury, reporting, statements, IAM, developer APIs, observability platform, frontend;
- legal-entity or accounting-policy master runtime;
- close checklist/reconciliation engines themselves;
- financial statements or regulatory reporting;
- historical B2T11/B2T12.

## 22. Verification record

- [x] Fiscal-year creation and deterministic identity/version implemented.
- [x] Exactly twelve monthly UTC periods generated.
- [x] Frozen Finance scope enforced in entity/database definitions and consumer decisions.
- [x] Period lifecycle and invalid transitions enforced.
- [x] Open/soft-close/hard-close/reopen/retire implemented with control evidence.
- [x] Reopen is scoped, expiring, privileged, additive, and non-destructive.
- [x] Shared idempotency and audit services reused.
- [x] Privileged lifecycle pattern reused; no IAM authority created.
- [x] Serializable transactions, row locks, expected version, optimistic version, and uniqueness protect concurrency.
- [x] History remains queryable and no delete runtime exists.
- [x] Read-only B2F05 admission port implemented.
- [x] No A5 posting, balance, account, journal, or reversal behavior introduced.
- [x] No B1/A6/A7 or later-platform authority duplicated.
- [x] No public API/controller/frontend introduced.
- [x] Legal-entity/policy content verification and statutory timezone ratification remain explicit review items.

### B2F04 result

> **Fiscal-year and accounting-period runtime implemented for the frozen scope; production opening remains review-gated, and B2F05 has not begun.**
