# A5T11 — A5 AR Control Account Provisioning Contract

- **Owner:** A5 Ledger & Internal Financial Core
- **ADR:** [`ADR-0090 — A5 AR Control Account Provisioning`](ADR/ADR-0090-A5-AR-Control-Account-Provisioning.md)
- **Status:** Runtime provisioning authority implemented; account not provisioned by migration or startup
- **Schema migration:** None
- **Blocked downstream task:** B2F07 Accounts Receivable

## 1. Purpose

A5T11 provides one bounded, privileged, idempotent orchestration for provisioning and canonically verifying the authorized A5 accounts-receivable control account through `LedgerService.createAccount()`.

It creates no account automatically. The account is created only when an authorized caller invokes the service with valid A2 approval and an allowing B2F06 control decision.

## 2. Authorized definition

```text
code:                 FINANCE-ACCOUNTS_RECEIVABLE-NGN
name:                 Finance accounts receivable control NGN
accountType:          ASSET
normalBalance:        DEBIT
currency:             NGN
accountingUnit:       CUSTOMER_FUNDS
allowNegativeBalance: false
```

Any changed field fails before account creation.

## 3. Existing authority reuse

- A5 `LedgerService.createAccount()` creates the canonical UUID/account.
- `LedgerService.listAccounts()` checks for an existing code before creation/recovery.
- `LedgerService.getAccount()` performs canonical post-create verification.
- A2 `PrivilegedActionApprovalService` owns approval lifecycle.
- B2F06 evaluates `FINANCE_A5_AR_ACCOUNT_PROVISION` controls.
- Shared Operations owns idempotency, audit, outbox, and metrics.

A5T11 creates no second account or ledger authority.

## 4. Provisioning flow

1. Validate exact authorized definition.
2. Reserve shared idempotency.
3. Read A5 accounts and detect exact/preexisting or conflicting code.
4. Consume A2 approval bound to action, code resource, and exact definition fingerprint.
5. Evaluate B2F06 control using maker/checker provenance.
6. If no exact account exists, call `LedgerService.createAccount()` once.
7. On error/uncertain response, read A5 before deciding whether to retry or fail unknown.
8. Verify committed UUID and every account property using `LedgerService.getAccount()`.
9. Record audit, outbox, metrics, and durable idempotency result.
10. Return B2F03-ready evidence without creating a mapping.

## 5. Idempotency and recovery

Scope:

```text
a5.ar-control-account.provision.idempotency.v1
```

The semantic hash includes the exact account definition and idempotency key. It excludes generated UUID, timestamps, audit/outbox IDs, and replay flags.

- Same key/hash replays the original evidence.
- Same key with changed definition conflicts.
- Existing exact account is recovered only after approval/control checks.
- Existing code with changed properties conflicts.
- A lost response is recovered by canonical A5 lookup and property verification.
- If no account can be verified after an uncertain result, the transaction fails with an unknown-outcome error; it does not blindly create another account.

## 6. Approval and controls

A2 action:

```text
FINANCE_A5_AR_ACCOUNT_PROVISION
```

Resource:

```text
type: A5_AR_CONTROL_ACCOUNT_PROVISION
id:   FINANCE-ACCOUNTS_RECEIVABLE-NGN
```

The fingerprint covers the exact authorized definition. B2F06 must allow the action under an effective active policy. Missing, denied, expired, consumed-with-mismatched-evidence, stale, or resource/fingerprint-mismatched approval fails closed.

No production account is created merely because tests use a fixture policy.

## 7. Audit, outbox, and metrics

Audit actions:

- `AR_CONTROL_ACCOUNT_PROVISIONED`
- `AR_CONTROL_ACCOUNT_RECOVERED`

Success outbox event:

- `A5ArControlAccountProvisioned`

Metrics:

- `a5.ar-control-account.provisioned`
- `a5.ar-control-account.rejected`

No success event is emitted until A5 returns or canonical lookup verifies the exact committed account.

## 8. B2F03 handoff

The result contains:

- canonical A5 UUID;
- code/name/type/normal balance;
- currency/accounting unit;
- negative-balance and active state;
- provisioning reference/version;
- definition/request/snapshot hashes;
- approval/control/audit/correlation evidence;
- `readyForB2F03Mapping = true`.

This evidence authorizes only a later B2F03 mapping proposal. It does not create or activate `finance.asset.receivable`.

## 9. Security and privacy

The record contains no customer identity, credentials, token, secret, invoice, receivable, or balance. Provisioning is internal and exposes no new controller/route/API.

## 10. Failure behavior

- Invalid definition: rejected before idempotency/account creation.
- Code conflict: rejected without mutation.
- A2/B2F06 denial: rejected without A5 creation.
- Post-create mismatch: rejected and flagged for owner review; no destructive deletion.
- Unknown result with no canonical evidence: explicit unknown error and safe retry procedure.
- Account exists but mapping absent/rejected: account remains valid A5 history but unusable by Finance.

## 11. Explicit non-goals

A5T11 does not:

- create/activate a B2F03 mapping;
- implement B2F07 AR, B2F08, or B2F09;
- create invoices/payment terms;
- post journals/lines, mutate balances, or reverse value;
- repurpose settlement, clearing, suspense, or wallet accounts;
- modify B1;
- expose a public API;
- create a schema migration.

## 12. Verification

- [x] Authorized definition is compatible with the existing A5 account model.
- [x] Provisioning delegates to `LedgerService.createAccount()`.
- [x] Canonical post-create verification is required.
- [x] Shared idempotency/A2/B2F06/audit/outbox/metrics are reused.
- [x] Changed payload, duplicate, approval, control, and unknown outcomes fail safely.
- [x] B2F03-ready evidence is returned without mapping creation.
- [x] No journal, balance, AR, B1, public API, or later-task behavior is introduced.
