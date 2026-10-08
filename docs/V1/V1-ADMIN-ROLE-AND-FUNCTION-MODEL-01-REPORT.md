# V1-ADMIN-ROLE-AND-FUNCTION-MODEL-01

**Classification: AUDIT/DESIGN ONLY. NO CODE, DATABASE, MIGRATION, ROLE, PERMISSION,
AUTHORIZATION, OR ADMIN WEB CHANGE WAS MADE.** This document designs a proposed starting
Function → Role → Workforce-User model for MonieNaija V1 and assesses whether the current
architecture can evolve toward a data-driven, extensible RBAC system without further source
changes being required for every future role/permission edit. It does not implement any of that.
It reuses, and does not re-litigate, facts already established in
`V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01`, `V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01`, and
`V1-ADMIN-SECURITY-AND-PORTAL-DECISION-02` (commit `31796c5`); new evidence gathered this task
is marked **NEW**.

**Repository discipline (performed before any file was read for this task):**
`git fetch origin arena/01a10374-monienaija` confirmed the real remote tip as
`31796c54e100cfc575df177cd272f142e193c29f`. The local checkout had again reverted to a stale
commit — the same recurring sandbox pattern logged in every prior task this session, this time
the furthest back yet (missing hundreds of files present at the real tip). `git reset --hard
origin/arena/01a10374-monienaija` restored the correct state; `git log` and `git status`
confirmed HEAD at `31796c5`, a clean working tree, and commit `31796c5` present in history before
any analysis began.

---

## 1. Executive summary

The repository already contains most of the *mechanism* a data-driven Function → Role → User
model needs — a generic scope-checking authorization engine (`requiredScopes.every(scope =>
principal.scopes.includes(scope))`), role-assignment records that are plain, non-enum database
rows rather than schema-hardcoded, and a maker/checker engine driven by configuration rather than
code. What it does **not** have is: a persisted function/permission catalogue (none exists; roles
and their scopes live only in an environment-variable JSON blob,
`A2_FINANCE_ROLES_JSON`, loaded once at process startup), a persisted roles table (roles are
config objects, not database rows), and — most importantly — a small number of genuinely
hardcoded role-*name* dependencies baked directly into application logic (chiefly,
`workforce-session.service.ts:152`'s `roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' :
'OPERATOR'`, and several literal `'FINANCE_ADMIN'` string checks in
`finance-role-administration.service.ts` and `workforce-configuration.ts`'s Zod schema). These
hardcoded dependencies, not the database schema, are the real obstacle to "create a new role
without a source-code change." This report proposes a minimum, non-generic starting V1 role set
(reusing the four existing roles' already-correct shape plus a reconceptualized administrative
role), a function catalogue scoped to what the backend actually implements today, and an explicit
governance model that keeps dual-control and maker/checker rules non-bypassable even once role
assignment itself becomes configurable. Nothing in this report is implemented.

---

## 2. Current authorization architecture (Part A)

### 2.1 Current workforce roles

Exactly four, config-driven, schema-validated at startup (`A2_FINANCE_ROLES_JSON`,
`src/authorization/workforce-configuration.ts`): `FINANCE_ADMIN`, `FINANCE_PREPARER`,
`FINANCE_CONTROLLER`, `FINANCE_AUDITOR`. Unchanged since the prior three audits; re-confirmed
this session.

### 2.2 Current role definitions

Each role is a JSON object with `roleKey`, `displayName`, `description`, `enabled`, `scopes`
(string array), `applicableActions` (string array), `mfaRequired`, `approvalCapability`,
`makerEligible`, `checkerEligible`, `administrativeCapability` — all previously documented in
full in `V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01` §2.1 and reused here without re-derivation.

### 2.3 Current principal types

Five: `CUSTOMER`, `AGENT`, `SUPPORT`, `OPERATOR`, `PRIVILEGED` (plus `SERVICE`, reserved for the
disabled partner-callback boundary, and `AGGREGATOR`, referenced defensively in one controller
check but never actually produced by any login path). Principal type is derived from role
holdings at session-establishment time, not stored as its own independent concept.

### 2.4 Current permissions/capabilities (scopes)

Exactly five scope strings exist anywhere in the system: `privileged:execute`,
`privileged:approve`, `finance:prepare`, `finance:audit`, `internal:access`. **NEW finding this
session:** the scope-checking mechanism itself is generic and already works —
`src/authorization/authorization.service.ts:98`:
```
if (!requiredScopes.every((scope) => principal.scopes.includes(scope))) { ... deny ... }
```
This is structurally identical to a permission check (`requiredScopes` = "the functions this
route needs," `principal.scopes` = "the functions this principal's roles grant"). **The gap is
not a missing mechanism — it is that almost no route in `route-policy-registry.ts` populates
`requiredScopes` with anything.** Of the ~30 route branches enumerated across the prior three
audits, only two populate `requiredScopes`: the partner-callback branch (`SERVICE` principal
only) and the final catch-all (`internal:access`, granted to no role). Every other branch is
gated purely by `allowedPrincipalTypes`, which is far coarser than a function/permission check.

### 2.5 Current authorization guards and route policies

`RuntimeAccessGuard` (global `APP_GUARD`) resolves every request through
`RoutePolicyRegistry.resolve()`, which returns an `authenticationMode` (`PRINCIPAL`,
`WORKFORCE_SESSION`, `CUSTOMER_LOGIN`, `AGENT_LOGIN`, `SUPPORT_LOGIN`, `WORKFORCE_ASSERTION`,
`PROVIDER_CALLBACK`) and, for authenticated routes, an `AuthorizationPolicy`
(`resourceType`, `action`, `allowedPrincipalTypes`, optional `requiredScopes`,
`customerAccess`/`agentAccess`/`aggregatorAccess`). `AuthorizationService` then checks principal
type membership, scope coverage (only where declared), and self-access rules. This is unchanged
infrastructure, fully re-usable as the enforcement point for a richer function model (see Part F).

### 2.6 Current role-to-capability mappings

Exist only inside `A2_FINANCE_ROLES_JSON`'s `scopes` arrays — a role "has" a capability only in
the sense that it is granted one of the five scope strings above. There is no mapping from a role
to a specific *business* capability (e.g. "can suspend an agent") anywhere in configuration —
that mapping is implicit in which `allowedPrincipalTypes` a given controller/route happens to
list, which is compiled into the application, not configuration.

### 2.7 Hardcoded role assumptions (critical for Part F)

**NEW findings this session**, confirmed by direct code inspection:

1. `src/authorization/workforce-session.service.ts:152`:
   ```
   type: roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' : 'OPERATOR',
   ```
   The literal string `'FINANCE_ADMIN'` is hardcoded into the principal-type derivation. No
   other role, however configured, can ever produce a `PRIVILEGED` principal without a code
   change to this exact line.
2. `src/authorization/workforce-configuration.ts:50-55` (schema `superRefine`):
   ```
   if (role.administrativeCapability && role.roleKey !== 'FINANCE_ADMIN') { ...fail... }
   ```
   `administrativeCapability` can never be granted to any role key other than the literal string
   `'FINANCE_ADMIN'`.
3. `src/authorization/workforce-configuration.ts:147` + the `.min(4).max(4)` schema bound
   (line ~238): the role vocabulary must be **exactly** `['FINANCE_ADMIN', 'FINANCE_PREPARER',
   'FINANCE_CONTROLLER', 'FINANCE_AUDITOR']` — not a superset, not a subset. A fifth role cannot
   be added via configuration alone.
4. `src/authorization/finance-role-administration.service.ts` contains multiple literal
   `'FINANCE_ADMIN'` string comparisons: `c.roleKey === 'FINANCE_ADMIN'` (assignment/initial
   grant prohibitions), `c.principal.roles.includes('FINANCE_ADMIN')` (sole gatekeeper check for
   first-of-each-role assignment), and the `InitialBootstrap`/local-dev-seed paths are
   hardcoded to grant exactly `'FINANCE_ADMIN'`.
5. `route-policy-registry.ts` hardcodes **principal types** (not role names) into route
   conditions — e.g. `allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED']`. This is one
   level more flexible than hardcoding role names directly (any role mapping to `OPERATOR` is
   automatically covered), but principal type itself is only ever derived via finding #1's
   hardcoded check, so the flexibility is illusory beyond the existing two-type split.
6. Several individual admin controllers (`admin-agent-lifecycle.controller.ts`,
   `admin-support-credentials.controller.ts`, etc.) hardcode an in-method allow-list of principal
   types (`['OPERATOR','SERVICE','PRIVILEGED']`) rather than reading `requiredScopes` from policy
   — meaning even if the route policy declared a function-specific `requiredScopes`, some
   controllers would need their own code updated too, since they do not currently consult
   `policy.requiredScopes` at all, only the pre-resolved principal object's `type`.

### 2.8 Database structures related to workforce roles/permissions

**NEW findings this session**, from direct entity inspection
(`src/authorization/workforce-authentication.entity.ts`):

- `a2_finance_role_assignments.role_key` is a plain `varchar(100)` column — **not** a Postgres
  `ENUM`, **not** a foreign key to any roles table, and has **no `CHECK` constraint** restricting
  its values (unlike the same table's `status` column, which does have a `CHECK
  (status IN ('ACTIVE','REVOKED'))`). **This is a materially positive finding for extensibility:
  the database schema itself places no restriction on which role keys can be assigned** — the
  exactly-four-roles limitation is enforced entirely in application code
  (`workforce-configuration.ts`'s Zod schema, loaded once from an environment variable at
  startup), not in the schema. Relaxing the role vocabulary does not require a destructive
  migration to the assignment table itself.
- **There is no `roles` table and no `functions`/`permissions` table anywhere in the schema.**
  Roles exist only as a parsed, in-memory JSON configuration object
  (`A2WorkforceConfigurationV1.roles`), re-read once per process start from
  `A2_FINANCE_ROLES_JSON`. A role does not have a database identity; it is a string key that
  happens to match an entry in that in-memory array.
- `a2_finance_role_assignments` otherwise already has the right shape for a future
  Function→Role→User model's "user has role" edge: `principalId`, `roleKey`, `effectiveFrom/To`,
  `assignedBy`/`assignedAt`, `revokedBy`/`revokedAt`, `approvalIds`, `auditReferences`,
  optimistic `recordVersion`. This table is a strong candidate to be **reused, not replaced**,
  once `roleKey` is validated against a database-backed roles table instead of (or in addition
  to) the environment-variable JSON.
- `PrivilegedActionApproval` (the maker/checker engine's own table) is similarly
  **action-type-driven** (`actionType: varchar`), not hardcoded to specific role names at the
  schema level — the rule linking an `actionType` to specific initiating/approving roles lives
  entirely in `A2_MAKER_CHECKER_RULES_JSON`, again an environment-variable config object, not a
  database table.
- A **separate**, pre-existing `Capability` entity (`src/capability-registry/capability.entity.ts`,
  table `capabilities`) exists in the codebase, but — important to note so it is not mistaken for
  prior art toward a permission catalogue — **this is a product-feature-tracking registry**
  (fields: `domain`, `productScope` [V1/V2], `lifecycle`, `backendStatus`, `apiStatus`,
  `adminUiStatus`, `customerUiStatus`), used to document which backend/API/UI surfaces exist and
  in what state. It is read-only infrastructure for documentation/governance, has no relationship
  to `principal.scopes` or any authorization check, and should not be conflated with the function/
  permission catalogue this report proposes. It does, however, demonstrate that the codebase
  already has a working precedent for a domain-coded, database-backed registry pattern (primary
  key = code, `enabled` flag, versioned) that a future function catalogue could structurally
  resemble.

### 2.9 Admin Web assumptions about roles

Reused directly from the prior two reports: `Layout.tsx` computes `isAdmin = roles.includes
('FINANCE_ADMIN') || scopes.includes('privileged:execute')`, `isController =
roles.includes('FINANCE_CONTROLLER') || scopes.includes('privileged:approve')`, `isOperator =
roles.length > 0`. **NEW observation this session:** the `isAdmin`/`isController` checks already
use an **OR against a scope string**, not purely a role-name check — meaning Admin Web's own
navigation logic is already halfway toward being permission-driven (a future SUPER_ADMIN holding
`privileged:execute` would show the same nav item without any frontend code change), whereas
`isOperator`'s blanket `roles.length > 0` is the one spot that is role-name-agnostic but also
completely function-agnostic (any role at all unlocks the same four nav items, which is the root
of the FINANCE_AUDITOR-reaches-everything-at-the-UI-level symptom, mirroring the backend finding).

### 2.10 Configuration schemas that constrain role creation

`workforce-configuration.ts`'s Zod `roleSchema` (§2.7, findings 2–3) is the sole constraint
surface. It is strict (`.strict()`, rejects unknown fields), bounds array sizes, and enforces the
cross-field invariants already described. No other file constrains role creation.

### 2.11 Summary: permission-driven vs. hardcoded, by component

| Component | Permission-driven (data) | Hardcoded (code) |
|---|---|---|
| Role existence | Env var JSON (not DB) | Exact 4-key vocabulary enforced in Zod schema |
| Role→scope mapping | Env var JSON | — |
| Scope→route requirement | `route-policy-registry.ts`'s `requiredScopes` field (data-shaped, but only populated on ~2 of ~30 branches) | Which branch a path matches is itself code (route matching), and most branches use `allowedPrincipalTypes` instead of `requiredScopes` |
| Principal type derivation | — | Fully hardcoded (`roles.includes('FINANCE_ADMIN') ? ...`) |
| `administrativeCapability` holder | — | Hardcoded to `'FINANCE_ADMIN'` literal |
| Maker/checker rules | Env var JSON (`A2_MAKER_CHECKER_RULES_JSON`) | Self-approval prohibition logic is code, but which roles are makers/checkers for which action is data |
| Role assignment persistence | Database row (`a2_finance_role_assignments`), schema-unconstrained on `role_key` | `finance-role-administration.service.ts`'s literal `'FINANCE_ADMIN'` business-rule checks |
| Admin Web nav visibility | Partially — `isAdmin`/`isController` check scopes (data-like) | `isOperator`'s blanket any-role check; screen *contents* beyond nav are not permission-filtered at all |

---

## 3. Proposed V1 functional areas (Part B, item 4 of the required contents)

Per instruction, the six listed areas (SUPER_ADMIN/Administration, Finance, Operations,
Compliance, Treasury, Customer Service) are evaluated as **functional areas**, not assumed to
each become exactly one role.

| Functional area | Backend capability actually found (this session + prior audits) | Minimum roles needed |
|---|---|---|
| Administration | Workforce role administration (today's `FINANCE_ADMIN` mechanics); broad read access; agent/customer lifecycle actions currently reachable via type-collapse, not by design | **One role** — no separation-of-duties need was found *within* pure administration itself (it is not a maker/checker domain the way finance mutation is) |
| Finance | Fee/commission/reward/limit/product registries (single-step writes today, no governed action); ledger (unreachable); no maker/checker rule for ledger exists yet; `FINANCE_CONTROL_POLICY_ACTIVATE` already has a real maker/checker split | **Three roles**, matching the already-coded shape: Preparer (maker), Controller (checker), Auditor (read) — segregation-of-duties is a real, already-partially-implemented requirement here, unlike Administration |
| Operations | Agent lifecycle, aggregator administration, support ticket/workforce-user provisioning, agent funding/outlets/terminals — all built, none have any role-specific (as opposed to principal-type) authorization today | **One role** is sufficient to start — no evidence of a maker/checker need within pure agent/support operations was found in the backend as implemented (e.g. agent suspend is a single-step action in the current code, with no approval step coded anywhere) |
| Compliance | KYC assessment recording, compliance-cases, risk-profile — all exist under the generic `/customers/:id` branch, with no dedicated compliance role or approval step coded anywhere | **One role** at V1 scope — the backend does not currently implement a compliance-specific approval workflow to split across multiple roles |
| Treasury | **No backend capability distinct from Ledger/Reconciliation was found anywhere in the repository.** No treasury-specific controller, entity, or service exists. "Treasury Portal" is named only in the roadmap's future frontend list, with no backend platform (B3 Treasury) yet built. | **Zero roles at V1** — there is nothing for a Treasury role to do yet that Finance/Reconciliation read access doesn't already cover; a dedicated Treasury role would have no function catalogue to assign today |
| Customer Service | Support ticket viewing/assignment/resolution (`support-internal.controller.ts`), customer investigation reads (`admin-customer.controller.ts`) — already fairly narrow, read/ticket-oriented | **One role** is sufficient — no mutation of financial state belongs here by design, matching the proposal's own stated boundary |

**This directly answers the instruction not to assume one role per area:** Finance needs three
(an already-existing pattern); everything else needs at most one; Treasury needs **zero** at V1,
since no Treasury-specific backend capability exists to assign a role to.

---

## 4. Proposed initial V1 roles (Part B)

1. **SUPER_ADMIN** (conceptual rename/expansion of today's administrative role — see Part A §5 of
   the prior report for the open "rename vs. coexist" decision, not resolved here)
2. **FINANCE_PREPARER** (already exists, retained as-is)
3. **FINANCE_CONTROLLER** (already exists, retained as-is)
4. **FINANCE_AUDITOR** (already exists, retained as-is — with its enforcement gap flagged, not
   fixed, per Part 9 below)
5. **OPERATIONS** (new conceptual role — agent/aggregator/support administration)
6. **COMPLIANCE** (new conceptual role — KYC/compliance-case/risk-profile administration)
7. **CUSTOMER_SERVICE** (new conceptual role — ticket handling and read-only customer
   investigation, explicitly excluded from any financial mutation)

**Treasury is deliberately not proposed as a starting V1 role** — see §3 above. If a Treasury
backend platform (B3) is ever built, a Treasury role should be defined against its actual
capabilities at that time, not pre-created empty today.

This is **seven** conceptual roles, not six — because Finance, per the product owner's own
example, splits into three, while Treasury contributes zero. None of these are created in this
task.

---

## 5. Proposed V1 function/permission catalogue (Part C)

Every function below is checked against the actual repository. Functions marked **(exists)** map
to a real, already-implemented backend route; functions marked **(future)** have no current
backend implementation and are listed only because the product owner's example mentioned them —
they are not to be read as already-built.

### CUSTOMER
| Function | Status | Evidence |
|---|---|---|
| `customer.view` | **(exists)** | `GET /customers`, `GET /customers/:id` |
| `customer.create` | **(exists)** | `POST /customers` |
| `customer.suspend` / `customer.activate` / `customer.close` | **(exists, single action)** | `PATCH /customers/:id` is one generic lifecycle-transition endpoint, not three separate functions in the backend today — the DTO carries a target status; a future function catalogue could still *split* this one route into three distinct permissions at the authorization layer even though the backend route is unified |
| `customer.view_transactions` | **(exists)** | `GET /internal/customers/:id/transactions` (`admin-customer.controller.ts`) |
| `customer.manage_support_case` | **(exists)** | `support-internal.controller.ts` ticket routes, scoped by customer where applicable |
| `customer.view_wallets` / `customer.create_wallet` | **(exists)** | `customer-wallet.controller.ts` |
| `customer.terminate` | **(future)** — no distinct "terminate" lifecycle status beyond what `PATCH /customers/:id` already models was separately confirmed this task; treat as covered by the lifecycle function above, not a separate one, unless the product owner wants finer-grained statuses than exist today |

### KYC / COMPLIANCE
| Function | Status | Evidence |
|---|---|---|
| `kyc.view` | **(exists)** | `GET /customers/:id/kyc` |
| `kyc.review` / `kyc.approve` / `kyc.reject` | **(exists, single action)** | `POST /customers/:id/kyc-assessment` — one endpoint, no distinct approve/reject sub-actions or a separate review-vs-decide step in the backend today; again, a function catalogue *could* split this at the authorization layer ahead of any backend change, but should not claim three backend actions exist where one does |
| `compliance.manage_case` | **(exists)** | `customer-compliance.controller.ts` (`compliance-cases` sub-resource — create/get/patch/comment/evidence/assignment/history) |
| `compliance.restrict_account` / `compliance.release_restriction` | **(future)** — no distinct "restriction" concept separate from the general lifecycle status (`PATCH /customers/:id`) or the general risk-profile endpoints was found |
| `compliance.manage_risk_profile` | **(exists)** | `customer-risk-profile.controller.ts` |

### AGENT
| Function | Status | Evidence |
|---|---|---|
| `agent.view` | **(exists)** | `GET /internal/agents` (`admin-agent.controller.ts`) |
| `agent.create` | **(exists, via application)** | Agent applications (`agent-application-admin.controller.ts`) → activation, not a direct "create agent" endpoint |
| `agent.activate` / `agent.suspend` / `agent.terminate` / `agent.reactivate` | **(exists)** | `admin-agent-lifecycle.controller.ts` — four distinct existing endpoints, genuinely separable functions today, unlike the customer-lifecycle case above |
| `agent.change_limits` | **(exists, as limit assignment, not agent-specific)** | `limit-catalog`/`limit-assignment` controllers assign limit profiles; not a dedicated "change an agent's limit" endpoint distinct from the general limit-assignment mechanism |
| `agent.manage_permissions` | **(future)** — no concept of per-agent granular permissions exists; agent capability is governed by `agent_classes`/service-capability gates, which is a different mechanism (service eligibility, not an authorization permission) |
| `agent.fund` / `agent.defund` | **(exists)** | `agent-funding.controller.ts` |
| `agent.manage_credentials` | **(exists)** | `admin-agent-credentials.controller.ts` |
| `agent.manage_outlets_terminals` | **(exists)** | outlet/terminal routes under `/internal/agents/.../outlets|terminals` |

### AGGREGATOR
| Function | Status | Evidence |
|---|---|---|
| `aggregator.view` / `aggregator.manage` | **(exists, foundation only)** | `admin-aggregator.controller.ts`, `aggregator.controller.ts` — login/self-service deliberately out of V1 scope (separate, already-documented decision) |

### TRANSACTIONS
| Function | Status | Evidence |
|---|---|---|
| `transaction.view` | **(exists in principle, currently unreachable)** | `GET /transfers/:id`, `/deposits/:id`, `/withdrawals/:id` all fall to the `internal:access`-gated catch-all (nobody has this scope today) |
| `transaction.search` | **(future)** — no search/filter endpoint distinct from the per-id lookups above was found |
| `transaction.request_reversal` / `transaction.approve_reversal` / `transaction.reject_reversal` | **(future at the transaction level)** — the only reversal mechanism in the codebase operates at the **ledger journal** level (`POST /ledger/journals/:id/reversal`), not at the transfer/deposit/withdrawal level directly; see LEDGER below |

### LEDGER
| Function | Status | Evidence |
|---|---|---|
| `ledger.view` | **(exists in principle, currently unreachable)** | `GET /ledger/accounts`, `/ledger/journals/:id` — same `internal:access` gap |
| `ledger.post` | **(exists in principle, currently unreachable, and has NO maker/checker rule)** | `POST /ledger/journals` |
| `ledger.reverse` | **(exists in principle, currently unreachable, and has NO maker/checker rule)** | `POST /ledger/journals/:id/reversal` |
| `ledger.approve_adjustment` | **(future)** — there is no governed action in `A2_MAKER_CHECKER_RULES_JSON` for either posting or reversing a journal, so there is currently nothing for this function to approve; this function would need to be created together with `ledger.post`/`ledger.reverse` becoming governed actions |

### FINANCE (commercial rule registries)
| Function | Status | Evidence |
|---|---|---|
| `fee_rule.view` / `.create` / `.modify` | **(exists, single-step, no approval gate)** | `fee-rule-registry.controller.ts` |
| `fee_rule.activate` | **(future, as a distinct governed step)** — no separate "activate" vs. "create/modify" lifecycle was found for fee rules distinct from `FINANCE_CONTROL_POLICY_ACTIVATE`, which governs a different, more general "finance control policy," not fee rules specifically |
| `commission_rule.view` / `.create` / `.modify` | **(exists, single-step)** | `commission-rule-registry.controller.ts` |
| `reward_rule.view` / `.create` / `.modify` | **(exists, single-step; "no runtime reward crediting exists" per the route-policy-registry.ts code comments — schema foundation only)** | `reward-rule-registry.controller.ts` |
| `limit.view` / `.modify` | **(exists, single-step)** | `limit-catalog.controller.ts`, `limit-assignment.controller.ts`, `limit-operations.controller.ts` |
| `product.view` / `.modify` / `.governance` | **(exists, single-step)** | `product-catalog.controller.ts`, `product-governance.controller.ts` |

### WORKFORCE
| Function | Status | Evidence |
|---|---|---|
| `workforce.role.view` | **(exists, implicitly)** | Role assignments can be read via `A2FinanceRoleAssignment` queries inside `finance-role-administration.service.ts`'s `view()`; no dedicated "list all assignments" admin endpoint was separately confirmed this session |
| `workforce.role.assign` / `.revoke` | **(exists)** | `POST`/`DELETE /internal/a2/workforce/roles*` |
| `workforce.role.create` / `.modify` (i.e. define a *new* role or edit an existing role's function set) | **(future — this is precisely the capability this whole task is designing toward and explicitly must NOT be implemented now)** | No code path creates or edits a role definition; roles are environment-variable JSON, edited only by redeploying the application |
| `workforce.user.view` / `.create` / `.suspend` | **(exists, for SUPPORT only)** | `admin-support-credentials.controller.ts` — provisioning is SUPPORT-specific; there is no general "workforce user" concept distinct from the OIDC-identity-plus-role-assignment model for FINANCE_* roles (a FINANCE_* "user" is just an OIDC identity with an active assignment row, not a separately created local user record) |

### AUDIT
| Function | Status | Evidence |
|---|---|---|
| `audit.view` | **(exists, no dedicated UI)** | `GET /internal/audit` (`operations.controller.ts`) |
| `audit.search` | **(exists, narrowly)** | `AuditService.list()` supports filtering by `entityType`/`entityId`/`correlationId` — a real, if basic, search capability |
| `audit.export` | **(future)** — no export endpoint or format was found |

### RECONCILIATION
| Function | Status | Evidence |
|---|---|---|
| `reconciliation.view` | **(exists)** | `GET /internal/reconciliation/report`, `/trial-balance`, `/finance`, `/accounts/:id/activity` |
| `reconciliation.investigate` | **(future, as a distinct action)** — report data can be *viewed*, but there is no "open an investigation" workflow/entity distinct from viewing the report |
| `reconciliation.resolve` | **(future)** — no "break resolution" endpoint was found; resolving a break, if it requires correcting the ledger, would route through `ledger.post`/`ledger.reverse` above, not a reconciliation-specific action |

### OPERATIONS (observability)
| Function | Status | Evidence |
|---|---|---|
| `outbox.view` | **(exists, no UI)** | `GET /internal/outbox` |
| `metrics.view` | **(exists, no UI)** | `GET /internal/metrics` |
| `diagnostics.view` | **(exists, no UI)** | `GET /internal/diagnostics` |
| `notification.view_deliveries` | **(exists, no UI)** | `GET /internal/notifications/deliveries` |

---

## 6. Function sensitivity classification (Part D)

| Function (representative) | Classification | Directly assignable? | Restricted to approved role classes? | Maker/checker? | Independent approval? | Auditor-visible? | Never directly executable by SUPER_ADMIN? |
|---|---|---|---|---|---|---|---|
| `customer.view`, `agent.view`, `ledger.view`, `reconciliation.view`, `audit.view`, `outbox.view`, `metrics.view`, `kyc.view` | **READ** | Yes | No | No | No | Yes | N/A (read is fine for SUPER_ADMIN) |
| `customer.create`, `customer.suspend/activate`, `agent.activate/suspend/terminate/reactivate`, `compliance.manage_case`, `compliance.manage_risk_profile`, `kyc.review` | **OPERATIONAL** | Yes | No (any of Administration/Operations/Compliance as applicable) | No | No | Yes | No — SUPER_ADMIN/Operations/Compliance may execute these directly, matching current reachability and the proposal's own description of SUPER_ADMIN's allowed "administrative" scope |
| `agent.fund/defund`, `fee_rule.create/modify`, `commission_rule.create/modify`, `limit.modify`, `product.modify` | **SENSITIVE** (has real financial consequence even though it is not itself a ledger posting) | Yes, but — | Restricted to Finance/Operations as applicable | **Recommended** (not currently implemented) — see Part A §5 "borderline" note carried from the prior report | Recommended | Yes | Debatable — flagged, not resolved, in the prior report; this report does not force a resolution here either |
| `workforce.role.assign/revoke` | **PRIVILEGED** | No — restricted to the administrative role only | Yes | **Yes — already implemented** (FINANCE_ADMIN initiates, FINANCE_CONTROLLER approves) | Yes | Yes | N/A — this is exactly SUPER_ADMIN's one legitimate execution capability under the proposal |
| `workforce.role.create/modify` (defining a new role's function set) | **PRIVILEGED / governance-of-governance** | **No — must never be "just assignable"; this is the capability this whole report is designing the guardrails for** | Yes, to a narrowly-defined administrative capability | Should require independent approval even for the admin role itself (see Part G) | Yes | Yes | Not denied to SUPER_ADMIN outright, but must never allow self-escalation (see Part G/H) |
| `ledger.post`, `ledger.reverse`, `ledger.approve_adjustment` | **CRITICAL FINANCIAL** | No | Restricted to Finance roles only | **Mandatory, non-negotiable** | Mandatory | Yes | **Yes — SUPER_ADMIN must never be able to execute these directly, regardless of configuration** |
| `transaction.approve_reversal` | **CRITICAL FINANCIAL** (if/when it exists as a distinct function) | No | Restricted to Finance roles only | Mandatory | Mandatory | Yes | Yes |

**The governing principle applied throughout this table, matching the task's explicit
instruction:** READ and most OPERATIONAL functions are freely assignable to any role a future
administrator creates. SENSITIVE functions should be restricted and are strong maker/checker
candidates even though today's code doesn't enforce it. PRIVILEGED and CRITICAL FINANCIAL
functions must carry their governance rule (maker/checker, dual control, non-self-escalation)
**as a property of the function itself**, not as a property of whichever role happens to be
assigned it — so that a future "create a new role and give it whatever functions you like" admin
tool cannot accidentally (or deliberately) hand a new role unrestricted financial execution
merely by including a critical function in its function list (elaborated in Part G).

---

## 7. Initial role → function matrix (Part E)

Abbreviated to the representative functions above (the full catalogue in §5 follows the same
pattern per function); `CU` = can initiate, `AP` = can approve, `RO` = read only, `MC` =
maker/checker required.

| ROLE | FUNCTION | ACCESS TYPE | CAN INITIATE? | CAN APPROVE? | READ ONLY? | MAKER/CHECKER REQUIRED? | SENSITIVITY | RATIONALE |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | `workforce.role.assign/revoke` | Administer | Yes | No | No | Yes (existing) | PRIVILEGED | Mirrors today's exact FINANCE_ADMIN mechanics — unchanged |
| SUPER_ADMIN | `customer.*`, `agent.*`, `compliance.*`, `kyc.*`, commercial-rule `.view` | Administer / View | Yes (operational only) | No | Mixed | No | OPERATIONAL/SENSITIVE | Matches proposed boundary: broad administrative reach, no financial execution |
| SUPER_ADMIN | `ledger.post`, `ledger.reverse`, `ledger.approve_adjustment` | **None** | **No** | **No** | View only (`ledger.view` permitted) | N/A — denied entirely | CRITICAL FINANCIAL | Explicit product-owner requirement: highest administrative role is not an unrestricted financial authority |
| FINANCE_PREPARER | `ledger.post`, `ledger.reverse` (once governed) | Initiate | Yes | **No — cannot approve own work** | No | Yes (new, not yet implemented) | CRITICAL FINANCIAL | Maker role, matches existing `FINANCE_PREPARER` eligibility shape (`makerEligible: true`) |
| FINANCE_PREPARER | fee/commission/limit/product rule changes (pending Part A §5 borderline resolution) | Initiate (proposed) | Yes, if adopted | No | No | Recommended | SENSITIVE | Extends the existing maker role to commercial-rule changes, which today have no approval step at all |
| FINANCE_CONTROLLER | `ledger.approve_adjustment` (once governed) | Approve | No | Yes | No | Yes (new) | CRITICAL FINANCIAL | Checker role, matches existing shape (`checkerEligible: true`, `approvalCapability: true`) |
| FINANCE_CONTROLLER | `workforce.role.assign/revoke` (approval) | Approve | No | Yes | No | Yes (existing) | PRIVILEGED | Already implemented, unchanged |
| FINANCE_AUDITOR | all `.view` functions across every domain | View | No | No | Yes | No | READ | Matches declared intent exactly |
| FINANCE_AUDITOR | **anything else** | **None** | **No** | **No** | N/A | N/A | N/A | Per Part 9 below, this is the one row where declared intent and actual enforcement currently disagree |
| OPERATIONS | `agent.*` (activate/suspend/terminate/reactivate/fund/defund/credentials/outlets), `aggregator.*`, `support.manage_tickets`, `support.provision_workforce_user` | Administer | Yes (operational) | No | No | No (none currently implemented; could be added for high-risk subset per the prior report's Part G Option C) | OPERATIONAL / some SENSITIVE | Matches today's actual implemented reach, scoped away from finance/compliance/customer-lifecycle domains |
| COMPLIANCE | `kyc.*`, `compliance.manage_case`, `compliance.manage_risk_profile` | Administer | Yes | No | No | No currently; recommended candidate for future approval step on `compliance.restrict_account`-type actions if built | OPERATIONAL / SENSITIVE | Matches the generic `/customers/:id` KYC/compliance sub-resources |
| CUSTOMER_SERVICE | `customer.view`, `customer.view_transactions`, `customer.manage_support_case` | View / limited administer | Yes (ticket actions only) | No | Mostly | No | READ / OPERATIONAL | Matches proposed boundary: servicing and support, no financial mutation, no lifecycle authority (lifecycle suspend/activate stays with SUPER_ADMIN/Operations per current `PATCH /customers/:id` principal-type gate, which already excludes SUPPORT) |

---

## 8. Maker/checker requirements (Part E / Part 9 of deliverable)

Already-implemented (unchanged, reused from prior reports): `FINANCE_ROLE_ASSIGN`,
`FINANCE_ROLE_REVOKE` (FINANCE_ADMIN/SUPER_ADMIN initiates, FINANCE_CONTROLLER approves);
`FINANCE_CONTROL_POLICY_ACTIVATE` (FINANCE_PREPARER initiates, FINANCE_CONTROLLER approves).

**Proposed, not implemented:** a new governed-action pair, `LEDGER_JOURNAL_POST` and
`LEDGER_JOURNAL_REVERSAL`, with `FINANCE_PREPARER` as the sole initiating role and
`FINANCE_CONTROLLER` as the sole approving role, `minimumApprovals: 1`,
`selfApprovalProhibited: true` — mirroring the exact shape of the two rules that already work.
**This report does not create this rule.** It is listed because Part J requires naming which
future functions would govern ledger posting/reversal/approval, and the honest answer is "none
exist yet; here is the shape that would need to be added, following the pattern already proven
to work for role administration."

**Candidate for future consideration, not recommended one way or the other here:** maker/checker
for commercial-rule changes (fee/commission/limit/product), per the still-open "borderline"
decision from the prior report.

---

## 9. FINANCE_AUDITOR defect (Part I) — inventory, carried forward and reverified

Re-confirmed this session, unchanged: `workforce-session.service.ts:152`'s
`roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' : 'OPERATOR'` means a FINANCE_AUDITOR-only
identity has principal type `OPERATOR`, identical to FINANCE_PREPARER/FINANCE_CONTROLLER. Every
route whose `allowedPrincipalTypes` includes `OPERATOR` and has no `requiredScopes` is reachable
by FINANCE_AUDITOR today, by code, regardless of its declared `finance:audit`-only scope. The
full inventory (reused from `V1-ADMIN-SECURITY-AND-PORTAL-DECISION-02` Part D, re-verified this
session against unchanged code):

- Agent suspend/terminate/reactivate/activate (`admin-agent-lifecycle.controller.ts`)
- Customer lifecycle PATCH (`/customers/:id`)
- Customer wallet creation (`POST /customers/:id/wallets`)
- KYC assessment recording (`POST /customers/:id/kyc-assessment`)
- SUPPORT workforce-user provisioning (`/internal/admin/support/workforce-users`)
- Agent/customer credential issuance (`/internal/admin/agents/:id/credentials`,
  `/internal/admin/customers/:id/credentials`)
- Agent fund/defund (`/internal/agents/:id/fund|defund`)
- Fee/commission/reward/product/limit registry writes

**How the proposed future permission-driven architecture should prevent this (design-level
answer, not implemented):** the fix is not "give FINANCE_AUDITOR a different principal type
string" — it is to **stop deriving authorization from a two-value coarse principal type at all**,
and instead gate each of the routes above on a specific `requiredScopes` entry (e.g.
`agent.suspend`, `kyc.review`, `workforce.user.provision`) that only roles whose function list
actually includes that function would carry. Under the proposed model, FINANCE_AUDITOR's role
definition would simply never include any function key beyond the `.view`/`.audit` family, and
since the enforcement point (`requiredScopes.every(...)`) already exists and works correctly
wherever it is used today, **no new authorization mechanism needs to be invented — the existing
one needs to be applied to routes that currently skip it in favor of the coarser principal-type
check.** This is a meaningful, scoped engineering task (not attempted here), not an architecture
redesign.

---

## 10. Ledger auditability findings (Part J) — reverified against the repository this session

All three carried-forward findings were independently re-checked against the live repository
this session (commands and exact empty/present results shown in the working notes above) and
**confirmed unchanged**:

1. `src/ledger/ledger-journal.entity.ts` has no `actor`/`createdBy`/`postedBy` column.
2. `src/ledger/ledger.controller.ts` never declares `@Req()` or reads `authorizationPrincipal` —
   the calling principal's identity is not threaded into journal creation at all.
3. No `LEDGER_JOURNAL_POST`/`REVERSAL`/`APPROVE` governed action exists in
   `A2_MAKER_CHECKER_RULES_JSON` or its production template — confirmed absent by direct grep
   this session.

**Which future functions/permissions would govern this (design-level, not implemented):**

| Function | Who | Governance |
|---|---|---|
| `ledger.post` | `FINANCE_PREPARER` (maker) | New governed action `LEDGER_JOURNAL_POST`; requires actor-identity capture added to the journal-creation path first, or the audit trail for this action remains incomplete regardless of authorization correctness |
| `ledger.reverse` | `FINANCE_PREPARER` (maker) | New governed action `LEDGER_JOURNAL_REVERSAL`, same prerequisite |
| `ledger.approve_adjustment` | `FINANCE_CONTROLLER` (checker) | Approval step for both of the above, reusing the existing `PrivilegedActionApprovalService` mechanism exactly as `FINANCE_CONTROL_POLICY_ACTIVATE` already does |
| `ledger.view` | SUPER_ADMIN, FINANCE_AUDITOR, FINANCE_CONTROLLER, FINANCE_PREPARER (all read) | No governance needed beyond the existing `internal:access` reachability fix (already twice-documented as a separate, non-role engineering defect) |

This table does not authorize or sequence these changes ahead of the product-owner decisions
flagged in the prior report (Part A §5 of `V1-ADMIN-SECURITY-AND-PORTAL-DECISION-02`) — it is
provided because Part J of this task explicitly asks which functions would govern these actions.

---

## 11. Permission governance model (Part G)

**Core principle, stated explicitly per instruction:** *configurable role assignment does not
mean configurable security bypass.* A future "create a role, pick its functions" admin tool must
not be able to produce a role that holds `ledger.post` and `ledger.approve_adjustment`
simultaneously, or a role that can `workforce.role.create` and then assign itself every critical
function.

Proposed governance rules, by function class (design only):

| Function class | Who may assign this function to a role | Assignment requires approval? | Dual control required? | Can be assigned to a newly created role? | Additional restrictions |
|---|---|---|---|---|---|
| READ | SUPER_ADMIN (role administrator) | No | No | Yes, freely | None |
| OPERATIONAL | SUPER_ADMIN | No | No | Yes | None beyond normal review |
| SENSITIVE | SUPER_ADMIN | **Recommended: yes** (a second approver confirms the grant) | Recommended | Yes, but flagged for review | Should be logged distinctly in the audit trail as a "sensitive function granted" event |
| PRIVILEGED (e.g. `workforce.role.assign`) | SUPER_ADMIN, but **never to itself** | **Yes — mandatory**, by a second administrator-eligible principal | **Yes — mandatory** | Only to a role class pre-approved for administrative capability | Mirrors the existing, already-coded bootstrap-admin self-assignment prohibition exactly |
| CRITICAL FINANCIAL (`ledger.post`, `ledger.reverse`, `ledger.approve_adjustment`) | **Not SUPER_ADMIN alone — this class of function should require a structural rule, not merely an administrator's discretion, preventing it from ever being assigned to a non-Finance-class role, and preventing the same role from holding both the initiating and approving function for the same action** | **Yes — mandatory, by a role distinct from the grantee's own role class** | **Yes — mandatory** | **No — must be hard-restricted to the Finance role class (Preparer/Controller split preserved) regardless of what a future dynamic-role tool otherwise allows** | This is the one class where the report recommends the restriction be enforced **structurally** (e.g. a schema-level invariant analogous to today's `administrativeCapability` reservation), not merely as an administrative policy an operator is trusted to follow |

**The key structural recommendation (design-level, not implemented):** today's
`workforce-configuration.ts` already demonstrates the right pattern — `administrativeCapability`
is schema-reserved to a specific role key, and the schema throws at startup if that invariant is
violated. A future permission-driven system should keep an equivalent **non-bypassable,
schema-or-code-enforced** invariant for the CRITICAL FINANCIAL function class (e.g. "no role may
hold both `ledger.post` and `ledger.approve_adjustment`"; "no function marked
`criticalFinancial: true` may be assigned to a role that is not in the pre-approved Finance role
class"), so that the flexibility of "administrators can create and edit roles" never becomes a
path to "an administrator can grant itself unrestricted financial authority."

---

## 12. SUPER_ADMIN boundary (Part H)

### A. Administrative functions it can perform directly
Workforce role assignment/revocation (initiate only, mirroring today's `FINANCE_ADMIN`); customer
lifecycle administration (suspend/activate/close); agent lifecycle administration
(activate/suspend/terminate/reactivate); aggregator administration; support ticket and
workforce-user administration; KYC assessment recording; commercial-rule registry administration
(fee/commission/reward/limit/product) — pending the Part A §5 borderline decision on whether this
belongs here or under a Finance-initiated maker/checker flow instead.

### B. Functions it can govern but not execute
Financial maker/checker actions (`ledger.post`, `ledger.reverse`) — SUPER_ADMIN may define *who*
holds the Finance roles that can perform these (via role assignment), and may view the outcome,
but must never be the initiator or approver itself. This mirrors the proposal's explicit
instruction: "should not automatically receive unrestricted financial execution... should not
bypass maker/checker... should not directly manipulate the ledger simply because it is the
highest administrative role."

### C. Functions it can view
Everything: customer/agent/aggregator records, wallet balances, transaction history, ledger
entries/accounts, KYC/compliance records, reconciliation reports, the full audit trail —
**including audit records of its own actions**.

### D. Functions that must remain outside its direct authority
`ledger.post`, `ledger.reverse`, `ledger.approve_adjustment`; approval of any Finance maker
action; any future direct "wallet debit/credit" primitive (none exists today, and none should be
added for this role); self-assignment of a new role or scope to itself; creation of a second
SUPER_ADMIN (mirroring today's structural "cannot assign another administrator" bootstrap rule).

---

## 13–15. FINANCE, OPERATIONS, COMPLIANCE, TREASURY, CUSTOMER_SERVICE boundaries

Already specified in full in §4 (role selection), §5 (function catalogue), and §7 (role→function
matrix) above; repeated here only as a direct cross-reference per the deliverable's required
section list:

- **FINANCE** (Preparer/Controller/Auditor split): maker/checker preserved exactly as already
  coded for role-administration and control-policy actions; extended, conceptually, to ledger
  posting/reversal; Auditor is read-only by declared intent, not yet by enforcement (§9).
- **OPERATIONS**: agent/aggregator/support administrative functions; no financial mutation; no
  maker/checker currently implemented or required for V1 scope.
- **COMPLIANCE**: KYC/compliance-case/risk-profile functions; no financial mutation; no
  maker/checker currently implemented or required for V1 scope.
- **TREASURY**: no V1 role — no backend capability exists distinct from Ledger/Reconciliation,
  which Finance/Auditor roles already cover; defer role creation until a Treasury-specific
  backend platform (B3) exists with actual functions to assign.
- **CUSTOMER_SERVICE**: ticket handling and narrow, read-oriented customer investigation; must
  not directly create unauthorized financial value — matches the fact that no financial mutation
  primitive is reachable from any support/customer-service-shaped route today in the first place.

---

## 16. Dynamic/extensible RBAC architecture assessment (Part F)

### What must be stored as data (not yet, today)
1. A **function/permission catalogue** table: code, name, description, domain, sensitivity class
   (READ/OPERATIONAL/SENSITIVE/PRIVILEGED/CRITICAL FINANCIAL), whether maker/checker-governed,
   whether it may be freely assigned or requires governance approval to grant. **Does not exist
   today** — the closest precedent in shape (not purpose) is the unrelated `capabilities` table
   (§2.8).
2. A **roles** table: role code, display name, description, enabled flag, set of assigned
   function codes (a join table, `role_functions`), MFA/approval-eligibility flags analogous to
   today's `makerEligible`/`checkerEligible`/`approvalCapability`/`administrativeCapability`.
   **Does not exist today** — roles are an environment-variable JSON blob, not database rows.
3. **User↔role assignment** — **already exists and is already close to the right shape**:
   `a2_finance_role_assignments` (principalId, roleKey, effective window, assignedBy/At,
   revokedBy/At, approvalIds, auditReferences). The main change needed is validating `roleKey`
   against the new database-backed roles table instead of the environment-variable JSON, which
   does not require a destructive migration since `role_key` already has no `CHECK` constraint or
   foreign key today (§2.8).

### What is currently hardcoded (must change for true dynamism)
1. `workforce-session.service.ts:152` — principal-type derivation hardcoded to the literal
   `'FINANCE_ADMIN'` string. **This is the single most important code change a future dynamic
   model requires** — principal type (or an equivalent coarse bucket used for the cheapest early
   route-matching) would need to be derived from whether a role carries a specific function/flag
   (e.g. `administrativeCapability` or a dedicated "produces elevated principal type" marker),
   not from matching a specific role name.
2. `workforce-configuration.ts`'s exact 4-role vocabulary bound and the
   `administrativeCapability`-reserved-for-`'FINANCE_ADMIN'` schema rule — both would need to
   become data-driven invariants (e.g. "at most one role may carry `administrativeCapability:
   true`" as a general rule, not naming a specific role key) rather than code constants.
3. `finance-role-administration.service.ts`'s literal `'FINANCE_ADMIN'` checks — would need to
   become "the role(s) flagged `administrativeCapability: true`" lookups against the new roles
   table, not string literals.
4. Individual admin controllers that check `principal.type` directly
   (`admin-agent-lifecycle.controller.ts` and similar) rather than consulting
   `policy.requiredScopes` — these would need to be updated to check function-specific scopes for
   a function-level model to actually constrain them; today they would ignore a new, finer-grained
   `requiredScopes` declaration even if route-policy-registry.ts were updated to supply one,
   because they do their own separate, simpler type check instead of trusting the resolved policy.
5. `route-policy-registry.ts`'s per-route `allowedPrincipalTypes` arrays — these are currently the
   *primary* gate for most routes; a function-driven model would need most of them converted to
   (or supplemented by) `requiredScopes` entries referencing the new function catalogue.

### What should eventually become configurable
Role existence, role display metadata, role→function assignment, and (within the governance
boundaries of Part 11) which functions a given role carries — exactly the product owner's stated
target workflow (Administration → Roles & Permissions → Create Role → Select functions → Save →
Assign to workforce user; Edit Role → Add/remove functions → Save → audit change).

### What security rules must remain hardcoded/non-bypassable
Per Part 11: the self-approval prohibition mechanism; the maker/checker enforcement logic itself
(which roles are eligible is data, but *that* a CRITICAL FINANCIAL action requires two distinct
principals is not something role configuration should be able to turn off); the restriction that
no single role may hold both the initiating and approving function for the same CRITICAL
FINANCIAL action; the restriction that a role cannot be used to assign itself a new role or scope
(the existing bootstrap-admin self-assignment prohibition, generalized); audit-event emission on
every authorization decision and every role/function mutation (already coded as a blanket
mechanism via `AuthorizationService.recordDecision()`, should remain unconditional regardless of
which roles/functions exist).

### Overall assessment
**The current architecture can support the target model, but not for free.** The database layer
is already closer to ready than the application layer: `a2_finance_role_assignments`'s schema
does not need a destructive migration, and the scope-checking mechanism (`requiredScopes.every`)
already works. The real work is (a) building the two missing catalogue tables (functions, roles)
and their join, (b) migrating the ~5-6 hardcoded `'FINANCE_ADMIN'` string dependencies to
data-driven flag lookups, and (c) auditing and updating the individual controllers that currently
bypass `policy.requiredScopes` in favor of their own simpler `principal.type` checks. This is a
bounded, describable engineering program, not a full-system rewrite — but it is also not "just
add rows to a table," because of the hardcoded dependencies in §2.7.

---

## 17. Admin Web implications (Part K) — design only, not implemented

The V1 Admin Web remains one combined portal (unchanged conclusion from the prior report,
reconfirmed against the roadmap). Its future navigation and in-screen action availability should
be organized conceptually by functional area (Administration, Finance, Operations, Compliance,
Treasury [if ever populated], Customer Service) for human wayfinding, but **visibility and action
availability should be driven by the workforce user's actual function set, not by which
department label a screen carries** — e.g. a user holding `customer.view` but not
`customer.suspend` should eventually see the customer list and detail view but not a suspend
button, regardless of which "department" that screen is filed under. **Backend authorization
remains authoritative regardless of what the UI shows** — a hidden button is a usability
property, not a security control; the enforcement must happen at the API layer exactly as it
already is supposed to (and, per Part 9, currently is not, for FINANCE_AUDITOR). None of this is
implemented in this task; Admin Web is unchanged.

---

## 18. "INITIAL V1 CONFIGURATION" (Part L)

> **This configuration is intended to be configurable and extensible; it is not a permanent
> hardcoded organizational model.**

### 1. Initial V1 roles
`SUPER_ADMIN` (conceptual — rename-of or addition-to today's `FINANCE_ADMIN`, per the still-open
decision in the prior report), `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`,
`OPERATIONS`, `COMPLIANCE`, `CUSTOMER_SERVICE`. No Treasury role at V1 (§3).

### 2. Initial V1 function catalogue
The full set enumerated in §5, restricted to **(exists)**-marked functions for anything actually
assignable at V1; **(future)**-marked functions are explicitly deferred, not created as inert
placeholders.

### 3. Role → function assignments
As tabulated in §7.

### 4. Critical functions
`ledger.post`, `ledger.reverse`, `ledger.approve_adjustment` — reserved exclusively to the
Finance role class, never assignable to SUPER_ADMIN/Operations/Compliance/Customer Service under
any future role-editing tool (§11, §12 item D).

### 5. Functions requiring maker/checker
Already implemented: `workforce.role.assign`/`revoke`, `fee_rule`... — correction: only
`FINANCE_CONTROL_POLICY_ACTIVATE`'s underlying action is currently governed among commercial-rule
functions; fee/commission/limit/product writes are **not yet** governed (§5, §8) and are flagged
as sensitive-not-yet-governed, not silently assumed to already have a rule. Proposed for the
future, not implemented: `ledger.post`, `ledger.reverse`, `ledger.approve_adjustment`.

### 6. Functions reserved from direct SUPER_ADMIN execution
All CRITICAL FINANCIAL functions (item 4) plus approval of any Finance maker action.

### 7. Auditor-only functions
None are *exclusive* to FINANCE_AUDITOR (view functions are shared with other roles per §7), but
FINANCE_AUDITOR should hold **no function outside the `.view`/`.audit` family at all** — this is
the one role whose entire catalogue membership should be a strict subset of every other role's
read functions, with zero overlap into any mutation function.

### 8. Functions that can be freely reassigned later
All READ and OPERATIONAL-classified functions (§6) — e.g. `customer.view`, `agent.view`,
`reconciliation.view`, `agent.activate/suspend`, `compliance.manage_case` — may be reassigned
across roles by a future role-editing administrator without additional governance beyond normal
change review.

### 9. Functions requiring privileged governance
SENSITIVE-classified functions (commercial-rule writes, agent funding) are candidates for
mandatory second-approval-on-grant (not on every use, but on the act of assigning the function to
a role) per §11's governance table; PRIVILEGED functions (`workforce.role.*`) require the
stronger, already-partially-coded dual-control pattern.

### 10. Deferred functions
Everything marked **(future)** in §5: `customer.terminate` as a distinct status,
`compliance.restrict_account`/`release_restriction`, `agent.manage_permissions`,
`transaction.search`, `transaction.request/approve/reject_reversal` as a distinct
transaction-level (as opposed to ledger-level) concept, `fee_rule.activate` as a distinct
lifecycle step, `reconciliation.investigate`/`resolve` as distinct workflow actions,
`audit.export`, `workforce.role.create/modify` (the dynamic role-editing capability itself — this
entire report is designing its guardrails, not building it), and any Treasury-specific function
whatsoever.

---

## 19. Recommended implementation sequence (Part M) — not started

1. **Permission/function catalogue foundation** — build the `functions` table and seed it with
   the **(exists)**-marked functions from §5 only (not the future ones), each carrying its
   sensitivity classification from §6 as data.
2. **Role model** — build the `roles` table and `role_functions` join; migrate the four existing
   FINANCE_* role definitions out of `A2_FINANCE_ROLES_JSON` and into these tables as the first
   data-driven roles, preserving their exact current scopes/flags.
3. **Role-to-function assignments** — populate `role_functions` per §7's matrix for the three new
   roles (Operations, Compliance, Customer Service) and the reconceptualized administrative role,
   once the product owner has resolved the "rename vs. coexist" decision from the prior report.
4. **Workforce assignment** — reuse `a2_finance_role_assignments` as-is, validating `roleKey`
   against the new `roles` table instead of (or in addition to, during transition) the
   environment-variable JSON.
5. **Privileged permission governance** — implement the non-bypassable invariants from §11
   (no role may hold both initiating and approving functions for the same critical action; no
   self-assignment of administrative functions) as schema-or-service-level guarantees, not mere
   policy.
6. **FINANCE_AUDITOR remediation** — the narrowly-scoped fix identified as uncontested in the
   prior report: ensure FINANCE_AUDITOR's role-function set contains no mutation function, and
   that the routes it currently reaches by accident (§9's inventory) are converted to check
   function-specific `requiredScopes` rather than coarse principal type.
7. **Financial maker/checker for ledger** — add the `LEDGER_JOURNAL_POST`/`REVERSAL`/`APPROVE`
   governed actions (§8, §10), sequenced together with item 8 below so reachability and
   governance arrive together.
8. **Ledger actor/audit model** — add actor-identity capture to `ledger.controller.ts` and
   `LedgerJournal`/emit `AuditService` events for posting/reversal, **before** or **simultaneously
   with** fixing the pre-existing `internal:access` reachability gap (already twice-documented),
   so ledger never becomes reachable-but-unauditable in an intermediate state.
9. **Admin Web role/function administration** — build the "Administration → Roles & Permissions
   → Create/Edit Role" screens described in Part K, once items 1–3 exist to administer.
10. **Remaining capability exposure** — the already-identified missing Admin Web screens (Agents,
    Aggregators, Support, commercial-rule registries, Audit log) from the prior report, built
    against the new function-driven visibility model from Part K rather than the current
    department-name-only gating.

None of these ten steps were started in this task.

---

## 20. Product-owner decisions still required

Carried forward from the prior report, restated because this task's design depends on them:
1. Does SUPER_ADMIN **replace** `FINANCE_ADMIN` or **coexist** alongside it?
2. Should fee/limit/product configuration changes be SENSITIVE-but-freely-assignable, or
   maker/checker-governed like ledger postings?
3. Is the four-role schema cap relaxed, or is a role key repurposed, to accommodate the new
   Operations/Compliance/Customer Service roles?

**New, from this task's analysis:**
4. Should `PATCH /customers/:id`'s single lifecycle endpoint be split into distinct
   `customer.suspend`/`.activate`/`.close` functions at the authorization layer even though the
   backend route itself remains unified, or should the function catalogue track it as one
   function (simpler, but coarser-grained than the product owner's own example implied)?
5. Should `kyc-assessment`'s single endpoint be split into `kyc.review`/`.approve`/`.reject`
   functions similarly, given the backend does not currently model three distinct actions?
6. Confirm whether a Treasury role should truly wait for backend capability (this report's
   recommendation) or whether the product owner wants an empty placeholder role reserved now for
   organizational-chart reasons independent of what it can currently do.

---

**End of report. No code, database, migration, role, permission, authorization, or Admin Web
change was made in the course of producing this document.**
