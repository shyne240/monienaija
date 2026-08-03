# ADR-0002: Represent money as integer minor units with currency

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owners:** Chief Software Architect; future Finance and Ledger owners

## Context
Binary floating-point arithmetic can introduce rounding errors that are unacceptable for balances, fees, settlements, and audit. Monetary records must be precise, comparable, and support accounting rules across currencies and product contexts.

## Decision
Represent a monetary amount as an integer count of minor units plus an explicit ISO 4217 currency code (for example, NGN kobo). Store, transmit, validate, and calculate amounts using integer/decimal-safe types appropriate to the selected platform; never use binary floating point. The currency exponent and rounding policy are controlled reference data. A monetary value is not an amount alone: it includes currency, and where relevant the account, effective time, rate/source, and business purpose. Ledger posting validates currency compatibility and exact debit/credit equality; display formatting occurs at the edge.

## Alternatives considered
1. **Floating-point naira values:** rejected because representational error can corrupt financial results.
2. **Arbitrary decimal strings everywhere:** precise but invites inconsistent scale, parsing, and normalization without strict controls.
3. **Integer minor units without currency:** simple but unsafe for multi-currency evolution and integration clarity.

## Consequences
APIs, schemas, tests, reporting, and partner adapters must explicitly handle scale and currency. Currency conversion, fractional pricing, and rounding require approved domain rules and test coverage. Existing values are corrected by compensating entries, never in-place edits.
