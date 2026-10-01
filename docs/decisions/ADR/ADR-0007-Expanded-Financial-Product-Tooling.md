# ADR-0007: M6 expanded financial product tooling remains non-money-moving

- **Status:** Proposed for domain review
- **Date:** 2026-08-03
- **Decision owners:** Future Product, Finance, Risk, Ledger, and Operations owners

## Context

M6 requires virtual-account records, saved beneficiaries, a bank directory, payment quotes, fee calculation, and limit evaluation. These objects support later controlled products but must not change the existing wallet, transfer, deposit, withdrawal, or ledger money engine.

## Decision

- Store virtual-account assignments, beneficiaries, banks, and payment quotes in owned tables with explicit validation and lifecycle fields.
- Enforce one active virtual account per wallet/provider and prevent duplicate beneficiaries using database uniqueness constraints.
- Keep bank directory operations internal and locally managed; do not synchronize with or call an external provider.
- Make quote money fields immutable after creation. Quote status may move from `ACTIVE` to `EXPIRED` or `USED`; expiry is evaluated on reads and use commands.
- Implement fee and limit engines as pure integer-minor-unit calculations/evaluations. They do not persist usage, execute payments, enforce limits, or mutate wallets.
- Extend the shared payment-reference sequence/registry for transfer, quote, and virtual-account references. Existing transfer references are populated additively without changing prior transfer behavior.
- Keep all M6 APIs internal and non-money-moving. No M6 operation creates a ledger journal or updates a wallet balance.

## Alternatives considered

1. **Execute a payment when creating a quote or evaluating a limit:** rejected because M6 is configuration and decision tooling, not payment execution.
2. **Cache fee or limit outcomes in wallets:** rejected because wallet balances remain ledger-derived and M6 does not own financial state.
3. **Synchronize the bank directory with an external provider:** rejected because external integration belongs to a later controlled capability.
4. **Use separate reference generators by domain:** rejected because references must be globally unique across transfer, deposit, withdrawal, quote, and virtual-account records.

## Consequences

M6 provides internal building blocks only; payment orchestration must explicitly consume quotes and evaluations in a later authorised flow. Fee rounding uses integer basis points with floor division and VAT is calculated on the fee. Limit evaluation requires the caller to provide current usage because no usage ledger or enforcement workflow is introduced here. Authentication and authorization remain prerequisites for production exposure.
