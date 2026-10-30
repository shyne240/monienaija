# V1-ADMIN-SECURITY-AND-PORTAL-DECISION-02

**Classification: DECISION / ARCHITECTURE DOCUMENT ONLY. NO CODE, DATABASE, MIGRATION, ROLE,
AUTHORIZATION, OR ADMIN WEB CHANGES WERE MADE.** No `SUPER_ADMIN` was created. `FINANCE_ADMIN`
was not renamed. No navigation was added. This document evaluates a product-owner-proposed
security model against repository evidence at commit `c2e1326718ce79ca86abbbd3cc398e1a348e3114`
(branch `arena/01a10374-monienaija`), and produces a decision document for explicit product-owner
approval, per the task's framing. It reuses and does not re-litigate
`V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01` and `V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01`; new
evidence gathered this task (principally the audit-trail investigation in Part D) is marked
**NEW**.

**Recurring environment note:** at the start of this task the local checkout had again reverted
to a stale commit, the same pattern logged three times now in this session. It was re-verified
against `origin/arena/01a10374-monienaija` and hard-reset to the real tip before any file was
read, so all findings below reflect the true current repository state.

---

## PART A — Does the proposed model fit MonieNaija V1?

### 1. What already exists and can be retained

| Proposed element | Existing equivalent | Retain? |
|---|---|---|
| A role that administers workforce roles/permissions but cannot itself move money or approve financial actions | **This is already exactly how `FINANCE_ADMIN` is declared**, not merely similar: its scope is `["privileged:execute"]`, its `applicableActions` are only `FINANCE_ROLE_ASSIGN`/`FINANCE_ROLE_REVOKE`, `approvalCapability: false`. FINANCE_ADMIN today has **no declared financial mutation or approval capability of its own** — this part of the proposal is not a new restriction, it is a restatement of what the schema already enforces for the role that would be renamed. | Retain the underlying mechanics; the open question is naming/scope-widening, not restriction |
| A maker role that initiates financial operations but cannot approve its own work | **Exists in shape** as `FINANCE_PREPARER` (`makerEligible: true`, `checkerEligible: false`) and the self-approval prohibition already coded into every maker/checker rule (`selfApprovalProhibited: true`, enforced in `finance-role-administration.service.ts`: `if (c.principal.principalId === c.targetPrincipalId) throw ... 'Self assignment prohibited'`). | Retain |
| A checker role that approves/rejects, cannot approve its own maker action | Exists as `FINANCE_CONTROLLER` (`checkerEligible: true`, `approvalCapability: true`), same self-approval prohibition | Retain |
| An independent read/audit role with no mutation and no role assignment | Exists as `FINANCE_AUDITOR` (`scopes: ["finance:audit"]`, `applicableActions: []`, all eligibility/capability flags `false`) — **by declared config**. By actual route-level enforcement, this is **not currently true** (Part C/D of the prior audit; restated below). | Retain the declared intent; the enforcement gap is the thing requiring a decision, not the role concept |
| Maker/checker segregation for role assignment and control-policy activation | Exists and works: `FINANCE_ROLE_ASSIGN`/`REVOKE` (FINANCE_ADMIN initiates, FINANCE_CONTROLLER approves) and `FINANCE_CONTROL_POLICY_ACTIVATE` (FINANCE_PREPARER initiates, FINANCE_CONTROLLER approves) — both schema-validated at startup. | Retain |
| An audit trail recording actor, action, entity, before/after state, timestamp, correlation id | Exists as the central `audit_events` table (`src/operations/audit-event.entity.ts`) — see Part D for exact field-by-field sufficiency assessment | Retain, with gaps noted |

### 2. What conflicts with the proposed model

- **"Financial operations belong to dedicated financial roles" conflicts with current reality
  that *no* role can currently perform the core financial mutation operation (ledger journal
  posting/reversal) at all.** `POST /ledger/journals` and `POST /ledger/journals/:id/reversal`
  fall through `route-policy-registry.ts`'s final catch-all, which requires
  `requiredScopes: ['internal:access']` — a scope granted to **no role, finance or otherwise**
  (re-confirmed this session, unchanged since the prior two audits). The proposed model assumes
  FINANCE_PREPARER/CONTROLLER actively move money today; in the current implementation, **nobody
  can**, through this specific mechanism, regardless of role.
- **"SUPER_ADMIN should not directly... execute reversals" conflicts with the fact that the
  existing Admin Web Ledger screen's reversal button is wired to `FINANCE_ADMIN`'s own visible
  UI** (`LedgerOperationsScreen.tsx`, visible under the `isOperator` gate to any of the 4 current
  finance roles, including today's sole seeded identity, which holds only `FINANCE_ADMIN`) —
  though the underlying call is currently non-functional (broken by the same `internal:access`
  gap), the UI *presents* journal reversal as something the current FINANCE_ADMIN-equivalent
  identity can initiate, which is the opposite of the proposed SUPER_ADMIN boundary.
- **"No wallet debit/credit by SUPER_ADMIN" has no corresponding backend concept to conflict
  with or confirm** — there is **no dedicated "wallet adjustment" or "balance regularization"
  endpoint/service anywhere in the codebase** (verified this session: no "adjust"/"regulariz"/
  "debit"/"credit" mutation method exists outside the double-entry ledger journal mechanism
  itself). "Financial mutation" in this system is, structurally, synonymous with "post or
  reverse a ledger journal" — there is no separate wallet-adjustment primitive the proposed model
  needs to additionally restrict.

### 3. What is missing

- **No action-level distinction for ledger postings/reversals exists in
  `A2_MAKER_CHECKER_RULES_JSON`** — only `FINANCE_ROLE_ASSIGN`, `FINANCE_ROLE_REVOKE`, and
  `FINANCE_CONTROL_POLICY_ACTIVATE` are governed actions. There is no `LEDGER_JOURNAL_POST` or
  `LEDGER_JOURNAL_REVERSAL` maker/checker rule, so even if the `internal:access` scope gap were
  fixed tomorrow, there is currently **no segregation-of-duties rule at all** for the one action
  the proposed model cares most about.
- **No actor-identity capture on the ledger journal entity or its controller** (Part D, new
  finding, detailed below) — the single most consequential financial record in the system does
  not structurally know who posted it.
- **No route-level, role-specific authorization for ledger operations at all** — `ledger.controller.ts`
  takes no `@Req`, inspects no `authorizationPrincipal`, and the route policy gates only by the
  unreachable `internal:access` scope, not by `FINANCE_PREPARER`/`FINANCE_CONTROLLER` specifically.
  Fixing the scope gap alone, without adding role-specific checks, would make ledger posting
  reachable by **any** workforce principal type, not just the intended maker/checker pair.
- **No conceptual or coded SUPER_ADMIN** — confirmed absent again this session (consistent with
  the prior two audits).

### 4. What is currently unsafe

- Per the prior audit (Part D of `V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01`, re-confirmed
  unchanged this session): **FINANCE_AUDITOR, by current route-level code, can reach
  mutation-capable endpoints** (agent suspend/terminate, customer lifecycle PATCH, SUPPORT
  workforce-user provisioning, credential issuance, commercial-rule writes) because those routes
  check only `principal.type` (`OPERATOR`), which FINANCE_AUDITOR shares with
  FINANCE_PREPARER/FINANCE_CONTROLLER. This is the single clearest conflict with the proposed
  model's explicit requirement that the audit role have "no mutation of financial state, no role
  assignment, no operational mutation outside explicitly permitted audit functions."
- **The ledger's lack of actor capture (Part D) means that even a correctly-restricted
  FINANCE_PREPARER/CONTROLLER flow, if built exactly as proposed, could not yet be fully audited
  at the ledger-journal level** without additional work — a correctly-authorized action and an
  adequately-audited action are two different gaps, and only the first is a role/authorization
  question; the second is a data-capture question (Part D).

### 5. What requires a product decision

- Whether the renamed/broadened "SUPER_ADMIN" concept **replaces** `FINANCE_ADMIN` (i.e.
  `FINANCE_ADMIN` ceases to exist as a distinct role and all current FINANCE_ADMIN duties move to
  SUPER_ADMIN) or **coexists** with it (FINANCE_ADMIN remains the finance-role-administration
  gatekeeper, SUPER_ADMIN is added as a broader, separate, non-financial administrative layer).
  The task instructs not to create or rename anything, so this document evaluates both shapes
  conceptually (Part B) without committing to one.
- Whether the four-role, exactly-four-keys schema invariant (`workforce-configuration.ts`:
  `z.array(roleSchema).min(4).max(4)`, `REQUIRED_ROLES` hard-coded) is intended to be relaxed to
  accommodate a fifth role, or whether SUPER_ADMIN is meant to *replace* one of the four existing
  keys. This is a structural, schema-level decision with real migration consequences, explicitly
  out of scope to resolve here.
- Whether fixing the `internal:access` scope-grant gap (pre-existing, already documented twice)
  should be sequenced together with adding the missing `LEDGER_JOURNAL_POST`/`REVERSAL`
  maker/checker rule, so that ledger reachability and ledger segregation-of-duties arrive
  together rather than ledger becoming reachable-but-unsegregated in an intermediate state.

---

## PART B — Conceptual definition of SUPER_ADMIN (not created in code)

This section defines the role **as a concept only**, per instruction, distinguishing VIEW /
ADMINISTER / FINANCIAL MUTATION / APPROVAL explicitly for each capability, so that "full
administrative access" is not silently read as "financial access."

| Capability | VIEW | ADMINISTER | FINANCIAL MUTATION | APPROVAL |
|---|---|---|---|---|
| Customer information | **Yes** | **Yes** (profile/contact/address fields, lifecycle status per existing `PATCH /customers/:id` shape) | No | No |
| Wallet balances | **Yes** | No (no "administer a balance" concept should exist for this role) | **No — explicitly denied** | No |
| Transaction history | **Yes** | No | No | No |
| Ledger entries | **Yes** (read journals/accounts/balances) | No | **No — explicitly denied** (cannot post or reverse a journal) | **No — explicitly denied** |
| KYC information | **Yes** | **Yes** (record/update KYC assessment status as an administrative/compliance action, not a financial one) | No | No |
| Reconciliation | **Yes** | No (reconciliation *results* are visibility; *resolving a break* is debatable — see note below) | No | No |
| Audit records | **Yes**, including records of SUPER_ADMIN's own actions | No (audit records should not be editable by anyone, including SUPER_ADMIN — immutability is a prerequisite of the model, see Part D) | No | No |
| Suspend customers | N/A | **Yes** (lifecycle/compliance action) | No | No |
| Suspend agents | N/A | **Yes** (operational/lifecycle action) | No | No |
| Configure limits | N/A | **Yes** (catalogue/policy configuration) | Debatable — a limit *configuration* change is not itself a money movement, but it has financial consequence; this report flags it as a borderline case requiring explicit product confirmation rather than assuming either answer | No |
| Configure fees | N/A | **Yes** (rule registry configuration) | Same borderline note as limits | No |
| Configure products | N/A | **Yes** | No | No |
| Configure workforce roles | N/A | **Yes — this is the one capability that is unambiguously and currently already FINANCE_ADMIN's job** (`administrativeCapability`, role assign/revoke initiation) | No | No (initiating a role assignment is not the same as approving one — `FINANCE_CONTROLLER` remains the approver even under this proposal, preserving the existing maker/checker shape) |
| Platform configuration (general) | **Yes** | **Yes**, where a dedicated configuration surface exists (none currently does beyond the commercial-rule registries above — see `V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01` Part G: a general "Configuration Platform," B8, is itself unbuilt) | No | No |
| Operational visibility (metrics/diagnostics/outbox) | **Yes** | No (observing is not administering) | No | No |
| Audit visibility | **Yes** | No | No | No |

**Note on the limits/fees borderline case:** the product owner's proposal lists "platform
configuration" under SUPER_ADMIN's allowed privileges and separately lists "execute financial
adjustments" as explicitly denied. Fee-rule and limit-rule *configuration* (defining what a fee
or limit *is*) is conceptually closer to "platform/commercial configuration" than to "executing a
financial adjustment on a specific customer's balance" — but this report does not resolve the
borderline unilaterally; it is listed in Part A §5 as a decision point.

### Explicit privilege declaration for the SUPER_ADMIN concept

- **Administrative privileges:** workforce role administration (assign/revoke the other roles,
  initiate-only, mirroring today's `FINANCE_ADMIN` exactly); customer/agent lifecycle actions
  (suspend/activate/terminate/reactivate); KYC assessment recording; commercial-rule
  configuration (fee/limit/product/commission/reward registries), pending the borderline
  resolution above; SUPPORT workforce-user provisioning.
- **Read privileges:** customers, wallets (balance only, not mutation), transaction history,
  ledger (read-only), KYC, reconciliation, audit, agents, aggregators, support tickets, metrics,
  diagnostics, outbox.
- **Configuration privileges:** commercial-rule registries (fee/commission/reward/limit/product),
  pending the borderline note; no general "platform configuration" surface currently exists
  beyond these registries.
- **Workforce privileges:** same as administrative privileges above — this is not a separate
  bucket in the current implementation, it is the same mechanism (`A2_FINANCE_ROLES_JSON`
  assignment).
- **Role-management privileges:** assign/revoke the three non-admin roles (initiate only, as
  today); cannot assign another SUPER_ADMIN to itself or grant itself new scopes (mirroring the
  existing, already-coded bootstrap-admin restriction: "the bootstrap administrator cannot
  self-assign, change own scopes, assign another administrator, or create roles/scopes" —
  `A2-FINANCE-ROLE-ENTITLEMENT-AND-BOOTSTRAP-CONTRACT.md`).
- **Audit privileges:** full read access to the audit trail, **including records of its own
  actions**, with no ability to delete, edit, or suppress audit records (this is a property the
  audit store must guarantee structurally — not something any role's authorization can override).
- **Financial privileges explicitly denied:** post a ledger journal; reverse a ledger journal;
  debit or credit a wallet (no such primitive exists to deny today, but none should be added for
  this role in the future); approve any financial maker action.
- **Approval privileges explicitly denied:** cannot be a `checkerEligible` role for any financial
  action (`FINANCE_CONTROL_POLICY_ACTIVATE` or any future `LEDGER_JOURNAL_*` action); may remain
  the approver *only* for non-financial governance actions it does not itself initiate, mirroring
  today's design where `FINANCE_CONTROLLER` (not `FINANCE_ADMIN`) is the approver for
  `FINANCE_ROLE_ASSIGN`/`REVOKE` even though `FINANCE_ADMIN` is the initiator — i.e. the proposed
  SUPER_ADMIN, like today's FINANCE_ADMIN, should remain a **maker-only**, never a checker, for
  the one governed action it does initiate.
- **Maker privileges explicitly denied (for financial actions):** SUPER_ADMIN should not be a
  `makerEligible` role for any action in a future `LEDGER_JOURNAL_*` maker/checker rule.

---

## PART C — Finance role boundaries (conceptual)

| Domain | FINANCE_PREPARER | FINANCE_CONTROLLER | FINANCE_AUDITOR |
|---|---|---|---|
| Wallet adjustments | N/A — no such primitive exists; if one is ever built, PREPARER would be the natural maker | N/A — would be the natural checker if built | View only, if a view surface is built |
| Reversals (ledger journal reversal) | **Should be maker** (initiate a reversal request) — not currently wired as a governed action; today anyone with a working ledger connection could call it (moot, since it's currently unreachable) | **Should be checker** (approve/reject) | View only — can see that a reversal occurred and its before/after journal state, cannot initiate or approve |
| Financial regularization | Same shape as reversals — no dedicated primitive exists beyond ledger journals themselves | Same | View only |
| Fees (rule configuration) | Plausible maker role for proposing a fee-rule change (not currently a governed maker/checker action — today it is a bare `OPERATOR`/`PRIVILEGED`-gated write with no approval step at all) | Plausible checker role for approving a fee-rule change | View only |
| Commissions | Same shape as fees | Same | View only |
| Limits | Same shape as fees | Same | View only |
| Financial configuration (general) | Maker, where a governed action exists | Checker | View only |
| Financial approvals | **Cannot approve its own initiated action** (already enforced self-approval prohibition pattern) | **Sole approver role for financial actions** under this proposal | Cannot approve anything — "no mutation... no operational mutation outside explicitly permitted audit functions" |
| Ledger operations (journal posting) | Maker, if/when `LEDGER_JOURNAL_POST` becomes a governed action | Checker | Read-only access to journals/accounts/balances |
| Reconciliation | Can view; may be the natural maker for *resolving* a reconciliation break, if resolution requires a ledger correction | Natural checker for break resolution if the above is adopted | View only — reconciliation reports, trial balance, account activity, exactly as already reachable today via `/internal/reconciliation/*` |
| Financial reporting | View | View | **View is its core purpose** — financial reporting/audit visibility is exactly what FINANCE_AUDITOR already exists for |

**Preserving existing maker/checker segregation:** nothing above proposes removing or weakening
the two governed actions that already work correctly
(`FINANCE_ROLE_ASSIGN`/`REVOKE` initiated by the admin role and approved by
`FINANCE_CONTROLLER`; `FINANCE_CONTROL_POLICY_ACTIVATE` initiated by `FINANCE_PREPARER` and
approved by `FINANCE_CONTROLLER`). The proposal is additive: it asks for the *same* maker/checker
shape to be extended to ledger posting/reversal and, pending the Part B borderline decision,
possibly to commercial-rule registries — none of which currently have any maker/checker rule at
all (today they are single-step `OPERATOR`-gated writes, which is itself a segregation-of-duties
gap independent of the SUPER_ADMIN question).

---

## PART D — Audit trail sufficiency assessment

### Existing capability (verified this session)

`src/operations/audit-event.entity.ts` defines a central `audit_events` table with: `entityType`,
`entityId`, `action`, `actor` (a principal-id **string**), `correlationId`, `requestId`,
`previousValues`/`newValues` (JSONB, passed through `redactRecord()` which strips known secret
fields — passwords/PINs/tokens/hashes — but preserves ordinary business field content),
`occurredAt`, `createdAt`. Confirmed callers/usages:

- `AUTHORIZATION_DECISION` — emitted by `authorization.service.ts:recordDecision()` on every
  authorization check, capturing `allowed`/`reason`/`principalType`/`resourceType`/`resourceId`/
  `customerId`/`action`/`requiredScopes`/`requiredRoles`/`evaluatedAt` inside `newValues`.
- `WORKFORCE_BOOTSTRAP_CONSUMED`, `LOCAL_ADMIN_FINANCE_ADMIN_GRANTED`, `FINANCE_ROLE_ASSIGNED` —
  emitted by `finance-role-administration.service.ts` for the finance-role-administration
  lifecycle.
- `PRIVILEGED_ACTION_APPROVAL` — emitted by `privileged-action-approval.service.ts`, keyed by
  `entityId = approval.id` across its full lifecycle (request → approve/reject), meaning the
  maker/checker relationship for a given approval **is reconstructable** by querying all events
  sharing that `entityId` and ordering by `occurredAt`.
- Several other domain-specific audit emissions exist (`ar-control-account-provisioning.service.ts`,
  `partner-connection-audit.service.ts`, etc.) following the same shape.

**This answers the question "who did what, to what, when, and under which correlation/approval
relationship" reasonably well for the domains that call `AuditService` at all** — the schema has
the right columns for actor, action, entity, before/after, timestamp, and correlation, and the
approval lifecycle is genuinely traceable via shared `entityId`.

### Missing capability (NEW findings this session)

1. **"Actor role" is not a first-class field anywhere in the audit trail.** `actor` is always
   populated with a principal-id string (e.g. `issuer:subject`), never the role(s) that principal
   held at the time of the action. `AUTHORIZATION_DECISION` events do capture `principalType`
   (the coarse `OPERATOR`/`PRIVILEGED`/etc. bucket) but not the specific role array
   (`FINANCE_PREPARER` vs `FINANCE_CONTROLLER` vs `FINANCE_AUDITOR` are indistinguishable in the
   audit record itself, since all three collapse to `OPERATOR`). Reconstructing "which role was
   this actor acting under" requires a **separate** join against `A2FinanceRoleAssignment`'s
   effective-window history at the event's timestamp — possible in principle (the assignment
   table does carry `effectiveFrom`/`effectiveTo`), but **not pre-joined, not queried together
   today, and not exposed anywhere in Admin Web.** This directly affects the proposed audit
   requirement "actor role" as a first-class, minimum field — it exists only as a derivable
   fact, not a stored one.
2. **The ledger journal entity itself has no actor-identity field at all.**
   `src/ledger/ledger-journal.entity.ts` has no `createdBy`/`postedBy`/`actor` column — only
   `idempotencyKey`, `requestHash`, `correlationId`, `reference`, `description`, and a free-form
   `metadata` JSONB blob. `src/ledger/ledger.controller.ts` takes no `@Req()` and never reads
   `authorizationPrincipal` — the calling principal's identity is **not passed into journal
   creation at all** in the current code. Nor does any ledger service call `AuditService` to
   record a `LEDGER_JOURNAL_POSTED`/`LEDGER_JOURNAL_REVERSED` event. **This is the single most
   consequential gap relative to the proposed audit requirement**, since ledger
   posting/reversal is exactly the financial-mutation action the whole proposed model is built
   around controlling and auditing.
3. **Deposit, withdrawal, and transfer controllers have the same gap** (no `@Req()`/principal
   capture) — consistent with the fact that these routes are currently unreachable by anyone
   (the `internal:access` scope gap), so the gap has had no practical consequence yet, but it
   would need to be closed before any of these become usable under the proposed model.
4. **No structural guarantee of audit-record immutability was found or disproven in this
   session** — `AuditEvent` is an ordinary TypeORM entity with no append-only constraint,
   trigger, or role restriction visible at the schema level (no migration-level `REVOKE UPDATE`/
   `REVOKE DELETE` grant was found for the `audit_events` table in a brief check of the relevant
   migration). This matters for the proposed requirement that **even SUPER_ADMIN's own actions**
   be reliably auditable — today, nothing in the schema stops a sufficiently-privileged database
   actor (not a workforce HTTP principal, but direct DB access) from altering `audit_events`
   after the fact. This is a lower-priority, infrastructure-level gap (outside HTTP
   authorization entirely) rather than a role-design gap, but is recorded here since the product
   owner's requirement explicitly asks for SUPER_ADMIN's own actions to be auditable, which
   implies non-repudiation that the current schema does not yet structurally guarantee.

### Answering "who did what, to what, when, under which role, with what effect?" per role

| Role | Can the current system answer this today? |
|---|---|
| SUPER_ADMIN (conceptual, would reuse FINANCE_ADMIN's mechanics) | **Partially.** Role-assignment actions (the one thing FINANCE_ADMIN does today) are well audited (`FINANCE_ROLE_ASSIGNED`, linked `AUTHORIZATION_DECISION` events). Its broader, unintended reach into agent/customer/support/commercial domains (Part A) *is* captured by each domain's own audit emission where one exists, but "under which role" still requires the external join described in finding 1. |
| FINANCE_PREPARER | **Not yet meaningfully** for the actions the proposal cares about (ledger posting) — the mechanism doesn't exist yet to audit. Its one currently-real action (`FINANCE_CONTROL_POLICY_ACTIVATE` initiation) is audited. |
| FINANCE_CONTROLLER | Same shape as PREPARER — approval actions for the two existing governed actions are audited and linked via `entityId`; ledger approval doesn't exist as a concept yet. |
| FINANCE_AUDITOR | Its own (intended-to-be-read-only) actions are not separately logged as "read" events (reads are not typically audited in this system at all — only mutating `AuditService.record()` calls exist; no evidence of read-access logging for GET requests), which is consistent with normal practice but means there is **no audit trail of what an auditor actually looked at**, only of what it changed (which, per Part D above / the prior audit's Part D, it currently should not be able to do but structurally can in several domains). |
| Other workforce users (SUPPORT) | Partially — ticket actions and credential-issuance actions call into domain services; not individually re-verified this session. |

**Conclusion: the audit *infrastructure* (the `audit_events` table and its calling pattern) is
reasonably well-designed where it is used, but it is not uniformly applied** — the exact domain
the proposed model is most concerned about (ledger postings/reversals/financial mutation) is the
one domain with the **weakest** audit wiring of any examined in this report, and "actor role" is
a derivable, not stored, fact everywhere. No fixes are implemented in this task.

---

## PART E — Portal architecture reconciliation

Reusing `V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01` Part A directly rather than re-deriving:
the **authoritative** roadmap (`docs/decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md`) names five
separate portals (Admin, Finance, Operations, Compliance, Treasury), explicitly gated behind
backend platform maturity ("frontend development follows backend platform maturity" — §6), and
an older, explicitly superseded roadmap combined them into one "Admin & Operations Portal."

**Direct answer: the five-portal architecture is intended for a future phase, not V1, by the
roadmap's own stated sequencing.** The same roadmap document states the next authoritative
implementation platform is B2 Finance (§9), with B3 Treasury, B4 Fraud & AML, B5 Merchant, B6
Reporting, B7 Statement, B8 Configuration, and B9 Identity & Access Administration all
sequenced after it — i.e. most of the backend platforms each of the five portals would sit on top
of (Finance Portal → B2, Operations Portal → plausibly B5/B8, Compliance Portal → no named
backend platform maps directly to "Compliance" in the roadmap's Phase B list at all — the closest
named platform is B4 Fraud & AML, which is not the same scope as regulatory/KYC compliance;
Treasury Portal → B3) are themselves not yet built or, in Compliance's case, not even clearly
identified as a backend platform owner. **For V1, the roadmap supports exactly one combined
portal** — not because a single portal was declared "the V1 answer" anywhere explicitly, but
because no document authorizes building five separate frontends before their backend platforms
exist, and most of those backend platforms don't exist yet.

### What each proposed role should see, for V1, inside that one combined portal

| Role | What V1 should show it |
|---|---|
| SUPER_ADMIN (conceptual) | Dashboard/operational overview; Customer directory (incl. KYC view+assessment, lifecycle/suspend); Agent directory & lifecycle; Aggregators; Support tickets & workforce-user provisioning; Product/fee/commission/reward/limit **configuration** screens (pending the Part B borderline decision); Finance Role Administration (its existing core duty); Audit log viewer (including its own actions); Reconciliation (read); Ledger (**read-only** — accounts/journals/balances, no post/reverse controls in the UI) |
| FINANCE_PREPARER | Ledger journal/reversal **initiation** UI (once the backend governed action exists); fee/commission/limit/reward/product rule-change **proposal** UI (pending Part B borderline); its own pending-request queue |
| FINANCE_CONTROLLER | Privileged Approvals screen (already exists — `ApprovalsScreen.tsx`); ledger journal/reversal **approval** UI (once built); rule-change **approval** UI (pending Part B) |
| FINANCE_AUDITOR | Reconciliation (read); Ledger (read); Audit log (read); Customer/Agent/Transaction read views; **no write affordance anywhere in the UI**, and — per Part D — this should be matched by an equivalent backend restriction, which does not exist today |

This table is a **V1-scoped recommendation for what the single combined portal's menu should
contain per role**, not a finalized information architecture — it does not add any Admin Web
menu in this task.

---

## PART F — Capability ownership map

"OWNER PORTAL" again marked **(inferred)** where the roadmap does not state it directly, per the
same honesty standard as the prior report.

| CAPABILITY | BACKEND EXISTS? | V1? | OWNER ROLE (proposed) | OWNER PORTAL (inferred unless noted) | SUPER_ADMIN VIEW? | FINANCE ROLE ACCESS? | OTHER PORTAL? | ADMIN UI REQUIRED? | CURRENT UI? |
|---|---|---|---|---|---|---|---|---|---|
| Customers | Yes | Yes | SUPER_ADMIN administers; Finance roles view only | Admin (V1: combined) | View+Administer | View only | Compliance (KYC specifically) | Yes | Yes (`CustomerDirectoryScreen`) |
| KYC | Yes | Yes | SUPER_ADMIN administers (assessment); Auditor views | Compliance (future) | View+Administer | Auditor: view | Compliance | Yes | Partial (KYC read+assessment only) |
| Wallets | Yes | Yes | SUPER_ADMIN views only (no administer-balance concept); no mutation primitive exists | Finance (future) | View only | View only | — | Yes (view) | Partial (sub-view of Customer Directory) |
| W2W | Yes (customer self-service) | Yes | N/A — not an admin action at all | N/A | View (transaction history) only | View only | — | View-only observability | No |
| Cash-In | Yes (agent-mediated) | Yes | N/A — agent action, not admin | Operations (future) | View only | View only | — | View-only observability | No |
| Cash-Out | Yes (agent-mediated) | Yes | N/A | Operations (future) | View only | View only | — | View-only observability | No |
| Cash-to-Cash | Yes (agent-mediated) | Yes | N/A | Operations (future) | View only | View only | — | View-only observability | No |
| Agents | Yes | Yes | SUPER_ADMIN administers (lifecycle) | Operations (future) / Admin (V1) | View+Administer | View only | Merchant Platform B5 | Yes | **No UI exists** |
| Aggregators | Yes (foundation) | Yes (foundation; login deferred, separate documented decision) | SUPER_ADMIN administers | Operations (future) / Admin (V1) | View+Administer | View only | Merchant Platform B5 | Yes | **No UI exists** |
| Fees | Yes (registry only; runtime calc unreachable) | Yes | FINANCE_PREPARER proposes / FINANCE_CONTROLLER approves (pending Part B); SUPER_ADMIN may administer if borderline resolves that way | Finance (future) / Admin (V1) | View | Preparer/Controller: administer, pending decision | Commercial B1 | Yes | **No UI exists** |
| Commissions | Yes (registry+resolver) | Yes | Same shape as Fees | Finance (future) / Admin (V1) | View | Same | Commercial B1 | Yes | **No UI exists** |
| Limits | Yes (catalogue/assignment; runtime evaluate unreachable) | Yes | Same shape as Fees | Finance (future) / Admin (V1) | View | Same | Commercial B1 | Yes | **No UI exists** |
| Products | Yes (catalogue+governance) | Yes | SUPER_ADMIN or Finance roles, pending Part B | Commercial (future) / Admin (V1) | View | View/administer, pending decision | Commercial B1 | Yes | **No UI exists** |
| Rewards | Yes (registry+resolver) | Yes (schema foundation; "no runtime reward crediting exists" per code comments) | Same shape as Fees | Finance (future) / Admin (V1) | View | Same | Commercial B1 | Lower priority (no runtime effect yet) | **No UI exists** |
| Ledger | Yes, but **unreachable** (`internal:access` gap) | Yes — core | SUPER_ADMIN: view only. FINANCE_PREPARER: post (once governed). FINANCE_CONTROLLER: approve (once governed) | Finance (future) / Admin (V1) | View only | Preparer posts, Controller approves (proposed) | — | Yes | **Exists but broken** (`LedgerOperationsScreen`) |
| Reversals | Same as Ledger (sub-capability) | Yes | Same as Ledger | Finance (future) / Admin (V1) | View only | Preparer initiates, Controller approves (proposed) | — | Yes | Broken, same root cause |
| Reconciliation | Yes | Yes | SUPER_ADMIN/Auditor view | Finance (future) / Admin (V1) | View | View | — | Yes | **Works** (`ReconciliationObservabilityScreen`) |
| Breaks | Not a separately identified backend concept (appears inside reconciliation report payload, not a standalone endpoint — unchanged finding from the prior report) | Unclear | Same as Reconciliation | Finance (future) / Admin (V1) | View | View | — | Unclear until confirmed as a distinct capability | No dedicated UI confirmed |
| Approvals | Yes | Yes | FINANCE_CONTROLLER approves | Admin (V1, cross-cutting) | No (SUPER_ADMIN should not approve financial actions) | Controller: full | — | Yes | **Works but invisible to the current seeded FINANCE_ADMIN identity** (`ApprovalsScreen`) |
| Support | Yes (tickets + workforce-user provisioning) | Yes | SUPER_ADMIN administers provisioning; broader workforce reads tickets | Operations (future) / Admin (V1) | View+Administer | View only | — | Yes | **No UI exists** |
| Workforce (role administration) | Yes | Yes | SUPER_ADMIN (today's FINANCE_ADMIN) | Admin (V1) / Administrative IAM (B9, future) | Full (its core duty) | Controller approves | — | Yes | Works (`RoleAssignmentScreen`) |
| Audit | Yes (central `audit_events`, partial coverage per Part D) | Yes | SUPER_ADMIN and Auditor both view, including SUPER_ADMIN's own actions | Admin (V1) / Observability C2 (future) | View | View | — | Yes | **No UI exists** (Dashboard has only a stale placeholder) |
| Outbox | Yes | Unclear if admin-relevant | SUPER_ADMIN/Operations view | Observability C2 (future) | View | View | — | Lower priority | **No UI exists** |
| Notifications | Yes (admin deliveries view) | Unclear | SUPER_ADMIN/Operations view | Operations (future) / Admin (V1) | View | View | — | Lower priority | **No UI exists** |
| Diagnostics | Yes | Operational | SUPER_ADMIN/Operations view | Observability C2 (future) | View | View | — | Lower priority | **No UI exists** |
| Metrics | Yes | Operational | SUPER_ADMIN/Operations view | Observability C2 (future) | View | View | — | Lower priority | **No UI exists** |

**Practical answer to "if I am the Super Admin, where do I go to see/manage this?":** under this
proposed model, for V1 (one combined portal), SUPER_ADMIN would go to the **same single Admin
Web application** for everything in the table above — the proposal does not change the
one-portal-for-V1 conclusion from Part E, it changes *who inside that portal is allowed to click
which buttons*. The practical gap remains what Part F of the prior report already established:
most of the rows above have **no UI at all today**, regardless of which role is asking.

---

## PART G — Security risk decision on the principal-type authorization model

| Option | Security impact | Implementation impact | V1 impact | Risk | Compatibility with B9 |
|---|---|---|---|---|---|
| **A. Keep current broad OPERATOR/PRIVILEGED access until B9** | Leaves the Part A/D findings (FINANCE_AUDITOR can mutate; no ledger actor-capture) open indefinitely | None | No disruption to current (limited) working flows | **Highest** — explicitly contradicts the product owner's stated segregation requirement for as long as it stands, with no committed remediation date (B9 is sequenced far out per the roadmap) | Fully compatible — this is literally "do nothing until B9," which is what the architecture already assumes will eventually happen |
| **B. Tighten all role-level authorization now** | Closes every gap identified in Parts A/D at once | **Highest** — touches every `/internal/**` route policy and every admin controller across ~20 domains; requires finalizing every "pending decision" in Part A §5/Part B's borderline notes first, or risk building on an unapproved assumption | Risk of breaking currently-working flows (e.g. Customer Directory, Reconciliation) if role boundaries are drawn before the Part B/C conceptual boundaries are approved | **Moderate** — mostly implementation/regression risk rather than security risk, but doing it before approval risks rework | Likely needs redoing once B9 arrives with its own permanent role/entitlement model — short-term investment in an admittedly "interim" system |
| **C. Tighten only high-risk mutation domains immediately (agent suspend/terminate, customer lifecycle, SUPPORT provisioning, and — new in this task — ledger posting/reversal once reachable), while retaining broad read access** | Directly closes the specific finding in Part A §4 (FINANCE_AUDITOR mutation reach) and pre-empts the ledger-specific gap in Part A/D before the `internal:access` fix ships | **Moderate** — a bounded, named set of controllers, smaller than option B | Minimal disruption — read surfaces (Reconciliation, Customer directory reads, Capability registry, Audit/Outbox/Metrics/Diagnostics) remain exactly as they are today | **Low-moderate** — still requires the Part B/C role-boundary decisions to be finalized for the specific domains chosen, but the blast radius is much smaller than B | Same interim-investment caveat as B, but smaller sunk cost if B9 later redefines roles differently |
| **D. Defer all authorization changes until the portal/role model is formally approved** | No immediate risk reduction; the Part A/D gaps remain open for exactly as long as approval takes | None | None | **High, but time-bounded and explicit** rather than indefinite (unlike A, which has no forcing function to ever resolve) | Fully compatible; avoids building twice |

**Recommendation (not implemented): Option C, sequenced immediately after — not instead of —
Option D's prerequisite decision.** Reasoning: Part A §5 and Part B's borderline notes show that
several of the role-boundary questions (fee/limit/product configuration ownership, whether
SUPER_ADMIN and FINANCE_ADMIN coexist or merge, whether the four-role schema cap is relaxed) are
genuinely undecided and this report should not guess at them (per instruction). But the single
sharpest, least-ambiguous finding in this entire exercise — **FINANCE_AUDITOR, an explicitly
"read-oriented assurance only" role, can currently suspend agents, mutate customers, and
provision SUPPORT users purely because of a type-collapse, with no plausible argument that this
was ever an intended design** — does not require waiting on the harder borderline questions to
fix, because no one has proposed that FINANCE_AUDITOR *should* retain that reach under *any* of
the four role-hierarchy options this task or the prior one considered. Recommending Option C for
that specific, narrow slice, while treating everything else as Option D (deferred pending
approval), is the only combination that both respects "do not implement yet" and flags that one
finding as not actually contested. **No code is changed in this task regardless of this
recommendation.**

---

## PART H — Final product decision document (for explicit approval)

### 1. Proposed V1 role hierarchy

```
SUPER_ADMIN         — broad administrative/visibility authority; zero financial mutation or approval authority
  FINANCE_PREPARER  — financial maker; initiates permitted financial operations; cannot approve its own work
  FINANCE_CONTROLLER — financial checker; approves/rejects financial operations; cannot approve its own maker action
  FINANCE_AUDITOR   — independent read/audit role; zero mutation authority anywhere, not just in finance
```
This hierarchy is **evolutionary, not revolutionary**, relative to what already exists: it keeps
the exact same four-role shape and the exact same maker/checker mechanics already coded
(`FINANCE_ADMIN`→`FINANCE_PREPARER`/`FINANCE_CONTROLLER`/`FINANCE_AUDITOR`), and proposes (a)
renaming/reconceptualizing the administrative role away from a finance-sounding name toward one
that matches its actual (already-broader-than-finance) practical reach, and (b) adding the
missing financial-action maker/checker rule (ledger posting/reversal) that doesn't exist today
for any role. Whether (a) is a rename of `FINANCE_ADMIN` or an additional, coexisting role is the
**first open decision** this document asks the product owner to resolve (Part A §5).

### 2. Proposed SUPER_ADMIN authority boundary

Per Part B: full view access everywhere; administer customers/agents/support/workforce-roles/
commercial-rule-registries (pending the fee/limit/product borderline decision); zero ability to
post or reverse a ledger journal; zero ability to approve a financial maker action; cannot
self-assign, change its own scopes, or create another SUPER_ADMIN (mirrors the existing bootstrap
restriction already coded for FINANCE_ADMIN).

### 3. Proposed FINANCE_PREPARER boundary

Per Part C: maker for financial operations once those operations have a governed
maker/checker action defined (today, only `FINANCE_CONTROL_POLICY_ACTIVATE`; the proposal adds
ledger posting/reversal as new governed actions). Cannot approve its own initiated action
(already an enforced, reusable pattern). No administrative/workforce authority.

### 4. Proposed FINANCE_CONTROLLER boundary

Per Part C: sole checker for financial maker actions (ledger posting/reversal, once governed;
already the checker for role-assignment and control-policy actions). No administrative/workforce
initiation authority of its own (already true today — FINANCE_CONTROLLER cannot initiate
`FINANCE_ROLE_ASSIGN`).

### 5. Proposed FINANCE_AUDITOR boundary

Per Part C/D: full read access to financial and operational state as already declared
(`finance:audit` scope); **zero mutation anywhere**, which requires closing the Part A §4 /
Part G gap (today it can mutate several non-finance domains by accident). This is the one
boundary this report explicitly flags as **not currently enforced** and recommends prioritizing
(Part G, Option C) once approved.

### 6. Financial segregation-of-duties rules

- No role may be both maker and checker for the same action (`selfApprovalProhibited`, already
  coded and enforced for the two existing governed actions; must be replicated for any new
  ledger-posting/reversal governed action).
- SUPER_ADMIN is never a maker or checker for financial actions.
- FINANCE_AUDITOR is never a maker or checker for anything.
- A maker's own request cannot be approved by the same principal (`principal.principalId ===
  targetPrincipalId` check pattern already exists for role assignment; equivalent check needed
  for any new financial governed action).

### 7. Audit requirements

Minimum fields (actor identity, actor role, action, target/entity, before/after state, timestamp,
correlation/request id, maker/checker relationship) are **mostly already structurally supported**
by the existing `audit_events` table, with two explicit, named exceptions requiring remediation
before the model can be considered fully auditable (Part D): (i) actor **role** is not a stored
field anywhere, only derivable by a separate join against role-assignment history; (ii) the
ledger journal entity and controller capture **no actor identity at all**, and no
`LEDGER_JOURNAL_POSTED`/`REVERSED` audit event is emitted anywhere in the current code.
Audit-record immutability (append-only guarantee) was not found to be structurally enforced at
the schema level and should be confirmed or added as part of any future implementation.

### 8. V1 portal model

**One combined Admin Web portal for V1**, per Part E — the five-portal roadmap split is for a
future phase, gated on backend platforms (B2 Finance, B3 Treasury, B5 Merchant, B8
Configuration, B9 Identity & Access Administration) that do not yet exist. This is not a
convenience choice; it follows directly from the roadmap's own stated frontend-maturity gate.

### 9. Capability ownership by role/portal

Part F's full table — summarized: SUPER_ADMIN administers non-financial domains and views
everything; FINANCE_PREPARER/CONTROLLER own the maker/checker pair for financial actions (today
only control-policy activation; proposed to extend to ledger posting/reversal and, pending
decision, commercial-rule changes); FINANCE_AUDITOR views everything and mutates nothing.

### 10. What the Super Admin sees

Per Part E's V1 table: Dashboard, Customer directory (incl. KYC view/assessment, lifecycle),
Agent/Aggregator administration, Support administration, commercial-rule configuration (pending
decision), Finance Role Administration, Audit log (incl. its own actions), Reconciliation
(read), Ledger (read-only).

### 11. What the Super Admin cannot do

Post or reverse a ledger journal; approve any financial maker action; debit or credit a wallet
(no such primitive should ever be added for this role); assign itself a new role or scope;
create another SUPER_ADMIN; suppress or edit its own audit trail.

### 12. What Finance users see/do

FINANCE_PREPARER: initiate ledger postings/reversals and (pending decision) commercial-rule
change proposals, once those become governed actions; view its own pending queue.
FINANCE_CONTROLLER: the existing Privileged Approvals screen, extended to cover the new financial
governed actions once they exist. FINANCE_AUDITOR: read-only views across customers, agents,
ledger, reconciliation, and audit — with no write affordance anywhere in the UI, backed by an
equivalent backend restriction that must be added (Part G).

### 13. What is V1

The one-combined-portal model (Part E); the renamed/reconceptualized top administrative role
with the same bootstrap/self-restriction mechanics already coded; extending the existing,
already-working maker/checker *mechanism* to a new governed action for ledger
posting/reversal; closing the FINANCE_AUDITOR mutation gap (Part G, Option C candidate).

### 14. What is deferred to B9

The five-portal split; a true "permanent," cross-platform identity & access administration
authority (role definitions, assignments, entitlements, reviews, privileged governance) that
supersedes the entire current A2T11 interim Finance-role mechanism — unchanged conclusion from
`V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01`.

### 15. Security risks requiring immediate remediation (once approved — not implemented here)

In priority order, per Part G:
1. FINANCE_AUDITOR's current ability to mutate non-finance domains (agent lifecycle, customer
   lifecycle, SUPPORT provisioning) — the least-ambiguous, least-contested finding in this
   report.
2. The ledger journal entity/controller's complete lack of actor-identity capture and audit
   emission — a prerequisite for the proposed model's core premise (segregated, auditable
   financial mutation) to mean anything once the `internal:access` reachability gap is
   separately fixed.
3. The missing `LEDGER_JOURNAL_POST`/`REVERSAL` maker/checker governed-action definitions —
   without these, fixing reachability alone would make ledger posting a single-step,
   unsegregated `OPERATOR`-gated action, which is worse than today's "unreachable by anyone"
   state from a segregation-of-duties standpoint.

### 16. Exact implementation sequence after approval (not started)

1. Product owner resolves the open decisions named throughout this document: SUPER_ADMIN as a
   rename-of or addition-to FINANCE_ADMIN; the fee/limit/product configuration-ownership
   borderline; whether the four-role schema cap is relaxed or one key is repurposed.
2. Define (as a written architecture artifact, not code) the exact new maker/checker governed
   actions for ledger posting/reversal, mirroring the existing `FINANCE_CONTROL_POLICY_ACTIVATE`
   shape.
3. Implement the FINANCE_AUDITOR mutation-boundary fix (Part G, Option C) as a narrowly-scoped
   authorization change — the one item this report identifies as uncontested.
4. Implement actor-identity capture and audit emission on the ledger journal/reversal path,
   independent of and before wiring any UI to it.
5. Separately, fix the pre-existing `internal:access` scope-grant gap for
   Ledger/Fees/Deposits/Withdrawals/Transfers (already twice-documented), sequenced **after**
   steps 2–4 so that reachability and segregation/audit arrive together rather than ledger
   becoming reachable-but-unsegregated in between.
6. Only then extend Admin Web with the missing screens identified in Part F (Agents, Aggregators,
   Support, commercial-rule registries, Audit log, real Ledger read view), scoped per the
   approved role model from step 1.
7. Treat the five-portal split and B9 as explicitly out of scope for this sequence, per the
   roadmap's own stated gating.

---

**This document is a decision artifact for product-owner approval. No code, database, migration,
role, authorization, or Admin Web change has been made as part of producing it.**
