# B2F06 — Finance Roles, Materiality, Maker-Checker, and Segregation-of-Duties Control Runtime

- **Platform:** B2 — Finance Platform
- **Contract:** `B2F-FINANCE-CONTROL` v1
- **ADR:** [`ADR-0087 — B2 Finance Control Policy and Segregation of Duties`](ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md)
- **Status:** Internal runtime implemented; no default policy activated
- **Migration:** `1785753600048-CreateB2FFinanceControlTables.ts`

## 1. Purpose

B2F06 implements Finance control-policy definitions and deterministic control decisions for Finance actions. It defines Finance role semantics, configurable materiality bands, maker-checker requirements, segregation rules, exception evidence, audit, idempotency, and read-only consumer ports while reusing A2 as the sole authorization and privileged-approval authority.

No user, credential, session, role assignment, approval vault, ledger, account, journal-of-record, balance, commercial decision, settlement, or product authority is created.

## 2. Runtime artifacts

- `src/policy/b2f-finance-control.types.ts`
- `src/policy/b2f-finance-control.entity.ts`
- `src/policy/b2f-finance-control.service.ts`
- `src/policy/b2f-finance-control.module.ts`
- migration `1785753600048-CreateB2FFinanceControlTables.ts`
- focused tests `test/b2f-finance-control.*.spec.ts`
- B2F04 and B2F05 consumer integration

The module exposes no controller or public route.

## 3. Finance role semantics

The v1 Finance role vocabulary is:

| Role                 | Finance responsibility                                          | Not authoritative for                       |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `FINANCE_PREPARER`   | prepares Finance journal/period/mapping/control requests        | A2 authorization, approval, or A5 posting   |
| `FINANCE_APPROVER`   | checks ordinary approved Finance actions under active policy    | role assignment, authentication, or posting |
| `FINANCE_CONTROLLER` | checks elevated/material/exceptional and period-control actions | IAM administration, A5 reversal, settlement |
| `FINANCE_AUDITOR`    | read-only control evidence and independent review               | approval execution or source mutation       |

These are policy-required role names consumed from A2 principal/approval evidence. B9 later administers identity/access assignments. B2F06 does not assign roles.

## 4. Action categories

The control vocabulary covers:

- `FINANCE_JOURNAL_POST`
- `FINANCE_PERIOD_OPEN`
- `FINANCE_PERIOD_SOFT_CLOSE`
- `FINANCE_PERIOD_HARD_CLOSE`
- `FINANCE_PERIOD_REOPEN`
- `FINANCE_PERIOD_RETIRE`
- `FINANCE_ACCOUNT_MAPPING_ACTIVATE`
- `FINANCE_ACCOUNT_MAPPING_RETIRE`
- `FINANCE_MATERIALITY_OVERRIDE`
- `FINANCE_EXCEPTION_ACCEPT`

Each policy version defines maker roles, checker roles, minimum distinct approvals, whether materiality applies, and whether override evidence is required.

## 5. Materiality policy

A policy must define exactly three contiguous bands:

- `STANDARD`
- `ELEVATED`
- `MATERIAL`

Each band stores inclusive minimum/maximum minor-unit bounds, required checker roles, required distinct approval count, and override-evidence requirement. The first band begins at zero; the final band is open-ended; gaps and overlaps are rejected.

### No authoritative default thresholds

The repository does not establish legal, regulatory, audit, or Finance-approved monetary thresholds. B2F06 therefore seeds **no active policy and no default amounts**. Threshold values used in tests are fixtures only.

Final threshold amounts, approval counts above one, legal obligations, and jurisdiction-specific mandates are:

> **NOT VERIFIED / REQUIRES REVIEW**

A policy remains `DRAFT` until an A2 privileged approval activates it. Without an effective active policy, every control decision fails closed.

## 6. Policy lifecycle

Policy status is:

- `DRAFT`
- `ACTIVE`
- `RETIRED`
- `REJECTED`

Policy definitions are immutable/versioned/effective-dated and SHA-256 hashed. Activation consumes A2 action `FINANCE_CONTROL_POLICY_ACTIVATE`, exact policy UUID, and fingerprint. Only one active version exists per policy key. Activating a new version retires the previous active version without deleting it.

Policy idempotency scope:

```text
b2.finance.control-policy.idempotency.v1
```

## 7. Deterministic control decisions

An evaluation binds:

- action and amount;
- resource type/ID/version/hash;
- maker identity and policy-derived required roles;
- executor/checker A2 principal;
- consumed A2 approval references/provenance;
- override evidence;
- active policy key/version;
- request/correlation context.

Decision outcomes are `ALLOW` or `DENY`. Decisions persist immutable request/decision hashes, reasons, materiality band, policy version, actor/checker/approval provenance, resource binding, and evaluation time.

Decision idempotency scope:

```text
b2.finance.control-decision.idempotency.v1
```

Identical requests replay the original decision; changed semantics under the same key conflict.

## 8. Maker-checker and segregation

A decision denies when:

- maker equals executor/checker;
- maker lacks an allowed preparer role;
- executor/checker lacks required band/action role;
- distinct approval count is insufficient;
- consumed approval is stale, unconsumed, resource-mismatched, or approved by another actor;
- action policy is missing;
- override evidence is required but absent;
- materiality band is missing;
- active policy is absent/not effective.

The A2 approval service remains responsible for request/approve/consume lifecycle, expiry, MFA/scope, action fingerprint, resource matching, and self-approval at approval time. B2F06 adds Finance-specific policy evaluation after A2 evidence is consumed; it does not duplicate A2.

The A2 approval view now includes its immutable policy payload so Finance can verify policy-required maker roles without creating an identity/role store.

## 9. B2F04 integration

B2F04 continues to consume A2 privileged approval first. It then submits period action, zero materiality amount, period resource/version/fingerprint, maker/checker provenance, and exception evidence to B2F06. A denied control decision prevents period transition.

Hard-close/reopen action controls may require controller role and override evidence. The active policy determines exact requirements. B2F04 remains fiscal-period authority; B2F06 does not mutate periods.

## 10. B2F05 integration

B2F05 stores journal preparer ID/roles and control-decision reference. After A2 approval consumption and before A5 submission, it evaluates:

- `FINANCE_JOURNAL_POST`;
- total debit amount;
- exact Finance journal resource/version/fingerprint;
- preparer/checker segregation;
- materiality band and required checker roles/count;
- override evidence if required.

A `DENY` moves the governance request to `REJECTED` and A5 is not called. `ALLOW` permits the existing B2F05 state transition and controlled A5 posting. B2F05 remains journal-governance authority; A5 remains sole posting/value authority.

## 11. Persistence, concurrency, and history

Migration `0048` creates:

- `b2f_finance_control_policies`
- `b2f_finance_control_decisions`

It adds preparer/control-provenance columns to the existing Finance governance table; it does not add value or posting columns.

Policy activation uses serializable transactions, pessimistic locking, expected versions, unique active-policy constraint, and shared idempotency. Policies and decisions are preserved; no delete runtime is exposed.

## 12. Audit

Shared `AuditService` records:

- policy creation/activation/retirement;
- allowed/denied control decisions;
- policy version/hash;
- action/materiality/reasons;
- actor, resource, and approval provenance.

No second audit store exists.

## 13. Read-only consumer port

The internal consumer port exposes:

- active policy definition lookup;
- deterministic Finance control evaluation.

It is consumed by B2F04/B2F05 and later Finance tasks. It exposes no HTTP endpoint.

## 14. Authority boundaries

B2F06 does not:

- authenticate or authorize principals independently;
- issue/approve/consume approvals independently of A2;
- assign roles or administer IAM;
- post/mutate A5 accounts, journals, lines, balances, reversals, or value;
- calculate/mutate B1 commercial decisions;
- execute A6 settlement or call partners;
- alter A7 product behavior;
- implement Treasury, Reporting, Statements, Developer APIs, frontend, or B2F07.

## 15. Verification

- [x] Configurable role/action/materiality policy runtime implemented.
- [x] No unverified threshold is activated by default.
- [x] Maker-checker, self-approval, checker roles, approval count, stale/mismatch, override evidence, and fail-closed behavior implemented.
- [x] Deterministic, idempotent, audited control decisions implemented.
- [x] A2 approval provenance is consumed, not replaced.
- [x] B2F04/B2F05 integration implemented.
- [x] No A5/B1/A6/A7 or later-platform authority duplicated.
- [x] No controller/public API/frontend introduced.

### B2F06 result

> **Finance control runtime implemented with no active threshold policy; production Finance actions remain blocked until accountable owners approve and activate a policy.**
