# ADR-0006: Controlled internal deposits and withdrawals are explicit, journal-backed lifecycles

- **Status:** Proposed for domain review
- **Date:** 2026-08-03
- **Decision owners:** Future Payments, Ledger, Finance, Risk, and Operations owners

## Context

M5 introduces controlled payment capability without connecting an external rail. Deposits and withdrawals still need durable state, safe retries, globally unique references, settlement-account participation, and a clear boundary between a pending operational request and completed value movement.

## Decision

- Create deposits and withdrawals as idempotent `PENDING` records with globally sequenced payment references. A retry with the same request hash returns the original record; a changed payload is rejected.
- Complete a deposit or withdrawal only through an explicit internal lifecycle command. The command locks the payment and wallet rows, validates the state and wallet, and posts the corresponding journal through the existing ledger transaction manager.
- A completed deposit debits the configured settlement asset and credits the wallet. A completed withdrawal debits the wallet and credits the settlement asset. Wallet balances are never updated directly.
- Deposit and withdrawal records, journals, and journal lines commit or roll back together. Expected business failures become terminal `FAILED` records without journals; unexpected database failures roll back the entire transaction for retry/recovery.
- Use a shared payment-reference sequence and registry so deposit and withdrawal references are unique across both payment types. Seed NGN settlement asset, settlement clearing, and system suspense ledger accounts through the M5 migration; only the settlement asset is used by the deposit/withdrawal journal templates in this controlled scope.
- Keep lifecycle transitions explicit: deposits move from pending to completed/failed/cancelled; withdrawals move from pending to processing and then completed/failed/cancelled. Repeated terminal completion attempts are safe no-ops where the original completed outcome already exists.

## Alternatives considered

1. **Complete every payment at creation:** rejected because it cannot represent controlled pending, cancellation, or failure states.
2. **Mutate wallet balances while waiting for settlement:** rejected because the ledger is the only source of financial truth and pending operations must not invent value.
3. **Use separate reference counters per payment type:** rejected because references would not be globally unique across deposits and withdrawals.
4. **Treat callbacks as proof of completion:** rejected because external callbacks and partner integrations are outside M5 and require later verification controls.

## Consequences

The current internal completion commands are operational controls, not public customer APIs. Settlement asset accounts must be provisioned/funded in a controlled environment before a deposit can complete. Pending operations do not reserve wallet funds; the withdrawal completion transaction rechecks the ledger balance under lock. External rails, callbacks, notifications, authentication, and authorization remain future work and production exposure is not authorized by this implementation.
