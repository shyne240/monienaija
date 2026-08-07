# A3 Operational Recovery and Support Runbook Evidence

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T09 — A3 Integration, Reconciliation, and Release Gate
- **Status:** Prepared for operational-owner review; not a production authorization
- **Classification:** Documentation-only operational evidence
- **Application changes in this task:** None

## 1. Operating principles

A3 recovery is metadata recovery only:

- Never edit LedgerAccount balances, LedgerJournal rows, LedgerLine rows, or financial transaction records to clear an A3 discrepancy.
- Never rewrite `WalletAccount.customerId` to make an opaque legacy value appear canonical.
- Never reassign a binding to another Customer, CustomerWallet, WalletAccount, or LedgerAccount.
- Never report repair success without a durable audit/idempotency outcome and a subsequent independent reconciliation result.
- Never bypass A2 authorization or privileged-action approval.
- Preserve source records, audit evidence, reconciliation evidence, request/correlation IDs, and legal holds.

## 2. Evidence sources

Operators use the following read-only/evidence sources:

1. A3T07 binding reconciliation report from `ReconciliationService.getBindingReconciliation()`.
2. Existing internal reconciliation report and finance verification surfaces.
3. Operations audit and idempotency records.
4. Binding service/read-model results.
5. A2 authorization and privileged-action approval records.
6. Database migration/readiness evidence.
7. CustomerWallet, WalletAccount, LedgerAccount, and source-version records through owner-approved access.

Raw credentials, tokens, MFA proofs, device fingerprints, opaque customer values, and unnecessary financial payloads must not be copied into support tickets or general logs.

## 3. Discrepancy handling matrix

| A3T07 class                   | Initial state      | Immediate action                                              | Repair action permitted in A3T08                                                      | Owner                             |
| ----------------------------- | ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| `DUPLICATE_ACTIVE_BINDING`    | Blocked/error      | Freeze binding commands for affected scope; preserve evidence | No automatic reassignment; controlled review or terminal closure only                 | Reconciliation / Wallet / Finance |
| `ORPHANED_BINDING`            | Blocked/error      | Do not expose active financial account                        | Resolve to `PENDING` only after source evidence is consistent, or close with approval | Wallet / Customer Engineering     |
| `MISSING_*` source            | Blocked/error      | Do not fabricate account/balance                              | Manual review; close only when approved and physically possible                       | Source owner / Reconciliation     |
| `MISSING_ACTIVE_BINDING`      | Warning/non-active | Customer read returns missing-binding warning                 | No automatic account selection; approved binding execution or manual review           | Wallet / Customer Engineering     |
| `UNBOUND_FINANCIAL_WALLET`    | Warning/review     | Do not claim customer ownership from opaque value             | Explicit target review; no implicit bind or rewrite                                   | Wallet / Finance                  |
| `STALE_BINDING`               | Blocked/error      | Read model withholds balance                                  | Refresh metadata to `PENDING` only after approved source validation                   | Wallet / Reconciliation           |
| `CUSTOMER_OWNERSHIP_MISMATCH` | Blocked/error      | No ownership inference                                        | No reassignment; manual investigation or close                                        | Customer Engineering              |
| `ACCOUNT_OWNERSHIP_MISMATCH`  | Blocked/error      | No customer-facing active claim                               | Preserve WalletAccount compatibility value; manual review or close                    | Wallet / Finance                  |
| `CURRENCY_MISMATCH`           | Blocked/error      | Fail closed                                                   | No conversion or source mutation; manual review/close                                 | Finance / Ledger                  |
| `ACCOUNTING_UNIT_MISMATCH`    | Blocked/error      | Fail closed                                                   | No unit rewrite; manual review/close                                                  | Finance / Ledger                  |
| `LIFECYCLE_MISMATCH`          | Blocked/error      | Withhold active account/balance status                        | Resolve to pending or close under approved repair command                             | Wallet / Ledger                   |
| `QUERY_UNAVAILABLE`           | Control error      | Block repair and release decision                             | Restore read-only evidence path; no source changes                                    | Reconciliation / Operations       |

## 4. Approved A3T08 actions

### 4.1 Resolve to `PENDING`

Permitted only when:

- A2 authorization allows `wallet:account-binding:repair`.
- A2 privileged-action approval is valid, unexpired, resource-matched, and consumed with the exact action fingerprint.
- The binding is `REPAIR_REQUIRED`.
- Current Customer, CustomerWallet, WalletAccount, and LedgerAccount identity/dimension relationships are present and consistent.
- No financial source row needs to be changed.
- The command has a scoped idempotency key, reason, expected binding version, and correlation context.

This action does not make the account active and does not create a journal. A later approved binding retry is required for any `PENDING → ACTIVE` transition.

### 4.2 Close binding

Permitted only when:

- A2 authorization and privileged approval pass.
- The binding is non-active, or it is `ACTIVE` with an A3T07 binding-specific error requiring controlled deactivation.
- The action is idempotent, reasoned, version-checked, and audited.

Closing a binding is terminal metadata state. It does not delete or mutate source financial records, reverse value, or release identifiers for reuse.

## 5. Repair procedure

1. Identify the binding/customer-wallet/account scope from the A3T07 discrepancy and preserve the report timestamp.
2. Verify the operator/service principal, A2 authorization scope, MFA/approval context, and separation-of-duties requirement.
3. Obtain a privileged-action approval with action type `wallet:account-binding:repair`, exact resource, reason, and action fingerprint.
4. Submit the A3T08 repair command with an opaque idempotency key, expected binding version, reason, and request/correlation context.
5. Allow the repair service to re-read the binding and source records inside a serializable transaction.
6. If source identity/dimensions are not safe, leave the binding unresolved and escalate; do not force a state change.
7. For an approved transition, record the binding state/evidence change and Operations audit/idempotency outcome atomically.
8. Run A3T07 reconciliation again after the transaction.
9. Confirm the customer read model exposes `PENDING`, `CLOSED`, `STALE_BINDING`, or another truthful non-active state as applicable.
10. Close the incident only when the discrepancy has an owner, evidence, and controlled next state.

## 6. Failure and escalation procedure

| Failure                                    | Action                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Authorization denied                       | Stop; do not consume approval or mutate binding                                  |
| Approval missing/expired/resource mismatch | Stop; request a new correctly scoped approval                                    |
| Idempotency key conflict                   | Stop; preserve original outcome; do not use a changed payload under the same key |
| Stale binding version                      | Refresh evidence and retry only with a new approved version/context              |
| Reconciliation unavailable                 | Stop repair; restore read-only diagnostics first                                 |
| Transaction serialization/deadlock failure | Allow bounded retry; after exhaustion, preserve failure audit and investigate    |
| Unknown commit outcome                     | Query Operations/binding evidence; do not retry with a new target blindly        |
| Source missing/incompatible                | Manual review or approved closure; never change Ledger data                      |
| Audit/idempotency persistence failure      | Treat repair outcome as unconfirmed; do not report success                       |
| Legal/security/financial hold              | Stop ordinary cleanup/repair and escalate to hold owner                          |

## 7. Support evidence requirements

Every repair/rejection record must be traceable by:

- binding ID and canonical Customer UUID;
- CustomerWallet, WalletAccount, and LedgerAccount IDs;
- discrepancy type and A3T07 report timestamp;
- action, reason, expected version, and result state;
- approval ID and action fingerprint reference;
- idempotency scope/key status and request hash;
- principal, audit event, request ID, correlation ID, and trace ID; and
- post-repair reconciliation status.

Do not place raw `WalletAccount.customerId`, credentials, tokens, full ledger payloads, or sensitive investigative data in an unrestricted support record.

## 8. Operational readiness checklist

- [x] A3T07 discrepancy classes are typed and owner-assigned.
- [x] A3T08 uses A2 authorization and privileged approval.
- [x] Repair actions are metadata-only.
- [x] Repair actions use Operations idempotency and audit.
- [x] Repair requires a post-action reconciliation read.
- [x] No repair action posts journals or changes balances.
- [x] No automatic customer/account reassignment exists.
- [ ] Production database apply/revert and on-call drill evidence is recorded.
- [ ] Accountable Wallet, Finance, Ledger, Reconciliation, Operations, and Security owners approve the runbook.

This runbook is an A3T09 evidence input. It does not authorize production repair, A4/A5 work, or any financial correction.
