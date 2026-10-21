# V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01

**Classification: DOCUMENTATION ONLY. NO CODE, DATABASE, MIGRATION, ROLE, PERMISSION,
AUTHORIZATION, ADMIN WEB, OR API CHANGE WAS MADE.** This document is the authoritative Product
Owner decision record for the MonieNaija V1 admin role and permission model. It records the
outcome of Product Owner review of
`docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` (commit `f5f05db91c0b1f540831150b75698033ee6af4ef`).

**The ten decisions recorded in §2 of this document are FINAL.** They resolve, one-to-one, the ten
open "Product Owner decisions still required" items listed in §28 of the source specification. No
unresolved §28 item remains. **This document authorizes the next implementation phase. It does not
itself implement anything** — no source code, database schema, migration, authorization logic,
Admin Web code, or API was changed in producing it.

**Repository discipline (performed before any file was read or written for this task):**
`git fetch origin` found the true remote tip of `arena/01a10374-monienaija` at
`f5f05db91c0b1f540831150b75698033ee6af4ef`. The local checkout had again reverted to the branch's
original start-of-session commit, `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` — the **8th**
occurrence this session of this recurring sandbox state-loss pattern, with hundreds of files
across `src/`, `docs/`, `test/`, and the app trees again showing as modified/deleted/untracked
relative to the true tip. `git reset --hard origin/arena/01a10374-monienaija` restored the correct
state. Verified after reset, before any analysis began: branch = `arena/01a10374-monienaija`,
local HEAD = `f5f05db91c0b1f540831150b75698033ee6af4ef` = remote tip, working tree clean, and both
`f5f05db` and the source specification file confirmed present.

---

## 1. Source specification

This decision record resolves open questions raised in:

- `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` (commit `f5f05db91c0b1f540831150b75698033ee6af4ef`)
  — the definitive product/security specification that defined the ten candidate V1 roles, the
  function/permission catalogue, the role→function matrix, and the ten open Product Owner
  decisions (its §28) this document now closes.

That specification in turn built on, and this record does not re-litigate or contradict:

- `docs/V1/V1-ADMIN-ROLE-AND-FUNCTION-MODEL-01-REPORT.md` (commit `f74ca9d81770c032b5f7c6b1e58910362d3d9976`)
  — the audit/design report establishing the current authorization architecture, the hardcoded
  role-name dependencies, and the function/permission catalogue groundwork.
- `docs/V1/V1-ADMIN-SECURITY-AND-PORTAL-DECISION-02.md` (commit `31796c54e100cfc575df177cd272f142e193c29f`)
  — established the FINANCE_AUDITOR mutation defect and the three ledger-auditability findings,
  carried forward unchanged through every subsequent document including this one.
- `docs/V1/V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01.md` (commit `c2e1326`) and
  `docs/V1/V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01.md` (commit `302a10c`) — earlier audits establishing
  the single-portal decision and the role-architecture baseline, both unaffected by today's
  decisions.

---

## 2. The ten Product Owner decisions — FINAL

Each decision below states the decision itself, which open item in the source specification (§28)
it resolves, the governing functions/roles affected using the specification's stable function
codes, and is explicitly labeled by type: **[PRODUCT OWNER DECISION]** (the ruling itself),
**[REPOSITORY FACT]** (an unchanged, independently-verifiable fact about the current codebase that
motivates or is affected by the decision), **[IMPLEMENTATION RECOMMENDATION]** (a design choice
for the implementation team that follows from the decision but is not itself mandated verbatim by
the Product Owner), and **[FUTURE CAPABILITY]** (explicitly deferred, not authorized by this
decision).

### Decision 1 — SUPER_ADMIN replaces FINANCE_ADMIN

**Resolves spec §28 item 1.**

**[PRODUCT OWNER DECISION — FINAL]** `SUPER_ADMIN` is the highest administrative/governance role
for V1. The `FINANCE_ADMIN` role key does **not** remain as a separate V1 organizational role.
Existing `FINANCE_ADMIN` implementation dependencies must eventually be migrated to the
`SUPER_ADMIN` administrative-capability model. `SUPER_ADMIN` retains the explicit prohibition,
already stated in the specification (§11, Category D), on direct critical-financial execution and
approval.

**[REPOSITORY FACT, carried forward from the specification §4]** Six concrete hardcoded
dependencies on the literal string `'FINANCE_ADMIN'` currently exist and must be addressed as part
of this migration (full detail in §4 of this document, reused verbatim from the specification, not
re-derived here):
1. `workforce-session.service.ts:152` — principal-type derivation (`roles.includes('FINANCE_ADMIN')
   ? 'PRIVILEGED' : 'OPERATOR'`).
2. `workforce-configuration.ts` — `administrativeCapability` schema-reserved exclusively to the
   literal `'FINANCE_ADMIN'` role key.
3. `workforce-configuration.ts` — exact `.min(4).max(4)` role-count bound naming the four existing
   keys (superseded by Decision 3 below).
4. `finance-role-administration.service.ts` — multiple literal `'FINANCE_ADMIN'` comparisons
   governing assignment eligibility and bootstrap grants.
5. `route-policy-registry.ts` — hardcodes principal types derived via dependency #1.
6. Several admin controllers checking `principal.type` directly rather than consulting
   `policy.requiredScopes`.

**[IMPLEMENTATION RECOMMENDATION]** The migration should replace each literal `'FINANCE_ADMIN'`
string check with a role-class/flag lookup (e.g. "the role(s) flagged `administrativeCapability:
true`") so that the mechanism survives the rename and any future addition of further administrative
roles, rather than simply substituting the literal string `'SUPER_ADMIN'` for `'FINANCE_ADMIN'` in
the same six locations (which would only re-create the same class of hardcoding under a new name).

### Decision 2 — Commercial configuration is maker/checker governed

**Resolves spec §28 item 2.**

**[PRODUCT OWNER DECISION — FINAL]** The following functions, as catalogued in specification §7,
now require maker/checker governance (maker and checker must always be different principals):

| Function | Domain | Governance |
|---|---|---|
| `fee_rule.create` / `fee_rule.modify` | Finance | Maker/checker required |
| `commission_rule.create` / `commission_rule.modify` | Finance | Maker/checker required |
| `reward_rule.create` / `reward_rule.modify` | Finance | Maker/checker required |
| `product.modify` / `product.governance` | Finance | Maker/checker required |
| `limit.modify` (the limit catalogue/rule **definitions**, i.e. `limit-catalog.controller.ts`) | Finance | Maker/checker required |
| `agent.assign_limit` (assignment of an **already-defined** limit profile to a subject, i.e. `limit-assignment.controller.ts`) | Agent / Customer | **Remains operational — explicitly NOT maker/checker governed** |

**[REPOSITORY FACT]** All of the newly-governed functions above are, today, single-step writes
with no approval gate anywhere in the code (confirmed in specification §7's FINANCE domain table).
The one commercial-rule-adjacent action that already has real maker/checker today is
`finance.control_policy.activate` (`FINANCE_PREPARER` initiates, `FINANCE_CONTROLLER` approves),
which is the working precedent this decision's governance should mirror.

**[IMPLEMENTATION RECOMMENDATION]** `FINANCE_PREPARER` as maker, `FINANCE_CONTROLLER` as checker,
for each newly-governed function, following the exact shape of the already-implemented
`finance.control_policy.activate` rule (self-approval prohibited, minimum one approval).

### Decision 3 — Remove the fixed four-role cap

**Resolves spec §28 item 3.**

**[PRODUCT OWNER DECISION — FINAL]** The implementation must **not** simply widen the existing
hardcoded role-count bound from four to ten. The architecture must move toward the configurable
function/role model described in specification §20 (`FUNCTION CATALOGUE → ROLE → WORKFORCE USER`).
The ten V1 roles named in the specification are seeded initial configuration, not an immutable
system role list. Future roles must be creatable without source-code changes, subject to the
mandatory security governance defined in specification §19 and reaffirmed by Decision 10 below.
Existing hardcoded `FINANCE_ADMIN` assumptions (§4 of this document) must ultimately be removed,
not merely relabeled.

**[REPOSITORY FACT]** No `roles` or `functions`/`permissions` table exists in the database today;
roles are defined only in an environment-variable JSON blob (`A2_FINANCE_ROLES_JSON`) validated by
a Zod schema with an exact `.min(4).max(4)` bound. `a2_finance_role_assignments.role_key` is
already a plain, unconstrained `varchar` with no `CHECK` constraint or foreign key — the
assignment table does not require a destructive migration to support a data-driven roles table
(specification §3, §20).

**[IMPLEMENTATION RECOMMENDATION]** Build `functions` and `roles`/`role_functions` tables per the
sequence in specification §26 steps 1–4, rather than performing a second hardcoded-bound edit.

### Decision 4 — Customer lifecycle functions are distinct

**Resolves spec §28 item 4.**

**[PRODUCT OWNER DECISION — FINAL]** Customer suspension, activation, and closure are modeled as
three distinct authorization functions: `customer.suspend`, `customer.activate`, `customer.close`.
The existing `PATCH /customers/:id` route **may remain a single unified HTTP endpoint** if
technically appropriate — three separate HTTP endpoints are **not** required merely to achieve
authorization separation. Authorization decisions and audit records must distinguish which of the
three lifecycle actions was actually authorized and performed.

**[REPOSITORY FACT]** `PATCH /customers/:id` is currently one generic lifecycle-transition
endpoint carrying a target-status field in its DTO, not three separate backend code paths
(specification §7, CUSTOMER domain — function `customer.lifecycle_transition`, now superseded by
this decision's three distinct functions).

**[IMPLEMENTATION RECOMMENDATION]** The controller/service may continue to accept a single route,
but must derive which of the three functions (`customer.suspend`/`.activate`/`.close`) applies
from the requested target status *before* the authorization check runs, so `requiredScopes` can be
evaluated against the correct specific function rather than a single generic one, and so the
resulting audit event records the specific action rather than a generic "PATCH" label.

### Decision 5 — KYC functions are distinct, but no second reviewer in V1

**Resolves spec §28 item 5.**

**[PRODUCT OWNER DECISION — FINAL]** KYC decisioning is modeled as three distinct authorization
functions: `kyc.review`, `kyc.approve`, `kyc.reject`. These remain exclusively Compliance
functions (assignable to the `COMPLIANCE` role only). The existing backend endpoint may remain
unified if appropriate. **V1 does not introduce a mandatory independent second KYC reviewer
workflow** — no two-person KYC approval process is authorized by this decision.

**[REPOSITORY FACT]** `POST /customers/:id/kyc-assessment` is currently one endpoint, not three
distinct backend actions (specification §7, KYC/COMPLIANCE domain). No second-reviewer mechanism
exists anywhere in the backend today.

**[FUTURE CAPABILITY — explicitly not authorized by this decision]** A mandatory independent
second KYC reviewer / two-step KYC approval workflow remains a future capability requiring a
separate, explicit Product Owner decision if ever introduced. This decision record does not
create, imply, or schedule it.

### Decision 6 — Treasury launches with only `reconciliation.view`

**Resolves spec §28 item 6.**

**[PRODUCT OWNER DECISION — FINAL]** `TREASURY` receives exactly one function at V1:
`reconciliation.view`. No placeholder Treasury-specific functions are to be created for
capability that has no backend implementation. External settlement administration, suspense-entry
resolution, bank/NIBSS integration oversight, and external settlement execution all remain outside
V1, as already documented in the specification and the underlying architecture decisions
(ADR-0047, ADR-0048, ADR-0050).

**[REPOSITORY FACT]** `src/partner/external-settlement.entity.ts`, `external-settlement.service.ts`,
and `external-suspense-entry.entity.ts` exist as backend data models, but **zero controller
anywhere exposes them** — unlike `ledger.view` (backend-complete but unreachable due to the
`internal:access` scope gap), Treasury-adjacent data has no API surface at all today, reachable or
not (specification §6.10, §7 RECONCILIATION/TREASURY domain).

**[FUTURE CAPABILITY]** Additional Treasury functions (settlement administration, suspense
resolution, liquidity/float monitoring) may be added to the function catalogue later, once a
Treasury-specific backend platform exists, as a separate scoping exercise.

### Decision 7 — Agent fund/defund uses Agent-Network + Finance dual control

**Resolves spec §28 item 7.**

**[PRODUCT OWNER DECISION — FINAL]** For the function `agent.fund`/`agent.defund`:
`AGENT_NETWORK_MANAGER` initiates (maker); `FINANCE_CONTROLLER` independently approves or rejects
(checker). Maker and checker must always be different principals. The financial movement remains
under Finance governance notwithstanding that a non-Finance role is the initiator. `SUPER_ADMIN`
does not directly execute or approve this financial movement merely because it holds broad
administrative authority — the real financial/ledger controls around this operation must be
preserved.

**[REPOSITORY FACT — newly confirmed this session, more precise than the source specification's
framing]** `agent-funding.service.ts` already calls `LedgerService.postJournalInTransaction(...)`
directly — agent fund/defund **already posts real, immediate ledger journal entries today**, via a
code path separate from the generic, currently-unreachable `POST /ledger/journals` route. Unlike
the generic ledger-posting path, `agent-funding.controller.ts` **does** capture the calling
principal today (`@Req()` → `authorizationPrincipal` → `actor: principal.principalId`, passed into
the service) — so the actor-identity gap documented for generic ledger posting (§4 item 3 below)
does **not** apply to this specific action. What is missing today, and what this decision
authorizes fixing, is purely the **governance gate**: agent fund/defund is currently a single-step
action with no maker/checker approval of any kind, despite moving real ledger value immediately.
This is a materially more urgent and narrowly-scoped gap than the generic ledger reachability
issue, because this action is already reachable and already executes against the ledger today.

**[IMPLEMENTATION RECOMMENDATION]** This is a cross-functional maker/checker pair — the maker role
(`AGENT_NETWORK_MANAGER`) is not a Finance role, while the checker (`FINANCE_CONTROLLER`) is. This
is an intentional, explicit exception to the otherwise intra-Finance maker/checker pattern used in
Decision 2 and should be implemented as its own distinct governed-action rule (e.g.
`AGENT_FUNDING_REQUEST` / `AGENT_FUNDING_APPROVAL`) in whatever mechanism eventually generalizes
`A2_MAKER_CHECKER_RULES_JSON`, rather than being folded into the Finance-only rule set.

### Decision 8 — RISK_FRAUD remains thin in V1

**Resolves spec §28 item 8.**

**[PRODUCT OWNER DECISION — FINAL]** `RISK_FRAUD` uses the existing compliance-case infrastructure
(`customer-compliance.controller.ts` / `customer-compliance-case.entity.ts`). Its V1 mutation
surface is fraud-category case management only (`risk_fraud.manage_fraud_case`, as defined in
specification §7). **No dedicated fraud-case database model, fraud-detection engine,
transaction-risk-scoring engine, automated fraud hold, or automatic fraud reversal is authorized
by this decision or to be built in the implementation phase this document unblocks.** These remain
future capabilities requiring a separate, explicit scope approval.

**[REPOSITORY FACT]** `ComplianceCaseCategory.FRAUD` is a case-category enum value on the **same**
entity/table/controller used by `COMPLIANCE` — there is no separate backend resource for
Risk/Fraud today (specification §6.8, newly confirmed in the specification's drafting session).

### Decision 9 — RISK_FRAUD is restricted to FRAUD cases

**Resolves spec §28 item 9.**

**[PRODUCT OWNER DECISION — FINAL]** In V1, `RISK_FRAUD`'s `risk_fraud.manage_fraud_case` function
is restricted to cases of category `FRAUD` only. It does **not** receive access to `AML`- or
`SANCTIONS`-category cases, which remain exclusively `COMPLIANCE`'s. If a future requirement
justifies overlap between Risk/Fraud and Compliance case visibility, it must be introduced as an
**explicit additional function** (e.g. a distinctly-named read or case-management function scoped
to those categories) rather than silently broadening `risk_fraud.manage_fraud_case`'s existing
category restriction.

**[REPOSITORY FACT]** `ComplianceCaseCategory` includes `KYC`, `AML`, `SANCTIONS`, `FRAUD`, `PEP`,
`DOCUMENT`, `ACCOUNT_REVIEW`, `MANUAL_REVIEW` as a single flat enum on one shared entity — the
category-level restriction in this decision must be enforced at the authorization/function layer
(checking the case's category field against the function's permitted category set), since the
database schema itself does not separate fraud cases from other compliance cases into different
tables.

### Decision 10 — Role creation/modification requires independent dual control

**Resolves spec §28 item 10.**

**[PRODUCT OWNER DECISION — FINAL]** `workforce.role.create` and `workforce.role.modify` (the
future dynamic role-editing capability described in specification §20) require independent
approval: the maker of a role/function change cannot approve their own change; no role may assign
itself new privileges; critical financial functions remain subject to their non-bypassable
Finance-role-class restriction (specification §19) regardless of who edits a role's function list;
and — explicitly — **`SUPER_ADMIN` cannot self-approve a role/function change**, even though it is
the highest administrative role. This reaffirms, for the specific case of role/function
administration, the specification's core principle that role configuration must never become a
mechanism for bypassing security controls.

**[REPOSITORY FACT]** No code path today creates or edits a role definition at all (roles are
environment-variable JSON, edited only by redeploying the application); `workforce.role.assign` /
`.revoke` (a related but distinct action — assigning an *existing* role to a user, not editing a
role's function list) already has a working, non-bypassable maker/checker implementation today
(`FINANCE_ADMIN`/future `SUPER_ADMIN` initiates, `FINANCE_CONTROLLER` approves, self-approval
prohibited) — this is the direct precedent this decision's governance for role *creation/editing*
should structurally mirror.

**[IMPLEMENTATION RECOMMENDATION]** Model `workforce.role.create`/`.modify` approval using the
same `PrivilegedActionApprovalService` mechanism that already governs `workforce.role.assign`/
`.revoke` and `finance.control_policy.activate`, requiring a second, distinct administrator-
eligible principal as approver in every case, with no carve-out for the administrative role.

---

## 3. All source-specification §28 items — closure confirmation

| Spec §28 item | Resolved by | Status |
|---|---|---|
| 1. SUPER_ADMIN replace-vs-coexist | Decision 1 | **CLOSED — replaces** |
| 2. Commercial-rule maker/checker governance | Decision 2 | **CLOSED — governed, with the limit-assignment/limit-catalogue distinction specified** |
| 3. Four-role schema cap relaxation mechanism | Decision 3 | **CLOSED — move to configurable architecture, not a bound edit** |
| 4. Customer lifecycle function granularity | Decision 4 | **CLOSED — three distinct functions, route may stay unified** |
| 5. KYC function granularity and second-reviewer question | Decision 5 | **CLOSED — three distinct functions, no second reviewer in V1** |
| 6. Treasury placeholder visibility | Decision 6 | **CLOSED — `reconciliation.view` only** |
| 7. Agent fund/defund ownership | Decision 7 | **CLOSED — AGENT_NETWORK_MANAGER maker, FINANCE_CONTROLLER checker** |
| 8. RISK_FRAUD scope-expansion question (dedicated fraud model) | Decision 8 | **CLOSED — remains thin, existing compliance-case infrastructure only** |
| 9. RISK_FRAUD AML/SANCTIONS overlap question | Decision 9 | **CLOSED — FRAUD category only** |
| 10. `workforce.role.create`/`.modify` governance mechanism | Decision 10 | **CLOSED — independent dual control, no self-approval, no SUPER_ADMIN carve-out** |

**No unresolved §28 Product Owner decision remains.** No additional Product Owner decisions beyond
these ten have been introduced by this document.

---

## 4. Carried-forward repository/security facts still requiring implementation attention

These facts are **unchanged by today's decisions** and are not resolved by them. They are
explicitly re-stated here, per instruction, so the implementation phase this document authorizes
does not lose track of them:

1. **FINANCE_AUDITOR mutation defect** (first documented in `31796c5`, reverified unchanged
   through `f74ca9d` and `f5f05db`): `workforce-session.service.ts:152`'s
   `roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' : 'OPERATOR'` means a FINANCE_AUDITOR-only
   identity shares principal type `OPERATOR` with FINANCE_PREPARER/FINANCE_CONTROLLER, making
   every route gated only by `allowedPrincipalTypes` (without a `requiredScopes` check) reachable
   by FINANCE_AUDITOR despite its declared read-only (`finance:audit`) scope. Full inventory
   carried forward unchanged (agent lifecycle mutation, customer lifecycle PATCH, customer wallet
   creation, KYC assessment recording, SUPPORT workforce-user provisioning, agent/customer
   credential issuance, agent fund/defund, fee/commission/reward/product/limit registry writes).
   **Not fixed by this document or by any of the ten decisions above** — several of the decisions
   above (e.g. Decision 2's new maker/checker gates, Decision 4/5's function splits) will narrow
   or reshape parts of this inventory once implemented, but the underlying principal-type collapse
   itself requires the dedicated fix already recommended in prior reports.
2. **`internal:access` reachability gap**: the `internal:access` scope is granted to no role
   today, making `ledger.view`, `ledger.post`, `ledger.reverse`, `transaction.view`, and
   `reconciliation.view` permanently unreachable regardless of role-model changes, until a role is
   explicitly granted that scope (or the gating mechanism is replaced by function-specific
   `requiredScopes`, as the broader architecture work eventually requires). **Decision 6 assigns
   `TREASURY` the `reconciliation.view` function, but that function remains unreachable until this
   gap is fixed** — the decision authorizes the assignment; it does not by itself make the
   function usable.
3. **Ledger actor-identity/audit gap** (generic `POST /ledger/journals` path only — see the
   important distinction drawn in Decision 7 above, where the agent-funding path is confirmed
   **not** to share this gap): `src/ledger/ledger-journal.entity.ts` has no
   `actor`/`createdBy`/`postedBy` column, and `src/ledger/ledger.controller.ts` never reads the
   calling principal. Confirmed unchanged again this session.
4. **Ledger maker/checker gap** (generic `POST /ledger/journals`/`.../reversal` path): no governed
   action exists in `A2_MAKER_CHECKER_RULES_JSON` for either posting or reversing a ledger journal
   through the generic route. **This is distinct from Decision 7's agent-funding governance**,
   which covers a different, already-reachable code path; the generic ledger posting/reversal
   maker/checker gap remains open and unaddressed by any of today's ten decisions.
5. **The six hardcoded `FINANCE_ADMIN` dependencies** enumerated in §2 (Decision 1) of this
   document: these must be migrated, not merely renamed, as part of implementing Decisions 1 and 3
   together. Until they are migrated, `SUPER_ADMIN` cannot actually function as the replacement
   administrative role in running code — today's decisions authorize and direct that migration;
   they do not perform it.

---

## 5. Implementation consequences — what is now unblocked

This section identifies which steps of the specification's recommended implementation sequence
(specification §26) are now unblocked by these ten final decisions, and which remain blocked
pending further work (not further decisions):

| Specification §26 step | Status after this decision record |
|---|---|
| 1. Function/role catalogue foundation (build `functions`, `roles`, `role_functions` tables) | **Unblocked** — Decision 3 authorizes moving to this model instead of a bound edit |
| 2. Migrate existing FINANCE_* roles into the new tables | **Unblocked** |
| 3. Add the six new roles' function assignments | **Unblocked** — all ten roles' function sets are now fully specified (Decisions 1, 4–9 resolved every previously-open assignment question) |
| 4. Resolve the six hardcoded `FINANCE_ADMIN` dependencies | **Unblocked, and now explicitly directed** by Decision 1 — still requires the engineering work itself (§4 item 5 above) |
| 5. Implement non-bypassable governance invariants (maker ≠ checker; critical-financial role-class restriction; role-create/modify dual control) | **Unblocked** — Decision 10 makes the role/function-administration governance rule explicit and final, in addition to the already-specified financial-function rule |
| 6. Fix the FINANCE_AUDITOR mutation defect | **Still blocked on implementation, not decisions** — no Product Owner decision was required to authorize this fix; it remains an open engineering task (§4 item 1 above) |
| 7. Fix the `internal:access` reachability gap | **Still blocked on implementation, not decisions** — required before Decision 6's `TREASURY` → `reconciliation.view` assignment has any practical effect (§4 item 2 above) |
| 8. Add ledger actor-identity/audit capture | **Still blocked on implementation** for the generic ledger path; **already satisfied** for the agent-funding path per the fact newly confirmed in Decision 7 |
| 9. Implement `ledger.post`/`.reverse`/`.approve_adjustment` maker/checker | **Still open** — no decision above addresses the generic ledger posting/reversal governance gap (distinct from Decision 7's agent-funding-specific governance) |
| 10. Implement Decision 2's commercial-configuration maker/checker | **Unblocked** — fully specified by Decision 2 above |
| 11. Implement Decision 7's agent fund/defund dual control | **Unblocked** — fully specified by Decision 7 above, and narrower in scope than originally assumed since actor-identity capture already exists for this path |
| 12. Build Admin Web "Administration → Roles & Permissions" screens | **Unblocked in design terms** once steps 1–5 exist to administer; no Admin Web work is authorized or performed by this document |
| 13. Extend Admin Web visibility for the ten roles' functions | **Unblocked in design terms**; not implemented |

**In summary: every role/function *design* question raised in the specification is now closed.**
What remains before implementation can begin in earnest is the **engineering work itself** —
building the catalogue tables, migrating the hardcoded dependencies, and implementing the
newly-decided governance rules — none of which this document performs.

---

## 6. Non-permanence of the role model (restated, per instruction)

> **The ten roles named in this decision record — `SUPER_ADMIN`, `FINANCE_PREPARER`,
> `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`,
> `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY` — remain the INITIAL V1 organizational
> configuration. They are not immutable system roles. Decision 3 above explicitly directs that the
> implementation move toward a configurable function/role architecture in which future
> administrators can create, modify, and retire roles without source-code changes, subject always
> to the mandatory, non-bypassable security governance defined in the source specification (§19)
> and reaffirmed by Decision 10 of this record.**

---

## 7. What this document does and does not do

**This document does:**
- Record ten final Product Owner decisions, each resolving a previously-open question in
  `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md`.
- Authorize the implementation team to proceed into the engineering work described in §5 above.
- Preserve and re-state, without alteration, every repository fact and security gap carried
  forward from prior reports that remains relevant to that implementation work.

**This document does not:**
- Change any source code, database schema, migration, authorization logic, Admin Web code, or API.
- Create any role, function, permission, or database table.
- Fix the FINANCE_AUDITOR defect, the `internal:access` reachability gap, the ledger
  actor-identity/audit gap, or the ledger maker/checker gap.
- Migrate any of the six hardcoded `FINANCE_ADMIN` dependencies.
- Introduce any Product Owner decision beyond the ten recorded in §2.

---

**End of decision record. No code, database, migration, role, permission, authorization, or Admin
Web change was made in the course of producing this document.**
