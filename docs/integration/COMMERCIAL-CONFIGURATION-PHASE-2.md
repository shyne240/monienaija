# Commercial Configuration — Phase 2 (Arena 3)

Status: **implemented, tested, NOT deployed**. Nothing financial is activated by this work: no
fee is charged, no commission accrued, no reward credited, and runtime limit enforcement behaves
exactly as before.

Branch: `arena/c8d5facd-monienaija` (branched from `arena/5-main-web-integration`).

---

## 1. What this phase adds

Three things, and deliberately only three:

| # | Capability | Where |
|---|---|---|
| 1 | **One** limit-rule selection implementation shared by runtime enforcement and preview | `src/limit-catalog/limit-rule-applicability.ts` |
| 2 | Read-only **effective-configuration preview** over the authoritative resolvers | `src/commercial-configuration/effective-configuration-preview.*` |
| 3 | Read-only **governed change history** for one commercial resource | `src/authorization/privileged-action-approval-read.service.ts`, `src/commercial-configuration/commercial-change-history.controller.ts` |

Plus the Admin Web Studio surfaces that consume them (§5).

### 1.1 Shared limit-rule applicability (Phase 2)

Before this change, limit-rule selection lived inline inside `LimitEnforcementService`. A preview
that re-derived it would have been a second limits engine and could have disagreed with
enforcement — the exact failure a commercial configuration Studio exists to prevent.

`limit-rule-applicability.ts` now expresses that selection once:

```sql
SELECT … FROM limit_rules
 WHERE limit_profile_code = ANY($1::varchar[])
   AND upper(product) = upper($2) AND upper(currency) = upper($3)
   AND is_active = true AND deleted_at IS NULL
   AND effective_from <= $4
   AND (effective_to IS NULL OR $4 < effective_to)
 ORDER BY priority DESC, created_at ASC
```

then `narrowApplicableLimitRules()`:

- direction: a rule with `NULL`/`BOTH` matches any direction; otherwise it must equal the
  operation direction exactly;
- channel: a rule with `NULL` matches any channel; a channel-scoped rule never matches a
  channel-less operation;
- input order is preserved — filtering, never sorting, because re-sorting would silently change
  which rule wins a tie.

The module selects **candidate rules only**. It performs no evaluation, no threshold comparison,
no reservation and no balance lookup. `LimitEnforcementService` keeps all of that.

### 1.2 Effective-configuration preview (Phase 3)

`GET /api/v1/internal/commercial-configuration/effective-preview`

Composes the *existing* resolvers inside one `REPEATABLE READ READ ONLY` transaction:

| Section | Authority |
|---|---|
| product | `ProductCatalogService.getProduct` |
| KYC restriction | `CustomerFinancialEligibilityService.require` (the trusted gate) |
| tier policy | `InstitutionKycLimitPolicyService.resolveWithManager` |
| limits | `LimitProfileResolverService.resolve` + the shared selection helpers |
| fee | `FeeRuleResolverService.resolveWithManager` + `FeeRuleCalculatorService.compute` |
| commission | `CommissionRuleResolverService.resolveWithManager` |
| reward | `RewardRuleResolverService.resolveWithManager` |
| customer class | **not available** → `NOT_APPLICABLE`, never inferred |

Every section reports one of `RESOLVED | MISSING | AMBIGUOUS | NOT_APPLICABLE | UNAVAILABLE`.
The advisory guarantee is stated in the payload and enforced by tests:

```json
{
  "mode": "ADVISORY",
  "authoritative": "BACKEND_RESOLVERS",
  "fee":         { "computed": { "postsJournalLegs": false } },
  "commission":  { "accrualPosted": false },
  "reward":      { "creditPosted": false },
  "guarantees":  { "readonly": true, "writesPerformed": [], "financialMutations": [] }
}
```

`LimitEnforcementService.enforceWithManager` is **never** called by the preview — it reserves
usage. Only the pure selection helpers are shared.

### 1.3 Governed change history (Phase 4)

`GET /api/v1/internal/commercial-configuration/change-history?actionType=…&resourceId=…&limit=…`

A read-only projection of the **existing** `privileged_action_approvals` ledger — no new audit
engine, no new table, no state transition. `resourceId` is the pivot, so a caller must already
know the rule it is asking about; there is no "list every approval" capability.

Allowed actions are a commercial allowlist (`FEE_RULE_CREATE/MODIFY`, `COMMISSION_RULE_*`,
`REWARD_RULE_*`, `LIMIT_RULE_CREATE/UPDATE`, `PRODUCT_MODIFY`). The read function is derived from
the governed-action's resource type, so a `limit.view` holder cannot read fee history: the
controller re-checks `fee_rule.view` / `commission_rule.view` / `reward_rule.view` /
`product.view`. **No new function code, role or principal type is introduced.**

`policy` and `actionFingerprint` are deliberately not returned.

---

## 2. Route policies and authorization (Phase 6)

Two explicit branches were added to `route-policy-registry.ts`, **before** the generic
`/api/v1/internal/` fallback:

| Route | Authentication | Principal types | Functions |
|---|---|---|---|
| `…/effective-preview` | `WORKFORCE_SESSION` | `OPERATOR`, `SERVICE`, `PRIVILEGED` | `limit.view` |
| `…/change-history` | `WORKFORCE_SESSION` | `OPERATOR`, `SERVICE`, `PRIVILEGED` | `limit.view` (+ action-specific function in the controller) |

Both set `auditDeniedWorkforceFunction: true`, so a denial is written to `audit_events` as an
`AUTHORIZATION_DECISION / DENIED` row. Customer and agent access are `NONE` on both.

No permission, role, or approval was invented. `limit.view` is the function every operative limit
surface already requires, and every resolver composed by the preview is already readable through
the catalogue/fee/commission/reward read routes.

---

## 3. Governed authoring capability matrix

Grounded in **this** baseline's controllers — not in a hoped-for contract:

| Domain | Capability | Maker action | Machinery |
|---|---|---|---|
| Fee rule | `GOVERNED_AUTHORING` | `FEE_RULE_CREATE` / `FEE_RULE_MODIFY` | `POST /internal/fee-rules`, `PATCH /internal/fee-rules/:id`, `…/changes/:approvalId/execute-create|execute-modify` |
| Commission rule | `GOVERNED_AUTHORING` | `COMMISSION_RULE_CREATE` / `_MODIFY` | same shape |
| Reward rule | `GOVERNED_AUTHORING` | `REWARD_RULE_CREATE` / `_MODIFY` | same shape |
| Limit rule | `GOVERNED_AUTHORING` | `LIMIT_RULE_CREATE` / `LIMIT_RULE_UPDATE` | `POST /internal/limit-profiles/:code/rules`, `PATCH /internal/limit-rules/:id`, `…/execute-create`, `…/execute-update` |
| Limit profile / assignment | **not authored here** | — | separate administration surfaces |
| `TIERED` commission/reward model | **withheld** | — | calculation model + editing contract not approved |

`LIMIT_RULE_CREATE` and `LIMIT_RULE_UPDATE` **are** registered in `governed-action.registry.ts`,
so the earlier `BLOCKED_ON_GOVERNANCE` assessment for limits is obsolete.

Limit-rule creation is nested under an **existing** profile code: the Studio creates rules inside
a profile, never profiles themselves. Modify sends the loaded `version` and strips immutable
fields.

---

## 4. Admin Web Studio (Phase 5)

New files under `apps/admin-web/src/screens/authenticated/`:

- `commercial-authoring-contract.ts` — capability matrix, field sets, payload builders, path
  builders, change-state explanation, preview/history query builders. Contains **no** business
  rules: no fee/commission/reward/threshold arithmetic, no precedence decision.
- `commercial-preview-contract.ts` — mirror of the backend preview types plus
  `assertAdvisoryPreview()`, which **refuses to render** any response whose `mode` is not
  `ADVISORY`, whose `authoritative` is not `BACKEND_RESOLVERS`, whose `readonly` is not `true`,
  which reports any write/financial mutation, or which omits a section.
- `CommercialPreviewPanel.tsx` — the preview form and every backend section/status rendered
  verbatim. No local arithmetic.
- `CommercialAuthoringDrawer.tsx` — maker phase only, three-phase boundary explanation
  (proposal → independent approval → execution), change history, and HTTP error mapping
  (401/403/409/503).
- `commercial-authoring.css` — boundary, validation, history, preview and table styles.

`CommercialRulesScreen.tsx` gained a `preview` tab (first in order, `limit.view` gated), a
capability kicker (`GOVERNED REGISTRY` / `READ-ONLY REGISTRY`), a "New {resource}" action and a
"Propose a governed change" footer that mounts the drawer.

The Studio never claims a change succeeded: the drawer reports `REQUESTED` and states that the
rule does not exist yet.

---

## 5. Verification (all re-run on this branch)

### Backend

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | clean |
| Lint (src + test) | `npm run lint` | clean |
| Format | `npx prettier --check "src/**/*.ts" "test/**/*.ts"` | clean |
| Build | `npm run build` | exit 0 |
| Unit | `npm test` | 3465 passed, 1 failed |

The single unit failure is `test/consolidated-matrix.spec.ts`, which runs
`git merge-base --is-ancestor dd1b6314… HEAD` against a **shallow** clone in which that commit does
not exist ("fatal: Not a valid commit name"). It is a repository-history artefact of the sandbox,
not a code failure. `test/module-di-wiring.spec.ts`, which was SIGKILLed by the runner under
`maxWorkers=2` in the full run, passes standalone (8/8).

### New PostgreSQL integration suite

`test/v1-commercial-configuration-authoring.integration.spec.ts` — **26/26 passing** against real
PostgreSQL 18.4 with real HTTP, real bearer sessions minted by
`A2WorkforceSessionService.establish()` after persisting real role assignments, and real
authorization decisions.

| # | Assertion |
|---|---|
| 1 | Both routes carry an explicit workforce policy, not the generic `/internal/` fallback |
| 2 | `limit.view` holder served; anonymous caller 401 |
| 3 | Role without `limit.view` 403 **and** the denial is recorded in `audit_events` |
| 4 | POST/DELETE rejected on both read surfaces |
| 5 | Malformed preview input 400 (missing product, bad direction, negative amount) |
| 6 | Preview selects **exactly** the rule set enforcement selects |
| 7 | Direction narrowing identical (OUTGOING rule invisible to INCOMING; runtime refuses) |
| 8 | Channel narrowing identical (channel-scoped rule never matches a channel-less operation) |
| 9 | Effective dates: `effective_from` inclusive, `effective_to` exclusive — preview and runtime agree at ±1 ms |
| 10 | Inactive and soft-deleted rules ignored identically |
| 11 | Precedence `priority DESC, created_at ASC` preserved, never re-sorted |
| 12 | Direct helper call returns the same rules |
| 13 | No profile → `MISSING` + BLOCKER; strict runtime refuses; legacy contract still passes through |
| 14 | Empty profile ≠ no profile (`LIMIT_RULE_MISSING` vs `LIMIT_PROFILE_MISSING`) |
| 15 | No principal → `NOT_APPLICABLE`, not `MISSING` |
| 16 | Fee priority tie → `AMBIGUOUS`, no rule selected, no fee computed, BLOCKER |
| 17 | Fee/commission/reward resolve and report `postsJournalLegs`/`accrualPosted`/`creditPosted: false`; zero journal, usage and reservation rows created |
| 18 | Customer class `NOT_APPLICABLE` and carries no inferred identifier |
| 19 | Limit-rule proposal writes nothing → approval writes nothing → execution writes exactly one rule; replay 409 |
| 20 | Tampered payload 403; approval stays `APPROVED`, un-consumed |
| 21 | Unentitled maker 403; premature execution 409; maker cannot execute |
| 22 | Stale rule version 409 "Version conflict — stale version"; value unchanged, version incremented by the concurrent writer |
| 23 | History filtered by action type + resource, newest first, `executed` flag, no policy/fingerprint leakage |
| 24 | Non-commercial action type 403 |
| 25 | Action-specific read function enforced (`limit.view` alone cannot read fee history) |
| 26 | Missing/oversized query parameters 400; unknown resource yields an empty list, not an error |

### Regression (real PostgreSQL)

| Suite | Result |
|---|---|
| `v1-limit-04-limit-runtime` + `v1-commercial-rule-governance` | 2 suites / 43 tests passed |
| `v1-harden-01-runtime-access-guard-boundary`, `v1-limit-01-limit-catalogue`, `v1-fee-runtime-wiring`, `v1-customer-08-limits-view` | 4 suites / 43 tests passed |

### Admin Web

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx jest --watchAll=false` | 89 suites / **937 tests** passed |
| `npm run build` | exit 0 |

New Admin Web suites: `m2-commercial-authoring-contract.test.ts` (30 tests) and
`m2-commercial-authoring-surfaces.test.tsx` (17 tests).

---

## 6. Deliberate non-goals (unchanged boundaries)

- No commercial accounting, journal posting, fee charging at transaction time.
- No commission accrual, settlement or reward credit.
- No financial-provider activation.
- No tiered commercial authoring (model + editing contract not approved).
- No direct-write bypass where maker/checker applies.
- No new permission, role, approval or audit engine.
- No inference of a customer class from KYC tier, segment or agent class.
- Runtime limit enforcement behaviour is unchanged — proven by regression suite and by parity
  tests at ±1 ms of every boundary.

---

## 7. Open product decisions (not invented here)

1. **Limit-rule governance ownership** — the existing workflow is reused; who owns it long-term is
   undecided.
2. **Authorized maker roles** — `FINANCE_PREPARER` retains its existing grants; no new role.
3. **Customer-class targeting & precedence** — requires the canonical Arena 1 contract. Preview
   reports `NOT_APPLICABLE` until then.
4. **Tiered fee authoring** — the mission says *fee*; the earlier inventory scoped `TIERED` as a
   commission/reward calculation model. Both remain withheld; reconciliation is a product
   decision.
5. **Institution & agent-class targeting** — resolvers accept these inputs; no authoring contract
   exposes them yet.
6. **Approval-expiry defaults** — unchanged from `PrivilegedActionApprovalService`.
7. **Ambiguous top-priority handling** — the resolvers refuse; no tie-break policy is approved.

## 8. Remaining work for production-capable governed authoring

- Approve the customer-class contract, then add a `customerClass` section to the preview.
- Approve a tiered calculation model + editing contract for fee/commission/reward.
- Decide limit-rule governance ownership and maker-role scope.
- Approve a tie-break policy (or confirm permanent refusal) for equal top priority.
- Wire the Studio's approvals screen into the same discoverability path as change history.
- Provision the fee-revenue ledger account family before any fee posting can exist.
