# A5 Internal Financial Pilot Approval Package

- **Phase:** A5 — Internal Financial Pilot
- **Task:** A5T10 — A5 Integration, Pilot Release Gate, and A6 Handoff
- **Status:** Prepared for accountable-owner review; **not approved**
- **Classification:** Documentation-only approval and release evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Executive summary

A5 implements one bounded internal customer-to-customer transfer path inside the existing modular monolith. The committed artifacts establish:

- A2 authorization separation;
- A5 pilot cohort/limit/kill-switch admission;
- A4 policy/evidence/currentness/obligation validation;
- A3 source/destination binding and ownership validation;
- durable transfer lifecycle and pending/unknown states;
- Ledger-owned balanced double-entry posting;
- bounded retry, timeout verification, replay protection, and unknown recovery;
- a minimal transactional `transfer.completed` outbox fact;
- independent read-only reconciliation and deterministic discrepancies; and
- disable/rollback-safe pilot controls.

The package does not claim production deployment, live migration execution, owner approval, customer activation, public exposure, external settlement, or A6 readiness.

## 2. Evidence index

| Evidence                                                                                                                                     | Purpose                                                       | Status                           |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| [`A5-INTEGRATION-MATRIX.md`](A5-INTEGRATION-MATRIX.md)                                                                                       | Task-to-evidence and end-to-end trace                         | Prepared                         |
| [`A5-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A5-ROUTE-EXPOSURE-AND-ROLLBACK.md)                                                                     | Exposure, disable, emergency stop, rollback, prohibited edges | Prepared; no route approved      |
| [`A5-ADR-REVIEW-STATUS.md`](A5-ADR-REVIEW-STATUS.md)                                                                                         | ADR-0041 through ADR-0046 review register                     | Prepared; approval pending       |
| [`A5-OPERATIONAL-RECOVERY-RUNBOOK.md`](A5-OPERATIONAL-RECOVERY-RUNBOOK.md)                                                                   | Recovery, support trace, ownership, and stop conditions       | Prepared; owner review pending   |
| [`A5-EXIT-CHECKLIST.md`](A5-EXIT-CHECKLIST.md)                                                                                               | Acceptance, validation, and exit blockers                     | Prepared; not approved           |
| [`A5-A6-HANDOFF-PACKAGE.md`](A5-A6-HANDOFF-PACKAGE.md)                                                                                       | Permitted A6 handoff and prohibited external edges            | Prepared; handoff blocked        |
| [`A5-PILOT-BASELINE.md`](A5-PILOT-BASELINE.md)                                                                                               | A5T01 boundary and gap baseline                               | Committed                        |
| [`A5-TRANSFER-COMMAND-CONTRACT.md`](A5-TRANSFER-COMMAND-CONTRACT.md)                                                                         | A5T02 command/correlation contract                            | Committed                        |
| [`ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md`](ADR/ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md)         | Command identity and financial boundary                       | Proposed; implementation-aligned |
| [`ADR-0042-Financial-Command-Authorization-and-Policy-Evaluation.md`](ADR/ADR-0042-Financial-Command-Authorization-and-Policy-Evaluation.md) | A2/A4/A3 consumer gates                                       | Proposed; implementation-aligned |
| [`ADR-0043-Ledger-Posting-and-Customer-Transaction-Correlation.md`](ADR/ADR-0043-Ledger-Posting-and-Customer-Transaction-Correlation.md)     | Atomic Ledger posting and journal correlation                 | Proposed; implementation-aligned |
| [`ADR-0044-Transfer-Idempotency-Outbox-and-Recovery.md`](ADR/ADR-0044-Transfer-Idempotency-Outbox-and-Recovery.md)                           | Retry/recovery/outbox boundary                                | Proposed; implementation-aligned |
| [`ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md`](ADR/ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md)             | Transfer lifecycle/pending/unknown state                      | Proposed; implementation-aligned |
| [`ADR-0046-Pilot-Limits-Cohorts-and-Rollback.md`](ADR/ADR-0046-Pilot-Limits-Cohorts-and-Rollback.md)                                         | Cohort/limits/disable/safety controls                         | Proposed; implementation-aligned |

## 3. Decisions requested

Accountable owners are asked to approve, approve with conditions, return, or reject the following decisions:

1. A5 remains limited to `wallet.transfer/create` internal customer-to-customer transfer.
2. `Customer.id`, explicit A3 binding IDs, WalletAccount IDs, and LedgerAccount IDs remain distinct canonical references.
3. A2 authorization remains separate from A4 policy, pilot admission, A3 binding, and Ledger execution.
4. The internal gate sequence and fail-closed behavior are acceptable.
5. Transfer lifecycle, immutable identity, pending/unknown outcomes, and recovery reference rules are acceptable.
6. Ledger posting uses one balanced customer-funds journal and remains Ledger-owned.
7. Operations audit/idempotency/outbox scopes and the minimal `transfer.completed` event are acceptable.
8. Independent reconciliation is read-only and discrepancy classifications require owner investigation, not automatic repair.
9. Pilot control is disabled by default; the actual cohort, currency, limits, safety thresholds, and emergency-stop ownership are approved before activation.
10. Existing routes remain non-approved until a separate A2 route/data-exposure decision is recorded.
11. A5 may hand off bounded internal contracts to A6 only after all A5 exit conditions are approved; no A6 implementation begins from this package.

## 4. Owner approval register

No signatures, approvals, dates, or risk acceptances are fabricated.

| Owner/review                     | Required decision                                                                                | Approver | Decision/date | Conditions/comments                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | -------- | ------------- | ------------------------------------------- |
| Architecture                     | A5 boundary, ADR-0041–0046, modular-monolith placement, no prohibited edges                      | Pending  | Pending       | Review integration matrix and ADR register  |
| Security / A2                    | Exact authorization, pilot-control mutation, route/data exposure, emergency stop, support access | Pending  | Pending       | Keep existing routes non-approved           |
| Customer Engineering             | Customer identity, command/correlation, support trace, cohort semantics                          | Pending  | Pending       | Confirm canonical Customer.id use           |
| Wallet / A3                      | Binding, ownership, account dimensions, lifecycle, repair/read boundaries                        | Pending  | Pending       | Confirm no command-side repair/reassignment |
| A4 / Product / Risk / Compliance | Policy profile, currentness, limits/obligations, expiry, risk/compliance boundaries              | Pending  | Pending       | Confirm A4 remains policy authority         |
| Ledger / Finance                 | Account chart, double-entry, posting, balance, journal immutability, corrections                 | Pending  | Pending       | Confirm no transfer financial authority     |
| Operations                       | Audit/idempotency/outbox/metrics/diagnostics, recovery, on-call, retention                       | Pending  | Pending       | Approve outbox and pilot safety signals     |
| Reconciliation                   | Read-only report, discrepancy ownership, stop thresholds                                         | Pending  | Pending       | Confirm no report-driven repair             |
| Privacy / Legal                  | Data classification, retention, legal holds, support disclosure                                  | Pending  | Pending       | Review restricted IDs/payloads              |
| Support                          | Support trace, incident workflow, customer/internal communication                                | Pending  | Pending       | Approve runbook and escalation              |
| Database / Release               | Migration apply/rollback, deployment, readiness, disable drill                                   | Pending  | Pending       | No live execution evidence in repository    |
| Product / Pilot owner            | Cohort, limits, thresholds, go/no-go, rollback ownership                                         | Pending  | Pending       | Seed control remains disabled               |

## 5. Go/no-go recommendation

### Current recommendation

```text
NO-GO — IMPLEMENTATION EVIDENCE COMPLETE, APPROVAL/ACTIVATION CONDITIONS OPEN
```

### Go conditions

All of the following must be recorded before any pilot activation:

- A2/A3/A4 phase approvals.
- A5 ADR review and accountable owner decisions.
- Finance/Ledger posting approval.
- Live migration up/down and deployment/rollback evidence.
- Explicit approved Customer UUID cohort.
- Exact currency, minimum/maximum transaction, daily customer, and safety thresholds.
- Emergency-stop and durable-disable ownership/test evidence.
- Operations/Reconciliation/Support on-call and recovery approval.
- A protected internal caller/route decision under A2.
- Successful and failure-path evidence using approved test/synthetic data.

### No-go conditions

A5 remains disabled if any required identity, gate, control, account, policy, idempotency, audit, outbox, reconciliation, deployment, or approval evidence is missing, stale, conflicting, unavailable, or unexplained.

## 6. Explicit non-claims

This approval package does not claim:

- a production or staging pilot is active;
- a live database migration has been applied or rolled back;
- money has moved in production;
- external settlement or provider reliability;
- customer-facing route/API approval;
- security/privacy/legal/Finance/Risk/Compliance/Operations approval; or
- A6 entry approval.

## 7. Approval outcome rules

- **Approve:** Record owner, date, conditions, evidence references, and follow-up owner.
- **Approve with conditions:** Record every condition, owner, severity, mitigation, stop condition, and rollback behavior. Conditions cannot weaken Ledger/A2/A3/A4/Reconciliation boundaries.
- **Return with comments:** Keep status conditional and identify required evidence before re-review.
- **Reject:** Require a revised/superseding boundary decision before affected implementation or activation.
- **No response:** Remains pending; no activation is authorized.
