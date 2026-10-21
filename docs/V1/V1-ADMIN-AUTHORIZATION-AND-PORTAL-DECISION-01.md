# V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01

**Classification: PRODUCT/SECURITY DECISION AUDIT. NO CODE CHANGES.** No source, migration,
role, or UI changes were made for this task. No `SUPER_ADMIN` was created. `FINANCE_ADMIN` was
not renamed. `B9` was not built. Every claim is sourced to a specific file/line/quote at commit
`302a10cfa4a263e5926aba7495f63f848f79cc1f` (branch `arena/01a10374-monienaija`), which is the
commit that carries `V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01`. This report reuses, and does not
re-litigate, the established facts from that audit and from
`V1-ADMIN-FULL-SURFACE-AUDIT-01-REPORT.md`; new evidence gathered this task is marked **NEW**.

**Note on the session's recurring environment issue:** at the start of this task the local
checkout had again reverted to a stale commit (the same pattern logged twice before in this
session). It was re-verified against `origin/arena/01a10374-monienaija` and hard-reset to the
real tip before any file was read for this audit, so all findings below reflect the true current
repository state.

---

## PART A — The intended V1 administrative portal model

### A. What is the intended V1 administrative portal model?

The repository contains **two different portal models from two different eras**, and they
disagree:

1. An **older, superseded** planning document (`docs/archive/a1-consolidation/ROADMAP.md`,
   `docs/archive/a1-consolidation/A1-CROSS-DOCUMENT-REFERENCE-MAP.md`,
   `docs/archive/a1-consolidation/DEPENDENCY-GRAPH.md`) lists a single combined
   **"P1.10 Admin & Operations Portal"** depending on `A1, A2, A4, A5, A6, A7`.
2. The **current authoritative** roadmap (`docs/decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md`,
   effective 2026-08-09, explicitly "authoritative for all work sequenced after the completed
   legacy B2T01–B2T10 implementation") lists, in its Frontend section (§6), **five separate
   portals**: Admin Portal, Finance Portal, Operations Portal, Compliance Portal, Treasury
   Portal (plus Customer Mobile App, Agent App, Merchant App, Developer Portal).

### B. Is the current single Admin Web intended to be... ?

**Answer: (4) one of several portals that are planned but not yet separated — with the caveat
that the separation itself is not yet designed, only named.**

Evidence: the authoritative roadmap names "Admin Portal" as item 1 of the frontend list,
distinct from "Finance Portal" (item 2), "Operations Portal" (item 3), and "Compliance Portal"
(item 4). It does not describe what belongs in "Admin Portal" specifically versus the other
four — there is no document anywhere in the repository that defines the functional boundary
between "Admin Portal" and "Operations Portal," for example. The single `apps/admin-web`
application that actually exists is not declared anywhere to *be* any one of these five; it
predates the naming (it was built under the FINANCE_ADMIN/A2T11 effort, before the authoritative
roadmap document existed — see chronology below). Nothing names `apps/admin-web` as "the Admin
Portal" specifically, as opposed to a stand-in for several of the five.

Why not the other options:
- **(1) complete V1 back-office portal:** not supported — the roadmap explicitly plans
  *separate* Finance/Operations/Compliance/Treasury portals, meaning a single portal was never
  the intended end state, only possibly an interim one.
- **(2) Admin portal only:** not supported either way — no document says `apps/admin-web`'s
  functional scope is limited to whatever "Admin Portal" means; in practice it already contains
  Ledger (arguably Finance/Treasury), Reconciliation (arguably Finance), Role Administration
  (arguably the as-yet-undefined administrative-IAM domain), which spans more than a narrow
  "Admin" slice.
- **(3) interim combined Admin & Operations portal:** partially supported by the *older*,
  superseded P1.10 label, but that label is explicitly superseded by the 5-portal roadmap (see
  D below), so it cannot be read as the *current* intended model — only as a historical
  precedent for "one combined portal" thinking.

### C. Authoritative document establishing this

`docs/decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md` is explicitly self-declared as authoritative:
> "This document is the authoritative long-term platform roadmap. If an older roadmap, phase
> plan, implementation plan, handoff, contract, ADR, identifier, task label, or historical
> artifact assigns a different future meaning to A8, B2, B3, observability, frontend
> sequencing, or scale/extraction, this document controls **future sequencing and platform
> ownership**."

Its §6 "Frontend" section is the only place in the repository that names a 5-portal split, and
the only authoritative statement on frontend sequencing: *"Frontend development follows backend
platform maturity... no historical product-roadmap mention of a portal, mobile channel, PWA, or
developer portal authorizes frontend implementation before the required backend platforms are
mature."*

### D. Do later documents supersede the earlier "Admin & Operations Portal" language?

**Yes, explicitly and directly.** `docs/archive/phases-b1-b2/B2-ROADMAP-RECONCILIATION-HANDOFF.md`
(a transition document bridging the old and new roadmaps) states, in its own words:

> "`docs/ROADMAP.md` lists Customer Web Portal and Admin & Operations Portal in the historical
> P1 product roadmap... Nevertheless, the old product-roadmap presentation can be misread as
> current execution order."
>
> "The authoritative roadmap establishes an explicit maturity gate: Customer Mobile App, Agent
> App, Merchant App, **Admin Portal, Finance Portal, Operations Portal, Compliance Portal,
> Treasury Portal**, and Developer Portal are developed only after backend platforms are mature.
> Historical P1 portal labels remain product-history context, not implementation authorization."

This is not an inference — the repository itself names the exact supersession and even warns
that reading the old label as current authorization would be a misreading.

### Chronology: older portal architecture → current portal architecture → current implementation

| Stage | Document | Model | Status |
|---|---|---|---|
| 1. Early P1 planning | `docs/archive/a1-consolidation/ROADMAP.md` (+ dependency graph, cross-reference map) | One combined **"Admin & Operations Portal"** | **Superseded** |
| 2. Transition/reconciliation | `docs/archive/phases-b1-b2/B2-ROADMAP-RECONCILIATION-HANDOFF.md` | Explicitly declares the P1 label superseded; names the new 5-portal split; states frontend awaits backend maturity | Historical bridge document, not itself authoritative going forward |
| 3. Current authoritative roadmap | `docs/decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md` (2026-08-09) | **Five separate portals**: Admin, Finance, Operations, Compliance, Treasury — functional boundaries between them **not yet defined anywhere** | **Authoritative, current** |
| 4. Current implementation | `apps/admin-web/` | **One single app**, built under the A2T11/FINANCE_ADMIN effort, containing Dashboard, Customer Directory (incl. KYC/wallets), Ledger (broken), Transaction Observability (broken), Reconciliation, Finance Role Admin, Privileged Approvals | Matches neither stage 1 nor stage 3 cleanly — it is closer in *shape* to stage 1 (one app, several domains) but was never declared to *be* stage 1's "Admin & Operations Portal," and it was built **ahead of** stage 3's own stated maturity gate |

**Conclusion for Part A:** the current single Admin Web is best described as a **pre-roadmap,
ungoverned implementation** that exists in the gap between a superseded one-portal model and an
un-designed five-portal model. No document resolves which of the five future portals, if any,
`apps/admin-web` is meant to become, or whether it should be split. This is not guessed — it is
reported as an open gap.

---

## PART B — What FINANCE_ADMIN is supposed to represent for V1 today

Reusing `V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01` §1–§3 as the primary evidence base (not
re-litigated here), with direct answers:

- **Is FINANCE_ADMIN intentionally the temporary top-level administrator?**
  **Yes, of the currently-implemented A2 workforce system specifically** — not of the platform
  in perpetuity. It is schema-locked as the sole holder of `administrativeCapability`
  (`workforce-configuration.ts:50-55`), structurally singular, and the sole gatekeeper for
  creating the other three roles (`finance-role-administration.service.ts`). Simultaneously,
  ADR-0092 and the B9 handoff document describe this entire arrangement as "interim," pending a
  separate, unbuilt platform. Both are true, about different time horizons (already established).

- **What does "administrator" mean in the current architecture?**
  Precisely: the principal who may (a) exist as the sole holder of `administrativeCapability`,
  (b) directly grant the *first* assignment of each of the three non-admin finance roles, and
  (c) initiate `FINANCE_ROLE_ASSIGN`/`FINANCE_ROLE_REVOKE` for a `FINANCE_CONTROLLER` to approve.
  That is the **entire, literal scope of "administrator" as coded.** It does not mean "operator
  of all back-office functions" by design — that broader reach (established in the prior audit,
  §2.2) is a side effect of weak, principal-type-only route gating shared by all four finance
  roles, not a deliberate expansion of "administrator" to cover non-finance domains.

- **What domains is FINANCE_ADMIN supposed to control?** Per its own declared
  `applicableActions` (`["FINANCE_ROLE_ASSIGN","FINANCE_ROLE_REVOKE"]`) and scope
  (`"privileged:execute"`): **the Finance role-administration domain only.**

- **What domains should remain outside FINANCE_ADMIN?** The repository does not say explicitly
  — this is one of the open gaps this task was commissioned to surface (see Part H/I). What can
  be said with evidence: nothing in FINANCE_ADMIN's own declared scope, description, or the ADRs
  describes it as intended to administer agents, customers, support, products, fees,
  commissions, rewards, limits, or aggregators. Its reach into those domains today is explained
  entirely by route-policy mechanics (Part C), not by any document describing FINANCE_ADMIN as
  their owner.

- **Is its current authority intentionally broad, or merely a consequence of the interim
  architecture?** **The latter, on the evidence.** No document states "FINANCE_ADMIN should be
  able to suspend agents" or "FINANCE_ADMIN should be able to provision SUPPORT workforce
  users." The breadth traces to one line of code,
  `type: roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' : 'OPERATOR'`
  (`workforce-session.service.ts:152`), combined with route branches that accept `OPERATOR` and
  `PRIVILEGED` interchangeably almost everywhere outside the Finance-role-administration
  endpoints themselves. No new role is proposed here, per instruction.

---

## PART C — Role authorization matrix

**Methodology and evidence strength, stated up front:** cells for `FINANCE_ADMIN` marked
"Live-verified 200" come from real HTTP testing performed in the prior
`V1-ADMIN-FULL-SURFACE-AUDIT-01` session (Category: real HTTP, against the locally seeded
admin). No OIDC provider or seeded identity exists in this sandbox for
`FINANCE_PREPARER`/`FINANCE_CONTROLLER`/`FINANCE_AUDITOR`, so their cells are **derived from
static code** (route-policy-registry.ts branch conditions + the principal-type mapping in
`workforce-session.service.ts:152`), which is deterministic, unconditional code — not an
inference from convention. These cells are marked "Derived (OPERATOR type)." This distinction is
preserved throughout the matrix rather than presenting both as equally strong evidence.

**Important finding applied throughout this matrix, per the task's explicit instruction not to
assume 200 = correctly authorized:** a "CURRENT RESULT" of reachable/200 does **not** imply
"CORRECT" — the "INTENDED V1 ACCESS" and "CORRECT?" columns are judged against what each role's
own declared `description`/`applicableActions` say it is for, not against what the route
currently allows.

| ROLE | DOMAIN | ROUTE/API | CURRENT AUTHORIZATION CHECK | CURRENT RESULT | INTENDED V1 ACCESS | CORRECT? | RECOMMENDED ACTION |
|---|---|---|---|---|---|---|---|
| FINANCE_ADMIN | Customers (list/create/read) | `GET/POST /customers`, `GET /customers/:id` | `allowedPrincipalTypes: [CUSTOMER,OPERATOR,SERVICE,PRIVILEGED]` (route-policy) | Live-verified 200 | Undocumented for this role | **Unclear — no documented intent** | Decide and document intended owner |
| FINANCE_PREPARER/CONTROLLER/AUDITOR | Customers (list/create/read) | same | same (type=OPERATOR matches) | Derived 200 | Undocumented | **Unclear** | Decide and document |
| FINANCE_ADMIN | Customer lifecycle/suspension | `PATCH /customers/:id` | `allowedPrincipalTypes: [OPERATOR,SERVICE,PRIVILEGED]` (SUPPORT explicitly denied) | Live-verified 200 | Plausibly an "operations" or "compliance" action, not finance-role-admin | **Questionable** — FINANCE_ADMIN's own scope says nothing about customer lifecycle | Decide intended owner; current gate is type-only |
| FINANCE_PREPARER/CONTROLLER/AUDITOR | Customer lifecycle/suspension | same | type=OPERATOR matches | Derived 200 | Undocumented; FINANCE_AUDITOR is "read-oriented assurance only" per its own description | **No — contradicts FINANCE_AUDITOR's documented purpose** | See Part D |
| All 4 roles | KYC / identity docs / profile / kyc-assessment | `GET/POST /customers/:id/kyc*`, `/profile`, `/identity-document` | same generic `/customers/:id` branch | FINANCE_ADMIN live-verified 200 (profile/wallet read); others derived | Plausibly "Compliance Portal" domain per roadmap | **Questionable fit for a Finance role** | Decide intended owner (Compliance?) |
| All 4 roles | Customer compliance cases | `/customers/:id/compliance-cases/*` (`customer-compliance.controller.ts`) | same generic `/customers/:id` branch | Derived (not live-tested this session) | Plausibly "Compliance Portal" domain | **Questionable fit for a Finance role** | Decide intended owner |
| All 4 roles | Customer risk profile | `/customers/:id/risk-profile*` | same generic `/customers/:id` branch | Derived | Plausibly "Compliance Portal" domain | **Questionable fit** | Decide intended owner |
| CUSTOMER principal only | Customer security/PIN administration | `/customers/me/transaction-pin*` | `allowedPrincipalTypes: [CUSTOMER]`, `customerAccess: SELF` | N/A — **no workforce role of any kind can reach this; no admin PIN-reset/admin path exists anywhere in the codebase** | Self-service only, by design (per `V1-BOOTSTRAP-AUDIT-01.md` §7) | **Correct as designed** (no admin override exists, deliberately) | None — confirms a clean boundary |
| All 4 roles | Customer wallets | `/customers/:id/wallets*` | generic `/customers/:id` branch, OPERATOR/SERVICE/PRIVILEGED (+ CUSTOMER self) | FINANCE_ADMIN live-verified 200 | Plausibly Finance or Operations | **Unclear** | Decide intended owner |
| All 4 roles | Agent directory/lifecycle (suspend/terminate/reactivate/activate) | `/internal/agents/*`, `/internal/admin/agents/*` | `allowedPrincipalTypes: [OPERATOR,SERVICE,PRIVILEGED]` (SUPPORT denied) — controller (`admin-agent-lifecycle.controller.ts:76-89`) checks only `principal.type`, never `principal.roles` | FINANCE_ADMIN live-verified 200 (per prior audit); others derived | Plausibly "Operations Portal" per roadmap (B5 Merchant/Agent platform) | **No — a Finance role suspending/terminating agents has no documented basis** | Decide intended owner; tighten if Operations-only is confirmed |
| All 4 roles | Agent applications, classes, credentials, funding/defund, outlets/terminals | `/internal/agents/applications/*`, `/internal/agents/classes`, `/internal/admin/agents/:id/credentials`, `/internal/agents/:id/fund\|defund`, outlets/terminals | OPERATOR/SERVICE/PRIVILEGED (some branches also allow SUPPORT) | Derived / partially live-verified (fund/defund, applications — prior audit) | Plausibly Operations/Merchant domain | **No clear Finance basis** | Decide intended owner |
| All 4 roles | Aggregators | `/internal/aggregators*` | `allowedPrincipalTypes: [SUPPORT,OPERATOR,SERVICE,PRIVILEGED]` | Live-verified 200 (prior audit) | Plausibly Operations/Merchant domain | **No clear Finance basis** | Decide intended owner |
| All 4 roles | SUPPORT workforce-user provisioning | `/internal/admin/support/workforce-users*` | `allowedPrincipalTypes: [OPERATOR,SERVICE,PRIVILEGED]` (SUPPORT cannot self-provision) | Derived | Plausibly an administrative-IAM (B9) concern, not Finance | **No — this is exactly the kind of "who administers workforce identities" question B9 is meant to own, yet it is reachable today by any finance role** | Flag as a security-relevant gap pending B9 |
| All 4 roles | Support tickets | `/internal/support/tickets*` | generic `/internal/` catch-all, `[SUPPORT,OPERATOR,SERVICE,PRIVILEGED]` | Live-verified 200 (prior audit) | Plausibly Operations/Support domain | **Weak basis for Finance roles specifically, but broad "any workforce" read/assign is plausibly intentional for a shared ticket queue** | Lower priority than agent lifecycle/SUPPORT provisioning |
| All 4 roles | Limit catalogue/assignment/operations | `/internal/limit-*` | `[OPERATOR,SERVICE,PRIVILEGED]` | Live-verified 200 (prior audit) | Plausibly Commercial/Finance | **Plausible fit, not clearly wrong** | Lower priority |
| Nobody | Limit evaluate (runtime) | `POST /limits/evaluate` | Final catch-all, `requiredScopes: ['internal:access']` — granted to no role | 401/403 for everyone | Should be reachable by *something* (runtime pricing/limit engine) | **Broken, not a role-scoping issue** | Separate engineering fix (not this task) |
| All 4 roles | Product catalogue, product governance | `/internal/products*`, `/internal/product-governance*` | `[OPERATOR,SERVICE,PRIVILEGED]` / generic catch-all | Live-verified 200 (products, prior audit); governance derived | Plausibly Commercial/Finance | **Plausible fit** | Lower priority |
| All 4 roles | Fee rule registry | `/internal/fee-rules*` | `[OPERATOR,SERVICE,PRIVILEGED]` | Live-verified 200 (prior audit) | Finance/Commercial | **Plausible fit** | Lower priority |
| Nobody | Fee calculate (runtime) | `POST /fees/calculate` | Final catch-all, `internal:access`, granted to no role | 401/403 for everyone | Should be reachable | **Broken, not a role-scoping issue** | Separate engineering fix |
| All 4 roles | Commission rule registry/resolver | `/internal/commission-rules*` | `[OPERATOR,SERVICE,PRIVILEGED]` | Live-verified 200 (prior audit) | Finance/Commercial | **Plausible fit** | Lower priority |
| All 4 roles | Reward rule registry/resolver | `/internal/reward-rules*` | `[OPERATOR,SERVICE,PRIVILEGED]` | Live-verified 200 (prior audit) | Finance/Commercial | **Plausible fit** | Lower priority |
| All 4 roles | Commercial decision snapshots | `/internal/commercial-decision*` | `[OPERATOR,SERVICE,PRIVILEGED]` | Live-verified 200 (prior audit) | Finance/Commercial | **Plausible fit** | Lower priority |
| All 4 roles | Capability registry | `/internal/capabilities*` | `[SUPPORT,OPERATOR,SERVICE,PRIVILEGED]`, read-only | Live-verified 200 (prior audit) | Shared infrastructure, read-only | **Low risk regardless of role** | None |
| Nobody | Ledger accounts/journals/reversal | `/ledger/*` | Final catch-all, `internal:access`, granted to no role | 401/403 for everyone — **Admin Web's Ledger screen is broken** | Finance/Treasury, core | **Broken — not a role-scoping issue, a missing-scope-grant issue** | Separate engineering fix (not this task; previously documented in Task 13) |
| Nobody | Transfers/Deposits/Withdrawals (detail + lifecycle actions) | `/transfers/:id`, `/deposits/:id(...)`, `/withdrawals/:id(...)` | Final catch-all, `internal:access`, granted to no role | 401/403 — **Admin Web's Transaction Observability screen is broken** | Finance/Operations, core | **Broken — same root cause as Ledger** | Separate engineering fix |
| All 4 roles | Reconciliation report/trial-balance/finance/account-activity | `/internal/reconciliation/*` | generic `/internal/` catch-all, `[SUPPORT,OPERATOR,SERVICE,PRIVILEGED]` | Live-verified 200 (prior audit) | Finance/Treasury | **Plausible fit, broadly readable** | Lower priority |
| All 4 roles | Audit, Outbox, Metrics, Diagnostics | `/internal/audit`, `/internal/outbox`, `/internal/metrics`, `/internal/diagnostics` (`operations.controller.ts`) | generic `/internal/` catch-all | Live-verified 200 (prior audit) | Shared observability (Operations/C2 Observability) | **Plausible fit, low risk (read-only)** | None high-priority |
| All 4 roles | Admin notifications (deliveries) | `/internal/notifications/deliveries` | generic `/internal/` catch-all | Derived | Shared observability | **Low risk** | None |
| FINANCE_ADMIN only (by business rule, not route policy) | Finance role administration (assign/revoke) | `POST/DELETE /internal/a2/workforce/roles` | Route: authenticated-only (`WORKFORCE_SESSION`); **business logic** in `finance-role-administration.service.ts` enforces FINANCE_ADMIN-only initiation | Live-verified 200 for FINANCE_ADMIN | Exactly FINANCE_ADMIN, by design | **Correct — this is the one domain with real, role-specific (not just type-based) enforcement** | None |
| FINANCE_CONTROLLER only (by business rule) | Privileged approvals (approve) | `POST /internal/a2/workforce/approvals/:id/approve` | Route: authenticated-only; maker-checker rule requires `checkerEligible` role | Not independently live-tested this session; prior audit confirms rule exists | Exactly FINANCE_CONTROLLER (or any checker-eligible role for the governed action) | **Correct — role-specific enforcement exists here too** | None |

---

## PART D — FINANCE_AUDITOR boundary assessment

**Declared intent** (`A2_FINANCE_ROLES_JSON`, both `.env.example` and the production template):
`description: "Read-oriented assurance role"`, `scopes: ["finance:audit"]`,
`applicableActions: []`, `makerEligible: false`, `checkerEligible: false`,
`approvalCapability: false`, `administrativeCapability: false`.

**Does the current implementation actually enforce "read-only"? No — not outside the narrow
Finance-role-administration domain.**

Tracing the evidence precisely:

- `principal.type` for a FINANCE_AUDITOR-only identity is `OPERATOR`
  (`workforce-session.service.ts:152` — true for anyone not holding `FINANCE_ADMIN`).
- `finance-role-administration.service.ts` **does** correctly block FINANCE_AUDITOR from
  `FINANCE_ROLE_ASSIGN`/`REVOKE` (it checks `initiatingRoles`/`approvingRoles` from
  `A2_MAKER_CHECKER_RULES_JSON`, which name only `FINANCE_ADMIN` and `FINANCE_CONTROLLER`) and
  from `FINANCE_CONTROL_POLICY_ACTIVATE` (named initiator is `FINANCE_PREPARER` only). **This one
  domain is correctly enforced for FINANCE_AUDITOR.**
- **Everywhere else**, the route/controller layer checks only `principal.type ===
  'OPERATOR'/'SERVICE'/'PRIVILEGED'`, never `principal.roles` or `principal.scopes`. Since
  FINANCE_AUDITOR's type is `OPERATOR`, and the overwhelming majority of `/internal/**` write
  routes accept `OPERATOR`, **a FINANCE_AUDITOR-only identity would, per the code as written, be
  authorized to:**

| Action class | Route(s) | Can FINANCE_AUDITOR reach it per code? |
|---|---|---|
| Suspend/terminate/reactivate/activate an agent | `POST /internal/agents/:id/{suspend,terminate,reactivate,activate}`, `/internal/admin/agents/:id/...` | **Yes** — `requireOperational()` checks only `principal.type` |
| Mutate a customer's lifecycle status (activate/suspend/close) | `PATCH /customers/:id` | **Yes** — route policy allows `OPERATOR` |
| Create a customer wallet | `POST /customers/:id/wallets` | **Yes** — generic `/customers/:id` branch allows `OPERATOR` |
| Record a KYC assessment | `POST /customers/:id/kyc-assessment` | **Yes** — same branch |
| Provision a SUPPORT workforce user | `POST /internal/admin/support/workforce-users` | **Yes** — allows `OPERATOR` |
| Fund/defund an agent wallet | `POST /internal/agents/:id/fund` or `/defund` | **Yes** — allows `OPERATOR` |
| Issue/reissue agent or customer credentials | `POST /internal/admin/agents/:id/credentials`, `/internal/admin/customers/:id/credentials` | **Yes** — allows `OPERATOR` |
| Write a fee rule, commission rule, reward rule, or product record | `/internal/fee-rules`, `/internal/commission-rules`, `/internal/reward-rules`, `/internal/products` (POST/PATCH variants) | **Yes** — allows `OPERATOR` |
| Modify a limit catalogue entry or assignment | `/internal/limit-*` (POST/PATCH variants) | **Yes** — allows `OPERATOR` |
| Assign or revoke a FINANCE_* role | `POST/DELETE /internal/a2/workforce/roles` | **No** — correctly blocked by business-rule `initiatingRoles`/`approvingRoles` checks |
| Approve a privileged action | `POST /internal/a2/workforce/approvals/:id/approve` | **No** — correctly blocked by `checkerEligible` business rule |
| Initiate a reversal / activate a finance control policy | `FINANCE_CONTROL_POLICY_ACTIVATE` action | **No** — correctly blocked; named initiator is `FINANCE_PREPARER` only |

**This has not been reproduced over live HTTP** (no FINANCE_AUDITOR OIDC identity exists in
this sandbox to test with — flagged honestly, per the instruction not to assume 200 proves
anything without evidence, and equally not to assume code tracing proves nothing). The
unconditional nature of the code (`roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' : 'OPERATOR'`,
and `requireOperational()`'s plain `principal.type` check) makes this a deterministic, not
probabilistic, finding — not fixed in this task per instruction.

**Summary: FINANCE_AUDITOR's "read-oriented assurance only" description is accurate for the
Finance-role-administration domain specifically, and inaccurate everywhere else in the
`/internal/**` surface.** This is the single most concrete, named security gap this audit
identifies.

---

## PART E — Maker/checker matrix

(Unchanged from `V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01` §5, re-verified at this commit; the only
code governing maker/checker is `A2_MAKER_CHECKER_RULES_JSON` plus
`finance-role-administration.service.ts`.)

| Governed action | Initiating role(s) | Approving role(s) | Min approvals | Self-approval | Covers |
|---|---|---|---|---|---|
| `FINANCE_ROLE_ASSIGN` | `FINANCE_ADMIN` | `FINANCE_CONTROLLER` | 1 | Prohibited | Role assignment |
| `FINANCE_ROLE_REVOKE` | `FINANCE_ADMIN` | `FINANCE_CONTROLLER` | 1 | Prohibited | Role revocation |
| `FINANCE_CONTROL_POLICY_ACTIVATE` | `FINANCE_PREPARER` only | `FINANCE_CONTROLLER` | 1 | Prohibited | Finance control policy activation |

**No maker/checker rule exists for:** reversal requests specifically (the Admin Web
`LedgerOperationsScreen` calls a generic `POST /internal/a2/workforce/approvals/request` for a
journal reversal, which is a *generic* privileged-approval request, not a dedicated
`FINANCE_REVERSAL_*` action with its own named rule — it is governed only by whatever
`requestApproval`'s own validation requires, and the underlying `/ledger/journals/:id/reversal`
endpoint itself is unreachable by anyone per Part C's Ledger finding, which makes the
reversal-approval UI flow partially moot in practice today); agent lifecycle actions; customer
lifecycle actions; SUPPORT provisioning; or any product/fee/commission/reward/limit registry
write. These are all single-step, type-gated only (no maker, no checker) by design of the route
layer, not by an explicit maker/checker rule that was consciously scoped to exclude them.

**UI visibility vs. backend authorization disagreement (carried forward from the prior audit,
re-confirmed at this commit):**

| Screen | UI visibility gate | Backend authorization | Disagreement |
|---|---|---|---|
| Finance Role Admin (`RoleAssignmentScreen`) | `isAdmin` = `FINANCE_ADMIN` role or `privileged:execute` scope (`Layout.tsx:17`) | `finance-role-administration.service.ts` enforces FINANCE_ADMIN-only initiation | **No disagreement** — matches |
| Privileged Approvals (`ApprovalsScreen`) | `isController` = `FINANCE_CONTROLLER` role or `privileged:approve` scope (`Layout.tsx:18`) | Approval requires `checkerEligible` role | **No disagreement**, but consequence: the current seeded FINANCE_ADMIN identity (scope `privileged:execute` only) **can never see this screen**, even though `LedgerOperationsScreen` (visible to FINANCE_ADMIN) calls `POST /internal/a2/workforce/approvals/request` to *create* an approval it can then never view or action in the UI |
| Ledger, Transactions, Reconciliation, Customers | `isOperator` = any role at all (`Layout.tsx:19`, `principal.roles.length > 0`) | Backend: Ledger/Transactions routes require `internal:access` (granted to nobody — broken for everyone); Reconciliation/Customers work for any `OPERATOR/SERVICE/PRIVILEGED` | **Disagreement for Ledger/Transactions**: UI shows these screens as if usable to any of the 4 finance roles, but the backend silently fails (401/403) for all of them |

---

## PART F — Admin Web information architecture (derived, not designed)

"OWNER PORTAL" below is a **best-evidence inference from the domain's content against the
5-portal roadmap names** (Finance Platform = B2, Merchant/Agent = B5, Fraud/AML = B4, Reporting
= B6, Configuration = B8, Administrative IAM = B9) — the roadmap does not itself map individual
capabilities to portals, so this column is explicitly marked where it is inferred rather than
stated, per the instruction not to assume.

| MENU/MODULE | OWNER PORTAL (inferred unless noted) | INTENDED ROLE(S) | CURRENT BACKEND CAPABILITY | CURRENT ADMIN-WEB SCREEN | VISIBLE? | FUNCTIONAL? | MISSING? | V1 REQUIRED? | SOURCE/EVIDENCE |
|---|---|---|---|---|---|---|---|---|---|
| Dashboard / operational overview | Admin Portal (generic) | Undocumented | Partial (metrics/diagnostics/outbox endpoints exist) | `DashboardScreen.tsx` | Yes | **No real data — static placeholder** (prior audit: stale "outbox not available" text, no API calls at all) | Needs real wiring | Yes, in some form | `DashboardScreen.tsx` has zero `ApiClient` calls (grepped this session) |
| Customer directory, KYC, wallets | **Inferred: split between Compliance Portal (KYC/compliance-cases/risk-profile) and Finance/Operations (wallets, lifecycle)** | Undocumented | Full (`customer.controller.ts`, `customer-compliance.controller.ts`, `customer-risk-profile.controller.ts`, `customer-wallet.controller.ts`) | `CustomerDirectoryScreen.tsx` | Yes | Partially — list/create/PATCH/wallets/KYC-read/KYC-assessment work; compliance-cases and risk-profile have **no UI at all** | Compliance-cases, risk-profile UI | Yes for core servicing; compliance-cases/risk-profile arguably V1 Compliance Portal scope | `CustomerDirectoryScreen.tsx` API calls (this session) |
| Customer PIN/security administration | N/A — by design, self-service only | N/A (no admin role) | Self-service only (`customers/me/transaction-pin*`) | None | No | N/A | **Not missing — intentionally absent** | No | `route-policy-registry.ts` `/customers/me/*` branch; `V1-BOOTSTRAP-AUDIT-01.md` §7 |
| Ledger accounts/journals/reversal | Finance Platform (B2) / Treasury (B3) | Undocumented, but clearly finance-domain | Full backend (`ledger.controller.ts`) | `LedgerOperationsScreen.tsx` | Yes | **No — broken, 401/403** (`internal:access` scope granted to nobody) | Fix the scope gap, or accept as documented known-broken | Yes — core ledger visibility is clearly V1-necessary | Prior audit; this session's re-confirmation of `/ledger/*` → final catch-all |
| Transaction observability (deposits/withdrawals/transfers detail) | Finance/Operations | Undocumented | Full backend | `TransactionObservabilityScreen.tsx` | Yes | **No — broken, same root cause as Ledger** | Same fix | Yes | This session: screen calls `/deposits/:id`, `/withdrawals/:id`, `/transfers/:id` |
| Reconciliation report / trial balance / finance / account activity | Finance Platform (B2) / Reporting (B6) | Undocumented | Full (`reconciliation.controller.ts`) | `ReconciliationObservabilityScreen.tsx` | Yes | **Yes — works** | Breaks-specific UI (if breaks are a distinct report section) not separately verified | Yes | This session: screen calls `/internal/reconciliation/report`, `/trial-balance` |
| Finance role administration | Administrative IAM (B9 — currently housed inside A2 as interim) | `FINANCE_ADMIN` (initiate), `FINANCE_CONTROLLER` (approve) | Full | `RoleAssignmentScreen.tsx` | Yes (FINANCE_ADMIN only, `isAdmin` gate) | Yes | No | Yes | `Layout.tsx:17,90-97`; `finance-role-administration.service.ts` |
| Privileged approvals | Administrative IAM / cross-cutting | `FINANCE_CONTROLLER` (or any checker-eligible role) | Full | `ApprovalsScreen.tsx` | **Invisible to the current seeded FINANCE_ADMIN identity** (`isController` gate requires `FINANCE_CONTROLLER`/`privileged:approve`) | Yes, for roles that can see it | No | Yes | `Layout.tsx:18,99-106` |
| Agent directory & lifecycle (suspend/terminate/reactivate/activate, applications, classes, credentials, funding, outlets/terminals) | **Inferred: Merchant/Agent Platform (B5) / Operations Portal** | Undocumented | Full (`admin-agent-lifecycle.controller.ts` + 6 other agent-admin controllers) | **None** | No | N/A | **Yes — entire domain has zero Admin Web UI** | Likely yes for V1 operations | Prior audit (zero-UI finding); this session's controller inventory |
| Aggregators | Inferred: Merchant Platform (B5) | Undocumented | Full (`aggregator.controller.ts`, `admin-aggregator.controller.ts`) | None | No | N/A | Yes — zero UI | Plausibly V1 | Prior audit; this session |
| Support (tickets, workforce-user provisioning) | Inferred: Operations Portal | Undocumented | Full (`support-internal.controller.ts`, `admin-support-credentials.controller.ts`) | None | No | N/A | Yes — zero UI | Plausibly V1 | Prior audit; this session |
| Limits (catalogue/assignment/operations) | Inferred: Commercial/Finance (B1/B2) | Undocumented | Full (`limit-catalog.controller.ts` + 2 others) | None | No | N/A | Yes — zero UI | Plausibly V1 | Prior audit |
| Products (catalogue, governance) | Inferred: Commercial Platform (B1) | Undocumented | Full (`product-catalog.controller.ts`, `product-governance.controller.ts`) | None | No | N/A | Yes — zero UI | Plausibly V1 | This session's controller inventory |
| Fee rules, commission rules, reward rules | Inferred: Commercial Platform (B1) | Undocumented | Full (6 controllers) | None | No | N/A | Yes — zero UI | Plausibly V1 | Prior audit |
| Commercial decision snapshots | Inferred: Commercial Platform (B1) | Undocumented | Full | None | No | N/A | Zero UI, but this is read-only evidence, lower priority | Lower priority for V1 | Prior audit |
| Capability registry | Shared infrastructure | Undocumented | Full, read-only | None | No | N/A | Low priority (internal diagnostic concept) | Not necessarily | Prior audit |
| Audit, Outbox, Metrics, Diagnostics | Inferred: Observability (C2) | Undocumented | Full (`operations.controller.ts`) | **Dashboard has a stale placeholder referencing "outbox," not a real view** | Partially | No | Yes — zero *real* UI despite Dashboard's placeholder text | Plausibly V1 for audit/outbox at minimum | Prior audit |
| Admin notifications (deliveries) | Inferred: Operations | Undocumented | Full (`admin-notification.controller.ts`) | None | No | N/A | Zero UI | Lower priority | This session |
| Customer funding (internal view) | Inferred: Finance/Operations | Undocumented | Full (`customer-funding-internal.controller.ts`) | None | No | N/A | Zero UI | Lower priority | This session |
| Maturity, Production/readiness controllers | Infrastructure/deployment, likely never an Admin Web concern | N/A | Full | None | No | N/A | **Backend-only infrastructure, likely intentionally so** | No | This session |
| Fee calculate / Limit evaluate (runtime simulators) | N/A — broken | N/A | Backend exists but unreachable (`internal:access` scope gate) | `TransactionObservabilityScreen.tsx` has an inert "fee engine simulator" note | N/A | **No — broken for everyone** | Engineering fix, not a role/UI question | Only if the engines should be admin-exposed at all | This session's route trace |

---

## PART G — "Where did everything we built go?"

| CAPABILITY | Backend exists? | Admin UI exists? | Another portal should likely own it? | Intentionally backend-only? | V1 or V2? | Missing UI? | Blocked? |
|---|---|---|---|---|---|---|---|
| Customers (directory, lifecycle, KYC) | Yes | Yes (partial) | Compliance Portal (KYC/compliance-cases specifically) | No | V1 | Compliance-cases/risk-profile UI | No |
| Wallets | Yes | Yes (as a sub-view of Customer Directory) | Finance | No | V1 | Standalone wallet admin view | No |
| W2W transfers (customer self-service) | Yes (`customers/me/transfers`) | No (by design — customer self-service, not an admin concern) | N/A | Arguably yes for the transfer-creation action itself | V1 | Admin *observability* view is the broken `/transfers/:id` route | **Yes — blocked (`internal:access`)** |
| Cash-in / Cash-out / Cash-to-cash (agent-mediated) | Yes (`agent-cash-in/out/to-cash*.controller.ts`) | No | Operations/Merchant Platform | No | V1 | Yes — zero admin visibility into agent cash transactions | No (agent-side works; just no admin view) |
| Agents (lifecycle, applications, classes, credentials, funding, outlets) | Yes, extensively | **No** | Merchant Platform (B5) / Operations | No | V1 (agent domain is clearly implemented, not a V2 stub) | **Yes — entire domain** | No (backend works; UI absent) |
| Aggregators | Yes | No | Merchant Platform (B5) | No | V1 foundation (login deliberately deferred — separate, already-documented V1-SCOPE-CHALLENGE-01 decision) | Yes | No |
| Fees (registry + runtime calc) | Yes | No | Commercial (B1) | Registry: no. Runtime `fees/calculate`: **yes, broken**, not intentional | V1 | Yes | Runtime calc **yes, blocked** |
| Commissions | Yes (registry + resolver) | No | Commercial (B1) | No | V1 (schema foundation; "no runtime commission charging exists" per route-policy-registry.ts comments — i.e. partially intentional incompleteness, not purely a UI gap) | Yes | No |
| Limits (catalogue/assignment + runtime evaluate) | Yes | No | Commercial/Finance | Catalogue: no. Runtime `limits/evaluate`: **yes, broken** | V1 | Yes | Runtime evaluate **yes, blocked** |
| Products (catalogue + governance) | Yes | No | Commercial (B1) | No | V1 | Yes | No |
| Reconciliation | Yes | **Yes, working** | Finance/Reporting | No | V1 | No | No |
| Ledger (accounts/journals/reversal) | Yes | Yes, but **broken** | Finance/Treasury | No — this is core V1 infrastructure | V1 | N/A (UI exists, backend unreachable) | **Yes — blocked (`internal:access`)** |
| Reversals (approval flow for ledger reversal) | Partially — generic approval request exists; the underlying reversal endpoint is blocked | Yes, inside Ledger screen | Finance | No | V1 | N/A | **Yes — downstream of the Ledger block** |
| Privileged approvals | Yes | Yes, but invisible to the only seeded role (FINANCE_ADMIN) | Cross-cutting / Administrative IAM | No | V1 | No (exists; visibility gap only) | No (works for FINANCE_CONTROLLER) |
| Audit | Yes | No (Dashboard has only a stale text placeholder) | Observability (C2) | Partially — read-only audit trail is plausibly V1-visible | V1 | Yes | No |
| Outbox | Yes | No (same stale placeholder) | Observability (C2) | Plausibly backend-only/ops-only | Unclear | Yes, if intended for admin visibility | No |
| Notifications (admin deliveries view) | Yes | No | Operations | Plausibly backend-only | Unclear | Maybe | No |
| Support (tickets, workforce provisioning) | Yes | No | Operations | No | V1 | Yes | No |
| KYC / compliance cases / risk profile | Yes | Partial (KYC read+assessment only; compliance-cases and risk-profile have no UI) | Compliance Portal | No | V1 | Yes, for compliance-cases/risk-profile | No |
| Customer transaction PIN | Yes (self-service) | No admin UI exists or should exist | N/A | **Yes, intentionally self-service-only** | V1 | No — this is a correct boundary, not a gap | No |
| Workforce administration (SUPPORT user provisioning) | Yes | No | Administrative IAM (B9, currently ad hoc) | No | V1 implemented, but conceptually a B9-shaped concern | Yes | No |
| Finance role administration | Yes | Yes | Administrative IAM (B9, currently housed in A2) | No | V1 | No | No |

**This directly answers "if I am the administrator of MonieNaija, where do I go to see/manage
this?":** for roughly two-thirds of the capabilities table above, **the honest current answer is
"nowhere in the UI — only via direct API call."** The gap is not evenly distributed: Finance
Role Admin, Privileged Approvals, Reconciliation, and (partially) Customer servicing are
genuinely reachable in the UI today; Agents, Aggregators, Support, Limits, Products,
Fees/Commissions/Rewards registries, Audit, and Outbox are fully built on the backend and have
**zero** Admin Web presence; and Ledger/Transactions have UI that is present but non-functional
due to a scope-grant gap unrelated to roles.

---

## PART H — Decision required

Evaluated against the four offered outcomes:

- **(1) FINANCE_ADMIN is intentionally the V1 platform administrator, and Admin Web should
  expose the appropriate platform-wide administrative surface.** Not supported as stated —
  FINANCE_ADMIN's own declared scope is narrow (role administration only); its broad reach is
  incidental (Part B), not an intentional platform-admin design.
- **(2) FINANCE_ADMIN is only a finance administrator, and V1 requires a separate platform
  administrator role.** Partially supported in spirit (FINANCE_ADMIN's *declared* scope is
  finance-administration-only) but the specific prescription ("requires a separate platform
  administrator role **now**") is not evidenced — the repository's own stated path for "a
  separate, more complete authority" is B9, which is explicitly sequenced far in the future, not
  an immediate V1 ask.
- **(3) The V1 architecture intentionally uses a combined/interim administrator model until B9,
  and this is acceptable for V1 provided authorization boundaries are tightened.** **Best
  supported by the evidence**, with one caveat: the repository documents the *interim* nature of
  the model (ADR-0092, B9 handoff) but **never states that the current, uncontrolled breadth of
  non-finance access is an accepted, reviewed risk** — it is simply a byproduct nobody appears to
  have evaluated against FINANCE_AUDITOR's "read-only" description (Part D). So the "interim
  model is acceptable" half is well-evidenced; the "provided authorization boundaries are
  tightened" half is a forward-looking recommendation, not something the repository has already
  decided.
- **(4) The current documents conflict and an explicit product-owner decision is required
  before further Admin Web implementation.** **Also well supported**, specifically for the
  portal-architecture question (Part A: one combined portal vs. five separate portals is
  genuinely unresolved) and for the FINANCE_AUDITOR boundary question (Part D: nobody has
  decided whether the current broad reach is acceptable).

**Conclusion: the evidence best supports a combination of (3) and (4), not a clean single
answer** — the *role* question leans toward "(3), interim and acceptable, pending tightening,"
while the *portal/IA* question and the *FINANCE_AUDITOR-specific* question are squarely "(4),
needs an explicit decision." This report does not force a single outcome where the evidence
supports two different, compatible conclusions on two different sub-questions.

---

## PART I — Security decision on the OPERATOR/principal-type model

Options and consequences, evaluated without choosing one (per instruction):

**A. Tighten role-level authorization now, across all domains.**
- *Consequences:* Closes the FINANCE_AUDITOR/PREPARER/CONTROLLER over-reach immediately
  everywhere. Highest implementation cost and risk — touches every `/internal/**` route policy
  and every admin controller's authorization check; broad surface for regressions; requires
  deciding, for each of ~20 domains, which of the 4 finance roles (if any) should retain access,
  which the repository currently has **no documented answer for** (Part F/G — most "INTENDED
  ROLE(S)" cells are "Undocumented"). Risks blocking legitimate current usage if done without
  that product decision first.

**B. Explicitly accept the broader access as a documented interim risk until B9.**
- *Consequences:* Zero implementation cost or regression risk. Consistent with how the
  repository already treats the rest of A2T11 ("interim," "bounded," pending B9). Leaves the
  FINANCE_AUDITOR "read-oriented assurance only" claim factually false in practice for as long as
  the acceptance stands — acceptable only if explicitly and visibly documented (e.g. an ADR)
  rather than left as an undocumented gap the next UAT cycle rediscovers, as happened with this
  very task.

**C. Tighten only high-risk domains now (e.g. agent suspend/terminate, SUPPORT workforce-user
provisioning, customer lifecycle mutation) while leaving lower-risk read surfaces (reconciliation
reads, capability registry, audit, metrics) broad.**
- *Consequences:* Meaningfully reduces the sharpest edges of Part D's findings (an auditor-only
  identity being able to suspend an agent or provision a SUPPORT user) at a fraction of option
  A's cost. Still requires the same prerequisite product decision as A for the specific domains
  chosen — "high-risk" is this report's own reasonable-sounding grouping, not something the
  repository has defined, so even this narrower scope needs confirmation before implementation.
- This option most directly follows the instruction to distinguish real risk gradients rather
  than treating all 20+ domains as equally urgent, and is the one this report would flag as
  **most proportionate** if a single implementation direction is wanted later — but it is still
  presented as an option for decision, not a recommendation to execute now.

**D. Require a product/security decision before changing anything.**
- *Consequences:* No immediate risk reduction, but avoids a costly tightening pass built on
  undocumented assumptions about "intended role," which Part F/G shows mostly don't exist yet.
  Given that the role→domain intent is undocumented for the large majority of cells in Part C's
  matrix, **some version of D logically has to precede A or C regardless** — the "high-risk
  domain" list in C, for example, cannot be finalized without first deciding what each role is
  supposed to be for outside Finance.

**This report does not select one of A/B/C/D as "the" answer** — that is the explicit
product/security decision this task was commissioned to surface, not resolve.

---

## PART J — Recommended implementation sequence (not started)

1. **Product decision, not code:** resolve Part A (one portal vs. five; what `apps/admin-web`
   is/becomes) and Part H/I (accept interim breadth vs. tighten, and which domains if tightening)
   as an explicit, written decision (ADR-shaped), *before* touching authorization or Admin Web
   again.
2. **Authorization/security fixes** (only after step 1 names which domains, if any, should be
   narrowed): scoped to whatever the decision in step 1 selects — ranging from "document and
   accept" (near-zero code) to "add role-specific checks to agent lifecycle, SUPPORT
   provisioning, and customer lifecycle" (moderate, targeted code change).
3. **Portal/menu architecture** (only after step 1 confirms whether Admin Web stays single or is
   the first slice of a split): define, as a design artifact, which of the Part F/G capabilities
   belong in which portal going forward — this is an information-architecture decision document,
   not UI code.
4. **Missing Admin UI** for whatever step 3 assigns to "Admin Portal" scope (candidates per Part
   G: Agents, Aggregators, Support, at minimum, since they are fully built and entirely
   UI-invisible today).
5. **Missing Finance UI**: a real Ledger/Transaction view once the `internal:access` scope-grant
   gap (a pre-existing, already-documented defect, not introduced by this task) is separately
   fixed as an engineering item — fixing the *scope grant* is not itself a role/portal decision
   and can proceed independently of steps 1–4 if desired, since it only restores already-intended
   reachability rather than granting anything new.
6. **Missing Operations UI**: Support tickets, SUPPORT workforce provisioning, agent cash-in/out
   observability, Audit/Outbox real views (replacing the Dashboard's stale placeholder).
7. **Missing Compliance UI**: customer compliance-cases, risk-profile — currently fully built on
   the backend with zero UI.
8. **Missing Treasury UI**: not clearly identified by this audit — no Treasury-specific backend
   domain (distinct from Ledger/Reconciliation) was found; likely not yet a V1-relevant gap,
   pending the step-1 decision on what "Treasury Portal" is meant to contain.
9. **B9 future architecture**: explicitly out of scope for any near-term sequencing — the
   roadmap places it seven platforms away, and this task does not propose starting it.

---

## FINAL REPORT

1. **Current V1 portal architecture:** one monolithic `apps/admin-web`, built ahead of and not
   mapped onto the authoritative 5-portal roadmap (Admin, Finance, Operations, Compliance,
   Treasury). The 5-portal split is named but not functionally defined anywhere (Part A).
2. **Authoritative sources and precedence:** `docs/decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md`
   is self-declared authoritative and controls over the older, explicitly superseded
   `"Admin & Operations Portal"` P1 label; the supersession itself is documented in
   `B2-ROADMAP-RECONCILIATION-HANDOFF.md` (Part A chronology).
3. **Current meaning of FINANCE_ADMIN:** the sole, structurally singular administrator of the A2
   Finance-role system itself (role assignment/revocation gatekeeper); its much broader practical
   reach into non-finance domains is an unintended consequence of principal-type-only route
   gating, not a documented design decision (Part B).
4. **Role authorization matrix:** Part C — ~20+ domains traced against all four roles, with
   evidence strength (live-verified vs. code-derived) stated per cell, and "correct?" judged
   against each role's own documented purpose rather than against whether the route currently
   returns 200.
5. **FINANCE_AUDITOR security assessment:** its "read-oriented assurance only" description is
   accurate solely within the Finance-role-administration domain; by current code, it can reach
   write/mutate endpoints across agent lifecycle, customer lifecycle, SUPPORT provisioning,
   credential issuance, and commercial-rule registries, because route authorization checks
   principal type, not role. Not fixed in this task (Part D).
6. **Maker/checker matrix:** three governed actions only (`FINANCE_ROLE_ASSIGN`,
   `FINANCE_ROLE_REVOKE`, `FINANCE_CONTROL_POLICY_ACTIVATE`); one UI/backend disagreement
   identified (Ledger/Transactions screens visible but non-functional for all four roles) (Part E).
7. **Complete capability → portal mapping:** Part F, with "owner portal" explicitly marked as
   inferred (not repository-stated) for every row except Finance Role Admin/Approvals.
8. **Complete capability → Admin Web mapping:** Part F, same table, visible/functional/missing
   columns.
9. **Where existing V1 functionality belongs:** Part F/G — roughly two-thirds of implemented
   backend capability (agents, aggregators, support, limits, products, fee/commission/reward
   registries, audit, outbox) has no Admin Web presence at all; Finance Role Admin, Approvals,
   Reconciliation, and partial Customer servicing are the functional minority.
10. **Missing Admin Web functionality:** agent administration, aggregator administration,
    support ticket/workforce-user management, limit/product/fee/commission/reward registries,
    real audit/outbox views, customer compliance-cases and risk-profile screens (Part F/G).
11. **Missing other-portal functionality:** no distinct Treasury-domain backend capability was
    identified separate from Ledger/Reconciliation; Compliance-specific screens (KYC
    assessment is partially covered, compliance-cases/risk-profile are not) are the clearest
    concrete gap outside "Admin" (Part G).
12. **Authorization risks:** FINANCE_AUDITOR/PREPARER/CONTROLLER's unintended reach into agent
    lifecycle, customer lifecycle, and SUPPORT provisioning (Part D); the Ledger/Transactions
    `internal:access` scope-grant gap is a functionality risk, not strictly an authorization-model
    risk, but it undermines UI trust and was re-confirmed this session (Part C/G).
13. **Product decisions required:** (i) what the single Admin Web is/becomes relative to the
    5-portal roadmap (Part A); (ii) whether to accept, tighten entirely, or selectively tighten
    the OPERATOR-type broad reach, and for which domains (Part H/I); (iii) whether
    FINANCE_AUDITOR's documented "read-only" intent should be enforced in code, accepted as
    aspirational-only, or redefined.
14. **Recommended implementation sequence:** product decision → scoped authorization fix →
    portal/menu architecture decision → missing Admin UI → missing Operations UI → missing
    Compliance UI → (Treasury UI, pending further definition) → B9 deferred indefinitely (Part J).
15. **Exact next implementation task (not started here):** a dedicated, narrowly-scoped product/
    architecture decision task — not an engineering task — that produces a written decision
    (ADR-shaped) resolving Part A (portal model) and Part H/I (authorization risk acceptance vs.
    tightening, and which domains), so that the *following* task can implement against a settled
    answer instead of inventing one. This report explicitly does not perform or pre-empt that
    decision.
