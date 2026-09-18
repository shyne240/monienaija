# ADR-0085 — B2 Finance Fiscal Year and Accounting Period Runtime

- **ADR ID:** ADR-0085
- **Platform:** B2 — Finance Platform
- **Task:** B2F04 — Finance Fiscal Year and Accounting Period Runtime
- **Status:** Accepted; bounded internal runtime implemented
- **Decision date:** 2026-08-09
- **Authoritative contract:** [`docs/B2F-FISCAL-PERIOD-CONTRACT.md`](../B2F-FISCAL-PERIOD-CONTRACT.md)
- **Migration:** `1785753600046-CreateB2FFinanceFiscalPeriodTables.ts`

## 1. Context

B2F02 froze one NG primary accrual book, Gregorian January–December fiscal years, twelve monthly UTC periods, and states `PLANNED`, `OPEN`, `SOFT_CLOSED`, `HARD_CLOSED`, `REOPENED`, and `RETIRED`. B2F03 preserved A5 account authority and added no runtime mapping.

The repository had no Finance fiscal-year/period runtime. A5 had no Finance period gate and must remain posting/value authority. B2F04 therefore needs an internal period authority and a read-only future-B2F05 admission port without changing A5.

## 2. Decision

### 2.1 Persistence

Create two tables through migration `1785753600046`:

- `b2f_finance_fiscal_years` — frozen scope, deterministic identity/hash, state, and optimistic version;
- `b2f_finance_accounting_periods` — twelve versioned monthly definitions, lifecycle/control metadata, deterministic hashes, optimistic version, and restricted fiscal-year FK.

No journal, account, balance, posting, AR/AP, statement, report, or Treasury table is created.

### 2.2 Creation

`B2FFiscalPeriodService.createFiscalYear()` creates one January–December fiscal year and twelve `PLANNED` monthly UTC periods atomically in a serializable transaction. Definitions/references are deterministic; random IDs/timestamps are excluded from semantic hashes.

Creation uses shared idempotency scope `b2.finance.fiscal-period.create.idempotency.v1` and shared audit.

### 2.3 Lifecycle

Allowed transitions are exactly:

- `PLANNED -> OPEN | RETIRED`
- `OPEN -> SOFT_CLOSED | RETIRED`
- `SOFT_CLOSED -> OPEN | HARD_CLOSED | RETIRED`
- `HARD_CLOSED -> REOPENED | RETIRED`
- `REOPENED -> SOFT_CLOSED`
- `RETIRED ->` none

Hard close requires reconciliation and close-checklist references. Reopen requires correction scope and future expiry. Lifecycle metadata is additive; hard-close evidence is preserved after reopen.

### 2.4 Security

Every lifecycle transition consumes an A2 `PrivilegedActionApprovalService` approval bound to exact period UUID, target action, expected version, reason, and control-evidence fingerprint. B2F04 creates no IAM authority.

No canonical legal-entity/accounting-policy runtime exists yet. B2F04 records approval-bound evidence references but cannot independently resolve their contents. Production opening remains review-gated.

### 2.5 Idempotency and concurrency

Lifecycle uses `b2.finance.fiscal-period.lifecycle.idempotency.v1`. Identical commands replay without consuming approval twice; changed payload conflicts.

Transactions are serializable, period rows are pessimistically locked, commands carry expected record versions, and entities use optimistic version columns. Contradictory commands cannot both apply to the same observed version.

### 2.6 Audit/history

Shared `AuditService` records fiscal/period creation, transitions, rejected attempts against existing periods, and synchronized fiscal-year state. Runtime exposes no delete method; the FK uses `ON DELETE RESTRICT`.

### 2.7 Consumer admission port

Expose an internal read-only consumer port for B2F05:

- ordinary admission only while `OPEN`;
- close adjustment only while `SOFT_CLOSED`;
- reopen correction only while `REOPENED` and unexpired;
- exact book/legal-entity/currency/unit/date compatibility.

The port does not mutate state, reserve idempotency, or call A5.

### 2.8 A5 boundary

B2F04 imports/injects no Ledger service/entity. It creates no account, journal, line, posting, balance, reversal, or global A5 lock. Existing A5 modules remain unchanged. B2F05 must separately integrate Finance admission with future Finance-directed posting.

## 3. Consequences

### Positive

- Finance now has a bounded durable fiscal-year/period authority.
- Lifecycle is explicit, privileged, replay-safe, concurrency-protected, and auditable.
- Reopen is correction-scoped and non-destructive.
- B2F05 can consume a read-only period admission decision.
- A5/B1/A6/A7 and later-platform boundaries remain intact.

### Constraints

- Legal-entity and accounting-policy evidence is reference-based pending canonical runtime/ratification.
- UTC statutory suitability remains under review.
- Close references are required but B2F10/B2F11 engines do not yet exist.
- The period gate does not automatically block existing A5 transaction posting.
- Migration execution/production activation is not claimed.

## 4. Alternatives considered

### Put periods in A5

Rejected: fiscal governance belongs to B2 and would overload A5 posting/value authority.

### Add period columns to A5 journals now

Rejected: this would begin B2F05 and modify existing posting behavior.

### Use B1 commercial period keys

Rejected: they are commercial source periods, not Finance fiscal-period authority.

### Implement transitions without privileged approval

Rejected: open/close/reopen are controlled Finance actions.

### Use in-memory periods

Rejected: lifecycle, replay, audit, and concurrency evidence must be durable.

### Create a new idempotency/audit store

Rejected: shared Operations services already own those authorities.

### Implement a public period API

Rejected: B10 owns developer/public integration and B2F04 needs only internal service ports.

## 5. Follow-up

- Ratify legal-entity and accounting-policy evidence authorities.
- Decide statutory UTC versus Africa/Lagos calendar interpretation before production activation.
- B2F05 consumes admission without modifying this authority.
- B2F06 completes Finance role/materiality controls.
- B2F10/B2F11 provide real reconciliation/close references.
- Define retention/legal-hold duration and operational recovery.

No follow-up begins automatically.

## 6. Verification

- [x] ADR-0085 follows highest existing ADR-0084; no ADR renumbered.
- [x] Fiscal year and twelve monthly period persistence implemented.
- [x] Frozen scope and lifecycle enforced.
- [x] Shared idempotency/audit/privileged approval reused.
- [x] Serializable transactions, pessimistic locks, expected versions, optimistic versions, and uniqueness used.
- [x] Read-only B2F05 admission port implemented.
- [x] No Ledger posting/balance/account mutation or B1/A6/A7 mutation exists.
- [x] No public API, controller, frontend, Treasury, reporting, statement, or IAM authority introduced.
