# ADR-0005: Independent reconciliation and finance verification

- **Status:** Proposed for domain review
- **Date:** 2026-08-03
- **Decision owners:** Future Finance, Ledger, Risk, and Operations owners

## Context

Wallet balances, transfers, and journals are financially sensitive. Application-path tests alone can repeat the same assumptions as the write path and fail to detect drift. M4 requires controlled evidence that the ledger remains balanced, wallet accounts remain correctly owned, completed transfers remain traceable, and system totals remain conserved.

## Decision

Provide an independent, read-only reconciliation component that queries the PostgreSQL source tables directly rather than calling wallet, transfer, or ledger application services. Run a report in a `REPEATABLE READ` read-only transaction and return explicit `PASS`, `WARNING`, or `ERROR` checks for wallet/account ownership, ledger integrity, traceability, currency, and accounting-unit consistency.

Provide finance verification utilities for trial balance, asset and liability totals, journal integrity, balance conservation, and account activity. Expose these only through clearly internal verification routes; they are not customer or partner APIs and do not mutate financial state.

Use deterministic synthetic property/invariant tests and failure/recovery tests as release evidence. A reconciliation error or unresolved financial invariant violation blocks release and is investigated through controlled recovery procedures; rows are never edited to make a report pass.

## Consequences

The reconciliation queries intentionally duplicate key financial assertions independently of the application write path. Reports may be more expensive than ordinary reads and must be operationally scheduled or bounded as data volume grows. Authentication and authorization for internal tools remain a prerequisite for production exposure and are outside this milestone.
