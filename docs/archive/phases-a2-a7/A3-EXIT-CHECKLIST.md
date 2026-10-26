# A3 Exit Checklist

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T09 — A3 Integration, Reconciliation, and Release Gate
- **Status:** Prepared for accountable-owner review; not approved
- **Application changes in this task:** None
- **Approval package:** [`A3-APPROVAL-PACKAGE.md`](A3-APPROVAL-PACKAGE.md)
- **Integration matrix:** [`A3-INTEGRATION-MATRIX.md`](A3-INTEGRATION-MATRIX.md)

## 1. Task completion checklist

| Task  | Required evidence                                                                                                | Current evidence                                                                                                                                                                                                                                                                                                                             | Status                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A3T01 | Baseline, identity map, ownership inventory, gap register, duplicate/orphan query design                         | [`A3-BINDING-BASELINE.md`](A3-BINDING-BASELINE.md)                                                                                                                                                                                                                                                                                           | Prepared; owner approval pending             |
| A3T02 | Binding authority, source ownership, lifecycle, uniqueness, shared-read, prohibited-write, deactivation contract | [`ADR-0031-Customer-to-Financial-Account-Identity-Binding.md`](ADR/ADR-0031-Customer-to-Financial-Account-Identity-Binding.md), [`ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md`](ADR/ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md), [`A3-BINDING-OWNERSHIP-MATRIX.md`](A3-BINDING-OWNERSHIP-MATRIX.md) | Prepared; owner approval pending             |
| A3T03 | Deterministic Wallet/Ledger mapping, dimension rules, idempotency, failure matrix                                | [`ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md`](ADR/ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md), [`A3-WALLET-LEDGER-MAPPING-CONTRACT.md`](A3-WALLET-LEDGER-MAPPING-CONTRACT.md)                                                                                                                                 | Prepared; contract approval pending          |
| A3T04 | Binding entity, constraints, indexes, migration up/down, persistence tests                                       | `src/wallet/customer-financial-account-binding.entity.ts`, migration `1785753600021`, persistence tests                                                                                                                                                                                                                                      | Implemented/tested; live DB evidence pending |
| A3T05 | Authorized/audited/idempotent binding execution, replay/concurrency behavior, no monetary side effects           | `CustomerFinancialAccountBindingService`, binding tests                                                                                                                                                                                                                                                                                      | Implemented/tested                           |
| A3T06 | Authorized read model, Ledger-derived balance, stale/missing/non-active handling                                 | `CustomerFinancialAccountReadService`, read-model tests                                                                                                                                                                                                                                                                                      | Implemented/tested; route exposure pending   |
| A3T07 | Independent binding reconciliation, discrepancy classes, read-only diagnostics                                   | `ReconciliationService` binding report, discrepancy types, reconciliation tests                                                                                                                                                                                                                                                              | Implemented/tested                           |
| A3T08 | Privileged metadata-only repair, exception handling, recovery/idempotency/audit                                  | `CustomerFinancialAccountBindingRepairService`, repair tests                                                                                                                                                                                                                                                                                 | Implemented/tested                           |
| A3T09 | Integration matrix, route/rollback evidence, ADR review, approval package, exit checklist, A4/A5 handoff         | This A3 evidence package                                                                                                                                                                                                                                                                                                                     | Prepared; approval pending                   |

## 2. A3 acceptance criteria

### Identity and ownership

- [x] Customer UUID is the only canonical customer identity in A3 paths.
- [x] CustomerWallet remains metadata and provisioning evidence.
- [x] WalletAccount remains financial wallet facade.
- [x] Ledger remains source of financial account state, journals, lines, and balances.
- [x] Binding authority is singular and source ownership is not duplicated.
- [ ] Accountable Customer Engineering, Wallet, Ledger, Finance, and Reconciliation approval is recorded.

### Persistence and uniqueness

- [x] Binding schema has Customer, CustomerWallet, WalletAccount, and LedgerAccount relationships.
- [x] Active edge uniqueness and Customer-plus-currency uniqueness are defined.
- [x] Source versions and lifecycle states are persisted.
- [x] Invalid financial dimensions fail closed at persistence boundary.
- [x] Migration up/down and persistence metadata tests pass.
- [ ] Live PostgreSQL migration apply/revert and constraint inspection are recorded.

### Execution and read model

- [x] Binding execution requires A2 authorization.
- [x] Binding execution is audited and idempotent.
- [x] Replay and changed-payload behavior is tested.
- [x] Concurrent duplicate mapping is rejected.
- [x] Read model is authorized and read-only.
- [x] Read-model balance is obtained from LedgerService and not stored in metadata.
- [x] Missing/stale/non-active binding states do not fabricate an account or balance.

### Reconciliation and recovery

- [x] A3T07 runs direct read-only binding/source queries.
- [x] Duplicate, orphaned, missing, stale, ownership, lifecycle, currency, unit, and account discrepancies have typed results.
- [x] Every discrepancy carries severity, owner, recovery state, and source references.
- [x] A3T08 requires A2 authorization and privileged approval.
- [x] Repair actions are idempotent, audited, transaction-bounded, and metadata-only.
- [x] Repair never posts journals or changes balances.
- [x] Reconciliation is not used as a repair writer.

## 3. Release-gate checklist

- [x] `npm test -- --runInBand` passes on the current branch.
- [x] `npm run lint` passes on the current branch.
- [x] `npm run build` passes on the current branch.
- [x] `npm run format:check` passes on the current branch.
- [x] New A3 runtime tests cover persistence, binding, read, reconciliation, and repair behavior.
- [x] No A3 controller/API was added for binding/read/repair without an approved route contract.
- [x] No A4 policy, A5 money movement, A6 provider, A7 product, or A8 extraction implementation is present in the A3 package.
- [ ] Live PostgreSQL migration/reconciliation/rollback evidence is recorded.
- [ ] A2 entry/exit approval is recorded.
- [ ] A3 owner approvals are recorded.
- [ ] ADR-0034 and ADR-0035 are created/reviewed.
- [ ] A3 ADR numbering conflict is resolved.
- [ ] A3 route/exposure approval is recorded.

## 4. Exit result

**Implementation result:** A3T01-A3T08 evidence is present in the repository and automated validation passes.

**Phase result:** **NOT APPROVED / CONDITIONAL**. A3 must not be treated as approved until the unchecked release-gate conditions are resolved by accountable owners and recorded in [`A3-APPROVAL-PACKAGE.md`](A3-APPROVAL-PACKAGE.md).

A4 and A5 implementation remain blocked until the A3 approval decision is recorded.
