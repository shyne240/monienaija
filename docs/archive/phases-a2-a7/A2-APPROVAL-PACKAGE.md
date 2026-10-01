# A2 Runtime Identity & Access Approval Package

- **Task:** A2T10 — A2 Integration, Recovery, and Exit Evidence
- **Status:** Prepared for accountable-owner approval; not yet approved
- **Scope:** A2 Runtime Identity & Access and A3/A4 handoff
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Executive summary

A2 establishes a protected runtime identity/access boundary over the existing Customer Foundation and Operations contracts. The implementation includes authentication execution, hashed/revocable sessions, customer recovery, MFA/trusted-device checks, authorization, privileged approvals, route enforcement, and sensitive-data redaction.

A2 does not own customer identity, wallet/ledger value, eligibility/risk/compliance evidence, product policy, external providers, or financial execution. A2 does not begin A3, A4, A5, A6, A7, or A8 implementation.

## 2. Evidence index

| Evidence                                        | Purpose                                                      | Status             |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------ |
| `docs/A2-IMPLEMENTATION-PLAN.md`                | Canonical A2 task order and scope                            | Source of truth    |
| `docs/A2-TRUST-BOUNDARY-THREAT-MODEL.md`        | A2 baseline, principals, trust zones, threats, route classes | Prepared           |
| A2T02-A2T05 services/tests                      | Authentication, sessions, recovery, MFA, trusted devices     | Implemented/tested |
| A2T06 authorization services/tests              | Principal/role/scope and customer access                     | Implemented/tested |
| A2T07 approval services/tests                   | Maker-checker, break-glass, approval lifecycle               | Implemented/tested |
| A2T08 route services/tests                      | Route allowlist and runtime enforcement                      | Implemented/tested |
| `docs/A2-SECURITY-DATA-PROTECTION-CHECKLIST.md` | Secret/hash/token/device controls                            | Prepared           |
| A2T09 redaction/tests                           | Audit, outbox, idempotency, errors, logs, security events    | Implemented/tested |
| `docs/A2-INTEGRATION-TEST-MATRIX.md`            | Cross-boundary test evidence                                 | Prepared           |
| `docs/A2-ROUTE-EXPOSURE-AND-ROLLBACK.md`        | Route classification and rollback                            | Prepared           |
| `docs/A2-SECURITY-PRIVACY-REVIEW-STATUS.md`     | Security/privacy review state                                | Pending approval   |
| `docs/A2-OPERATIONAL-RECOVERY-RUNBOOK.md`       | Incident and recovery procedures                             | Prepared           |
| `docs/A2-ADR-REVIEW-STATUS.md`                  | ADR-0025 through ADR-0030 review status                      | Pending approval   |
| `docs/A3-A4-HANDOFF-CHECKLIST.md`               | A3/A4 inputs and prohibited edges                            | Prepared           |
| `docs/A2-EXIT-CHECKLIST.md`                     | A2 exit gates                                                | Prepared           |

## 3. A2 approval decisions

Accountable owners are asked to approve or return:

1. A2 establishes the runtime trust boundary without changing A1 ownership or financial truth.
2. Authentication, session, recovery, MFA, authorization, privileged approval, route protection, and redaction contracts are sufficient for the intended boundary.
3. Current internal routes remain protected and are not public APIs by default.
4. Security events, audit values, logs, diagnostics, outbox payloads, and idempotency responses are minimized and redacted.
5. A3 and A4 may consume A2 principal/authorization context only through the documented handoff contracts.
6. No A2 decision authorizes wallet/ledger/payment, A4 policy, external partner, or product activation.
7. ADR-0025 through ADR-0030 review status is accepted with recorded conditions.
8. A2 approval is recorded before A3/A4 implementation begins.

## 4. Approval record

The package does not fabricate signatures or approvals.

| Review / decision                | Accountable owner                               | Decision | Date    | Conditions / comments                     |
| -------------------------------- | ----------------------------------------------- | -------- | ------- | ----------------------------------------- |
| A2 security boundary             | Architecture / Security                         | Pending  | Pending | Review A2 threat model and route evidence |
| Authentication/session/recovery  | Security / Customer Engineering                 | Pending  | Pending | Review A2T02-A2T04 evidence               |
| MFA/trusted devices              | Security / Privacy                              | Pending  | Pending | Review A2T05 evidence                     |
| Authorization/privileged actions | Security / Operations / Compliance              | Pending  | Pending | Review A2T06-A2T07 evidence               |
| Route exposure/rollback          | Security / Operations / Production              | Pending  | Pending | Review A2T08 evidence                     |
| Secret/data protection           | Security / Privacy/Legal / Compliance           | Pending  | Pending | Review A2T09 evidence                     |
| ADR-0025 through ADR-0030        | Architecture and ADR owners                     | Pending  | Pending | Record approve/return decisions           |
| A3/A4 handoff                    | Architecture / Wallet / Ledger / Risk / Product | Pending  | Pending | Complete handoff checklist                |
| A2 phase approval                | Accountable release owners                      | Pending  | Pending | Required before A3/A4                     |

## 5. Outcome rules

- **Approve:** Record owner, date, conditions, and follow-up.
- **Return with comments:** Record comments, owner, target date, and mitigation.
- **Reject:** Require a revised or superseding decision before entry.
- **No response:** Remains Pending; A2 is not approved.
