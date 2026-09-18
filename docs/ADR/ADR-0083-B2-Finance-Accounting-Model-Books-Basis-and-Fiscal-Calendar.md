# ADR-0083 — B2 Finance Accounting Model, Books, Accounting Basis, and Fiscal Calendar

- **ADR ID:** ADR-0083
- **Platform:** B2 — Finance Platform
- **Task:** B2F02 — Finance Accounting Model, Books, Accounting Basis, and Fiscal Calendar Contract
- **Status:** Accepted for the B2F02 architecture contract; runtime not implemented
- **Decision date:** 2026-08-09
- **Authoritative contract:** [`docs/B2F-ACCOUNTING-MODEL-CONTRACT.md`](../B2F-ACCOUNTING-MODEL-CONTRACT.md)
- **Application source, entity, migration, service, controller, route, API, configuration, posting, balance, period-runtime, and frontend changes:** None

## 1. Context

The authoritative platform roadmap defines B2 as Finance Platform. B2F01 found that the repository already has:

- A5 ledger accounts, immutable posted journals/lines, derived balances, posting invariants, idempotent posting, and additive reversal (`src/ledger/*`, `src/migrations/1785753600000-CreateWalletAndLedger.ts`);
- an all-time read-only trial-balance/finance-verification surface (`src/reconciliation/reconciliation.service.ts`);
- B1 commercial fee, billing, invoice, statement, recognition, tax/VAT, cost, profitability, analytics, and commercial-reconciliation decisions (`src/policy/b1-*`);
- A6 external settlement/suspense/reconciliation and A7 product financial-effect/reconciliation authorities.

B2F01 did not find a runtime Finance book, fiscal year, accounting period, period lock, Finance journal governance layer, AR/AP, close, or period-aware official accounting-output authority. Evidence: [`docs/B2F-FINANCE-INVENTORY.md`](../B2F-FINANCE-INVENTORY.md).

B2 Finance therefore needs a stable accounting governance contract before later tasks can define chart mappings, Finance posting requests, controls, AR/AP, reconciliation, close, and official accounting outputs. The contract must not replace A5 posting/value or duplicate B1 commercial determination.

## 2. Decision

### 2.1 One bounded Finance book

B2F02 defines one book:

```text
bookKey:               finance.book.ng.primary
bookVersion:           1
bookType:              PRIMARY
legalEntityReference:  finance.legal-entity.ng.primary
legalEntityStatus:     PENDING_LEGAL_RATIFICATION
jurisdiction:           NG
accountingBasis:        ACCRUAL
functionalCurrency:    NGN
supportedCurrencies:   [NGN]
accountingUnit:         CUSTOMER_FUNDS
calendarKey:            finance.calendar.ng.gregorian
calendarVersion:        1
```

The legal-entity reference is an internal accounting-scope key, not a claim about a registered company, tax identity, license, or regulatory status. Those facts require Legal/Tax/Compliance/Finance ratification before runtime activation.

No secondary, tax, management, regulatory, consolidation, branch, merchant, partner, or Treasury book is authorized.

### 2.2 Book and policy versioning

The accounting-model contract is `B2-FINANCE-ACCOUNTING-MODEL` v1. Book definitions, accounting-policy definitions, calendars, fiscal years, and accounting periods are independently versioned, effective-dated, immutable, and hash-addressed.

The first Finance accounting-policy key is:

```text
finance.accounting-policy.ng.primary.v1
```

A new version is prospective. It does not rewrite historical source, Finance, or A5 evidence.

### 2.3 Accrual basis

The first book uses accrual basis: Finance period assignment follows the approved recognition condition, not merely cash/settlement time. B1 remains the commercial recognition/tax/cost decision authority. B2 later applies Finance accounting policy and period assignment to immutable B1 decisions; A5 remains proof of posting.

No cash, modified-accrual, tax, regulatory, or management basis is activated.

### 2.4 Currency and accounting unit

The book's functional and only supported currency is `NGN`; its accounting unit is `CUSTOMER_FUNDS`. Existing integer minor-unit and ISO currency conventions are reused from `src/common/money.ts`.

No FX amount, exchange rate, translation, remeasurement, or another currency is supported.

### 2.5 Fiscal calendar and periods

The first calendar is Gregorian, January 1 through December 31, with twelve monthly periods and UTC boundaries. Fiscal years use `finance.fiscal-year.ng.<YYYY>` and periods use `finance.period.ng.<YYYY>-<MM>`.

The period-state vocabulary is:

- `PLANNED`
- `OPEN`
- `SOFT_CLOSED`
- `HARD_CLOSED`
- `REOPENED`
- `RETIRED`

B2F02 defines opening, cutoff, late-arrival, soft-close, hard-close, reopen, effective-date, lock, and maker-checker semantics. It does not persist or activate a fiscal year or period. B2F04 is responsible for separately authorized runtime implementation.

UTC is the v1 contractual cutoff standard because existing repository timestamps are `timestamptz` and generated as ISO-8601 instants. Whether statutory requirements require Africa/Lagos civil-time cutoff is not verified and must be ratified before activation. Any change is prospective through a new calendar version.

### 2.6 Period lock is a Finance admission lock

A Finance period lock controls future B2 Finance treatment and posting-request admission. It does not globally lock A5 and is not currently enforced by A5. Existing transaction modules remain unchanged.

B2F05 must later define a controlled Finance-to-A5 interface that proves book/period/policy/approval compatibility before Finance-directed posting while preserving every A5 invariant.

### 2.7 Accounting dimensions and sources

Every future Finance treatment requires book, legal entity, jurisdiction, basis, functional/transaction currency, accounting unit, fiscal year, period, accounting date, accounting-policy version, source reference, and correlation identities.

Conditional references may point to A1/A3/A5, B1, A6, A7, and future B5 facts. References do not transfer source ownership. B2F03 will define detailed chart and dimension governance.

### 2.8 A5 and B1 boundaries

A5 remains authoritative for ledger account identity, journal/line creation, financial value, balances, posting time, posting invariants, immutable history, and reversal execution.

B2 Finance governs book, accounting basis/policy, fiscal calendar, period state, Finance admission, accounting treatment, dimensions, approval evidence, future posting requests, reconciliation, close, and accounting-output scope.

B1 remains authoritative for commercial terms and decisions, including fee, commission, revenue sharing, billing, invoice, commercial statement, recognition, tax/VAT, cost, profitability, analytics, and commercial reconciliation. B2 consumes B1 outputs and must not recalculate them.

### 2.9 Idempotency, audit, and maker-checker

The future accounting-model idempotency scope is reserved as:

```text
b2.finance.accounting-model.idempotency.v1
```

No idempotency record is created by this ADR.

Future commands use deterministic canonical hashes and replay/conflict rules through the shared Operations idempotency authority. Governance transitions use shared audit and A2 privileged approval primitives. Book approval/activation, accounting-policy approval, first-period opening, period close, and reopen require a requester and a different approver. B9 later administers IAM; B2 stores no credentials.

### 2.10 Failure and retention

Missing/incompatible book, legal-entity ratification, policy, period, source, dimension, approval, A5 mapping, reconciliation, or audit evidence fails closed. No fallback book/period/currency is inferred.

Governance history is immutable and additive. Retention classes are defined semantically, but exact durations require Finance/Tax/Legal/Compliance/Privacy/Audit review. Legal hold overrides disposal.

## 3. Consequences

### 3.1 Positive consequences

- Later Finance tasks share one stable book, basis, currency, unit, calendar, period, dimension, and source vocabulary.
- A5 remains the only financial value/posting/balance authority.
- B1 commercial decisions can be consumed without being mistaken for accounting posting finality.
- Period lock semantics are explicit without falsely claiming current A5 enforcement.
- Multi-book, multi-entity, consolidation, FX, Treasury, Reporting, Statement, IAM, API, and frontend scope are prevented from entering B2F02.
- Legal-entity and timezone uncertainties are explicit activation blockers rather than fabricated facts.

### 3.2 Costs and constraints

- B2F03–B2F06 must implement mappings, period runtime, posting interfaces, and controls before the model can govern live Finance activity.
- The single `NGN`/`CUSTOMER_FUNDS` book cannot represent another currency, accounting unit, or legal entity.
- Current A5 journals have no Finance book/period fields, so correlation/integration must be designed prospectively.
- Current all-time trial balance cannot be treated as an official period-aware Finance output.
- Legal entity, retention duration, materiality, close checklist, grace interval, and local-time statutory interpretation remain review items.

## 4. Alternatives considered

### 4.1 Treat A5 as the complete Finance Platform

**Rejected.** A5 owns value/posting and has ledger accounts/journals/balances, but B2F01 found no Finance book, fiscal period, close, AR/AP, or Finance governance authority. Treating A5 as B2 would overload the ledger and leave accounting governance undefined.

### 4.2 Create a separate B2 ledger and balances

**Rejected.** This would duplicate A5 and violate the authoritative platform boundary.

### 4.3 Reuse B1 billing/recognition periods as Finance periods

**Rejected.** B1 periods are commercial-scope inputs. They do not provide fiscal-year, period-lock, close/reopen, or official Finance accounting authority.

### 4.4 Create multiple books now

**Rejected.** No verified requirement exists for tax, regulatory, management, consolidation, or secondary books. It would introduce unapproved complexity.

### 4.5 Use cash basis because A5 records posted value

**Rejected.** Finance accounting treatment must distinguish recognition from cash movement. Accrual is the bounded first policy; its legal/statutory ratification remains an activation gate.

### 4.6 Support all A5 currencies

**Rejected.** Although A5 validates generic ISO currency codes, the implemented bounded A6/A7/B1 scope is `NGN`. Supporting additional currencies would silently introduce FX and compatibility requirements.

### 4.7 Use Africa/Lagos local time immediately

**Deferred, not rejected.** The repository consistently uses UTC instants/`timestamptz`, but statutory cutoff interpretation was not verified. UTC is frozen for v1 contract determinism; Finance/Tax/Legal must decide whether a prospective calendar version is required before runtime.

### 4.8 Implement period entities and migrations in B2F02

**Rejected.** The authoritative implementation plan defines B2F02 as an accounting-model ADR/contract task. Runtime period implementation belongs to B2F04 and requires separate authorization.

## 5. Required follow-up

1. Finance, Legal, Tax, Compliance, and Architecture ratify the legal-entity metadata.
2. Finance/Tax/Legal decide UTC versus Africa/Lagos civil-time cutoff before book activation.
3. B2F03 defines Finance chart/dimension governance mapped to A5 accounts.
4. B2F04 implements fiscal-year/period runtime, transitions, locks, and tests.
5. B2F05 defines the Finance posting-request/A5 interface.
6. B2F06 defines role, materiality, maker-checker, and segregation controls.
7. B2F09 defines B1/A6/A7 source-to-Finance treatment.
8. B2F10/B2F11 define reconciliation and close evidence.
9. Retention durations and statutory accounting obligations receive accountable-owner approval.

No follow-up begins automatically.

## 6. Verification

- [x] ADR-0083 is the next number after the highest existing ADR-0082; no existing ADR was renumbered.
- [x] One bounded book/basis/legal-entity reference/currency/unit/calendar is defined.
- [x] Fiscal-year and period identity/lifecycle/control semantics are defined without runtime claims.
- [x] A5 remains account, posting, journal, line, balance, value, and reversal authority.
- [x] B1 remains commercial decision/document authority.
- [x] A6 remains partner/settlement authority; A7 remains product authority.
- [x] B3/B5/B6/B7/B8/B9/B10/C2 boundaries remain intact.
- [x] No multi-book, multi-entity, consolidation, FX, AR/AP, tax calculation, Treasury, reporting, statement, public API, frontend, or historical B2T11/B2T12 work is introduced.
- [x] No runtime source, entity, migration, service, controller, route, API, configuration, posting, balance, or period record is created.
