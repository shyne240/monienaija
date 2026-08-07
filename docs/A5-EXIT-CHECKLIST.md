# A5 Exit Checklist

- **Phase:** A5 — Internal Financial Pilot
- **Task:** A5T10 — A5 Integration, Pilot Release Gate, and A6 Handoff
- **Status:** Prepared for accountable-owner review; not approved
- **Integration matrix:** [`A5-INTEGRATION-MATRIX.md`](A5-INTEGRATION-MATRIX.md)
- **Route/rollback evidence:** [`A5-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A5-ROUTE-EXPOSURE-AND-ROLLBACK.md)
- **ADR review:** [`A5-ADR-REVIEW-STATUS.md`](A5-ADR-REVIEW-STATUS.md)
- **Recovery runbook:** [`A5-OPERATIONAL-RECOVERY-RUNBOOK.md`](A5-OPERATIONAL-RECOVERY-RUNBOOK.md)
- **Approval package:** [`A5-APPROVAL-PACKAGE.md`](A5-APPROVAL-PACKAGE.md)
- **A6 handoff:** [`A5-A6-HANDOFF-PACKAGE.md`](A5-A6-HANDOFF-PACKAGE.md)

## 1. Task evidence

| Task  | Required evidence                                                               | Repository evidence                                                                          | Status                                              |
| ----- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| A5T01 | Pilot boundary, baseline, ownership, gaps, prohibited edges                     | [`A5-PILOT-BASELINE.md`](A5-PILOT-BASELINE.md)                                               | Implemented/documented                              |
| A5T02 | Customer-aware command/correlation contract                                     | [`A5-TRANSFER-COMMAND-CONTRACT.md`](A5-TRANSFER-COMMAND-CONTRACT.md), ADR-0041               | Implemented/documented                              |
| A5T03 | A2/A4/A3 consumer gates and fail-closed behavior                                | `src/transfer/internal-transfer-gate.service.ts`, ADR-0042, gate tests                       | Implemented/tested                                  |
| A5T04 | Lifecycle states, metadata persistence, migration, transitions, recovery states | `Transfer`, `TransferLifecycleService`, migration `1785753600023`, ADR-0045, lifecycle tests | Implemented/tested; live migration pending          |
| A5T05 | Atomic Ledger post, account validation, lock order, journal correlation         | `postToLedger`, existing LedgerService, ADR-0043, lifecycle tests                            | Implemented/tested; Finance/Ledger approval pending |
| A5T06 | Bounded retries, timeout verification, unknown recovery, replay                 | `postToLedgerWithRetry`, ADR-0044, lifecycle tests                                           | Implemented/tested                                  |
| A5T07 | Minimal transactional outbox, event key, duplicate prevention, no publisher     | `transfer-events.ts`, OutboxService/entity, migration `1785753600024`, outbox tests          | Implemented/tested; no external publisher           |
| A5T08 | Independent read-only reconciliation and support trace                          | `TransferReconciliationService`, discrepancy types, reconciliation tests                     | Implemented/tested                                  |
| A5T09 | Cohort, limits, enable/disable, emergency stop, safety thresholds               | `PilotControlService`, migration `1785753600025`, ADR-0046, pilot/gate tests                 | Implemented/tested; activation pending              |
| A5T10 | Complete evidence, release/rollback, approvals, exit, and A6 handoff            | This documentation package                                                                   | Prepared; approval pending                          |

## 2. A5 acceptance checklist

### End-to-end authority and trace

- [x] A2 authorization is required before pilot admission and financial execution.
- [x] A5 pilot control is disabled by default and rejects missing/disabled/emergency-stopped/out-of-cohort/over-limit commands.
- [x] A4 policy is current, same-subject, same-capability/action, evidence-bound, expiry-bound, and obligation-bound.
- [x] A3 source/destination binding and account dimensions are independently rechecked.
- [x] Transfer metadata preserves Customer, account, command, policy, request, correlation, causation, and recovery references.
- [x] Ledger remains the sole authority for accounts, journals, lines, balances, and posted value.
- [x] A successful internal transfer maps to one balanced source debit/destination credit journal.
- [x] Transfer journal reference is persisted within the posting transaction and is not treated as financial truth.
- [x] A5T06 retains logical identity across retries, verifies timeout outcomes, and persists unknown outcomes deterministically.
- [x] A5T07 creates a minimal `transfer.completed` outbox fact atomically and prevents duplicate event keys.
- [x] A5T08 independently verifies transfer/journal/lines/account dimensions/outbox/audit evidence read-only.
- [x] A5T09 disable/kill-switch behavior stops new commands without editing completed history.

### Failure, recovery, and stop conditions

- [x] Serialization and deadlock retries are bounded.
- [x] Retry exhaustion is non-success and support-traceable.
- [x] Known Ledger/account/limit failures have deterministic non-success outcomes.
- [x] Commit-timeout evidence is verified before success/retry decisions.
- [x] Unknown outcomes retain a deterministic recovery reference and cannot be retried blindly.
- [x] Outbox/audit/idempotency failure cannot silently report a completed transfer.
- [x] Reconciliation discrepancy classes include missing/duplicate/mismatched journal, amount/currency/accounting-unit/account identity, missing outbox, and audit evidence.
- [x] Pilot stop conditions include reconciliation, journal, outbox, authorization, unknown-outcome, and safety-threshold failures.
- [x] Rollback/disable does not modify Transfer, Ledger, Outbox, or Reconciliation source history.

### Scope and production edges

- [x] No public API, route, controller, scheduler, broker, external provider, settlement, callback, notification, A6, A7, or A8 implementation is included.
- [x] External banks, NIBSS, settlement, deposits, withdrawals, payments, fees, FX, and product expansion remain excluded.
- [x] Reconciliation remains read-only.
- [x] No source repair or automatic financial correction is introduced.

## 3. Validation record

```text
npm test -- --runInBand
  Test Suites: 46 passed, 46 total
  Tests:       253 passed, 253 total

npm run lint          PASS
npm run build         PASS
npm run format:check  PASS
```

The validation is local repository evidence. It does not claim live PostgreSQL migration execution, production deployment, route exposure, pilot activation, or approval.

## 4. Unresolved exit blockers

| Blocker                                        | Severity     | Owner                                       | Required evidence                                            | Status      |
| ---------------------------------------------- | ------------ | ------------------------------------------- | ------------------------------------------------------------ | ----------- |
| A2 phase/security/route/data-exposure approval | Blocker      | Security/Architecture/Operations            | Approved protected caller and exposure boundary              | Pending     |
| A3 binding/read/reconciliation approval        | Blocker      | Wallet/Ledger/Finance/Reconciliation        | Approved handoff and account-control evidence                | Pending     |
| A4 ADR/persistence/retention approval          | Blocker      | Architecture/A4/Operations/Privacy          | ADR review, live migration/rollback, retention/hold decision | Pending     |
| A5 ADR-0041 through ADR-0046 approval          | Blocker      | Architecture and accountable owners         | Recorded decisions/conditions                                | Pending     |
| Finance/Ledger posting approval                | Blocker      | Finance/Ledger                              | Approved chart, accounts, posting/recovery controls          | Pending     |
| Pilot cohort/limits/threshold approval         | Blocker      | Product/Risk/Compliance/Security/Operations | Explicit approved cohort and envelope                        | Pending     |
| Live migration/deployment/rollback evidence    | Blocker      | Database/Operations/Release                 | Controlled apply, rollback, readiness, and drill evidence    | Pending     |
| Support/on-call/reconciliation ownership       | High         | Operations/Support/Reconciliation           | Runbook approval and operational drill                       | Pending     |
| A6 entry approval                              | Out of scope | Future A6 owners                            | Separate A6 plan and governance                              | Not started |

## 5. Exit result

**Implementation result:** A5T01-A5T09 runtime/documentation evidence is committed and local automated validation passes.

**Phase result:** `NOT APPROVED / CONDITIONAL — DO NOT ACTIVATE THE PILOT OR BEGIN A6.`

A5T10 records the evidence and blockers. It does not claim that a pilot is live, that money has moved in production, or that accountable owners have approved the release.
