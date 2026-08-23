# B2F02 — Finance Accounting Model, Books, Accounting Basis, and Fiscal Calendar Contract

- **Platform:** B2 — Finance Platform
- **Task:** B2F02 — Finance Accounting Model, Books, Accounting Basis, and Fiscal Calendar Contract
- **Contract:** `B2FinanceAccountingModelContractV1`
- **Contract name:** `B2-FINANCE-ACCOUNTING-MODEL`
- **Contract version:** `1`
- **ADR:** [`ADR-0083 — B2 Finance Accounting Model, Books, Accounting Basis, and Fiscal Calendar`](ADR/ADR-0083-B2-Finance-Accounting-Model-Books-Basis-and-Fiscal-Calendar.md)
- **Status:** Contract accepted for architecture sequencing; runtime not implemented
- **Depends on:** [`B2F-FINANCE-INVENTORY.md`](B2F-FINANCE-INVENTORY.md), [`B2-FINANCE-PLATFORM-BOUNDARY.md`](B2-FINANCE-PLATFORM-BOUNDARY.md), and existing A5/B1/A6/A7 authorities
- **Application source, entity, migration, service, controller, route, API, configuration, posting, balance, period-runtime, and frontend changes:** None

## 1. Purpose and bounded first scope

This contract freezes the foundational B2 Finance accounting vocabulary and governance model before any Finance runtime implementation. It defines one bounded Finance book, one accounting basis, one provisional legal-entity reference, one functional currency, one accounting unit, one Gregorian fiscal calendar, monthly accounting periods, period controls, core accounting dimensions, source-document references, and the relationship between Finance governance and A5 Ledger.

The first Finance scope is intentionally limited to:

```text
book key:                 finance.book.ng.primary
book version:             1
book type:                PRIMARY
legal-entity reference:   finance.legal-entity.ng.primary
legal-entity status:      PENDING_LEGAL_RATIFICATION
jurisdiction:             NG
accounting basis:         ACCRUAL
functional currency:      NGN
supported currencies:     [NGN]
accounting unit:           CUSTOMER_FUNDS
calendar key:             finance.calendar.ng.gregorian
calendar version:         1
calendar year:            January 1 through December 31
period frequency:         MONTHLY
period time standard:     UTC
```

`finance.legal-entity.ng.primary` is an internal scope reference, not a claim about a registered corporate name, registration number, tax identifier, license, or regulatory status. Those legal facts were not verified in the repository by B2F01. The book must not become runtime-active until Finance, Legal, Tax, Compliance, and Architecture ratify the legal-entity metadata.

This contract does not activate the book or any period. It does not create a database record. It does not post or approve a journal. It does not compute or store a balance.

## 2. Existing capability versus contract versus future runtime

| Concern                   | Existing capability                                                                             | B2F02 contract decision                                                                                | Future runtime owner/task                              |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Ledger accounts           | A5 `ledger_accounts` with account type, normal balance, currency, accounting unit, active state | Finance book references A5 accounts; it never replaces their identity                                  | B2F03 mapping/governance; A5 remains account authority |
| Journals and lines        | A5 immutable `POSTED` journals/lines                                                            | Finance governs treatment, book, period, policy, and approval evidence before a future posting request | B2F05; A5 remains posting authority                    |
| Balances                  | A5 derives balances from signed ledger lines                                                    | No Finance balance authority or mutable balance field is permitted                                     | A5 only; B2F10/B2F12 consume read-only facts           |
| Reversal                  | A5 posts an inverse journal linked by `reversalOfJournalId`                                     | Finance later governs adjustment reason, period, approval, and correlation                             | B2F05/B2F06; A5 executes value correction              |
| Commercial decisions      | B1 decisions/documents for fee, billing, recognition, tax, cost, profitability, reconciliation  | Source documents are referenced and consumed without recalculation                                     | B2F09                                                  |
| External settlement       | A6 settlement/suspense/reconciliation evidence                                                  | Source documents are referenced and consumed without taking settlement ownership                       | B2F09/B2F10                                            |
| Product financial effects | A7 product-effect/reconciliation evidence                                                       | Source documents are referenced and consumed without taking product ownership                          | B2F09/B2F10                                            |
| Fiscal periods            | No runtime Finance period authority found                                                       | Vocabulary, identity, lifecycle, cutoff, lock, and ownership are frozen here                           | B2F04 runtime implementation                           |
| Finance books/policy      | No runtime Finance book found                                                                   | One bounded book/basis/scope and version model are frozen here                                         | B2F02 follow-on runtime only if separately authorized  |

Evidence for existing A5 behavior: `src/ledger/ledger-account.entity.ts`, `src/ledger/ledger-journal.entity.ts`, `src/ledger/ledger-line.entity.ts`, `src/ledger/ledger.service.ts`, `src/migrations/1785753600000-CreateWalletAndLedger.ts`, and `src/reconciliation/reconciliation.service.ts`.

## 3. Contract identity

`B2FinanceAccountingModelContractV1` is the authoritative B2 Finance contract for book identity, accounting basis, fiscal calendar, period governance, source classification, and Finance-to-A5 compatibility.

The contract identity is:

```text
contractName:     B2-FINANCE-ACCOUNTING-MODEL
contractVersion:  1
contractDocument: docs/B2F-ACCOUNTING-MODEL-CONTRACT.md
adr:              ADR-0083
```

A contract version identifies schema and invariant compatibility. It is distinct from:

- book version;
- accounting-policy version;
- fiscal-calendar version;
- fiscal-year version;
- accounting-period version;
- source-document version;
- A5 ledger account/journal identity;
- B1 commercial contract/decision version;
- A6 settlement version;
- A7 product version.

No version may be inferred from another version.

## 4. Finance book model

### 4.1 Definition

A Finance book is a governed accounting-policy scope. It groups one legal-entity reference, accounting basis, functional currency, supported-currency set, accounting unit, fiscal calendar, policy version, and accounting dimensions.

A Finance book is **not**:

- an A5 ledger account;
- an A5 journal or line;
- a balance;
- a B1 plan, invoice, recognition decision, tax decision, or cost decision;
- an A6 settlement account or settlement record;
- an A7 product;
- a Treasury position;
- a reporting or statement-delivery surface.

### 4.2 `FinanceBookV1`

The future immutable book definition must carry at least:

| Field                     | Type/constraint                       | First-scope value or rule                                |
| ------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `contractName`            | literal                               | `B2-FINANCE-ACCOUNTING-MODEL`                            |
| `contractVersion`         | positive integer                      | `1`                                                      |
| `bookReference`           | opaque immutable reference            | prefix `b2f-book-`; generation deferred to runtime task  |
| `bookKey`                 | stable lowercase dotted key           | `finance.book.ng.primary`                                |
| `bookVersion`             | positive integer                      | `1`                                                      |
| `bookType`                | closed vocabulary                     | `PRIMARY`                                                |
| `bookStatus`              | closed vocabulary                     | initially `DRAFT`; runtime activation not performed here |
| `legalEntityReference`    | stable internal reference             | `finance.legal-entity.ng.primary`                        |
| `legalEntityStatus`       | closed vocabulary                     | `PENDING_LEGAL_RATIFICATION` until approved              |
| `jurisdiction`            | ISO 3166-1 alpha-2                    | `NG`                                                     |
| `accountingBasis`         | closed vocabulary                     | `ACCRUAL`                                                |
| `functionalCurrency`      | ISO 4217                              | `NGN`                                                    |
| `supportedCurrencies`     | non-empty unique array                | exactly `[NGN]`                                          |
| `accountingUnit`          | existing A5-compatible unit           | `CUSTOMER_FUNDS`                                         |
| `fiscalCalendarKey`       | stable lowercase dotted key           | `finance.calendar.ng.gregorian`                          |
| `fiscalCalendarVersion`   | positive integer                      | `1`                                                      |
| `accountingPolicyVersion` | immutable version key                 | format defined in §5                                     |
| `definitionHash`          | SHA-256 lowercase hex                 | deterministic canonical definition hash                  |
| `effectiveFrom`           | ISO-8601 UTC instant                  | required before `ACTIVE`                                 |
| `effectiveTo`             | ISO-8601 UTC instant/null             | null or greater than `effectiveFrom`                     |
| `createdBy`               | A2 principal reference                | required in runtime                                      |
| `approvedBy`              | different A2 principal reference/null | required before `ACTIVE`                                 |
| `approvalReference`       | A2 privileged approval reference/null | required before `ACTIVE`                                 |
| `classification`          | data classification                   | `CONFIDENTIAL`                                           |
| `retentionClass`          | Finance retention class               | `FINANCE_POLICY_HISTORY`                                 |
| `legalHold`               | boolean                               | default false; hold overrides disposal                   |

### 4.3 Book type and status

B2F02 freezes one book type:

- `PRIMARY` — the first and only Finance accounting book in scope.

B2F02 freezes the book-status vocabulary:

- `DRAFT` — definition is incomplete or unapproved; no period may be opened.
- `APPROVED` — maker-checker approval and legal-entity ratification are present; activation time may still be future.
- `ACTIVE` — effective and available to classify Finance accounting treatments.
- `SUSPENDED` — no new Finance accounting treatment may be admitted; history remains readable.
- `RETIRED` — no new treatment may be admitted; immutable historical references remain valid.

Allowed transitions:

```text
DRAFT -> APPROVED -> ACTIVE -> SUSPENDED -> ACTIVE
                         |          |
                         +----------+-> RETIRED
DRAFT -> RETIRED
APPROVED -> RETIRED
```

No transition deletes or rewrites prior versions. An `ACTIVE` book cannot change legal entity, accounting basis, functional currency, accounting unit, or calendar in place.

### 4.4 No multi-book scope

B2F02 does not authorize secondary, management, tax, regulatory, consolidation, branch, merchant, partner, or Treasury books. Adding another book type or key requires a new reviewed contract/ADR and compatibility analysis. No cross-book posting, elimination, translation, or consolidation is defined.

## 5. Book identity, policy identity, and versioning

### 5.1 Stable identity

`bookKey + bookVersion` uniquely identifies a book definition. `bookReference` is the immutable record reference. `bookKey` is stable across compatible versions; `bookVersion` increments for a new immutable definition.

The first key/version is:

```text
finance.book.ng.primary / 1
```

### 5.2 Accounting policy version

The accounting-policy version is distinct from the A4 capability-policy version and B1 commercial-policy/document versions. The first Finance accounting-policy key is:

```text
finance.accounting-policy.ng.primary.v1
```

It identifies the Finance interpretation policy for source classification, accounting basis, period assignment, cutoff, adjustment treatment, and required evidence. It does not determine commercial price, tax amount, fee, commission, revenue share, settlement truth, product state, or ledger posting success.

A future policy record must be immutable, effective-dated, hash-addressed, and lifecycle-governed using patterns compatible with `src/policy/policy-profile-version.entity.ts`; it must not reuse the A4 policy table or pretend to be an A4 capability decision.

### 5.3 Version compatibility

A consumer is compatible with v1 only when all of the following match:

- contract name/version;
- book key/version;
- legal-entity reference/status requirement;
- jurisdiction;
- accounting basis;
- functional currency and supported currencies;
- accounting unit;
- fiscal calendar key/version;
- source-document kind/version support;
- required dimensions;
- accounting-policy version/effective interval;
- period version and state.

Unknown contract, book, policy, calendar, period, source kind, currency, accounting unit, or mandatory dimension fails closed.

## 6. Legal-entity scope

### 6.1 First-scope reference

The first book is limited to one internal legal-entity scope reference:

```text
finance.legal-entity.ng.primary
```

Jurisdiction is `NG`. This reference must not be presented as a registered legal name or regulatory identifier.

### 6.2 Required ratification metadata

Before the book can transition beyond `DRAFT`, a separately reviewed legal-entity record or approved external reference must establish:

- registered legal name;
- registration number and issuing registry;
- tax identification references;
- jurisdiction and residency;
- applicable license/regulatory references;
- accounting/reporting obligations;
- effective dates;
- owner and approval evidence;
- data classification and retention.

These facts are **NOT VERIFIED / REQUIRES REVIEW**. B2F02 does not invent them and does not create a legal-entity registry. Whether the canonical legal-entity master belongs in a future shared platform requires architecture review; B2 Finance owns its accounting-scope reference and consumption contract, not corporate identity administration.

### 6.3 No multi-entity accounting

No intercompany posting, consolidation, elimination, transfer pricing, branch accounting, or cross-entity allocation is in scope. A source document with another legal-entity reference is incompatible with v1.

## 7. Accounting basis

### 7.1 First basis

The first book uses `ACCRUAL` as its Finance accounting basis. Under this contract, accrual basis means accounting treatment is assigned to the period in which the approved recognition condition occurs, not merely the period in which cash or settlement occurs.

This is a governance definition only. It does not execute recognition, tax, cost allocation, journal posting, receivable, payable, accrual, deferral, or close.

### 7.2 Relationship to B1

B1 may emit commercial revenue-recognition, tax/VAT, cost-accounting, billing, invoice, and profitability decisions with their own methods, states, periods, and effective times. Evidence: `src/policy/b1-revenue-recognition-engine.types.ts`, `src/policy/b1-billing-engine.types.ts`, and `src/policy/b1-commercial-analytics-engine.types.ts`.

B2 Finance must:

- preserve the B1 decision reference/version/hash;
- treat B1 as the commercial determination input;
- apply the Finance accounting policy and period assignment separately;
- never interpret a B1 `RECOGNIZED`, `DECLARED`, `ALLOCATED`, `AMORTIZED`, invoice, or statement state as proof of A5 posting;
- correlate any later posting result to an A5 journal.

The actual B1-to-Finance treatment rules remain B2F09 work.

### 7.3 Excluded bases

`CASH`, `MODIFIED_ACCRUAL`, `TAX`, `REGULATORY`, and management-only bases are not supported by the first Finance book. Their names in B1 vocabularies do not activate them for Finance. Adding a basis requires a new book version or separately approved book and must not modify v1 history.

## 8. Currency and accounting-unit scope

### 8.1 Functional currency

The functional currency is `NGN`. This matches the existing bounded A5/A6/A7/B1 flows documented in B2F01 and enforced in relevant source contracts.

`NGN` must be normalized using the existing ISO-4217 three-letter conventions in `src/common/money.ts`. Monetary values remain integer minor units and must never pass through floating-point arithmetic.

### 8.2 Supported currencies

The v1 supported-currency set is exactly:

```text
[NGN]
```

A transaction currency other than `NGN` is incompatible and fails closed. No foreign-currency amount, exchange rate, translation amount, functional-currency equivalent, remeasurement, or realized/unrealized FX result is defined.

FX belongs to later E1 Foreign Exchange and any future Finance FX accounting extension requires a separate reviewed contract.

### 8.3 Accounting unit

The first book accounting unit is `CUSTOMER_FUNDS`, matching current A5 account/journal defaults and bounded B1/A6/A7 contracts. Evidence: `src/common/money.ts`, `src/ledger/ledger.types.ts`, and the contracts cited in B2F01.

B2F02 does not authorize another accounting unit. A source or A5 account/journal with a different accounting unit is incompatible with this book.

### 8.4 No new money representation

B2 Finance must consume existing money conventions:

- integer minor units;
- string-safe serialization;
- PostgreSQL `BIGINT` bounds;
- explicit ISO currency;
- no implicit conversion or rounding.

Evidence: `src/common/money.ts`, `src/ledger/ledger.service.ts`, and ADR-0002.

## 9. Fiscal calendar

### 9.1 Calendar identity

The first fiscal calendar is:

```text
calendarKey:       finance.calendar.ng.gregorian
calendarVersion:   1
calendarType:      GREGORIAN
fiscalYearStart:   January 1
fiscalYearEnd:     December 31
periodFrequency:   MONTHLY
periodCount:       12
weekDefinition:    not authoritative for posting periods
leapYearRule:      Gregorian calendar
cutoffTimeZone:    UTC
```

Calendar v1 has no 4-4-5 periods, adjustment period 13, weekly period, quarterly-only period, custom holiday shift, or multi-calendar behavior.

### 9.2 Time standard

All contract instants use ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) and future persistence must use PostgreSQL `timestamptz`, consistent with existing ledger, policy, audit, idempotency, and B1 entities.

Accounting dates are calendar dates (`YYYY-MM-DD`) interpreted in UTC for v1. A period starts at `00:00:00.000Z` on its first date and ends exclusively at `00:00:00.000Z` on the first date of the next period.

No local-time/DST cutoff is introduced. Whether statutory interpretation requires Africa/Lagos local civil time rather than UTC is **NOT VERIFIED / REQUIRES REVIEW** before runtime activation. If review requires a change, calendar version 2 must supersede v1 prospectively; v1 history is not rewritten.

### 9.3 Fiscal-year identity

A fiscal year is identified by:

```text
fiscalYearKey:      finance.fiscal-year.ng.<YYYY>
fiscalYearVersion:  1
label:              FY<YYYY>
startDate:           <YYYY>-01-01
endDateExclusive:    <YYYY+1>-01-01
calendarKey:         finance.calendar.ng.gregorian
calendarVersion:     1
bookKey:             finance.book.ng.primary
bookVersion:         1
```

A fiscal year belongs to exactly one book/calendar version. Fiscal-year boundaries cannot overlap or leave a gap in an active book.

### 9.4 Runtime status

No fiscal calendar, fiscal year, or period is persisted or live as a result of B2F02. B2F04 must implement and validate runtime records only after separate authorization.

## 10. Accounting-period identity

### 10.1 Monthly period identity

Each period is uniquely identified by book, fiscal year, calendar month, and period version:

```text
periodKey:       finance.period.ng.<YYYY>-<MM>
periodVersion:   1
periodNumber:    1..12
periodLabel:     <YYYY>-<MM>
```

For example, the contract shape permits `finance.period.ng.2027-01`; B2F02 does not create that period or assert that any specific fiscal year is open.

### 10.2 `FinanceAccountingPeriodV1`

A future period record must carry:

- contract/book/calendar/fiscal-year identities and versions;
- period key/version/number/label;
- start date and exclusive end date;
- cutoff instant;
- state and state version;
- opened/reopened/soft-closed/hard-closed instants and actor references as applicable;
- required maker-checker approval references;
- close-run/reconciliation references when applicable;
- effective dates;
- definition/request/decision hashes;
- correlation/request/causation IDs;
- classification, retention, and legal-hold metadata.

A period record does not contain a financial balance, journal line, or B1 commercial amount.

## 11. Period states and transition model

B2F02 freezes the following period states:

- `PLANNED` — period definition exists but no Finance accounting treatment may be admitted.
- `OPEN` — compatible Finance treatments may be admitted according to policy and cutoff.
- `SOFT_CLOSED` — ordinary Finance treatment admission is blocked; explicitly approved close adjustments may be prepared under maker-checker control.
- `HARD_CLOSED` — all new Finance treatment admission and adjustment requests for the period are blocked.
- `REOPENED` — a previously hard-closed period is temporarily open only for the approved correction scope and expiry window.
- `RETIRED` — invalidated before opening or preserved after an administrative supersession; no admission is allowed.

Allowed transitions are:

```text
PLANNED -> OPEN -> SOFT_CLOSED -> HARD_CLOSED
    |         |          |              |
    +---------+----------+--------------+-> RETIRED (only under approved conditions)
OPEN <-> SOFT_CLOSED
HARD_CLOSED -> REOPENED -> SOFT_CLOSED -> HARD_CLOSED
```

`REOPENED -> OPEN` is prohibited in v1. Reopening is correction-scoped, not a general reset. No transition bypasses required approvals or deletes prior transition evidence.

## 12. Period opening

A `PLANNED -> OPEN` decision requires all of the following:

- book status `ACTIVE` at the period start;
- ratified legal-entity metadata;
- compatible book/calendar/fiscal-year/period versions;
- approved Finance accounting-policy version effective for the complete period;
- no overlapping period;
- prior period hard-close or an explicitly approved first-period bootstrap condition;
- Finance owner request;
- independent Finance approver decision;
- A2 privileged-action evidence;
- definition and decision hashes;
- immutable audit evidence.

Opening a period does not open or unlock A5. A5 currently has no Finance-period runtime gate. B2F05 must define how future Finance-directed posting requests prove period admissibility without replacing A5 posting invariants.

## 13. Period cutoff and accounting-date assignment

### 13.1 Required times

A future Finance accounting-treatment request must distinguish:

- `sourceOccurredAt` — when the source event says the business event occurred;
- `sourceObservedAt` — when MonieNaija received/observed it;
- `financeRecognizedAt` — when the Finance recognition condition was satisfied under policy;
- `accountingDate` — date used for fiscal-period assignment;
- `recordedAt` — when the Finance record was durably created;
- `a5PostedAt` — A5 posting time, present only after A5 posts.

These values are not interchangeable. No caller may supply `a5PostedAt` as Finance truth; it is read from A5.

### 13.2 Standard cutoff

The standard monthly cutoff is the period's exclusive end instant. A request is eligible for ordinary period admission only when:

- accounting date is within `[periodStart, periodEndExclusive)`;
- current time is before or equal to the approved operational cutoff for admission;
- period state is `OPEN`;
- policy and source evidence are effective/compatible.

The runtime grace interval, if any, between calendar end and operational cutoff is **NOT VERIFIED / REQUIRES REVIEW**. B2F04 must not invent one without Finance approval.

### 13.3 Late-arriving facts

A late source fact does not silently backdate into a `SOFT_CLOSED` or `HARD_CLOSED` period.

- If the original period is `OPEN`, normal admission rules apply.
- If `SOFT_CLOSED`, only an approved close adjustment may be admitted.
- If `HARD_CLOSED`, it is assigned to the current eligible open period as a prior-period adjustment, or the original period is reopened through §16.
- The record must retain original source dates, intended period, assigned period, reason, materiality, policy version, and approval reference.

This contract does not define materiality thresholds or execute adjustments; those remain B2F06/B2F11 work.

## 14. Period close

### 14.1 Soft close

`OPEN -> SOFT_CLOSED` requires:

- cutoff reached or approved early-close reason;
- source-ingestion and posting queues assessed;
- A5 integrity/trial-balance verification reference;
- B1/A6/A7 source completeness evidence as applicable;
- unresolved discrepancy inventory;
- Finance preparer request and different approver;
- audit/correlation evidence.

Soft close blocks ordinary Finance admission but allows explicitly classified close adjustments after approval.

### 14.2 Hard close

`SOFT_CLOSED -> HARD_CLOSED` requires:

- all mandatory B2F11 close checklist items completed;
- Finance reconciliation complete for the period;
- A5 journal integrity and period-scoped posting correlation complete;
- all material breaks resolved or formally accepted by authorized owners;
- approved close adjustments posted/reconciled through A5;
- signed close evidence and maker-checker approval;
- no in-progress Finance idempotency reservation for the period;
- immutable close decision hash and audit evidence.

B2F02 defines these requirements but cannot satisfy them because B2F10/B2F11 runtime does not exist.

### 14.3 Close does not mutate history

Close changes Finance admission state only. It does not update A5 journals/lines, recompute B1 decisions, alter A6 settlements, or alter A7 product records.

## 15. Period-lock semantics

### 15.1 Finance admission lock

A period lock applies to B2 Finance accounting-treatment and Finance posting-request admission:

| Period state  | Ordinary treatment    | Close adjustment               | Posting-request admission      | Read/reconciliation |
| ------------- | --------------------- | ------------------------------ | ------------------------------ | ------------------- |
| `PLANNED`     | Denied                | Denied                         | Denied                         | Allowed             |
| `OPEN`        | Allowed if compatible | Allowed if classified/approved | Allowed if compatible          | Allowed             |
| `SOFT_CLOSED` | Denied                | Allowed with approval          | Only approved close adjustment | Allowed             |
| `HARD_CLOSED` | Denied                | Denied                         | Denied                         | Allowed             |
| `REOPENED`    | Denied                | Only approved reopen scope     | Only approved correction scope | Allowed             |
| `RETIRED`     | Denied                | Denied                         | Denied                         | Allowed             |

### 15.2 No claim of current A5 enforcement

A5 does not currently carry Finance book/period fields and does not enforce this period lock. Existing A5 transaction modules may continue posting under their own current authority and controls. B2F02 does not intercept them.

Before a future Finance runtime relies on lock semantics, B2F05 must define a non-duplicating interface that:

- validates Finance period admission before submitting a Finance-directed A5 posting request;
- includes immutable book/period/policy/source/approval references in correlation metadata;
- reads A5's actual posting result;
- never weakens A5 balance, currency, account, double-entry, idempotency, locking, or immutability controls.

## 16. Period reopen

### 16.1 Reopen authority

Only the Finance period-control authority may request reopen. Runtime authorization remains A2; administrative role assignment later belongs to B9.

Reopen requires:

- hard-closed period identity/version;
- specific correction scope and source references;
- reason code and narrative;
- materiality assessment;
- proposed affected accounts/dimensions;
- Finance preparer and different Finance approver;
- required Tax/Audit/Compliance approval where applicable;
- A2 privileged-action reference bound to an action fingerprint;
- start/expiry instants;
- maximum permitted posting count or explicit correction set;
- audit and reconciliation references.

Self-approval is prohibited, consistent with `PrivilegedActionApprovalService`.

### 16.2 Reopen behavior

`REOPENED` permits only the approved correction scope. It does not permit ordinary backdated business. Every accepted correction must retain the original period, current posting period if different, reopen approval, A5 journal/reversal references, and post-correction reconciliation.

At expiry or completion, the period transitions to `SOFT_CLOSED`, reruns required reconciliation/close checks, then returns to `HARD_CLOSED` under maker-checker approval.

### 16.3 No destructive rollback

Reopen never deletes or edits a prior Finance decision, B1 source, A6 settlement, A7 product record, or A5 journal. Corrections are additive and A5-owned where monetary.

## 17. Effective dating

Book, accounting policy, calendar, fiscal year, period, and future dimension definitions are effective-dated with:

```text
effectiveFrom: required UTC instant
effectiveTo:   null or UTC instant greater than effectiveFrom
```

Rules:

1. Active definitions for the same identity may not overlap.
2. A request resolves definitions at `financeRecognizedAt` and `accountingDate` according to the contract.
3. The resolved version/reference/hash is persisted; it is never recomputed from the newest version during replay.
4. A new version is prospective unless a separately approved correction/replay contract says otherwise.
5. Retiring a definition does not invalidate historical decisions.
6. B1/A6/A7 source effective dates remain source-owned and are referenced, not rewritten.

The effective-dated immutable pattern should be compatible with existing policy versioning in `src/policy/policy-profile-version.entity.ts`, but B2 Finance must use a distinct Finance authority and contract.

## 18. Accounting dimensions

### 18.1 Required core dimensions

Every future B2 Finance accounting-treatment decision must carry:

- `bookKey` and `bookVersion`;
- `legalEntityReference`;
- `jurisdiction`;
- `accountingBasis`;
- `functionalCurrency`;
- `transactionCurrency` (v1 must be `NGN`);
- `accountingUnit` (`CUSTOMER_FUNDS`);
- `fiscalCalendarKey` and version;
- `fiscalYearKey` and version;
- `accountingPeriodKey` and version;
- `accountingDate`;
- `accountingPolicyVersion`;
- source system/kind/reference/version/hash;
- correlation and causation references.

### 18.2 Conditional source dimensions

Where supplied by a canonical owner and required by treatment, the record may reference:

- A1 customer ID;
- A3 binding, WalletAccount, and LedgerAccount IDs;
- A7 product key/version, product operation, and financial-effect reference;
- B1 commercial scope/decision, plan, billing, invoice, recognition, tax, cost, analytics, or reconciliation reference;
- A6 partner key, external operation, settlement, suspense, and reconciliation reference;
- B5 merchant/agent reference when B5 exists;
- tax jurisdiction/category reference;
- future Finance cost-center, control-account-purpose, and reporting-dimension references.

These are references, not copied authorities.

### 18.3 Deferred dimensions

B2F03 must define governance, cardinality, compatibility, effective dating, and A5 mappings for account purpose, control account, contra account, cost center, product, merchant, partner, tax, and reporting dimensions.

B2F02 does not create chart mappings, cost centers, departments, branches, projects, consolidation entities, or Treasury dimensions.

## 19. Source-document references

### 19.1 Source-reference envelope

`FinanceSourceDocumentReferenceV1` must contain:

- `sourceKind`;
- `sourceOwner`;
- `sourceReference`;
- `sourceVersion`;
- `sourceHash` where available;
- `sourceOccurredAt`;
- `sourceObservedAt`;
- `sourceEffectiveAt`;
- `sourceCorrelationId`;
- minimal classification/retention metadata;
- optional supersedes/reversal reference supplied by the source owner.

### 19.2 Supported source kinds

The first contract recognizes these categories as references only:

- `A5_LEDGER_JOURNAL`
- `A5_TRANSFER`
- `A5_DEPOSIT`
- `A5_WITHDRAWAL`
- `B1_COMMERCIAL_DECISION`
- `B1_BILLING_RECORD`
- `B1_INVOICE`
- `B1_COMMERCIAL_STATEMENT`
- `B1_REVENUE_RECOGNITION_DECISION`
- `B1_TAX_VAT_DECISION`
- `B1_COST_ACCOUNTING_DECISION`
- `B1_COMMERCIAL_ANALYTICS_DECISION`
- `B1_PROFITABILITY_DECISION`
- `B1_COMMERCIAL_RECONCILIATION_DECISION`
- `A6_EXTERNAL_OPERATION`
- `A6_EXTERNAL_SETTLEMENT`
- `A6_EXTERNAL_SUSPENSE`
- `A6_EXTERNAL_RECONCILIATION`
- `A7_PRODUCT_OPERATION`
- `A7_PRODUCT_FINANCIAL_EFFECT`
- `A7_PRODUCT_RECONCILIATION`

Recognition does not imply automatic accounting admission. B2F09/B2F10 must define treatment and verification for each source kind.

### 19.3 Source ownership

B2 Finance must not modify, regenerate, or mark a source document complete. Source corrections produce a new source version/reference under the owning platform, after which Finance evaluates an additive treatment/correction.

## 20. Finance-to-A5 Ledger relationship

### 20.1 A5 remains authoritative

A5 remains authoritative for:

- ledger account identity and state;
- account type/normal balance/currency/accounting unit;
- journal/line creation;
- debit/credit balance;
- financial value and balances;
- posting transactionality, locking, and idempotency;
- posted-at time;
- immutable history;
- reversal journal execution.

Evidence: `src/ledger/*`, migration `1785753600000`, and ADR-0043.

### 20.2 B2 Finance governance

B2 Finance governs:

- book, legal-entity scope, basis, policy, calendar, period, dimensions;
- accounting treatment classification;
- Finance admission and period lock;
- maker-checker evidence;
- future posting-request identity;
- Finance correlation to A5 result;
- finance reconciliation, close, and official accounting outputs.

### 20.3 No shadow ledger

A future Finance record must not contain a mutable authoritative balance or claim `POSTED` unless an A5 journal ID has been retrieved and verified. A Finance posting request may be `PREPARED`, `APPROVED`, `SUBMITTED`, `REJECTED`, or `UNKNOWN` in future B2F05 vocabulary, but those states are not A5 journal states.

B2F02 does not freeze B2F05's lifecycle or implement it.

## 21. Posting authority boundary

This contract does not post.

Future Finance posting must:

1. resolve an active compatible book/policy/period;
2. validate source reference and accounting dimensions;
3. obtain required maker-checker approval;
4. map through B2F03-approved A5 account IDs;
5. submit exactly one idempotent request through the B2F05-approved A5 interface;
6. accept A5 rejection without claiming success;
7. read the durable A5 journal and verify currency/unit/lines/correlation;
8. record the A5 journal reference as evidence;
9. reconcile independently;
10. use A5 reversal/compensating entry for monetary correction.

No B2 component may write `ledger_accounts`, `ledger_journals`, or `ledger_lines` directly.

Existing non-B2 transaction modules are not retroactively placed under this contract by B2F02. Their integration migration is a future reviewed decision.

## 22. Reconciliation relationship

### 22.1 Existing interfaces

Existing `ReconciliationService` provides read-only ledger integrity, account activity, an all-time trial balance, and finance-verification data. Transfer, A6 external, A7 product, and B1 commercial reconciliation contracts provide source-specific evidence. Evidence is catalogued in `docs/B2F-FINANCE-INVENTORY.md`.

### 22.2 Finance reconciliation requirements

Future B2 Finance reconciliation must compare:

- resolved book/policy/calendar/period definition;
- source document and source-owner state;
- Finance treatment and approval;
- expected A5 accounts/lines/amount/currency/unit;
- actual A5 journal/lines/posting time;
- reversal/adjustment correlation;
- period admission and close state;
- source-specific reconciliation results.

It must operate read-only against source authorities and must not repair a source to make a report pass.

### 22.3 No completion claim

The existing all-time trial balance is not a B2 period-aware trial balance or official financial statement. B2F10/B2F12 remain future work.

## 23. Idempotency and deterministic decisions

### 23.1 Scope

The reserved future B2F02 idempotency scope is:

```text
b2.finance.accounting-model.idempotency.v1
```

No idempotency record is created by this documentation task.

### 23.2 Canonical request hash

A future book/calendar/period governance command must compute SHA-256 over canonical, ordered semantic input. Generated reference, database ID, created/updated timestamp, replay flag, and audit/outbox IDs are excluded.

For period transitions, semantic input includes:

- contract/book/calendar/fiscal-year/period identities and versions;
- current and requested state;
- effective/cutoff/reopen intervals;
- policy/definition hashes;
- reason/materiality/close/reconciliation references;
- approval action fingerprint/reference;
- actor/request/correlation/causation identity as policy requires.

### 23.3 Replay rules

- Same scope + key + semantic hash returns the durable original decision.
- Same scope + key + different hash fails with replay conflict.
- In-progress reservation fails closed; it does not execute concurrently.
- Expired governance idempotency must not erase immutable book/period/audit history.
- Retention duration is `NOT VERIFIED / REQUIRES REVIEW`; it must cover operational retry needs while durable governance records remain under their own retention policy.

### 23.4 Determinism

Given the same immutable definitions, source references, evaluation instant, requested transition, and approved evidence, compatibility/transition evaluation must return the same outcome, reason codes, assigned period, and hashes.

Current wall-clock time must be passed as an explicit evaluation input in tests; hidden `now` must not change historical replay.

## 24. Audit requirements

Future runtime must use shared `AuditService` rather than a Finance-specific audit store. Evidence for the shared primitive: `src/operations/audit.service.ts` and `src/operations/audit-event.entity.ts`.

Required Finance accounting-model audit actions include:

- `FINANCE_BOOK_CREATED`
- `FINANCE_BOOK_APPROVED`
- `FINANCE_BOOK_ACTIVATED`
- `FINANCE_BOOK_SUSPENDED`
- `FINANCE_BOOK_RETIRED`
- `FINANCE_POLICY_VERSION_APPROVED`
- `FISCAL_YEAR_CREATED`
- `ACCOUNTING_PERIOD_CREATED`
- `ACCOUNTING_PERIOD_OPENED`
- `ACCOUNTING_PERIOD_SOFT_CLOSED`
- `ACCOUNTING_PERIOD_HARD_CLOSED`
- `ACCOUNTING_PERIOD_REOPEN_REQUESTED`
- `ACCOUNTING_PERIOD_REOPENED`
- `ACCOUNTING_PERIOD_REOPEN_COMPLETED`
- `ACCOUNTING_PERIOD_RETIRED`
- `ACCOUNTING_MODEL_REPLAYED`
- `ACCOUNTING_MODEL_REPLAY_CONFLICT`

Audit evidence must include actor, request/correlation/causation IDs, prior/new state, versions/hashes, approval reference, reason, and effective time, subject to minimization. Audit evidence is not a balance, period source record, authorization, or posting proof.

## 25. Maker-checker and segregation expectations

The following actions require a requester and a different approver:

- approve/activate/suspend/retire a book;
- approve an accounting-policy version;
- open the first fiscal period;
- soft close or hard close a period;
- reopen a hard-closed period;
- accept a material unresolved close exception;
- change a future effective calendar/book version.

Requirements:

- self-approval is forbidden;
- approval is bound to action type, exact resource/version, definition hash, and requested transition;
- approval expires and is single-use;
- MFA/assurance and scope requirements are enforced by A2;
- future B9 administers role/entitlement assignment;
- B2 records Finance decision evidence but stores no credential/session secret;
- emergency access cannot silently reopen or post; it still requires post-event review and cannot mutate history.

The repository's `PrivilegedActionApprovalService` provides a generic approval pattern and prohibits self-approval. B2F06 must define the complete Finance role/materiality matrix. B2F02 does not implement it.

## 26. Compatibility and decision outcomes

### 26.1 Compatibility outcome

The future compatibility evaluator vocabulary is:

- `COMPATIBLE`
- `INCOMPATIBLE`
- `REQUIRES_APPROVAL`
- `NOT_EFFECTIVE`
- `PERIOD_LOCKED`
- `LEGAL_ENTITY_UNRATIFIED`
- `UNSUPPORTED_CURRENCY`
- `UNSUPPORTED_ACCOUNTING_UNIT`
- `UNSUPPORTED_SOURCE`
- `REJECTED`

Only `COMPATIBLE` may proceed to ordinary Finance treatment admission. A transition command may return `REQUIRES_APPROVAL` without changing state.

### 26.2 Failure codes

The v1 failure-code vocabulary is:

- `B2F_ACCOUNTING_MODEL_INVALID_COMMAND`
- `B2F_ACCOUNTING_MODEL_INCOMPATIBLE_CONTRACT`
- `B2F_ACCOUNTING_MODEL_BOOK_NOT_FOUND`
- `B2F_ACCOUNTING_MODEL_BOOK_NOT_ACTIVE`
- `B2F_ACCOUNTING_MODEL_BOOK_VERSION_MISMATCH`
- `B2F_ACCOUNTING_MODEL_LEGAL_ENTITY_UNRATIFIED`
- `B2F_ACCOUNTING_MODEL_ACCOUNTING_BASIS_UNSUPPORTED`
- `B2F_ACCOUNTING_MODEL_CURRENCY_UNSUPPORTED`
- `B2F_ACCOUNTING_MODEL_ACCOUNTING_UNIT_UNSUPPORTED`
- `B2F_ACCOUNTING_MODEL_CALENDAR_MISMATCH`
- `B2F_ACCOUNTING_MODEL_FISCAL_YEAR_MISMATCH`
- `B2F_ACCOUNTING_MODEL_PERIOD_NOT_FOUND`
- `B2F_ACCOUNTING_MODEL_PERIOD_OVERLAP`
- `B2F_ACCOUNTING_MODEL_PERIOD_GAP`
- `B2F_ACCOUNTING_MODEL_PERIOD_LOCKED`
- `B2F_ACCOUNTING_MODEL_CUTOFF_EXCEEDED`
- `B2F_ACCOUNTING_MODEL_TRANSITION_INVALID`
- `B2F_ACCOUNTING_MODEL_APPROVAL_REQUIRED`
- `B2F_ACCOUNTING_MODEL_SELF_APPROVAL_FORBIDDEN`
- `B2F_ACCOUNTING_MODEL_APPROVAL_EXPIRED`
- `B2F_ACCOUNTING_MODEL_REOPEN_SCOPE_VIOLATION`
- `B2F_ACCOUNTING_MODEL_SOURCE_UNSUPPORTED`
- `B2F_ACCOUNTING_MODEL_SOURCE_VERSION_MISMATCH`
- `B2F_ACCOUNTING_MODEL_POLICY_NOT_EFFECTIVE`
- `B2F_ACCOUNTING_MODEL_REQUIRED_DIMENSION_MISSING`
- `B2F_ACCOUNTING_MODEL_A5_REFERENCE_MISMATCH`
- `B2F_ACCOUNTING_MODEL_REPLAY_CONFLICT`
- `B2F_ACCOUNTING_MODEL_IN_PROGRESS`
- `B2F_ACCOUNTING_MODEL_QUERY_UNAVAILABLE`
- `B2F_ACCOUNTING_MODEL_PROHIBITED`

No failure code authorizes fallback to another book, currency, unit, period, source, or ledger.

## 27. Failure, disable, and rollback expectations

### 27.1 Fail closed

Missing/unavailable book, legal-entity ratification, policy, period, approval, source, A5 mapping, reconciliation, or audit dependency fails closed for Finance admission. It must not fabricate a default period or claim posting success.

### 27.2 Transaction failure

A failed future state transition must leave the prior state authoritative. Partial audit/idempotency/period changes must not be exposed as success. Exact transaction design belongs to runtime implementation.

### 27.3 Disable

Suspending the book or locking a period stops new B2 Finance admission. It does not:

- disable A5 globally;
- rewrite existing A5 journals;
- disable B1 commercial decisions;
- alter A6 settlement/source evidence;
- alter A7 products;
- delete historical Finance evidence.

### 27.4 Contract rollback

Because B2F02 is documentation-only, rollback means superseding this contract/ADR through a reviewed decision. Existing A5/B1/A6/A7 behavior is unchanged. A future runtime rollback must be additive and preserve identifiers, hashes, approvals, transitions, and legal holds.

## 28. Retention and classification expectations

### 28.1 Classification

- Book/calendar/policy definitions: `CONFIDENTIAL`.
- Period state and close/reopen evidence: `CONFIDENTIAL`.
- Approval/audit metadata: `CONFIDENTIAL`, elevated to `RESTRICTED` where actor/security details require.
- A5 journal metadata/source payload projections: minimum necessary; raw sensitive source payloads are prohibited.
- Legal registration/tax/license evidence: `RESTRICTED` unless a lower classification is explicitly approved.

### 28.2 Retention classes

The contract reserves semantic retention classes:

- `FINANCE_POLICY_HISTORY`
- `FINANCE_FISCAL_CALENDAR_HISTORY`
- `FINANCE_PERIOD_HISTORY`
- `FINANCE_CLOSE_EVIDENCE`
- `FINANCE_AUDIT_EVIDENCE`

Exact durations are **NOT VERIFIED / REQUIRES REVIEW** by Finance, Tax, Legal, Compliance, Privacy, and Audit before runtime. Until approved, runtime must not assign an arbitrary destructive expiry. Legal hold overrides ordinary disposal.

### 28.3 Minimization

Finance governance records must store references/hashes rather than unrestricted source payloads. They must not contain raw credentials, tokens, PINs, OTPs, partner secrets, callback signatures, full KYC documents, unrestricted risk/compliance notes, or unnecessary customer data.

## 29. Explicit non-goals

B2F02 does not implement or authorize:

- an entity, table, migration, repository, service, controller, route, API, scheduler, worker, or frontend;
- a live book, fiscal year, period, period transition, cutoff process, close, or reopen;
- a second ledger, journal, line, posting engine, balance, or financial-value authority;
- direct writes to A5 tables or changes to A5 posting behavior;
- chart-of-accounts mapping/governance implementation (B2F03);
- journal request/posting integration (B2F05);
- maker-checker runtime or full role/materiality matrix (B2F06);
- accounts receivable/payable (B2F07/B2F08);
- B1 fee, billing, invoice, recognition, tax, cost, profitability, or reconciliation recalculation;
- tax calculation, filing, settlement, or legal advice;
- A6 partner/settlement/suspense ownership;
- A7 product ownership;
- multi-entity, multi-book, consolidation, intercompany, branch, or elimination accounting;
- FX accounting, translation, remeasurement, or another currency;
- Treasury position, liquidity, funding, or cash management (B3);
- Merchant lifecycle (B5);
- consolidated reporting/presentation (B6);
- broad statement generation/delivery (B7);
- broad configuration platform behavior (B8);
- IAM administration (B9);
- public/developer APIs, credentials, webhooks, sandbox, SDKs, API analytics, versioning, or Developer Portal (B10);
- Observability Platform (C2);
- regulatory financial reporting, official financial statements, audit packs, month-end/year-end close runtime, or frontend behavior;
- historical B2T11/B2T12.

## 30. Future implementation handoff

- **B2F03** consumes book/dimension requirements and defines governed mapping to A5 ledger accounts.
- **B2F04** implements fiscal years, periods, transitions, cutoff, locks, close/reopen control records, and tests under this contract.
- **B2F05** defines Finance journal requests and the controlled A5 posting interface.
- **B2F06** defines Finance roles, materiality, maker-checker, and segregation controls.
- **B2F07/B2F08** use book/period/source dimensions for AR/AP without changing this book scope.
- **B2F09** maps immutable B1/A6/A7 source decisions to Finance treatments.
- **B2F10/B2F11** use period and policy identities for reconciliation and close.
- **B2F12/B2F13** consume closed-period accounting facts for official datasets/schedules without changing A5 or becoming B6/B7.
- **B2F15** hands approved Finance facts to B3 Treasury; it does not hand off a scale/extraction platform.

B2F03 must not begin automatically. Every future task requires separate authorization.

## 31. Verification record

- [x] B2F01 inventory and unresolved gaps reviewed.
- [x] Existing A5 account, journal, posting, balance, reversal, money, time, and reconciliation models reviewed.
- [x] Existing B1 billing/invoice/recognition/tax/cost/profitability/reconciliation decisions remain source-owned.
- [x] A6 settlement and A7 product boundaries remain source-owned.
- [x] One bounded primary Finance book is defined.
- [x] One provisional legal-entity reference and `NG` jurisdiction are defined without inventing registration facts.
- [x] One accrual basis, `NGN` functional/supported currency, and `CUSTOMER_FUNDS` accounting unit are defined.
- [x] One Gregorian January–December monthly UTC calendar is contractually defined.
- [x] Fiscal-year/period identity, states, opening, cutoff, close, reopen, and lock semantics are defined.
- [x] Effective dating, core/conditional dimensions, and source-document references are defined.
- [x] A5 remains account/posting/value/balance authority.
- [x] Existing A5 posting does not claim to enforce Finance period locks.
- [x] B2F02 does not claim a live book or period.
- [x] Idempotency, audit, maker-checker, compatibility, deterministic evaluation, failure, rollback, retention, and classification expectations are defined.
- [x] Multi-book, multi-entity, consolidation, FX, AR/AP, tax calculation, Treasury, Reporting, Statements, IAM, Developer Integration, Observability, frontend, and historical B2 closure work are excluded.
- [x] No runtime or migration artifact is created or modified.

### B2F02 result

> **Accounting model contract frozen — runtime not implemented, legal-entity and calendar ratification still required before activation.**
