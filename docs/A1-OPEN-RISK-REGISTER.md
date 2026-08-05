# A1 Open-Risk Register

- **Task:** A1T14 — A1 Review Package and Exit Evidence
- **Review date:** 2026-08-05
- **Status:** Open risks carried into accountable-owner review and future phase gates
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Risk register

| ID      | Risk / unresolved question                                                      | Impact                                                  | Accountable owner                                      | Mitigation / exit evidence                                                                                              | Target decision date               | Status |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| A1-R001 | Runtime authentication and authorization are absent while internal routes exist | Unsafe exposure or unauthorized access                  | Security / A2 owner                                    | Keep deployment/network restrictions; approve A2 principal, session, authorization, privileged-action, and audit design | Before A2 entry                    | Open   |
| A1-R002 | Customer-wallet metadata is not canonically bound to ledger-backed accounts     | Wrong mapping, duplicate provisioning, or inconsistency | Wallet / Ledger / Finance                              | A3 binding, repair, lifecycle, and independent reconciliation contract                                                  | Before A3 implementation           | Open   |
| A1-R003 | P1.3/onboarding risk vocabulary differs from P1.10                              | Inconsistent policy decisions                           | Risk / Compliance / A4 owner                           | Approve vocabulary mapping, precedence, stale-evidence behavior, and policy versioning                                  | Before A4 implementation           | Open   |
| A1-R004 | Legacy and Customer Beneficiary models overlap                                  | Divergent recipient status, verification, or history    | Payments Risk / Operations / A5 owner                  | Select canonical authority, define reversible mapping, preserve history, stop competing writers                         | Before A5 implementation           | Open   |
| A1-R005 | ADR-0020 through ADR-0024 have not received accountable-owner approval          | Later phases may implement unapproved boundaries        | Architecture governance / ADR owners                   | Complete ADR review record and resolve comments                                                                         | A1 approval review                 | Open   |
| A1-R006 | Domain-specific retention schedules are not all ratified                        | Over-retention, premature deletion, or hold breach      | Privacy/Legal / Compliance / Security / dataset owners | Approve data matrix, schedules, hold process, and source/audit distinction                                              | Before A2 exports or A6 processing | Open   |
| A1-R007 | External provider/partner boundary does not exist                               | Leakage, spoofed callbacks, settlement ambiguity        | A6 Partner / Finance / Compliance                      | No external integration before A6; approve field maps, lawful purpose, security, retention, settlement, reconciliation  | Before A6 implementation           | Open   |
| A1-R008 | A4 policy and A5 command handoff is not implemented                             | Divergent or fail-open financial decisions              | Risk / Product / Finance / A4-A5                       | Approve policy result, A2 authorization, A3 binding, fail-closed behavior, and correlation                              | Before A5 implementation           | Open   |
| A1-R009 | Reconciliation warning semantics remain ambiguous                               | Inconsistent release acceptance before money movement   | Finance / Operations / Reconciliation                  | Define warning ownership, risk acceptance, escalation, and release evidence                                             | Before A5 gate                     | Open   |
| A1-R010 | Outbox facts exist without publisher/inbox delivery                             | Event backlog, duplication, or recovery gaps            | Operations / event owners                              | Approve publisher/inbox, replay, lag, dead-letter, and retention design later                                           | Before event activation            | Open   |
| A1-R011 | A1 approval and A2 entry decision are not recorded                              | Baseline could be treated as approved prematurely       | Architecture / release owners                          | Complete approval table in [`A1-ARCHITECTURE-APPROVAL-PACKAGE.md`](A1-ARCHITECTURE-APPROVAL-PACKAGE.md)                 | A1 approval review                 | Open   |

## 2. Risk handling rules

- Open risks are not silently resolved by adding code, changing owners, or deleting records.
- Each risk has one accountable owner and a target decision date or phase gate.
- Risk acceptance requires rationale, compensating controls, expiry/review date, and relevant owner approval.
- Financial integrity, plaintext secrets, protected-route access, legal holds, and audit tampering do not receive permanent exceptions.
- A1T14 carries risks forward; it does not implement A2-A8 mitigations.

## 3. Risk review record

| Review              | Date       | Reviewer / accountable owner     | Outcome | Follow-up                                      |
| ------------------- | ---------- | -------------------------------- | ------- | ---------------------------------------------- |
| A1 open-risk review | 2026-08-05 | Pending accountable-owner review | Pending | Record decisions and dates in approval package |
