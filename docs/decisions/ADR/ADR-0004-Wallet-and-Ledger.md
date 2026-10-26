# ADR-0004: Wallet accounts are liability accounts backed by an immutable ledger

- **Status:** Proposed for domain review
- **Date:** 2026-08-03
- **Decision owners:** Future Wallet, Ledger, Finance, Risk, and Security owners

## Context

The application foundation now needs a first financial domain without introducing payment rails, customer identity, or direct balance mutation. Customer funds need a traceable account representation and a financial source of truth that remains correct under retries and concurrent writes.

## Decision

- Represent each customer/currency wallet as one active customer-funds liability account in the ledger. The wallet stores an opaque customer reference and never stores an independently authoritative balance.
- Store money as positive integer minor units plus an explicit currency. Debit and credit lines carry positive amounts; their direction determines the signed effect against an account's normal balance.
- Post a journal atomically with its lines in one PostgreSQL transaction. Account rows are locked in deterministic order before available-balance checks to prevent customer-funds accounts from becoming negative through concurrent posts.
- Require a durable idempotency key for wallet creation and journal posting. Persist a request fingerprint and return the original outcome for an identical retry; reject a key reused for a different command.
- Make posted journal headers and lines immutable. A correction is a new, linked compensating journal, never an update or deletion.
- Repeat the balance, currency, and immutability controls in the migration as database constraints/triggers so a second write path cannot silently bypass the application rules.

## Alternatives considered

1. **Store and mutate a wallet balance column:** rejected as an additional source of financial truth that can drift from the ledger.
2. **Allow unbalanced intermediate or posted journals:** rejected because downstream readers could observe or reconcile invented value.
3. **Use floating-point major-unit amounts:** rejected by ADR-0002 because rounding can corrupt financial records.
4. **Make a customer wallet a generic asset account:** rejected because customer funds are represented as a liability of the platform in this chart of accounts.

## Consequences

Wallet balance reads aggregate immutable ledger lines and may need query/index optimisation as volume grows. A chart-of-accounts owner must provision compatible system accounts before controlled value movement can be tested. The current HTTP chart and journal routes have no authentication because identity/access is explicitly outside this implementation; they must not be exposed as production public routes until that trust boundary exists. Finance, risk, security, reconciliation, and operational review remain release gates.
