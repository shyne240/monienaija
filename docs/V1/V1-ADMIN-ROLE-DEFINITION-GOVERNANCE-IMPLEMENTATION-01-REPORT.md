# V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 — Implementation Report

## 1. Objective and scope

Implements a governed, configuration-driven workflow for **creating and modifying authorization
role definitions** (role metadata + their `authorization_functions` grants) on top of the existing
V1 authorization catalogue, so that deployments can add or adjust future organizational roles
without a source-code change — while preserving every mandatory security invariant established by
the prior authorization work (foundation, hardening, privileged-approval, administrator
role-and-assignment).

This is **purely additive**. No existing role, grant, controller route, or governance decision was
changed except for the two specific, intentionally-scoped retrofits documented in §7.

Inputs read before implementation (per the task's explicit instruction):
- `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01.md`
- `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01.md`
- `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md`
- `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md`
- `docs/V1/V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01-REPORT.md`
- plus the prior authorization foundation/hardening/privileged-approval implementation reports and
  their corresponding integration specs, to extract the existing conventions reused here.

No `docs/V1/V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-01.md` governance-decision document exists in the
repository at the time of this task; this implementation therefore derives its authority model
directly from the already-approved Decision 10 note already present in the catalogue seed
(`workforce.role.create`/`workforce.role.modify`, "dual-control governance") and from the explicit
task instructions. No new governance decision was invented or silently varied — see §9 for the one
place a pre-existing *test assertion* (not a governance decision) had to be updated because it
hard-coded the pre-implementation, not-yet-wired state of those two functions.

## 2. No duplicate source of truth

Live authorization continues to read exclusively from the pre-existing
`authorization_roles` / `authorization_role_functions` tables, exactly as before (confirmed:
`AuthorizationCatalogueRuntimeService` and `A2WorkforceSessionService.establish()` are unchanged).
The new `role_definition_proposals` table is **only a maker/checker ledger** — a proposal row is
never read by the authorization/session-resolution path, and applying a proposal does nothing more
than write ordinary rows into the same two existing tables through the same entities
(`AuthorizationRole`, `AuthorizationRoleFunction`) every other part of the system already uses.
There is exactly one source of truth for "what a role may do": the committed rows in
`authorization_role_functions`.

## 3. Schema (migration `1785753600086-CreateRoleDefinitionGovernance`)

Purely additive, no data migration required for the 11 seeded roles:

1. `authorization_roles.definition_version INTEGER NOT NULL DEFAULT 1` — optimistic-concurrency
   token, incremented on every successful MODIFY apply.
2. `CHECK chk_authorization_roles_non_seeded_no_elevated_class`: `is_system_seeded = TRUE OR
   (administrative_capability = FALSE AND finance_role_class = FALSE)`. A configurable
   (`is_system_seeded = FALSE`) role can **never** acquire SUPER_ADMIN's administrative-capability
   classification or Finance-role-class membership, enforced at the database layer regardless of
   application-code correctness. Verified by a direct-SQL test (two independent `UPDATE`
   statements, both rejected — see §8, test category 8c).
3. `role_definition_proposals` — the proposal table. Columns capture proposal type, target role
   key, proposed metadata/grants, `deactivate` flag (reserved, unused — see §6), the
   `expected_definition_version` optimistic-concurrency token for MODIFY, a JSONB `prior_snapshot`
   (MODIFY only), a SHA-256 `action_fingerprint`, a `REFERENCES privileged_action_approvals(id)`
   foreign key, a `REFERENCES authorization_roles(id)` foreign key populated on successful apply,
   proposer identity, full decision/apply audit fields (`decided_by`/`decided_at`/
   `decision_reason`/`applied_by`/`applied_at`/`apply_failure_reason`), `correlation_id`, and
   `requested_at`/`expires_at`.
4. `UNIQUE INDEX uq_role_definition_proposals_in_flight ON role_definition_proposals
   (target_role_key) WHERE status IN ('REQUESTED','APPROVED')` — the DB-enforced half of "no two
   in-flight proposals for the same role key" (duplicate-submission protection).
5. A one-time `UPDATE authorization_functions` retrofits `workforce.role.create` /
   `workforce.role.modify` from `v1_status = 'FUTURE'`, `assignable = FALSE` (their state since
   V1-ADMIN-AUTHORIZATION-FOUNDATION-01) to `v1_status = 'IMPLEMENTED'`, `assignable = TRUE` — this
   *is* the workflow's maker/checker gate (see §4). No other catalogue row was touched.

## 4. Proposer / approver model

Hardcoded, not `A2_MAKER_CHECKER_RULES_JSON`-driven — mirrors the existing
`ADMINISTRATOR_OPERATIONAL_ROLE_KEYS` precedent in `finance-role-administration.service.ts`, and
deliberately avoids inventing a new role or widening the legacy maker/checker config to "solve" an
approval constraint:

- `ROLE_DEFINITION_INITIATOR_ROLE = 'SUPER_ADMIN'` — only a principal holding SUPER_ADMIN (and MFA
  assurance) may `submit()`/`apply()`.
- `ROLE_DEFINITION_APPROVER_ROLE = 'FINANCE_CONTROLLER'` — only a principal holding FINANCE_CONTROLLER
  may `approve()`/`reject()`.
- ADMINISTRATOR is never checked for and therefore is excluded entirely by construction — it holds
  neither role and every entry point (service method *and* the controller's own defense-in-depth
  `AuthorizationService.requireFunction()` gate, since `workforce.role.create`/`.modify` are not
  granted to ADMINISTRATOR) rejects it (test category 4).
- Catalogue grants: SUPER_ADMIN holds `workforce.role.create`/`.modify` as `INITIATE`;
  FINANCE_CONTROLLER holds them as `APPROVE`. Nobody else — not ADMINISTRATOR, not FINANCE_AUDITOR —
  holds either function at all (verified by test categories 4, 10, 14b).

### Does `PrivilegedActionApprovalService` genuinely fit this use case?

Verified (not assumed) before reuse: it is a generic, action-type-agnostic maker/checker primitive
— its `request()`/`approve()`/`reject()`/`consumeInTransaction()` methods take an arbitrary
`resourceType`/`action`/`policy`/`actionFingerprint` and already enforce, independent of what kind
of action is being approved:
- self-approval is forbidden (requester principal ID ≠ approver principal ID check inside the
  service itself, independent of and in addition to the role-gate above — proven in test 13b by
  constructing a single identity holding *both* SUPER_ADMIN and FINANCE_CONTROLLER, the only way to
  actually reach that internal check rather than being turned away earlier by the simple role gate);
- MFA assurance requirement on the requester;
- approval scope match against a declared `approvalScope`;
- expiry (`expiresAt`) with no approve/apply possible afterward;
- single-use consumption (`consumeInTransaction`) — an approval can be consumed at most once,
  atomically, inside the same DB transaction that performs the privileged mutation;
- a fingerprint (`actionFingerprint`, here `sha256(canonical({proposalId, proposalType, roleKey,
  displayName, description, readOnly, functionGrants, deactivate, expectedDefinitionVersion}))`)
  that must match at consume time — replay or tampering with the approved payload is rejected;
- its own audit trail of request/approve/reject/consume.

No gap was found that would make reuse unsafe for this action type; it was reused as-is, with no
weakening of any of its existing checks. The only wrapping needed was the two outer role gates
(SUPER_ADMIN may initiate, FINANCE_CONTROLLER may decide) layered in front of it, because the
approval service itself does not know which roles are allowed to invoke which action types — that
policy lives in the caller, exactly like every other existing caller of this service.

## 5. Lifecycle

`submit()` (SUPER_ADMIN, MFA required) → validates all fields (role-key pattern, text lengths,
function-grant list), validates every function grant (§6), computes the existing-role diff for
MODIFY, requests an approval via `PrivilegedActionApprovalService.request()`, persists a `REQUESTED`
proposal row in the same DB transaction as the audit record, with automatic rollback (including
cancelling the orphan approval) on any later failure (e.g. the in-flight unique-index conflict,
mapped to `409 Conflict`).

`approve()` / `reject()` (FINANCE_CONTROLLER only) → lazily expires a stale `REQUESTED` proposal if
past `expiresAt` before deciding; delegates the actual decision to
`PrivilegedActionApprovalService.approve()/.reject()`; any denial (self-approval, MFA, scope,
already-decided, etc.) is captured as `ROLE_DEFINITION_PROPOSAL_DECISION_DENIED` and re-thrown as
`403`; a genuine decision moves the proposal to `APPROVED` or `REJECTED` with `decidedBy`,
`decidedAt`, `decisionReason` recorded.

`apply()` (SUPER_ADMIN only) → single `dataSource.transaction()` using `SELECT ... FOR UPDATE`
(`pessimistic_write`) on the target proposal row, so **concurrent `apply()` calls on the same
proposal serialize and exactly one succeeds** (test 11b); re-validates everything against the
*live* catalogue state inside the same transaction (preflight: role still doesn't/does exist,
still not system-seeded, `expectedDefinitionVersion` still matches current
`authorization_roles.definition_version`, every function grant still valid/assignable/non-finance);
only if preflight passes does it call `PrivilegedActionApprovalService.consumeInTransaction()`
(single-use, atomic, inside the same transaction); only if that succeeds does it mutate the
catalogue (`mutateCatalogue()` — insert the new role row for CREATE, or update metadata and replace
active function-grant rows for MODIFY, bumping `definition_version`). Any failure *before* the
approval is consumed is recorded as a committed `APPLY_FAILED` state (durable, auditable, and
non-destructive — nothing was mutated). Any failure *after* the approval is consumed (i.e. inside
`mutateCatalogue()` itself) aborts the **entire** transaction, which also rolls back the
just-consumed approval — the proposal and its approval both revert to `APPROVED` and the operation
is safely retryable. There is no window in which the approval is consumed but the catalogue change
is lost, nor one in which the catalogue changes without a consumed approval.

`getProposal()` / `listProposals()` — read-only, gated on `workforce.role.view`.

## 6. What is / is not modifiable through this workflow

- **CREATE**: a brand-new role with a fresh `roleKey` (pattern `^[A-Z][A-Z0-9_]{1,49}$`),
  `displayName`, `description`, `readOnly` flag, and up to 100 function grants. Always created with
  `is_system_seeded = FALSE`, `administrative_capability = FALSE`, `finance_role_class = FALSE`,
  `is_active = TRUE`, `definition_version = 1` — none of these four flags are ever accepted from
  the request body; extra/forged fields in the HTTP body (e.g. `administrativeCapability: true`,
  `financeRoleClass: true`) are silently ignored because the service never reads or forwards them
  (verified in test 9a) and, as a structural backstop, the DB CHECK constraint from §3 would reject
  them even if a future code change tried.
- **MODIFY**: only targets a role with `is_system_seeded = FALSE` — i.e. only a role that was
  itself created through this same workflow. **All eleven V1-seeded roles are completely immutable
  through this path** (test 9c) — this is the explicit "which seeded-role attributes are
  modifiable" boundary: *none*. MODIFY may change `displayName`, `description`, `readOnly`, and
  fully replace the active function-grant set (old grants deactivated, new ones inserted);
  `expectedDefinitionVersion` is mandatory and must match the role's current
  `definition_version` or the proposal is rejected at submit time, and re-checked again at apply
  time against the then-current value (optimistic concurrency, closing the TOCTOU window between
  submission and application — test 11e).
- **Deletion**: not implemented. A `deactivate` boolean column exists on the proposal table and
  entity as a reserved, forward-compatible slot, but no code path in this implementation ever sets
  it to `true` from a real workflow action, and the HTTP/service surface does not expose a
  "deactivate a role" operation. This follows the task's explicit instruction: implement
  deactivation only if proven safe, and otherwise implement nothing destructive. Proving
  deactivation-of-a-live-role safe (e.g. interaction with existing sessions/assignments still
  referencing that role) was out of scope for this task and was not attempted; the column is inert.

## 7. Mandatory security invariants — how each is enforced

| Invariant | Enforcement |
|---|---|
| Configurable role cannot acquire SUPER_ADMIN's admin-capability classification | DB CHECK constraint (§3.2) + service never sets the flag (§6) |
| ADMINISTRATOR cannot gain SUPER_ADMIN/Finance assignment authority | ADMINISTRATOR holds neither `workforce.role.create` nor `.modify`; both the controller's function gate and the service's explicit role check reject it (test 4) |
| DB-enforced Finance-class restrictions remain effective regardless of config | The pre-existing Finance-class-restriction trigger on `authorization_role_functions` (built in V1-ADMIN-AUTHORIZATION-FOUNDATION-01/HARDENING-01, untouched here) still fires on every insert, including ones made by `mutateCatalogue()` — proven by a **direct SQL** attempt bypassing the application layer entirely (test 8b) which the trigger rejects; the service also pre-emptively rejects any `CRITICAL_FINANCIAL`/`financeClassRestricted` function grant at submission time (test 8a) as defense-in-depth, not as the sole control |
| SUPER_ADMIN retains no prohibited financial authority | Unchanged — this task grants SUPER_ADMIN nothing beyond `workforce.role.create`/`.modify` INITIATE, neither of which is a financial-execution function |
| FINANCE_AUDITOR stays read-only | FINANCE_AUDITOR holds neither function; the pre-existing read-only DB trigger for FINANCE_AUDITOR is untouched; test 10 proves FINANCE_AUDITOR is denied submit/approve/reject/apply but can still read via `workforce.role.view` (a separate, pre-existing read grant) |
| Maker/checker separation independent of seniority | SUPER_ADMIN (the more senior/more privileged identity) can never decide its own proposal regardless of seniority — enforced both by the simple role gate (SUPER_ADMIN is never FINANCE_CONTROLLER) and, for the edge case of a single identity holding both roles, by the approval service's own self-approval check (test 2a, test 13b) |
| Proposer cannot gain self-approval authority via the proposed change itself | A proposal can never grant `workforce.role.*` functions to any role — `assertGrantable()` unconditionally rejects any grant whose function code starts with `workforce.role.` (test 9b) — so no proposal can ever manufacture a new path to deciding role-definition proposals |
| Invalid/duplicate/unknown/non-assignable function codes rejected | `validateFunctionGrants()`/`assertGrantable()` reject unknown codes, non-assignable codes, invalid access types, and duplicate codes within one proposal (test 7) |
| Pending proposals never affect live authorization | Confirmed: `AuthorizationCatalogueRuntimeService`/session resolution never reads `role_definition_proposals`; a role does not exist in `authorization_roles` until `apply()` succeeds (test 5, test 6a's `resolveForRoleKeys` assertion) |
| Approval+application atomic/safely recoverable | Single transaction with row-level pessimistic lock for `apply()`; approval consumption and catalogue mutation share one transaction; any failure after consumption rolls back both (§5); concurrent-apply and replay-apply both proven safe (test 11b, 11c) |

## 8. Required test categories (all run against real PostgreSQL + real HTTP)

New focused spec: `test/v1-admin-role-definition-governance-implementation-01.integration.spec.ts`
— **30 tests, all passing**, covering all 14 required categories:

| # | Category | Representative test(s) |
|---|---|---|
| 1 | SUPER_ADMIN submits a valid proposal | 1a |
| 2 | SUPER_ADMIN cannot approve its own proposal | 2a |
| 3 | FINANCE_CONTROLLER independently approves/rejects | 3a, 3b |
| 4 | ADMINISTRATOR excluded from create/modify/approve | 4a, 4b |
| 5 | Unapproved proposal never changes live authorization | 5a |
| 6 | Approval+apply applies role+function grants consistently (CREATE and MODIFY), proven against the live catalogue-runtime resolver | 6a, 6b |
| 7 | Invalid/non-assignable/duplicate/bad-access-type functions rejected | 7a–7d |
| 8 | Structural restrictions enforced even against direct-SQL bypass attempts | 8a (service), 8b (DB trigger via raw SQL), 8c (DB CHECK via raw SQL) |
| 9 | Role cannot acquire SUPER_ADMIN/Finance authority via config; cannot self-amplify role-governance power; cannot target a seeded role | 9a, 9b, 9c |
| 10 | FINANCE_AUDITOR cannot exploit the workflow for write privileges | 10a |
| 11 | Duplicate/concurrent/replayed/expired/stale proposals cannot double-apply or overwrite newer state | 11a (duplicate in-flight), 11b (`Promise.all` concurrent apply, exactly one 201), 11c (replay after APPLIED → 409), 11d (expired proposal cannot be approved), 11e (stale `definition_version` at apply time → `APPLY_FAILED`, role left unchanged) |
| 12 | Rejected/failed proposals leave live assignments unchanged | 12a |
| 13 | Audit records accurately capture proposer/approver/before-after/outcome, including denied/self-approval attempts | 13a, 13b |
| 14 | Pre-existing 11-role roster and ADMINISTRATOR/SUPER_ADMIN/FINANCE_CONTROLLER grants on the two retrofitted functions are exactly as intended | 14a, 14b |

Full run of the new spec in isolation:
```
Test Suites: 1 passed, 1 total
Tests:       30 passed, 30 total
```

## 9. One pre-existing test assertion intentionally updated (not a governance change)

Two *tests* (not governance decisions) from earlier tasks hard-coded the pre-implementation state
of `workforce.role.create`/`workforce.role.modify` as permanently non-assignable, zero-assignment
placeholders:

- `test/v1-admin-authorization-foundation-01.integration.spec.ts` — `explicitlyBarred` list in
  "does not mark any FUTURE or OUT_OF_V1_SCOPE function as assignable…"
- `test/v1-admin-authorization-hardening-01.integration.spec.ts` — "I2. a non-assignable
  (FUTURE/OUT_OF_V1_SCOPE) function has zero role assignments"

This task's entire deliverable *is* making those two functions the real, assignable,
IMPLEMENTED maker/checker gate for role-definition governance (SUPER_ADMIN INITIATE,
FINANCE_CONTROLLER APPROVE) — this was always the intended purpose of those placeholder rows per
the existing Decision 10 note already present in the catalogue seed file before this task began.
Both test files were updated to remove exactly these two function codes from their
"still non-assignable / zero assignments" lists, with an inline comment explaining why and pointing
at the migration and the new spec's own "14b" assertion that proves the final grant state. Every
other function code in both lists (`transaction.search`, `transaction.reversal.request/.approve`,
`agent.manage_permissions`, `compliance.restrict_account`, `compliance.release_restriction`,
`audit.export`, `reconciliation.investigate`, `reconciliation.resolve`,
`treasury.manage_settlement`, `treasury.resolve_suspense`, `ledger.approve_adjustment`,
`customer.terminate`) is completely untouched and still asserted non-assignable/zero-assignment.
No role roster, no other function's catalogue semantics, and no other governance decision was
changed. Both updated spec files pass (and were re-verified in the full PG integration run below).

## 10. Final verification results

All commands run from the repository root against the embedded PostgreSQL instance
(`node scripts/embedded-pg.js`), after this task's complete code+migration+test change set:

- **Typecheck** — `npx tsc --noEmit -p tsconfig.json`: **0 errors**.
- **Build** — `npm run build` (`nest build`): **succeeded**, no errors.
- **Focused new spec** — `test/v1-admin-role-definition-governance-implementation-01.integration.spec.ts`:
  **30/30 passed**.
- **Full backend unit suite** — `npm run test`: **174 test suites passed, 1823 tests passed, 0 failed**.
- **Full PostgreSQL integration suite** — `npm run test:pg` (`scripts/run-pg-integration-tests.js`,
  all 102 `test/*.integration.spec.ts` files, batched, `--runInBand` within each batch):
  **102/102 files passed, 1967/1967 tests passed, 0 failed.** (This includes the new 30-test spec,
  the two updated pre-existing specs from §9, and the existing
  `test/v1-administrator-role-and-assignment-implementation-01.integration.spec.ts` — the full
  38-test suite from the prior task — all passing unchanged, confirming category 14's
  "existing 11-role seeding / operational-role assignment / Finance maker-checker / KYC / customer
  PII / SUPPORT / customer self-service" requirement.)

No test was skipped and no suite was claimed to pass without actually being run.

## 11. Scope boundaries respected

- No offline SUPER_ADMIN recovery ceremony was implemented.
- No Admin Web/mobile UI was touched — backend-only (new entity, service, controller, module wiring,
  migration, tests).
- No multi-tenant/organization identifier was introduced.
- No silent change to the approved 11-role roster, function catalogue semantics, or any other
  governance decision — the one intentional, documented retrofit is covered in full in §9.
- `A2_MAKER_CHECKER_RULES_JSON` was not touched; the existing `privileged-approval` rate-limit
  category was reused as-is (no new rate-limit category added).
- `route-policy-registry.ts` required no change — the new controller's routes already fall under
  the existing `internal/a2/workforce/` prefix recognized as `WORKFORCE_SESSION`.

## 12. Known limitations / remaining gaps

- Role **deletion/deactivation** is not implemented (reserved `deactivate` column only — see §6).
  If a future task needs this, it must separately analyze the interaction with existing sessions
  and `a2_finance_role_assignments` rows that may still reference a role being deactivated.
- The workflow assumes a single, hardcoded approver identity model
  (SUPER_ADMIN initiates / FINANCE_CONTROLLER approves). It does not support, and was not asked to
  support, N-of-M approval, delegated approval, or approval by committee.
- `expiresInSeconds` on submission defers entirely to `PrivilegedActionApprovalService`'s existing
  default/maximum expiry handling; this implementation does not add a separate, shorter default
  specific to role-definition proposals.
- No admin UI exists yet to drive this workflow interactively; it is reachable only via the
  documented HTTP endpoints under `/api/v1/internal/a2/workforce/role-definitions/proposals`.

## 13. Files changed/added

- `src/migrations/1785753600086-CreateRoleDefinitionGovernance.ts` (new)
- `src/authorization/role-definition-proposal.entity.ts` (new)
- `src/authorization/role-definition-governance.service.ts` (new)
- `src/authorization/role-definition-governance.controller.ts` (new)
- `src/authorization-catalogue/authorization-role.entity.ts` (added `definitionVersion` column)
- `src/authorization-catalogue/authorization-catalogue.seed.ts` (SUPER_ADMIN/FINANCE_CONTROLLER
  grants on `workforce.role.create`/`.modify`)
- `src/authorization/authorization.module.ts` (wired new entities/controller/service)
- `test/v1-admin-role-definition-governance-implementation-01.integration.spec.ts` (new, 30 tests)
- `test/v1-admin-authorization-foundation-01.integration.spec.ts` (updated per §9)
- `test/v1-admin-authorization-hardening-01.integration.spec.ts` (updated per §9)
- This report.
