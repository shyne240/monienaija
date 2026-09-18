# ADR-0090 — A5 AR Control Account Provisioning

- **ADR ID:** ADR-0090
- **Task:** A5T11 — A5 AR Control Account Provisioning
- **Owner:** A5 Ledger & Internal Financial Core
- **Status:** Accepted; bounded provisioning runtime implemented
- **Contract:** [`docs/A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md`](../A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md)
- **Migration:** None

## Context

B2F07 requires an approved A5 receivable control account before B2F03 can map `finance.asset.receivable`. The current A5 account model and `LedgerService.createAccount()` support the authorized `ASSET`/`DEBIT`/`NGN`/`CUSTOMER_FUNDS`/non-negative definition. No existing account may be repurposed, and B2 Finance cannot create A5 accounts.

## Decision

1. Add an internal A5 provisioning service that validates exactly `FINANCE-ACCOUNTS_RECEIVABLE-NGN` / `Finance accounts receivable control NGN` and its authorized properties.
2. Delegate canonical creation exclusively to `LedgerService.createAccount()`.
3. Verify existing or newly created accounts through A5 reads before returning evidence.
4. Reuse shared idempotency scope `a5.ar-control-account.provision.idempotency.v1`.
5. Require A2 privileged approval and B2F06 action `FINANCE_A5_AR_ACCOUNT_PROVISION` bound to exact definition fingerprint.
6. Recover uncertain outcomes by canonical account lookup before any retry.
7. Emit audit/outbox/metrics only after canonical verification.
8. Return evidence for a later B2F03 mapping proposal; do not create the mapping.
9. Create no migration, controller, journal, line, balance, AR record, invoice, payment term, or later-task behavior.

## Consequences

- A5 remains the only canonical account authority.
- A generated canonical UUID is known only after authorized provisioning executes.
- The account cannot be used by Finance until B2F03 separately approves/activates its mapping.
- Exact duplicates replay/recover; conflicting definitions fail closed.
- A missing active B2F06 policy prevents production provisioning.

## Alternatives rejected

- Seed through migration: bypasses runtime approval/control and is not required by schema.
- Create account in B2F03/B2F07: violates A5 authority.
- Reuse settlement/clearing/suspense/wallet account: incorrect purpose and prohibited.
- Blind retry after timeout: duplicate-risk.
- Add public provisioning API: unnecessary and out of scope.

## Verification

- [x] Existing A5 model supports the authorized definition without semantic changes.
- [x] A5 creation/read authority is reused.
- [x] A2/B2F06 and Operations controls are reused.
- [x] No migration or direct ledger-table mutation is introduced.
- [x] No mapping, AR, B1, posting, balance, public API, B2F08, or B2F09 behavior is introduced.
