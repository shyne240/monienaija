# V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01

**Classification: DOCUMENTATION/DESIGN ONLY. NO CODE, DATABASE, MIGRATION, ROLE, PERMISSION,
AUTHORIZATION, ADMIN WEB, OR API CHANGE WAS MADE.** This is the definitive product/security
specification for the MonieNaija V1 starting role and function model, for Product Owner review
and approval prior to implementation. It builds directly on, and does not silently replace, the
repository-grounded findings of `docs/V1/V1-ADMIN-ROLE-AND-FUNCTION-MODEL-01-REPORT.md`
(commit `f74ca9d81770c032b5f7c6b1e58910362d3d9976`). Every place this document records a new
Product Owner decision (the ten-role set itself, and its consequences) is explicitly labeled
**[PRODUCT OWNER DECISION]**; every place it states a repository fact, that fact is carried
forward from the baseline audit or independently reverified this session, and is labeled
**[REPOSITORY FACT]** where it matters to distinguish from design proposal.

**Repository discipline (performed before any file was read or written for this task):**
`git fetch origin` found the true remote tip of `arena/01a10374-monienaija` at
`f74ca9d81770c032b5f7c6b1e58910362d3d9976`. The local checkout had again reverted to the
branch's original start-of-session commit, `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` — the
7th occurrence of this recurring sandbox state-loss pattern, with hundreds of files (nearly
the entire `src/`, `docs/`, `test/`, and app trees) showing as modified/deleted/untracked
relative to true tip. `git reset --hard origin/arena/01a10374-monienaija` restored the correct
state. Verified after reset: branch = `arena/01a10374-monienaija`, local HEAD =
`f74ca9d81770c032b5f7c6b1e58910362d3d9976` = remote tip, working tree clean, and both
`f74ca9d` and the baseline report file confirmed present before any analysis began.

---

## 1. Purpose

This document is the implementation team's definitive specification for "what the V1 starting
authorization model is supposed to be." It supersedes the *proposals* in
`V1-ADMIN-ROLE-AND-FUNCTION-MODEL-01-REPORT.md` with the Product Owner's actual decision — **ten**
named V1 roles, listed below — while preserving every repository-grounded fact that report
established (hardcoded dependencies, DB schema shape, scope-check mechanism, the FINANCE_AUDITOR
defect, the ledger auditability gaps). It is documentation/design only: **nothing in this
specification is implemented by this task.** It exists so an implementation team has one
authoritative source to build against, rather than reconstructing intent from four separate prior
audit reports.

---

## 2. Architectural principles

These principles govern every design decision in this document and must survive into
implementation unchanged:

1. **Functions are the authorization unit; roles are bundles of functions.** A role has no
   inherent authority — it is a named, assignable collection of functions. Authorization
   decisions should ultimately be made by checking "does this principal hold function X," not
   "does this principal hold role Y." (**Already the direction of travel in the repository** —
   see §3's reuse of `requiredScopes.every(scope => principal.scopes.includes(scope))`.)
2. **The ten V1 roles are an initial, non-permanent configuration, not a fixed system model.**
   See the mandatory statement in §27.
3. **Configurable authorization must never become a configurable security bypass.** Certain
   functions (ledger posting, ledger reversal, financial approval, privileged access
   administration, security-critical configuration) must carry governance rules that are
   properties of the *function*, not of whichever role happens to hold it — so no future
   role-editing tool can hand a newly created role unrestricted financial or administrative
   authority merely by including that function in its list. Elaborated fully in §19.
4. **Broad administrative visibility is not the same as financial execution authority.**
   SUPER_ADMIN may see and govern almost everything; it may not post, reverse, or approve
   financial transactions, and it may not approve its own privileged actions.
5. **Maker and checker must always be different principals for every governed action**, and this
   rule must be enforced structurally, not left to administrative discretion.
6. **Every sensitive or privileged action must be reconstructible after the fact**: who did it,
   under which role, what function was invoked, what changed, who approved it, and why — this is
   a design requirement for every new function this specification introduces, not only the ones
   already enforced today.
7. **Nothing is invented that the repository does not support.** Every function in this
   specification is checked against actual code; anything not implemented is explicitly labeled
   FUTURE, BACKEND ONLY, or OUT OF V1 SCOPE — never silently assumed.
8. **The Admin Web remains one combined portal.** Functional-area organization is a navigational
   convenience; actual visibility and action availability must ultimately be function-driven, not
   department-hardcoded, and backend authorization is always authoritative regardless of what the
   UI displays.

---

## 3. Current authorization architecture (carried forward, repository fact)

**[REPOSITORY FACT, unchanged from the baseline report, reverified this session]** Today's
mechanism: `RuntimeAccessGuard` resolves every request via `RoutePolicyRegistry.resolve()` to an
`AuthorizationPolicy` (`allowedPrincipalTypes`, optional `requiredScopes`); `AuthorizationService`
checks principal-type membership and, where `requiredScopes` is populated,
`requiredScopes.every(scope => principal.scopes.includes(scope))`. Exactly four roles exist today
(`FINANCE_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`), defined only in an
environment-variable JSON blob (`A2_FINANCE_ROLES_JSON`), never persisted as database rows. No
`roles` or `functions`/`permissions` table exists anywhere. `a2_finance_role_assignments.role_key`
is a plain unconstrained `varchar`, not an enum or FK — the four-role limit is enforced purely in
application-layer Zod validation (`workforce-configuration.ts`), not in the database schema. The
scope-checking mechanism itself is generic and already works correctly; it is simply applied to
almost none of the ~30 route branches in `route-policy-registry.ts` today (most use the coarser
`allowedPrincipalTypes` check instead). Full detail: baseline report §2.

---

## 4. Current hardcoded role assumptions (carried forward, repository fact)

**[REPOSITORY FACT]** Six concrete hardcoded dependencies were identified and must be scheduled
for remediation before any dynamic role-creation capability is built (baseline report §2.7,
reverified unchanged):

1. `workforce-session.service.ts:152` — `roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' :
   'OPERATOR'` — principal-type derivation hardcoded to the literal role name.
2. `workforce-configuration.ts` — `administrativeCapability` schema-reserved exclusively to the
   literal `'FINANCE_ADMIN'` role key.
3. `workforce-configuration.ts` — exact `.min(4).max(4)` role-count bound; the vocabulary must be
   precisely the four existing role keys, no more, no fewer.
4. `finance-role-administration.service.ts` — multiple literal `'FINANCE_ADMIN'` string
   comparisons governing assignment eligibility and bootstrap grants.
5. `route-policy-registry.ts` — hardcodes **principal types** into route conditions; flexible only
   insofar as any role mapping to the same principal type is automatically covered, but principal
   type itself is derived via dependency #1.
6. Several admin controllers (e.g. `admin-agent-lifecycle.controller.ts`) check
   `principal.type` directly inside the controller method rather than consulting
   `policy.requiredScopes` — these would need code changes too, independent of route-policy
   changes, for a function-level model to actually constrain them.

**These six items, not the database schema, are the real obstacle to "create a new role without a
source-code change."** This specification's ten roles are introduced as *configuration intent*;
items 1–6 above remain true hardcoded dependencies today and are unaffected by this document
unless and until the implementation sequence in §26 addresses them.

---

## 5. The ten initial V1 roles — Product Owner decision

**[PRODUCT OWNER DECISION — supersedes the baseline report's seven-role proposal]**

> MonieNaija V1 will begin with these ten roles: `SUPER_ADMIN`, `FINANCE_PREPARER`,
> `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`,
> `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY`.

This decision explicitly overrides the baseline report's earlier recommendation (which had
proposed folding Agent-network management into OPERATIONS, Risk/Fraud into COMPLIANCE, and
omitting TREASURY entirely at V1 pending backend capability). The Product Owner has determined
that these are each distinct **organizational** roles regardless of how much V1 backend capability
currently exists behind each one — i.e. the role taxonomy reflects intended organizational
structure, not solely "how many buttons exist today." This specification honors that decision
while being explicit, per role, about exactly how much real V1 capability stands behind each name
today, so the implementation team is never misled into thinking a role has more built
functionality than it does.

Four of the ten (`FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, and the role
underlying `SUPER_ADMIN`) already exist in the repository in some form; six are new organizational
roles with no current database or configuration representation (`OPERATIONS`,
`AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY`). None of the
ten are created by this task.

---

## 6. Role definitions (Part B)

### 6.1 SUPER_ADMIN

| Field | Value |
|---|---|
| Purpose | Highest administrative/governance authority: provisions workforce roles, oversees the platform, has the broadest read visibility |
| Business responsibility | Workforce administration, overall platform oversight, cross-functional visibility, system configuration governance |
| Authority boundary | Administrative and governance — **not** financial-execution |
| May do | Assign/revoke workforce roles (as maker, with FINANCE_CONTROLLER-equivalent checker, per today's already-implemented pattern); administer customer/agent/aggregator lifecycle; administer KYC/compliance assignment of work; view everything, including the full audit trail; govern (not execute) financial maker/checker processes by deciding who holds the Finance roles |
| May NOT do | Post or reverse a ledger journal; approve a financial maker/checker action; approve its own privileged action; create a second SUPER_ADMIN-equivalent role assignment for itself; bypass any maker/checker gate; directly create monetary value |
| Sensitivity level | PRIVILEGED (broad administrative reach); explicitly excluded from CRITICAL FINANCIAL |
| Can initiate? | Yes — administrative/role-assignment actions only |
| Can approve? | Yes — for non-financial, non-self privileged actions it did not initiate (e.g. another administrator's role assignment, subject to governance in §19) |
| Primarily read-only? | No — broad administrative mutation, but zero financial mutation |
| Initial V1 status | Conceptual role; whether it **replaces or coexists with** today's `FINANCE_ADMIN` key is an **unresolved Product Owner decision**, carried forward — see §28 item 1 |

### 6.2 FINANCE_PREPARER

| Field | Value |
|---|---|
| Purpose | Initiates (makes) governed financial and financial-adjacent operations |
| Business responsibility | Prepares ledger postings/reversals and commercial-rule changes for independent review |
| Authority boundary | Maker only — never checker for its own work |
| May do | Initiate ledger journal postings/reversals (once governed — see §9); initiate fee/commission/reward/limit/product rule changes (pending the still-open commercial-rule governance decision, §28 item 2) |
| May NOT do | Approve any action it initiated; approve any other preparer's action while also holding controller eligibility for the same action type; assign/revoke workforce roles; administer non-finance domains |
| Sensitivity level | Handles CRITICAL FINANCIAL functions as maker |
| Can initiate? | Yes |
| Can approve? | No |
| Primarily read-only? | No |
| Initial V1 status | **[REPOSITORY FACT]** Role already exists in `A2_FINANCE_ROLES_JSON` with `makerEligible: true`; retained unchanged |

### 6.3 FINANCE_CONTROLLER

| Field | Value |
|---|---|
| Purpose | Independently reviews, approves, or rejects governed financial operations |
| Business responsibility | Checker for Finance Preparer-initiated actions and for workforce role assignment/revocation |
| Authority boundary | Checker only — must be a different principal than the maker; does not receive SUPER_ADMIN's administrative breadth |
| May do | Approve/reject ledger postings/reversals (once governed); approve/reject commercial-rule changes (pending §28 item 2); approve/reject workforce role assignment/revocation, exactly as today |
| May NOT do | Initiate the actions it approves; self-approve; administer workforce/customer/agent/compliance domains outside its approval function |
| Sensitivity level | Handles CRITICAL FINANCIAL and PRIVILEGED functions as checker |
| Can initiate? | No |
| Can approve? | Yes |
| Primarily read-only? | No |
| Initial V1 status | **[REPOSITORY FACT]** Already exists with `checkerEligible: true`, `approvalCapability: true`; retained unchanged |

### 6.4 FINANCE_AUDITOR

| Field | Value |
|---|---|
| Purpose | Independent read/audit/inspection authority over all financial activity |
| Business responsibility | Reviews financial records, ledger entries, audit trail, and governed-action history without the ability to alter any of it |
| Authority boundary | Strictly read-only across every domain |
| May do | View customer/agent/ledger/reconciliation/audit/compliance records in full; search/filter the audit trail |
| May NOT do | Initiate or approve any mutation anywhere in the system, in any domain, under any circumstance |
| Sensitivity level | READ only by declared intent |
| Can initiate? | No |
| Can approve? | No |
| Primarily read-only? | **Yes — exclusively** |
| Initial V1 status | **[REPOSITORY FACT]** Already exists with `scopes: ['finance:audit']`, declared read-only intent — **but see §15, its enforcement does not currently match its declared intent; this is a carried-forward defect, not a new design choice** |

### 6.5 OPERATIONS

| Field | Value |
|---|---|
| Purpose | General operational platform administration not owned by a more specific functional role |
| Business responsibility | Support ticket administration, SUPPORT workforce-user provisioning, aggregator administration, operational observability (outbox/metrics/diagnostics/notification delivery review) |
| Authority boundary | Operational — explicitly excludes financial mutation and excludes agent-network-specific lifecycle actions (owned by `AGENT_NETWORK_MANAGER`, see §6.6) and compliance/risk actions |
| May do | Manage support tickets; provision/suspend SUPPORT workforce-user credentials; administer aggregator records; view outbox/metrics/diagnostics/notification-delivery data |
| May NOT do | Post/reverse ledger entries; approve financial actions; mutate fee/commission/reward/limit/product rules; perform agent lifecycle actions (activate/suspend/terminate — these belong to `AGENT_NETWORK_MANAGER`); perform KYC/compliance/risk actions |
| Sensitivity level | Mostly OPERATIONAL, no SENSITIVE or above |
| Can initiate? | Yes — operational actions only |
| Can approve? | No |
| Primarily read-only? | No, but no financial or compliance mutation |
| Initial V1 status | New organizational role; functions below are drawn from existing, already-implemented controllers (support/aggregator/observability), narrowed now that `AGENT_NETWORK_MANAGER` takes agent-specific lifecycle functions |

### 6.6 AGENT_NETWORK_MANAGER

| Field | Value |
|---|---|
| Purpose | Dedicated authority over the agent network as a first-class V1 participant |
| Business responsibility | Agent visibility, onboarding/activation, lifecycle management, credential issuance, outlet/terminal management, agent-level limit assignment, agent network reporting |
| Authority boundary | Operational authority over agents — financial consequences of agent operations (funding/defunding float, and any future agent-facing settlement) remain subject to Finance governance, not granted automatically because the action touches an agent |
| May do (**[REPOSITORY FACT]** all `(exists)`-marked below are real, already-implemented backend routes) | View agents (`GET /internal/agents`); review/activate agent applications (`agent-application-admin.controller.ts`); activate/suspend/terminate/reactivate agents (`admin-agent-lifecycle.controller.ts` — four distinct existing endpoints); issue/manage agent credentials (`admin-agent-credentials.controller.ts`); manage agent outlets/terminals; assign agent-level limit profiles (`limit-assignment.controller.ts` — `subjectType = 'AGENT'` is a genuinely supported, repository-confirmed value); view agent network reporting via reconciliation/account-activity views |
| May NOT do | Fund or defund agents without Finance governance (see below — flagged SENSITIVE, not granted unconditionally); invent per-agent granular "permissions" (no such mechanism exists — **FUTURE**, not built); approve its own agent-lifecycle action (no maker/checker currently required for agent lifecycle at V1, see §9); mutate ledger, fee, commission, or compliance records |
| Sensitivity level | Mostly OPERATIONAL; agent fund/defund is SENSITIVE and flagged for a governance decision, not resolved here (see §28 item 7) |
| Can initiate? | Yes |
| Can approve? | No (no agent-lifecycle maker/checker step currently implemented or required at V1) |
| Primarily read-only? | No |
| Initial V1 status | New organizational role, but almost entirely backed by already-implemented functions — the strongest "ready for Admin Web surface" case among the six new roles |
| Explicit FUTURE items | Per-agent granular permission management (`agent.manage_permissions`) is **FUTURE** — no such concept exists; agent eligibility today is governed by agent-class/service-capability gates, a separate mechanism from authorization permissions |

### 6.7 COMPLIANCE

| Field | Value |
|---|---|
| Purpose | Regulatory/KYC/AML compliance authority |
| Business responsibility | KYC review and assessment recording, compliance-case management (KYC/AML/SANCTIONS/PEP/DOCUMENT/ACCOUNT_REVIEW/MANUAL_REVIEW categories), customer risk-profile administration |
| Authority boundary | Compliance decision-making; explicitly distinguished from `RISK_FRAUD` below (regulatory/KYC/AML vs. fraud/transaction-risk-detection) even though, per **[REPOSITORY FACT]**, both currently operate on the *same* underlying `compliance-cases` resource (see §6.8 for why) |
| May do | View/record KYC assessments (`POST /customers/:id/kyc-assessment`); create/update/comment/assign/close compliance cases of category KYC, AML, SANCTIONS, PEP, DOCUMENT, ACCOUNT_REVIEW, MANUAL_REVIEW (`customer-compliance.controller.ts`); administer customer risk profiles (`customer-risk-profile.controller.ts`) |
| May NOT do | Mutate financial state directly; approve its own KYC decision as a second, independent reviewer (no such two-step review currently exists in the backend — see §28 item 5); act on cases of category `FRAUD` (reserved to `RISK_FRAUD`, a function-level distinction within the same table — see §6.8) |
| Sensitivity level | OPERATIONAL for case administration; a compliance decision that results in account restriction is SENSITIVE and flagged for a future control (see below) |
| Can initiate? | Yes |
| Can approve? | No (no distinct second-reviewer approval step exists in the backend today — `POST /customers/:id/kyc-assessment` is a single-step action) |
| Primarily read-only? | No |
| Initial V1 status | Backend exists and is reachable today; narrowed from the baseline report's single generic Compliance function set to explicitly exclude `FRAUD`-category cases, which this specification assigns to `RISK_FRAUD` instead |
| Financial-consequence note | If a compliance decision needs to trigger an actual financial restriction/reversal beyond a status flag, that mutation must route through the appropriate Finance-governed function, not a compliance function directly — no backend mechanism currently links compliance decisions to financial mutation automatically, so this separation already holds structurally today, not merely by policy |

### 6.8 RISK_FRAUD

| Field | Value |
|---|---|
| Purpose | Fraud/risk detection, analysis, investigation, and risk-control authority — distinct from regulatory/KYC/AML compliance |
| Business responsibility | Fraud case investigation, transaction-risk analysis, suspicious-activity review, risk-rule/control administration where implemented |
| Authority boundary | Investigative/analytical; explicitly **not** merged into COMPLIANCE, per Product Owner instruction |
| **[REPOSITORY FACT — important, must not be glossed over]** | There is **no separate fraud-detection backend, no transaction-monitoring engine, and no dedicated "fraud case" table or controller anywhere in the repository.** The only fraud-adjacent concept found is `ComplianceCaseCategory.FRAUD` — a case *category* value on the **same** `customer-compliance` entity/table/controller that `COMPLIANCE` also uses. There is no distinct backend resource for Risk/Fraud to call its own today. |
| May do (V1, with the above caveat) | **View** compliance cases filtered to category `FRAUD` (and, pending a product decision, `AML`/`SANCTIONS` where overlap is judged appropriate) via the existing `customer-compliance.controller.ts` read endpoints; **create/update/comment on** cases of category `FRAUD` specifically, reusing the same controller, narrowed by function-level scoping (`risk_fraud.manage_fraud_case` as a distinct *function*, enforced against the same case-category field, not a distinct database resource); view customer risk-profile data (`customer-risk-profile.controller.ts`) read-only, since risk scoring is Compliance-owned today |
| May NOT do | Mutate case categories outside `FRAUD` (that remains COMPLIANCE's function); administer risk-profile scoring directly (that mechanism is currently Compliance-owned, not Risk-owned, in the backend as built); perform any financial mutation; approve its own fraud-case resolution (no two-step review exists) |
| FUTURE items — explicitly not built, do not assume otherwise | A dedicated transaction-risk-scoring/fraud-rule engine; automated suspicious-activity flagging; a standalone fraud-case data model separate from `compliance-cases`; any fraud-triggered automatic transaction hold or reversal mechanism |
| Sensitivity level | OPERATIONAL for case investigation at V1 (given the shared-resource caveat above); would become SENSITIVE/PRIVILEGED once a real automated risk-control or transaction-hold mechanism is built |
| Can initiate? | Yes, narrowly (fraud-category case creation/update only) |
| Can approve? | No |
| Primarily read-only? | Largely yes at V1, given the thin real backend surface described above |
| Initial V1 status | **Organizational role exists per Product Owner decision; V1 functional surface is intentionally thin and explicitly flagged as such** — implementers must not build a separate fraud-case backend to "fill out" this role without a separate, explicit scoping decision; see §28 item 8 |

### 6.9 CUSTOMER_SERVICE

| Field | Value |
|---|---|
| Purpose | Customer servicing: lookup, viewing, ticket handling, dispute intake |
| Business responsibility | Customer account viewing, transaction history viewing, support/dispute ticket handling, customer communication, permitted account servicing |
| Authority boundary | Narrow, largely read-oriented; explicitly excludes financial mutation and lifecycle authority |
| May do | View customers and their wallets (`GET /customers`, `/customers/:id`); view transaction history (`GET /internal/customers/:id/transactions`); manage support tickets tied to a customer (`support-internal.controller.ts`) |
| May NOT do | Suspend/activate/close a customer account (that remains an Administration/Operations function at V1, matching today's `PATCH /customers/:id` principal-type gate which already excludes SUPPORT); create financial value or process a reversal directly to resolve a complaint — any financial correction must route through the Finance maker/checker workflow, not a Customer Service action |
| Sensitivity level | READ / light OPERATIONAL (ticket handling) only |
| Can initiate? | Yes — ticket actions only |
| Can approve? | No |
| Primarily read-only? | Mostly yes |
| Initial V1 status | Backend exists and is reachable today (support ticket + customer investigation reads); narrowest-risk role in the set |

### 6.10 TREASURY

| Field | Value |
|---|---|
| Purpose | Treasury/settlement/liquidity authority |
| Business responsibility | Oversight of float/liquidity position, external settlement/reconciliation with payment partners, suspense-entry resolution |
| Authority boundary | Monitoring/oversight at V1; execution of external settlement/liquidity movement is explicitly out of V1 scope |
| **[REPOSITORY FACT — important, must not be glossed over]** | **No admin-facing controller of any kind exposes Treasury-relevant data.** `src/partner/external-settlement.entity.ts`, `external-settlement.service.ts`, and `external-suspense-entry.entity.ts` exist in the codebase as backend data models for the A6 external-partner domain, but **zero controller anywhere calls `ExternalSettlementService`** — unlike Ledger (which is at least backend-complete-but-unreachable due to the `internal:access` scope gap), Treasury-relevant data has **no API surface whatsoever today**, reachable or not. `reconciliation.controller.ts` (report/trial-balance/finance/account-activity) is the closest adjacent, genuinely reachable-once-fixed capability, but it is a general ledger-reconciliation view, not a Treasury-specific one. |
| CURRENT V1 TREASURY FUNCTIONS | `treasury.view_reconciliation_report` — read-only, via the existing (currently unreachable due to the `internal:access` gap) `reconciliation.controller.ts` endpoints; nothing else exists today |
| FUTURE TREASURY FUNCTIONS (explicitly not built; do not infer implementation) | External settlement administration; suspense-entry resolution; liquidity/float position monitoring and reporting; bank/NIBSS integration oversight; any external payout/settlement execution — all out of V1 scope per the repository's own architecture decisions (ADR-0047/0048/0050, external-partner domain explicitly isolated) |
| May do (V1) | View reconciliation reports (once the `internal:access` reachability gap is fixed — a prerequisite shared with every other read-only internal function, not Treasury-specific) |
| May NOT do | Execute, administer, or approve anything — there is nothing to execute yet |
| Sensitivity level | READ only, and only once the shared reachability gap is fixed |
| Can initiate? | No |
| Can approve? | No |
| Primarily read-only? | Yes — **entirely** |
| Initial V1 status | **Organizational role exists per Product Owner decision, with almost no V1 functional surface.** The role is seeded now so a future administrator can grant it functions as external settlement/treasury capability is built, without having to invent a new role at that time. **Implementers must not build Treasury-specific functionality now merely because the role exists** — this directly matches the Product Owner's own framing of TREASURY in the task instructions. |

---

## 7. Function/permission catalogue (Part K)

Every function below is checked against the actual repository and classified using the required
five-way status: **IMPLEMENTED** (reachable and usable today, mutation gaps aside),
**PARTIALLY IMPLEMENTED** (the action exists in code but is missing a necessary complementary
control, e.g. a maker/checker step or actor capture, while still being reachable),
**BACKEND ONLY** (code exists — service/entity/route — but is not reachable by any principal
today, whether due to the `internal:access` scope gap or because literally no controller exposes
it), **FUTURE** (no implementation exists and would need to be built), **OUT OF V1 SCOPE**
(explicitly excluded by existing architecture decisions, not merely unbuilt).

### CUSTOMER domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `customer.view` | View customer | Customer | Read customer record/profile | READ | IMPLEMENTED | Any | No | No | Yes | Yes | None |
| `customer.create` | Create customer | Customer | `POST /customers` | OPERATIONAL | IMPLEMENTED | SUPER_ADMIN, OPERATIONS, CUSTOMER_SERVICE (view-adjacent) | No | No | Yes | Yes | None |
| `customer.lifecycle_transition` | Suspend/activate/close customer | Customer | `PATCH /customers/:id` — single generic endpoint today, not three separate backend actions | OPERATIONAL | PARTIALLY IMPLEMENTED (one route models three intents; may be split at the authorization layer — §28 item 4) | SUPER_ADMIN, OPERATIONS | No | No | Yes | Yes | Currently excludes SUPPORT-type principals at the route level |
| `customer.view_transactions` | View customer transaction history | Customer | `GET /internal/customers/:id/transactions` | READ | IMPLEMENTED | Any read-eligible role | No | No | Yes | Yes | None |
| `customer.view_wallets` / `customer.create_wallet` | View/create customer wallet | Customer | `customer-wallet.controller.ts` | READ / OPERATIONAL | IMPLEMENTED | SUPER_ADMIN, OPERATIONS, CUSTOMER_SERVICE (view only) | No | No | Yes | Yes | None |
| `customer.manage_support_case` | Manage a customer's support ticket | Customer | `support-internal.controller.ts` | OPERATIONAL | IMPLEMENTED | CUSTOMER_SERVICE, OPERATIONS | No | No | Yes | Yes | None |
| `customer.terminate` (distinct from lifecycle_transition) | Terminate customer account | Customer | No distinct status/endpoint beyond `customer.lifecycle_transition` | — | FUTURE | — | TBD | TBD | — | — | Only relevant if the Product Owner wants a status finer-grained than exists today |

### AGENT domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `agent.view` | View agent | Agent | `GET /internal/agents` | READ | IMPLEMENTED | Any | No | No | Yes | Yes | None |
| `agent.review_application` / `agent.create` | Review/activate agent application | Agent | `agent-application-admin.controller.ts` | OPERATIONAL | IMPLEMENTED | AGENT_NETWORK_MANAGER, SUPER_ADMIN | No | No | Yes | Yes | None |
| `agent.activate` / `agent.suspend` / `agent.terminate` / `agent.reactivate` | Agent lifecycle transitions | Agent | `admin-agent-lifecycle.controller.ts` — four distinct existing endpoints | OPERATIONAL | IMPLEMENTED | AGENT_NETWORK_MANAGER, SUPER_ADMIN | No (none implemented or currently required) | No | Yes | Yes | None at V1; candidate for future approval on `terminate` specifically if risk warrants |
| `agent.manage_credentials` | Issue/manage agent credentials | Agent | `admin-agent-credentials.controller.ts` | SENSITIVE | IMPLEMENTED | AGENT_NETWORK_MANAGER, SUPER_ADMIN | No | No | Yes | Yes | Credential issuance is a security-adjacent action; flagged SENSITIVE despite no current approval gate |
| `agent.manage_outlets_terminals` | Manage agent outlets/terminals | Agent | Outlet/terminal routes under `/internal/agents/.../outlets|terminals` | OPERATIONAL | IMPLEMENTED | AGENT_NETWORK_MANAGER | No | No | Yes | Yes | None |
| `agent.assign_limit` | Assign an agent-level limit profile | Agent | `limit-assignment.controller.ts`, `subjectType = 'AGENT'` — confirmed repository value | OPERATIONAL | IMPLEMENTED | AGENT_NETWORK_MANAGER | No | No | Yes | Yes | None at V1; shared mechanism with customer limit assignment |
| `agent.fund` / `agent.defund` | Fund/defund an agent's float | Agent | `agent-funding.controller.ts` (direct and aggregator-sub-agent variants) | **SENSITIVE** (real financial movement) | IMPLEMENTED, no approval gate today | AGENT_NETWORK_MANAGER and/or FINANCE_PREPARER — **unresolved**, see §28 item 7 | **Recommended, not implemented** | Recommended | Yes | **Debatable — flagged, not resolved** | This is the sharpest AGENT_NETWORK_MANAGER/FINANCE boundary question in this specification |
| `agent.manage_permissions` | Per-agent granular permission management | Agent | No such concept exists; agent eligibility is governed by agent-class/service-capability gates, a different mechanism | — | FUTURE | — | — | — | — | — | Do not confuse with authorization-permission assignment |

### AGGREGATOR domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `aggregator.view` / `aggregator.manage` | View/administer aggregator | Aggregator | `admin-aggregator.controller.ts`, `aggregator.controller.ts` | OPERATIONAL | IMPLEMENTED (foundation only — aggregator login/self-service deliberately out of V1 scope, a separate pre-existing decision) | OPERATIONS, SUPER_ADMIN | No | No | Yes | Yes | None |

### TRANSACTION domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `transaction.view` | View a transfer/deposit/withdrawal | Transaction | `GET /transfers/:id`, `/deposits/:id`, `/withdrawals/:id` | READ | **BACKEND ONLY** — falls to the `internal:access` catch-all, which no role currently holds | OPERATIONS, FINANCE_AUDITOR (once reachability is fixed) | No | No | Yes | Yes | Reachability fix is a prerequisite, not Treasury/Finance-specific |
| `transaction.search` | Search/filter transactions | Transaction | No distinct search endpoint beyond per-id lookups | — | FUTURE | — | — | — | — | — | — |
| `transaction.reversal.request` / `.approve` | Request/approve a transaction-level reversal | Transaction | No transaction-level reversal mechanism exists; the only reversal mechanism operates at the **ledger journal** level | — | FUTURE (at the transaction level) | — | **Mandatory once built** | Mandatory | — | No | Would route through `ledger.reverse`/`ledger.approve_adjustment` in practice — see LEDGER domain |

### LEDGER domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `ledger.view` | View ledger accounts/journals | Ledger | `GET /ledger/accounts`, `/ledger/journals/:id` | READ | **BACKEND ONLY** — same `internal:access` gap | FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR, SUPER_ADMIN, TREASURY | No | No | Yes | Yes | None |
| `ledger.post` | Post a ledger journal | Ledger | `POST /ledger/journals` | **CRITICAL FINANCIAL** | **BACKEND ONLY, and PARTIALLY IMPLEMENTED even once reachable** — reachability blocked, **and** no maker/checker rule exists, **and** no actor-identity capture exists (see §15) | FINANCE_PREPARER only | **Mandatory, non-negotiable, not yet implemented** | Mandatory | Yes | **No — never** | The single most important non-bypassable rule in this specification; see §19 |
| `ledger.reverse` | Reverse a ledger journal | Ledger | `POST /ledger/journals/:id/reversal` | **CRITICAL FINANCIAL** | Same as `ledger.post` | FINANCE_PREPARER only | **Mandatory, not yet implemented** | Mandatory | Yes | **No — never** | Same as above |
| `ledger.approve_adjustment` | Approve a posted/reversed journal | Ledger | No governed action exists in `A2_MAKER_CHECKER_RULES_JSON` today for either action | **CRITICAL FINANCIAL** | FUTURE — nothing to approve until `ledger.post`/`.reverse` become governed actions | FINANCE_CONTROLLER only | Mandatory | Mandatory | Yes | **No — never** | Must be created together with `ledger.post`/`.reverse` governance |

### FINANCE (commercial rule registries) domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `fee_rule.view` / `.create` / `.modify` | Fee rule registry | Finance | `fee-rule-registry.controller.ts` | SENSITIVE | IMPLEMENTED, single-step, no approval gate | FINANCE_PREPARER (and/or SUPER_ADMIN — unresolved, §28 item 2) | Recommended, not implemented | Recommended | Yes | Debatable, unresolved | — |
| `commission_rule.view` / `.create` / `.modify` | Commission rule registry | Finance | `commission-rule-registry.controller.ts` | SENSITIVE | Same as above | Same as above | Same | Same | Yes | Debatable, unresolved | — |
| `reward_rule.view` / `.create` / `.modify` | Reward rule registry | Finance | `reward-rule-registry.controller.ts` — schema foundation only, no runtime reward crediting exists per code comments | SENSITIVE | IMPLEMENTED (schema only) | Same as above | Recommended | Recommended | Yes | Debatable | — |
| `limit.view` / `.modify` (non-agent-specific) | Limit catalogue/assignment | Finance | `limit-catalog.controller.ts`, `limit-assignment.controller.ts`, `limit-operations.controller.ts` | SENSITIVE | IMPLEMENTED | FINANCE_PREPARER, AGENT_NETWORK_MANAGER (agent-subject only, see AGENT domain) | No | No | Yes | Yes | — |
| `product.view` / `.modify` / `.governance` | Product catalogue/governance | Finance | `product-catalog.controller.ts`, `product-governance.controller.ts` | SENSITIVE | IMPLEMENTED | FINANCE_PREPARER, SUPER_ADMIN (unresolved, §28 item 2) | No | No | Yes | Yes | — |
| `finance.control_policy.activate` | Activate a finance control policy | Finance | Already-governed action in `A2_MAKER_CHECKER_RULES_JSON` | PRIVILEGED | **IMPLEMENTED** — the one commercial-rule-adjacent action with real maker/checker today | FINANCE_PREPARER (maker), FINANCE_CONTROLLER (checker) | **Yes — already implemented** | Yes | Yes | No | Working precedent for `ledger.post`/`.reverse`'s future governance |

### WORKFORCE domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `workforce.role.view` | View role assignments | Workforce | Implicit via `finance-role-administration.service.ts`'s `view()`; no dedicated list-all endpoint confirmed | READ | PARTIALLY IMPLEMENTED | SUPER_ADMIN, FINANCE_AUDITOR | No | No | Yes | Yes | — |
| `workforce.role.assign` / `.revoke` | Assign/revoke a workforce role | Workforce | `POST`/`DELETE /internal/a2/workforce/roles*` | PRIVILEGED | **IMPLEMENTED with real maker/checker today** | SUPER_ADMIN (maker) | **Yes — already implemented** | Yes | Yes | Yes (maker side only — approval is FINANCE_CONTROLLER's) | Cannot self-approve; cannot assign a second administrator to itself |
| `workforce.role.create` / `.modify` | Create a new role or edit an existing role's function set | Workforce | No code path exists; roles are env-var JSON today | PRIVILEGED / governance-of-governance | **FUTURE — this is precisely the capability this specification designs the guardrails for; explicitly NOT implemented by this task** | — | Should require independent approval even for the administrative role itself | Yes | Yes | Not denied outright, but must never allow self-escalation | See §19 |
| `workforce.user.view` / `.create` / `.suspend` | Workforce user (SUPPORT) provisioning | Workforce | `admin-support-credentials.controller.ts` | OPERATIONAL | IMPLEMENTED (SUPPORT-specific only) | OPERATIONS, SUPER_ADMIN | No | No | Yes | Yes | No general "workforce user" concept beyond OIDC identity + role assignment for FINANCE_* |

### COMPLIANCE / RISK domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `kyc.view` | View KYC record | Compliance | `GET /customers/:id/kyc` | READ | IMPLEMENTED | COMPLIANCE, SUPER_ADMIN, FINANCE_AUDITOR | No | No | Yes | Yes | — |
| `kyc.review` (single action, covers review/approve/reject) | Record a KYC assessment decision | Compliance | `POST /customers/:id/kyc-assessment` — one endpoint, not three distinct backend actions | OPERATIONAL | PARTIALLY IMPLEMENTED (one route models three intents; see §28 item 5) | COMPLIANCE | No (no second-reviewer step exists) | No | Yes | Yes | — |
| `compliance.manage_case` (categories: KYC/AML/SANCTIONS/PEP/DOCUMENT/ACCOUNT_REVIEW/MANUAL_REVIEW) | Manage a compliance case | Compliance | `customer-compliance.controller.ts` | OPERATIONAL | IMPLEMENTED | COMPLIANCE | No | No | Yes | Yes | Excludes `FRAUD` category, reserved to RISK_FRAUD |
| `risk_fraud.manage_fraud_case` (category: FRAUD only) | Manage a fraud-category compliance case | Risk/Fraud | Same `customer-compliance.controller.ts`/entity, function-scoped to `category = FRAUD` | OPERATIONAL | **PARTIALLY IMPLEMENTED — shares a database resource with `compliance.manage_case`, no dedicated fraud backend exists** | RISK_FRAUD | No | No | Yes | Yes | **New function this specification introduces at the authorization layer; does not require a schema change, only a scope distinction by case category** |
| `compliance.manage_risk_profile` | Administer customer risk profile | Compliance | `customer-risk-profile.controller.ts` | OPERATIONAL | IMPLEMENTED | COMPLIANCE | No | No | Yes | Yes | RISK_FRAUD has view-only access to this today, per §6.8 |
| `compliance.restrict_account` / `.release_restriction` | Apply/release an account restriction distinct from lifecycle status | Compliance | No distinct mechanism beyond `customer.lifecycle_transition` or risk-profile status | — | FUTURE | — | Recommended once built | Recommended | — | — | — |

### AUDIT domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `audit.view` | View audit log | Audit | `GET /internal/audit` | READ | IMPLEMENTED (no dedicated Admin Web UI) | FINANCE_AUDITOR, SUPER_ADMIN | No | No | Yes (self-referential) | Yes | — |
| `audit.search` | Search/filter audit log | Audit | `AuditService.list()` — filters by entityType/entityId/correlationId | READ | IMPLEMENTED (narrow) | Same | No | No | Yes | Yes | — |
| `audit.export` | Export audit log | Audit | No export endpoint/format exists | — | FUTURE | — | — | — | — | — | — |

### RECONCILIATION / TREASURY domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `reconciliation.view` | View reconciliation report/trial-balance | Reconciliation/Treasury | `GET /internal/reconciliation/report`, `/trial-balance`, `/finance`, `/accounts/:id/activity` | READ | **BACKEND ONLY** — same `internal:access` gap | FINANCE_AUDITOR, TREASURY, SUPER_ADMIN | No | No | Yes | Yes | This is TREASURY's only current V1 function |
| `reconciliation.investigate` / `.resolve` | Open/resolve a reconciliation break | Reconciliation | No distinct workflow/entity beyond viewing the report | — | FUTURE | — | Recommended once built (resolution may require `ledger.post`/`.reverse`) | — | — | — | — |
| `treasury.manage_settlement` | Administer external settlement | Treasury | `external-settlement.entity/service.ts` exist; **zero controller exposes them** | — | **BACKEND ONLY (no API surface exists at all, not even unreachable)** | — | — | — | — | — | OUT OF V1 SCOPE per ADR-0047/0048/0050 |
| `treasury.resolve_suspense` | Resolve a suspense entry | Treasury | `external-suspense-entry.entity.ts` exists; no controller | — | **BACKEND ONLY (no API surface)** | — | — | — | — | — | OUT OF V1 SCOPE |

### OPERATIONS (observability) domain

| Code | Name | Domain | Description | Sensitivity | V1 Status | Assignable to roles? | Maker/checker? | Approval required? | Auditor visibility? | SUPER_ADMIN direct execution? | Governance notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `outbox.view` | View outbox | Operations | `GET /internal/outbox` | READ | IMPLEMENTED (no UI) | OPERATIONS, SUPER_ADMIN | No | No | Yes | Yes | — |
| `metrics.view` | View metrics | Operations | `GET /internal/metrics` | READ | IMPLEMENTED (no UI) | Same | No | No | Yes | Yes | — |
| `diagnostics.view` | View diagnostics | Operations | `GET /internal/diagnostics` | READ | IMPLEMENTED (no UI) | Same | No | No | Yes | Yes | — |
| `notification.view_deliveries` | View notification deliveries | Operations | `GET /internal/notifications/deliveries` | READ | IMPLEMENTED (no UI) | Same | No | No | Yes | Yes | — |

---

## 8. Sensitivity classifications (Part D, summary)

| Class | Definition | Representative functions |
|---|---|---|
| READ | No mutation capability | `*.view`, `audit.search` |
| OPERATIONAL | Ordinary business mutation, no outsized financial or security consequence | `customer.create`, agent lifecycle transitions, `compliance.manage_case`, `kyc.review` |
| SENSITIVE | Real financial or security-adjacent consequence, not yet a critical ledger-level action | `agent.fund/defund`, `fee_rule`/`commission_rule`/`product` writes, `agent.manage_credentials` |
| PRIVILEGED | Governs the authorization/administration system itself | `workforce.role.assign/revoke`, `workforce.role.create/modify` |
| CRITICAL FINANCIAL | Directly creates, moves, or reverses recorded monetary value in the ledger | `ledger.post`, `ledger.reverse`, `ledger.approve_adjustment` |

This classification is applied consistently in §7's catalogue and governs §19's governance rules.

---

## 9. Initial role → function matrix (Part L)

Per instruction, roles are never used as a substitute for permission identifiers — this matrix
shows which **functions** each role bundles, with `ALLOW` / `DENY` / `CONDITIONAL` / `FUTURE` per
cell. "A role is a bundle of functions; a function is the actual authorization unit."

| Function | SUPER_ADMIN | FINANCE_PREPARER | FINANCE_CONTROLLER | FINANCE_AUDITOR | OPERATIONS | AGENT_NETWORK_MANAGER | COMPLIANCE | RISK_FRAUD | CUSTOMER_SERVICE | TREASURY |
|---|---|---|---|---|---|---|---|---|---|---|
| `customer.view` | ALLOW | DENY | DENY | ALLOW (read) | ALLOW | DENY | ALLOW | CONDITIONAL (fraud-linked only) | ALLOW | DENY |
| `customer.create` | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY | DENY |
| `customer.lifecycle_transition` | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY | DENY |
| `customer.view_transactions` | ALLOW | DENY | DENY | ALLOW | ALLOW | DENY | CONDITIONAL (case-linked) | CONDITIONAL (fraud-case-linked) | ALLOW | DENY |
| `customer.manage_support_case` | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | ALLOW | DENY |
| `agent.view` | ALLOW | DENY | DENY | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY |
| `agent.activate/suspend/terminate/reactivate` | ALLOW | DENY | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY |
| `agent.manage_credentials` | ALLOW | DENY | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY |
| `agent.manage_outlets_terminals` | ALLOW | DENY | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY |
| `agent.assign_limit` | ALLOW | DENY | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY |
| `agent.fund/defund` | DENY (SENSITIVE, unresolved governance) | CONDITIONAL — pending §28 item 7 | CONDITIONAL — pending §28 item 7 | DENY | DENY | CONDITIONAL — pending §28 item 7 | DENY | DENY | DENY | DENY |
| `aggregator.view/manage` | ALLOW | DENY | DENY | ALLOW (view) | ALLOW | CONDITIONAL (agent-linked aggregators) | DENY | DENY | DENY | DENY |
| `transaction.view` | ALLOW (once reachable) | DENY | DENY | ALLOW (once reachable) | ALLOW (once reachable) | DENY | DENY | CONDITIONAL (fraud-case-linked) | DENY | DENY |
| `ledger.view` | ALLOW (once reachable) | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | ALLOW (once reachable) |
| `ledger.post` | **DENY — always** | ALLOW (maker only) | DENY (checker, not maker) | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `ledger.reverse` | **DENY — always** | ALLOW (maker only) | DENY (checker, not maker) | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `ledger.approve_adjustment` | **DENY — always** | DENY (maker, not checker) | ALLOW (checker only) | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `fee_rule`/`commission_rule`/`product` writes | CONDITIONAL — pending §28 item 2 | CONDITIONAL — pending §28 item 2 | DENY (approval role only if governed) | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `finance.control_policy.activate` | DENY (maker) | ALLOW (maker) | ALLOW (checker) | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `workforce.role.view` | ALLOW | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY |
| `workforce.role.assign/revoke` | ALLOW (maker) | DENY | ALLOW (checker only) | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `workforce.role.create/modify` | FUTURE (governed per §19, not SUPER_ADMIN-unilateral) | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE |
| `workforce.user.view/create/suspend` (SUPPORT) | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY | DENY |
| `kyc.view` | ALLOW | DENY | DENY | ALLOW | DENY | DENY | ALLOW | CONDITIONAL (fraud-linked) | DENY | DENY |
| `kyc.review` | ALLOW | DENY | DENY | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY |
| `compliance.manage_case` (non-FRAUD) | ALLOW | DENY | DENY | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY |
| `risk_fraud.manage_fraud_case` (FRAUD category) | DENY | DENY | DENY | DENY | DENY | DENY | DENY | ALLOW | DENY | DENY |
| `compliance.manage_risk_profile` | ALLOW | DENY | DENY | DENY | DENY | DENY | ALLOW | DENY (view only) | DENY | DENY |
| `audit.view/search` | ALLOW | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY |
| `outbox/metrics/diagnostics/notification.view` | ALLOW | DENY | DENY | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY |
| `reconciliation.view` | ALLOW (once reachable) | DENY | DENY | ALLOW (once reachable) | DENY | DENY | DENY | DENY | DENY | ALLOW (once reachable) |
| `treasury.manage_settlement` / `.resolve_suspense` | FUTURE / OUT OF V1 SCOPE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE | FUTURE |

---

## 10. Maker/checker requirements (Part M)

| Function | Maker | Checker | Can same person do both? | Required audit data |
|---|---|---|---|---|
| `workforce.role.assign` / `.revoke` | SUPER_ADMIN | FINANCE_CONTROLLER | **No — already structurally enforced** | Actor, target principal, role key, effective window, approval id, correlation id — all already captured today |
| `finance.control_policy.activate` | FINANCE_PREPARER | FINANCE_CONTROLLER | **No — already structurally enforced** | Same shape as above, already captured today |
| `ledger.post` (proposed, not implemented) | FINANCE_PREPARER | FINANCE_CONTROLLER | **No — must be enforced before this function is reachable in production** | Actor identity, role, journal id, debit/credit lines, before/after account balances, approval id, correlation id, request id — **currently NOT captured at all** (§11) |
| `ledger.reverse` (proposed, not implemented) | FINANCE_PREPARER | FINANCE_CONTROLLER | **No** | Same as above, plus original journal reference |
| `fee_rule`/`commission_rule`/`product` writes (candidate, unresolved — §28 item 2) | FINANCE_PREPARER (if adopted) | FINANCE_CONTROLLER (if adopted) | **No, if adopted** | Actor, role, rule id, before/after rule definition, effective date, approval id |
| `workforce.role.create` / `.modify` (future dynamic role editing) | An administrator-eligible principal | A **second, distinct** administrator-eligible principal — never the same person, and never self-approved even for the highest administrative role | **No — must never be possible, including for SUPER_ADMIN acting alone** | Actor, role definition before/after (full function list diff), reason, approval id |
| Agent lifecycle transitions (`activate`/`suspend`/`terminate`/`reactivate`) | AGENT_NETWORK_MANAGER | — | N/A — no maker/checker required at V1 (not a financial or security-critical class) | Actor, agent id, before/after status, timestamp |
| `agent.fund` / `.defund` | Pending §28 item 7 | Pending §28 item 7 | **Pending** — recommended "no" if adopted as a governed action, given its real financial consequence | Actor, role, agent id, amount, before/after balance, approval id if governed |

**The system must prevent a maker from approving their own operation wherever independent
approval is required** — already true for the two implemented rules, and a hard requirement for
every new governed action this specification proposes. None of the proposed-but-not-implemented
rows above are implemented by this task.

---

## 11. SUPER_ADMIN boundary (Part C/H, four categories)

### A. Can execute directly
Workforce role assignment/revocation (maker side only); customer lifecycle administration; agent
lifecycle administration (if not delegated solely to AGENT_NETWORK_MANAGER — both may hold it);
aggregator administration; SUPPORT workforce-user provisioning; KYC/compliance case assignment of
work; commercial-rule registry administration — pending §28 item 2.

### B. Can govern but not execute
Financial maker/checker actions (`ledger.post`, `ledger.reverse`, `ledger.approve_adjustment`) —
may decide who holds the Finance roles able to perform these, may view every outcome, but is never
the initiator or approver itself.

### C. Can view only
Everything: customer/agent/aggregator records, wallet balances, transaction history, ledger
entries/accounts, KYC/compliance/risk records, reconciliation reports, the full audit trail —
including audit records of its own actions.

### D. Must remain outside its direct authority entirely
`ledger.post`, `ledger.reverse`, `ledger.approve_adjustment`; approval of any Finance maker action;
any future wallet-debit/credit primitive; self-assignment of a new role or scope to itself;
creation of a second SUPER_ADMIN-equivalent assignment; self-approval of `workforce.role.create`
or `.modify` even once that capability exists.

---

## 12. FINANCE boundaries

Three roles, matching the already-implemented shape: **FINANCE_PREPARER** (maker only, never
checker for its own work), **FINANCE_CONTROLLER** (checker only, never maker, does not receive
SUPER_ADMIN's administrative breadth), **FINANCE_AUDITOR** (read-only by declared intent — see
§15 for the carried-forward enforcement defect). Full detail: §6.2–6.4, §7 LEDGER/FINANCE domains.

## 13. OPERATIONS boundary

General operational administration (support, SUPPORT workforce-user provisioning, aggregator
administration, observability views), explicitly excluding agent-specific lifecycle functions
(owned by AGENT_NETWORK_MANAGER) and all financial mutation. Full detail: §6.5.

## 14. AGENT_NETWORK_MANAGER boundary

Dedicated agent-network authority: visibility, onboarding, lifecycle, credentials, outlets/
terminals, agent-level limit assignment. Agent funding/defunding is flagged SENSITIVE and its
exact ownership (AGENT_NETWORK_MANAGER vs. FINANCE_PREPARER vs. shared) is an open Product Owner
decision (§28 item 7) — it is **not** granted to AGENT_NETWORK_MANAGER unconditionally by this
specification, per the explicit instruction that financial consequence is not automatically
inherited by whichever role touches the surrounding operation. Full detail: §6.6.

## 15. COMPLIANCE boundary

KYC review/assessment, non-FRAUD compliance-case management, customer risk-profile
administration. No unrestricted financial mutation authority; no two-step independent review
exists for KYC decisions today (flagged, §28 item 5). Full detail: §6.7.

## 16. RISK_FRAUD boundary

Fraud-category case investigation only, sharing the same backend resource as COMPLIANCE but
function-scoped by case category; genuinely distinct fraud/risk backend capability is FUTURE.
Full detail: §6.8.

## 17. CUSTOMER_SERVICE boundary

Customer lookup, transaction-history viewing, support-ticket handling. No lifecycle authority, no
financial mutation — any financial correction must route through Finance governance, never a
direct Customer Service action. Full detail: §6.9.

## 18. TREASURY boundary

Read-only reconciliation-report visibility once the shared `internal:access` reachability gap is
fixed; no execution capability exists or is proposed at V1; external settlement/suspense
resolution is explicitly OUT OF V1 SCOPE. Full detail: §6.10.

---

## 19. Permission governance (Part P)

Functions are classified into four governance tiers. **The core principle, stated explicitly per
instruction: configurable role assignment must never become a mechanism for bypassing mandatory
security controls.** A future role-editing tool must not be able to create a role and assign it
`ledger.post` and `ledger.approve_adjustment` simultaneously, nor allow any principal to assign
itself a critical function.

1. **Ordinary configurable permissions** (READ, most OPERATIONAL) — any future administrator may
   freely assign these to any role, new or existing, without special governance beyond normal
   change review. Examples: `customer.view`, `agent.view`, `compliance.manage_case`.
2. **Sensitive configurable permissions** (SENSITIVE class) — assignable, but the *act of
   assigning* the function to a role should itself require a second approval, and the grant should
   be distinctly logged. Examples: `agent.fund/defund`, `fee_rule.create/modify`.
3. **Critical permissions with mandatory governance** (PRIVILEGED, CRITICAL FINANCIAL) — must
   carry a **non-bypassable structural rule**, not merely administrative policy: (a) no role may
   simultaneously hold both the initiating and approving function for the same governed action;
   (b) assignment of a CRITICAL FINANCIAL function must be restricted to the pre-approved Finance
   role class regardless of what a role-editing tool otherwise permits; (c) `workforce.role.create`
   /`.modify` itself requires independent, non-self approval even when the actor is the
   administrative role.
4. **Non-bypassable security controls** — not permissions at all, but system invariants that no
   role configuration may ever disable: the maker ≠ checker rule; the prohibition on self-approval;
   the prohibition on a role assigning itself new critical functions; unconditional audit-event
   emission on every authorization decision and every role/function mutation.

**Structural recommendation (design-level, not implemented):** today's `administrativeCapability`
schema-reservation pattern in `workforce-configuration.ts` (§4 item 2) is proof the codebase
already knows how to enforce "this capability belongs to exactly one role, and the schema itself
throws if that invariant is violated." A future permission-governance implementation should keep
an equivalent non-bypassable invariant for CRITICAL FINANCIAL functions, generalized away from
hardcoding a specific role *name* and instead keyed to a role-class flag (e.g. "Finance role
class"), so the mechanism survives role renaming/addition.

---

## 20. Dynamic role architecture (Part O)

Target model (unchanged from the baseline report, restated here as the authoritative version):

```
FUNCTION CATALOGUE
        ↓
       ROLE
        ↓
WORKFORCE USER
```

The ten V1 roles are **seeded/configured** starting roles, not an immutable list. Future
administrators should be able to create roles such as `FRAUD_INVESTIGATOR`,
`SETTLEMENT_OFFICER`, `AGENT_ONBOARDING_OFFICER`, `KYC_ANALYST`, `RISK_MANAGER` — **without
source-code changes** — provided (a) the functions such a role would need already exist in the
catalogue, and (b) governance rules (§19) permit their assignment. For example, `KYC_ANALYST`
could be created today, conceptually, by assigning it `kyc.view` and `kyc.review` out of the
existing catalogue — a pure role-creation exercise. `FRAUD_INVESTIGATOR`, by contrast, would be
constrained by the same thin V1 backend surface RISK_FRAUD itself has (§6.8) until a genuinely new
fraud-detection capability is built — **that** would be a new authorization capability requiring
actual backend work, distinct from merely creating a new role.

**This distinction — "new role using existing functions" vs. "new capability requiring new
backend work" — must be preserved in any future admin tooling**, so administrators are not misled
into thinking role creation alone can produce functionality the backend doesn't have.

What must change for this to work without source edits (carried forward from the baseline
report's Part F, unchanged): build `functions` and `roles`/`role_functions` tables (none exist
today); migrate the six hardcoded `'FINANCE_ADMIN'`-literal dependencies (§4) to data-driven flag
lookups; update controllers that check `principal.type` directly to consult `policy.requiredScopes`
instead; reuse `a2_finance_role_assignments` largely as-is (its schema already permits this, per
§3). None of this is implemented by this task.

---

## 21. Admin Web implications (Part Q)

The V1 Admin Web remains **one combined portal** — this specification does not propose, and
explicitly rejects, separate web applications per functional area. Future navigation may be
organized conceptually into Administration / Finance / Operations / Agent Network / Compliance /
Risk & Fraud / Customer Service / Treasury sections for human wayfinding, but **actual visibility
and action availability should be determined by the functions a workforce user's role(s) actually
hold, not by which department a screen is filed under** — e.g. a user holding `customer.view` but
not `customer.lifecycle_transition` should eventually see the customer list/detail but not a
suspend action, regardless of screen placement. **Backend authorization remains authoritative
regardless of what the UI displays** — hiding a button is a usability property, not a security
control. None of this is implemented in this task; Admin Web is unchanged.

---

## 22. Audit requirements (Part N)

For every SENSITIVE, PRIVILEGED, and CRITICAL FINANCIAL function, the following must be captured
at the time of action (design requirement for implementation, not implemented here):

- Actor identity (principal id)
- Actor role (the specific role under which the action was authorized — **not currently captured
  anywhere**; today's `audit_events.actor` stores only a principal-id string, never a role,
  per the Task 16 finding carried forward unchanged)
- Function/permission used (the specific function code invoked, once the catalogue exists)
- Action performed
- Target entity/id
- Before state / after state
- Timestamp
- Request ID
- Correlation ID
- Transaction ID (where applicable)
- Maker (for governed actions)
- Checker (for governed actions)
- Approval or rejection outcome and reason
- Source/channel (Admin Web, API, etc.)

**[REPOSITORY FACT, carried forward from commit `31796c5` and reverified unchanged this session]**
The ledger journal entity and controller currently capture **none** of this for `ledger.post` or
`ledger.reverse`:
1. `src/ledger/ledger-journal.entity.ts` has no `actor`/`createdBy`/`postedBy` column.
2. `src/ledger/ledger.controller.ts` never declares `@Req()` or reads the calling principal —
   confirmed again this session by direct grep returning zero matches.
3. No `LEDGER_JOURNAL_POST`/`REVERSAL`/`APPROVE` governed action exists in
   `A2_MAKER_CHECKER_RULES_JSON` — confirmed again this session by direct grep returning zero
   matches.

**This remains an implementation requirement for the later authorization/ledger-hardening phase,
not an action taken in this task.** The `AuditService`/`AuthorizationService.recordDecision()`
mechanisms already exist and work for every other audited action in the system; they must be
extended to the ledger path, and to carry the specific role (not just principal id) once the role
model in this specification is implemented.

---

## 23. V1 vs. future classification (Part R)

| Item | Classification |
|---|---|
| SUPER_ADMIN, FINANCE_PREPARER/CONTROLLER/AUDITOR roles | V1 — IMPLEMENT NOW (role model/config work) |
| OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, CUSTOMER_SERVICE roles | V1 — IMPLEMENT NOW (role model/config work; backend functions largely already exist) |
| RISK_FRAUD role | V1 — IMPLEMENT NOW as an organizational role, but its functional surface is V1 SECURITY/SCOPE REMEDIATION-adjacent — needs only a function-level scoping change (case-category restriction) against the existing compliance-cases backend, not new backend work |
| TREASURY role | V1 — IMPLEMENT NOW as an organizational role with almost no functions; its only function (`reconciliation.view`) is V1 — BACKEND EXISTS, ADMIN SURFACE REQUIRED, blocked on the shared reachability fix |
| Ledger/Reconciliation reachability (`internal:access` scope gap) | V1 SECURITY REMEDIATION — already twice-documented, affects FINANCE_AUDITOR, TREASURY, FINANCE_PREPARER/CONTROLLER's `ledger.view` |
| FINANCE_AUDITOR mutation-surface defect | V1 SECURITY REMEDIATION |
| Ledger actor-identity/audit capture | V1 SECURITY REMEDIATION |
| `ledger.post`/`.reverse`/`.approve_adjustment` maker/checker | V1 — IMPLEMENT NOW (recommended; not yet built) |
| Function/role database catalogue (`functions`, `roles`, `role_functions` tables) | DEFERRED — needed before any dynamic role creation, but V1 can launch on the existing env-var JSON model extended to ten roles if the hardcoded dependencies in §4 are also addressed for the new roles |
| `workforce.role.create`/`.modify` (dynamic role editing) | FUTURE |
| External settlement/suspense administration, external payout execution | OUT OF V1 SCOPE |
| Per-agent granular permissions (`agent.manage_permissions`) | FUTURE |
| Transaction-level reversal (distinct from ledger-level) | FUTURE |
| Dedicated fraud-detection/transaction-monitoring engine | FUTURE — do not pull into V1 merely because RISK_FRAUD exists as a role |
| Audit export | FUTURE |
| Two-step independent KYC review | FUTURE |
| Fee/commission/product maker-checker governance | DEFERRED, pending §28 item 2 |

---

## 24. Known security gaps (carried forward, not fixed by this task)

1. **FINANCE_AUDITOR mutation defect** (§6.4, §4 item 1): a FINANCE_AUDITOR-only identity is
   assigned principal type `OPERATOR` — identical to FINANCE_PREPARER/CONTROLLER — so every route
   gated only by `allowedPrincipalTypes: [..., 'OPERATOR', ...]` without a `requiredScopes` check
   is reachable by FINANCE_AUDITOR today, contradicting its declared read-only scope
   (`finance:audit`). Full inventory carried forward unchanged from `31796c5`: agent lifecycle
   mutation, customer lifecycle PATCH, customer wallet creation, KYC assessment recording, SUPPORT
   workforce-user provisioning, agent/customer credential issuance, agent fund/defund, and all
   fee/commission/reward/product/limit registry writes.
2. **Ledger actor-identity/audit gap** (§22): no actor capture anywhere in the ledger posting
   path.
3. **No maker/checker on ledger posting/reversal**: the single largest financial-mutation
   mechanism in the codebase (there is no wallet-debit/credit primitive; ledger journal
   posting/reversal is the sole mechanism) has zero governance today.
4. **`internal:access` scope is granted to no role**, making Ledger/Transactions/Reconciliation
   permanently unreachable regardless of role model changes, until a role is explicitly granted
   that scope.
5. **Six hardcoded `'FINANCE_ADMIN'`-literal dependencies** (§4) block true dynamic role
   creation; adding the six new organizational roles in this specification does not by itself
   resolve them — they must be addressed in the implementation sequence (§26) for the new roles to
   receive correct principal-type derivation and administrative-capability eligibility, where
   relevant.
6. **RISK_FRAUD and COMPLIANCE share one database resource** (`compliance-cases`) with no
   database-level separation — the distinction this specification draws between them is
   function-level/case-category-level only; if stronger data isolation between Compliance and
   Risk/Fraud is later required, that is a schema change, not merely a role/function change.
7. **TREASURY has literally zero API surface** for its intended future domain (external
   settlement/suspense) — not merely unreachable like Ledger, but entirely unexposed by any
   controller.

---

## 25. Final "INITIAL V1 CONFIGURATION" summary

> **These ten roles constitute the initial V1 organizational configuration. They are not
> immutable system roles. The authorization architecture is intended to support future role
> creation and modification through configurable functions/permissions subject to mandatory
> security governance.**

- **Roles:** SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR, OPERATIONS,
  AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY.
- **Function catalogue:** as enumerated in §7, restricted to IMPLEMENTED/PARTIALLY IMPLEMENTED
  functions for anything actually assignable at V1 launch; BACKEND ONLY functions are assignable
  only once their reachability gap is fixed; FUTURE and OUT OF V1 SCOPE functions are not created.
- **Role → function assignments:** as tabulated in §9.
- **Critical functions:** `ledger.post`, `ledger.reverse`, `ledger.approve_adjustment` — reserved
  exclusively to the Finance role class, never assignable to SUPER_ADMIN or any non-Finance role
  under any future role-editing tool.
- **Maker/checker list:** as tabulated in §10 (two already implemented, several proposed).
- **SUPER_ADMIN-excluded functions:** all CRITICAL FINANCIAL functions, plus approval of any
  Finance maker action, plus self-assignment of new roles/functions to itself.
- **Auditor-only visibility:** FINANCE_AUDITOR should hold no function outside the `.view`/`.audit`
  family — a strict subset of every other role's read functions, with zero mutation overlap.
- **Freely reassignable functions:** all READ and most OPERATIONAL functions.
- **Privileged-governance functions:** SENSITIVE functions require second-approval-on-grant;
  PRIVILEGED/CRITICAL FINANCIAL functions require the stronger dual-control pattern in §19.
- **Deferred functions:** everything marked FUTURE or OUT OF V1 SCOPE in §7/§23.

---

## 26. Recommended implementation sequence

1. **Function/role catalogue foundation** — build `functions` and `roles`/`role_functions` tables;
   seed with the ten roles and the IMPLEMENTED/PARTIALLY IMPLEMENTED functions from §7 only.
2. **Migrate existing four FINANCE_* roles** out of `A2_FINANCE_ROLES_JSON` into the new tables,
   preserving current scopes/flags exactly.
3. **Add the six new roles'** function assignments per §9, once the hardcoded dependencies in §4
   relevant to each are resolved (e.g. AGENT_NETWORK_MANAGER and OPERATIONS do not need principal-
   type changes since neither requires `PRIVILEGED`; SUPER_ADMIN does, per the open §28 item 1
   decision).
4. **Resolve the hardcoded dependencies in §4** — replace literal `'FINANCE_ADMIN'` checks with
   data-driven role-class/flag lookups.
5. **Implement non-bypassable governance invariants** from §19 (maker ≠ checker structurally; no
   CRITICAL FINANCIAL function assignable outside the Finance role class; no self-approval of role
   administration).
6. **Fix the FINANCE_AUDITOR mutation defect** (§24 item 1) by converting the routes in its
   inventory to function-specific `requiredScopes` checks.
7. **Fix the `internal:access` reachability gap** for Ledger/Transactions/Reconciliation,
   simultaneously granting it to the appropriate new roles' function sets (FINANCE_AUDITOR,
   TREASURY, FINANCE_PREPARER/CONTROLLER for `ledger.view`; OPERATIONS for `transaction.view`).
8. **Add ledger actor-identity/audit capture** (§22) before or simultaneously with step 9, so
   ledger never becomes reachable-but-unauditable in an intermediate state.
9. **Implement `ledger.post`/`.reverse`/`.approve_adjustment` maker/checker governance.**
10. **Resolve the fee/commission/product maker-checker question** (§28 item 2) and implement if
    adopted.
11. **Build the Admin Web "Administration → Roles & Permissions" screens** for role/function
    administration, once steps 1–5 exist to administer.
12. **Extend Admin Web visibility** for the newly defined roles' functions (Agent Network,
    Compliance, Risk & Fraud, Customer Service, Treasury screens), function-driven per §21.

None of these twelve steps were started in this task.

---

## 27. Explicit statement of non-permanence

> **These ten roles constitute the initial V1 organizational configuration. They are not
> immutable system roles. The authorization architecture is intended to support future role
> creation and modification through configurable functions/permissions subject to mandatory
> security governance.**

---

## 28. Explicit unresolved Product Owner decisions

1. Does `SUPER_ADMIN` **replace** today's `FINANCE_ADMIN` role key, or **coexist** alongside it?
2. Should fee/commission/reward/limit/product configuration changes remain SENSITIVE-but-
   freely-assignable, or become maker/checker-governed like ledger postings?
3. Is the four-role schema cap in `workforce-configuration.ts` relaxed to ten (or more), or is a
   different mechanism (e.g. a flag-based rewrite) used to introduce the six new roles?
4. Should `PATCH /customers/:id`'s single lifecycle endpoint be split into distinct
   `customer.suspend`/`.activate`/`.close` functions at the authorization layer even though the
   backend route itself remains unified?
5. Should `kyc-assessment`'s single endpoint be split into `kyc.review`/`.approve`/`.reject`
   functions, and should a second, independent KYC reviewer step be introduced?
6. Confirm the recommendation that TREASURY launches with only `reconciliation.view` and no other
   function — or whether the Product Owner wants any additional placeholder visibility granted now
   despite no backend capability existing.
7. **Who owns `agent.fund`/`.defund`** — AGENT_NETWORK_MANAGER alone, FINANCE_PREPARER/CONTROLLER
   under maker/checker, or a shared model where AGENT_NETWORK_MANAGER initiates and
   FINANCE_CONTROLLER approves? This is the sharpest new boundary question introduced by adding
   AGENT_NETWORK_MANAGER as a distinct role from OPERATIONS/FINANCE.
8. Confirm whether RISK_FRAUD's V1 scope should remain exactly as defined here (view + fraud-
   category case management only, sharing the Compliance backend) or whether a dedicated,
   minimal fraud-case data model should be scoped as a near-term (not this task) follow-up.
9. Confirm whether RISK_FRAUD should also receive read access to `AML`/`SANCTIONS`-category cases
   (overlapping with COMPLIANCE) given the real-world adjacency of fraud and AML investigation, or
   remain strictly limited to `FRAUD`-category cases only as specified here.
10. Confirm the exact governance mechanism for `workforce.role.create`/`.modify` once built —
    this specification recommends independent, non-self approval even for the administrative role,
    but the Product Owner should confirm whether a different control (e.g. requiring two
    SUPER_ADMIN-equivalent principals, if more than one ever exists) is preferred instead.

---

**End of specification. No code, database, migration, role, permission, authorization, Admin Web,
or API change was made in the course of producing this document.**
