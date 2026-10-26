# P0-A / P0-B Maker-Checker Fix — Completion Report

Branch: `arena/edba26d6-monienaija` (on top of `2ccc17b`). Date: 2026-10-21.

Fixes the two P0 defects from `END-TO-END-FUNCTIONALITY-AUDIT.md` (E.1 / E.2) using the
established `RoleDefinitionGovernanceService` pattern (inline policy through the real
`PrivilegedActionApprovalService`, server-computed fingerprints, resubmitted execution
payloads). No schema changes. No new approval policies invented — registry values are the
Decision-2 / role-model values verbatim.

## P0-A — commercial rule maker-checker (audit E.1)

**Behavior fixed.** The fee / commission / reward / product registry write endpoints no longer
perform direct writes. Each write endpoint now creates a **PENDING** maker-checker request:

| Route (was direct write) | Governed action | Resource |
|---|---|---|
| `POST /internal/fee-rules` | `FEE_RULE_CREATE` (`fee_rule.create`) | `FEE_RULE` (id `null`) |
| `PATCH /internal/fee-rules/:id` | `FEE_RULE_MODIFY` | `FEE_RULE` (rule id) |
| `POST /internal/commission-rules` | `COMMISSION_RULE_CREATE` | `COMMISSION_RULE` |
| `PATCH /internal/commission-rules/:id` | `COMMISSION_RULE_MODIFY` | `COMMISSION_RULE` |
| `POST /internal/reward-rules` | `REWARD_RULE_CREATE` | `REWARD_RULE` |
| `PATCH /internal/reward-rules/:id` | `REWARD_RULE_MODIFY` | `REWARD_RULE` |
| `POST /internal/products` | `PRODUCT_MODIFY` (no `product.create` exists) | `PRODUCT` |
| `PATCH /internal/products/:code` | `PRODUCT_MODIFY` | `PRODUCT` (code) |
| `POST /internal/product-governance/records` | `PRODUCT_GOVERNANCE` | `PRODUCT` |
| `PATCH /internal/product-governance/records/:id` | `PRODUCT_GOVERNANCE` | `PRODUCT` (id) |

- The fingerprint is `sha256(canonical({action, resourceType, resourceId, payload}))` computed
  **server-side** from the actual change payload (rule fields + `reason` + optimistic-concurrency
  `version`). Key order never matters; any payload difference changes the hash.
- Approval rides the existing surfaces: `POST /internal/a2/workforce/approvals/:id/approve` and
  the new `POST .../approvals/:id/reject` (the `rule()` maker-checker lookup now falls back to
  the governed-action registry when `A2_MAKER_CHECKER_RULES_JSON` has no entry — env rules keep
  precedence; unknown actions still fail closed).
- Execution is domain-owned: `POST <collection>/changes/:approvalId/execute-create` /
  `execute-modify` recomputes the fingerprint from the **resubmitted** payload, then consumes
  the approval (fingerprint/resource/action binding, CONSUMED/EXPIRED refusals, executor = the
  approving FINANCE_CONTROLLER or `privileged:execute`), then performs the write. Tampered
  payload → 403; replay → 409; maker executing → 403; unauthorised initiation/approval → 403.
- FINANCE_PREPARER initiates and cannot approve; FINANCE_CONTROLLER (or a dual-role principal)
  cannot approve their own request (`SELF_APPROVAL_FORBIDDEN` in decide()). Full pending →
  approved → rejected/consumed audit trail preserved on the approval rows.
- Reward / product-catalog / product-governance write endpoints additionally gained the
  `requireFunction` gates they previously lacked (product-governance had zero auth).
- Write failure after consumption is audited `GOVERNED_CHANGE_EXECUTION_FAILED` and rethrown;
  the approval stays CONSUMED (same tradeoff as the finance-role flow).

## P0-B — ledger journal reversal maker request (audit E.2)

**Behavior fixed.** The preparer leg no longer posts a hardcoded mock fingerprint with the wrong
action/resource types.

- New `POST /internal/ledger/journals/:journalId/reversal-request` `{reason}` (maker;
  `ledger.reverse` / FINANCE_PREPARER) creates a PENDING request registered as
  `LEDGER_JOURNAL_REVERSAL` / `LEDGER_JOURNAL` with the deterministic fingerprint
  `sha256(canonical({action:'LEDGER_JOURNAL_REVERSAL', resourceType:'LEDGER_JOURNAL',
  resourceId:journalId, payload:{reason}}))` — computed server-side; the client never sends one.
- `POST /internal/ledger/journals/:journalId/reversal` now **requires** `{reason, approvalId}`
  (the ungoverned direct-reversal path is closed). Execution recomputes the fingerprint from the
  actual `{reason}`, consumes the approved request under the established separation-of-duties
  machinery (MFA, `privileged:approve` approval scope, maker≠checker), then delegates to the
  untouched `LedgerService.reverseJournal` primitive. Domain rules preserved: unknown journal
  404, missing reason 400, reversal of a reversal 409, already-reversed 409, tampered reason
  403, missing approvalId 400, replay 409.
- `LedgerOperationsScreen` rewired: preparer → `/reversal-request` (no mock fingerprint); the
  checker form takes the approved request ID and executes with the fingerprint-bound reason.

## Files changed

New: `src/authorization/governed-action.registry.ts`,
`src/authorization/commercial-rule-governance.service.ts`,
`src/ledger/ledger-reversal-governance.service.ts`,
`test/governed-action.registry.spec.ts`, `test/commercial-rule-governance.service.spec.ts`,
`test/ledger-reversal-governance.service.spec.ts`,
`test/v1-commercial-rule-governance.integration.spec.ts`,
`test/v1-ledger-reversal-governance.integration.spec.ts`.

Modified: `src/authorization/authorization.module.ts`,
`src/authorization/workforce-administration.controller.ts`,
`src/fee-rules/fee-rule-registry.controller.ts`,
`src/commission/commission-rule-registry.controller.ts`,
`src/reward/reward-rule-registry.controller.ts`,
`src/product-catalog/product-catalog.controller.ts`,
`src/product-governance/product-governance.controller.ts` (+ its 2 DTOs),
`src/ledger/ledger.controller.ts`, `src/ledger/ledger.module.ts`,
`src/ledger/dto/post-journal.dto.ts`, `apps/admin-web/src/screens/authenticated/LedgerOperationsScreen.tsx`,
`apps/admin-web/__tests__/ledger-operations.test.tsx`, and the four fixture suites
`test/v1-commercial-02/03`, `test/v1-commission-01`, `test/v1-reward-01` (HTTP write tests
converted to the governed flow; mock principals repaired with real roles/scopes/`assuranceLevel`
— the previous empty `roles: [], scopes: []` broke every function gate).

## Test results (exact commands)

| Command | Result |
|---|---|
| `npm run test` | **PASS** — 177 suites, **1854/1854** tests (was 174/1831; +3 new suites) |
| `npm --prefix apps/admin-web test` | **PASS** — 9 suites, **66/66** tests |
| `npm run build` (nest) | **PASS** — exit 0 |
| `npm --prefix apps/admin-web run build` | **PASS** — `index-DIBzuJAq.js 305.96 kB │ gzip: 81.58 kB` |
| `npm run test:pg -- test/v1-commercial-rule-governance.integration.spec.ts` (representative) | **BLOCKED (environment)** — *"Real PostgreSQL is required for integration suites but is not reachable at 127.0.0.1:5432 as \"monienaija\" … connect ECONNREFUSED 127.0.0.1:5432"* and *"Invalid environment configuration: DB_HOST/DB_NAME/DB_USER/DB_PASSWORD undefined"* |

The new unit suites cover allowed and denied cases end-to-end at service level over the real
`PrivilegedActionApprovalService` (initiation, self-approval prohibition, approval-scope,
tamper/replay/expiry/rejection, execution-failure audit, reversal domain rules). The two new
PG-gated integration suites (synthetic data only) cover the same at real HTTP level and are the
model for DB-backed verification once a disposable PostgreSQL + `DB_*` env are provisioned.

**Evidence classification:** unit/frontend/build results are V-NOW at this HEAD. Integration
suites (new + updated fixtures) are written and typechecked but **not executed** — the blocker is
environmental (no PostgreSQL reachable, no `DB_*` env), identical to the audit's finding. This
report does **not** claim end-to-end DB-backed verification.

## Remaining gaps (out of this fix's scope)

- `limit.modify` (Decision 2) is still ungoverned — P1 gap (`agent.assign_limit` is explicitly
  NOT governed per Decision 2 and stays operational).
- `ApprovalsScreen` still cannot list pending approvals (known pre-existing GET-listing gap);
  approve/reject by request ID works, including for the new governed actions.
- P1: Commercial Rules screens remain read-only (no propose/approve UI). The backend now
  enforces maker-checker regardless of frontend visibility.
- Pre-existing test-fixture gap fixed here in passing: the empty mock principals had already
  broken every `requireFunction` gate for the four commercial fixture suites.

No schema/migration changes. No ledger postings or reversals performed outside tests. The
development database was never touched (integration harness creates isolated `mn_it_*_${pid}`
databases only, and no integration suite ran).
