# A5 Operational Recovery and Support Runbook

- **Phase:** A5 — Internal Financial Pilot
- **Task:** A5T10 — A5 Integration, Pilot Release Gate, and A6 Handoff
- **Status:** Runbook prepared for Operations/Security/Finance/Support review; not a production authorization
- **Classification:** Documentation-only operational recovery evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Operating principles

A5 recovery is evidence-preserving control and support work:

- Ledger remains the authority for financial accounts, journals, lines, balances, and posted value.
- Transfer rows, journals, outbox facts, audit events, policy records, binding records, and reconciliation reports are not edited to make a command pass.
- A2 authorization, A4 policy, A3 binding, pilot control, Ledger, Operations, and Reconciliation answer separate questions.
- An A4 allow or pilot allow is not financial execution approval by itself.
- An unknown outcome is not optimistic success and not permission for blind retry.
- Pilot disable stops new admission only and never rewrites completed financial history.
- Diagnostics and reconciliation are observational/read-only and cannot repair or authorize.
- Restricted customer/account/policy/risk/compliance/security evidence is minimized, access-controlled, and audited.

No scheduler, broker, external publisher, public route, or automatic financial correction is part of A5T10.

## 2. Evidence sources and access

Use only approved A2-authorized internal read paths and owner-controlled evidence:

1. A2 authorization/principal/session/privileged-action/security-event evidence.
2. A5 pilot control/version/cohort/limit/kill-switch decision and audit evidence.
3. A4 policy decision/profile/snapshot/version/expiry/obligation/limit references.
4. A3 binding/read/reconciliation/control evidence.
5. Transfer lifecycle state, immutable command identity, request/correlation/trace/causation, journal, failure, and recovery references.
6. Ledger journal/line/account/balance evidence through Ledger-owned reads.
7. Operations idempotency, audit, outbox, metrics, diagnostics, and request context.
8. Independent transfer reconciliation report and discrepancy classifications.
9. Application version, migration head, release/disable control, incident, and support references.

Do not copy credentials, passwords, access/refresh tokens, MFA proofs, device fingerprints, raw policy snapshots, raw risk/compliance notes, full ledger lines, mutable balances, or unrestricted customer records into broad support channels.

## 3. Incident classification and immediate action

| Incident                                    | Immediate safe state                               | First owner            | Preserve                                                            | Prohibited response                                   |
| ------------------------------------------- | -------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Emergency stop active                       | Pilot admission denied                             | Operations/Release     | Environment version, control decision, request/correlation evidence | Clearing the stop in a customer command               |
| Durable pilot control disabled/missing      | Pilot admission denied                             | Operations/Product     | Control ID/version, cohort, audit, idempotency                      | Treating missing control as allow                     |
| Customer outside cohort/limit exceeded      | Command denied                                     | Pilot/Operations       | Customer UUID in restricted scope, amount/currency, decision code   | Broadening cohort or changing limits inline           |
| A2 authorization failure                    | Protected path denied                              | A2/Security            | Principal, resource/action, denial, security event                  | Treating as policy allow or bypassing A2              |
| A4 deny/pending/expired/currentness failure | No execution                                       | A4/Risk/Compliance     | Decision/profile/snapshot/expiry/reason/evidence refs               | Editing policy/source evidence                        |
| A3 binding/account discrepancy              | No account selection/posting                       | A3/Wallet/Ledger       | Binding IDs/versions, account dimensions, reconciliation report     | Repairing/reassigning in transfer path                |
| Ledger rejection/imbalance                  | Journal-free failed outcome                        | Ledger/Finance         | Transfer, journal attempt, account/currency/unit, error code        | Editing a journal or balance                          |
| Serialization/deadlock exhaustion           | Bounded retry conflict; no optimistic success      | Operations/Ledger      | Attempt count, SQLSTATE, same command/key, trace                    | Unbounded retry or new financial identity             |
| Commit-timeout/unknown outcome              | Verify durable Transfer/Ledger evidence            | Operations/Ledger      | Transfer/journal/outbox/idempotency/audit references                | Blind retry or optimistic success                     |
| Missing/duplicate/mismatched outbox         | Stop new pilot if threshold/stop condition applies | Operations             | Event key, payload hash/content, aggregate, transaction refs        | Treating outbox as financial truth or editing payload |
| Reconciliation error                        | Stop new pilot progression                         | Reconciliation/Finance | Read-only discrepancy report and source refs                        | Repairing source rows from report                     |
| Audit/idempotency unavailable               | Fail closed/no untraceable execution               | Operations             | Safe failure, request/correlation, attempted action                 | Returning success without evidence                    |

## 4. Standard recovery procedure

1. **Open an incident.** Record release/app version, pilot control version, capability/action, safe request/correlation/trace IDs, incident ID, and owner.
2. **Authorize access.** Verify the operator/support principal through A2 and apply least-privilege/audience controls.
3. **Stop new admission.** Activate the environment emergency stop or durable pilot disable if financial truth, reconciliation, authorization, outbox, audit, or unknown-outcome safety is uncertain.
4. **Preserve evidence.** Retain Transfer, Ledger, outbox, audit, idempotency, pilot-control, policy, binding, and reconciliation records under applicable holds.
5. **Trace the command.** Start with `commandId`, idempotency scope/key/hash, correlation/causation/request/trace IDs, then follow customer/account/binding, policy, Transfer, journal, outbox, and audit references.
6. **Verify financial truth from Ledger.** Confirm journal identity, immutable lines, debit/credit totals, currency, accounting unit, account IDs, and Ledger-derived balances through Ledger-owned reads.
7. **Verify lifecycle truth.** Confirm Transfer state, journal reference, failure/recovery fields, optimistic version, and whether the result is `COMPLETED`, `FAILED`, `CANCELLED`, `PENDING_RECOVERY`, or `UNKNOWN`.
8. **Verify Operations evidence.** Check the relevant idempotency record, `LEDGER_POSTED`/failure audit facts, outbox event key/payload/status, and metrics/diagnostics.
9. **Use bounded recovery only.** A5T06 performs bounded serialization/deadlock retry and timeout verification. Do not invent a new command, account, journal, key, or outbox event to resolve ambiguity.
10. **Reconcile independently.** Run the read-only transfer reconciliation report and classify discrepancies. Reconciliation does not repair.
11. **Escalate to the owner.** Assign A2/A3/A4/Ledger/Finance/Operations/Reconciliation/Support ownership based on the discrepancy classification.
12. **Close only with evidence.** Record decision, mitigation, stop/disable state, recovery reference, remaining discrepancy, follow-up owner, and approval. Do not claim financial resolution solely from an application response.

## 5. Recovery decision matrix

| Observed state/evidence                                               | Safe interpretation                               | Action                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Completed Transfer, valid matching Ledger journal, valid outbox/audit | One verified internal financial effect            | Keep history immutable; reconcile/support trace                       |
| Completed Transfer without journal or with invalid journal            | Controlled discrepancy; do not downgrade/edit row | Stop pilot, escalate Ledger/Reconciliation                            |
| Processing Transfer after unexpected failure, no verified journal     | Unknown outcome                                   | Preserve recovery reference; hold new retry until controlled recovery |
| Unknown/Pending Recovery with valid recovery reference                | Financial outcome unresolved                      | Operations/Ledger verification; no blind retry                        |
| Failed/Cancelled with no journal                                      | Verified non-success metadata outcome             | Preserve record; no compensating financial mutation                   |
| Outbox missing/duplicate/payload mismatch                             | Operations evidence discrepancy                   | Stop threshold/pilot if required; do not alter financial truth        |
| A2/A4/A3/pilot denial                                                 | Command did not enter financial execution         | Preserve audit; do not create Transfer/journal to simulate execution  |
| Retryable serialization/deadlock                                      | Transaction was boundedly rejected                | Retry same logical identity only within bound                         |
| Retry exhaustion                                                      | No optimistic success                             | Return controlled conflict and escalate/support trace                 |

## 6. Disable and rollback-safe procedure

1. Set `A5_PILOT_EMERGENCY_STOP=true` or call the authorized durable control disable.
2. Verify new gate requests return the expected pilot denial and do not reach A4/Ledger.
3. Preserve all completed Transfer, Ledger, outbox, audit, idempotency, policy, binding, and reconciliation records.
4. Do not delete or rewrite completed transfers, journals, lines, balances, or outbox facts.
5. Investigate in-flight `PROCESSING`, `PENDING_RECOVERY`, and `UNKNOWN` states through A5T06 and Ledger/Operations evidence.
6. Run the independent reconciliation report and record discrepancies.
7. Roll back code/config only after compatibility with applied schema and immutable historical records is assessed.
8. Keep the pilot disabled until the cause, owner, mitigation, stop condition, and approval are recorded.
9. Re-enable only with a new A2-authorized control mutation and a reviewed go/no-go decision.

Disabling the pilot is not a financial rollback. Any approved financial correction remains a Ledger/Finance compensating-entry decision outside A5T10.

## 7. Support trace contract

An approved support trace may include, subject to A2 audience authorization:

```text
commandId
transferId
sourceCustomerId / destinationCustomerId
source/destination WalletAccount and LedgerAccount IDs
A3 binding IDs/versions
A2 authorization reference
A4 decision/profile/policy/snapshot references
pilot control ID/version/decision code
idempotency scope/key/request hash
request/correlation/trace/causation IDs
journal ID and verified journal correlation
outbox event ID/event key/schema version
recovery reference
reconciliation discrepancy keys
```

The trace must not expose secrets, raw evidence, unrestricted risk/compliance data, mutable balance snapshots, or full journal-line payloads. Support reads are audited by Operations.

## 8. Operational ownership and stop conditions

- **Operations:** idempotency, audit, outbox, metrics, diagnostics, readiness, incident evidence, and control mutation history.
- **Security/A2:** principal, authorization, emergency access, route/data exposure, and security incidents.
- **Risk/Compliance/A4:** policy decision/currentness, source evidence, obligations, and policy recovery.
- **Wallet/A3:** customer/account binding, ownership, lifecycle, and binding control evidence.
- **Ledger/Finance:** accounts, journals, lines, balances, posting, financial discrepancies, and corrections.
- **Reconciliation:** independent read-only discrepancy reports.
- **Support:** approved trace access and customer/internal communication under owner controls.

Stop new pilot activity for journal imbalance, unexplained balance drift, missing or corrupt outbox, audit/idempotency failure, authorization failure, repeated unknown outcomes, reconciliation error, or any unexplained identity/account mismatch.

## 9. Runbook readiness evidence

- [x] A5T06 timeout/retry/unknown recovery behavior is linked.
- [x] A5T07 outbox event identity, rollback, duplicate prevention, and no-publisher boundary are linked.
- [x] A5T08 independent read-only reconciliation and discrepancy classifications are linked.
- [x] A5T09 pilot cohort, limits, emergency stop, disable, audit, and safety threshold behavior is linked.
- [x] A2/A3/A4/Ledger/Operations/Reconciliation/Support ownership is explicit.
- [x] No repair writer, public exposure, scheduler, broker, external integration, or financial correction is introduced.
- [ ] Operations/Security/Finance/Reconciliation/Support approve the runbook.
- [ ] On-call/recovery drill and live deployment evidence are recorded.
- [ ] Pilot activation and A5 phase approval are recorded.

This runbook is an operational decision input. It does not authorize production recovery, pilot activation, route exposure, or A6 work.
