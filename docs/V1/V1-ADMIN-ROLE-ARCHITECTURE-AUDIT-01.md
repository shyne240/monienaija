# V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01 — Is FINANCE_ADMIN the Platform Administrator?

**Classification: AUDIT ONLY.** No source, schema, migration, authorization, UI, or seed
changes were made for this task. Every claim below is sourced to a specific file, line, or
quoted string in the repository as it exists at commit `a0018e961a3b513c45fef40d89071c7bc687b8f1`
(branch `arena/01a10374-monienaija`). Where the repository is silent, this report says so
explicitly instead of inferring an answer from generic fintech convention. This report
supersedes nothing and renames nothing; it reuses facts already established in
`docs/V1/V1-ADMIN-FULL-SURFACE-AUDIT-01-REPORT.md` where cited, re-verified live-code-current
against this commit.

**Trigger:** human Admin Web UAT observed that the only seeded local admin
(`admin@monienaija.local`) carries a single role, `FINANCE_ADMIN`, documented in its own
config as `"Initial privileged finance administration"` / `"System administrator with full
privileges"` (the latter phrase was the tester's paraphrase, not a literal repository string —
see §2.0), and asked whether that is the intended top-level administrator of MonieNaija or
whether a platform-wide `SUPER_ADMIN` role is missing from an incomplete role architecture.

---

## 1. Authoritative role design found in the repository

### 1.1 Exhaustive search results (verbatim, not inferred)

| Term searched | Result |
|---|---|
| `SUPER_ADMIN`, `SUPER ADMIN`, `SuperAdmin`, `super-admin` | **Zero matches anywhere in the repository** (source, tests, docs, config, archive — full-text, case-sensitive and case-insensitive). |
| `platform administrator`, `platform admin` | **Zero matches** in `docs/`. |
| `system administrator` | **Zero matches** in `docs/`. |
| `operations administrator` | **Zero matches** in `docs/`. |
| `back-office administrator` / `back office administrator` | **Zero matches** in `docs/`. |
| `"full privileges"`, `"System administrator"` (exact phrases) | **Zero matches anywhere** in source, tests, docs, `.env*`, or deployment templates. |
| `administrator` (generic) | Present in 18 files under `docs/`, all describing **FINANCE_ADMIN specifically** or OIDC-provider-side identity concepts — never a distinct higher role. |
| `FINANCE_ADMIN` | Present in 22 files under `docs/` plus `src/`, `test/`, `.env.example`. |
| `"workforce roles"` | Not found as a literal phrase; the governing concept is called the **"A2T11 Finance role vocabulary"** throughout. |

**Conclusion:** `SUPER_ADMIN` was never named, drafted, proposed, or rejected anywhere in this
repository's history. There is no dead code, no commented-out role, no ADR alternative, and no
docs/archive mention of it under any spelling. This is a documented absence, not an inference.

### 1.2 The actual, authoritative role vocabulary (code-enforced, not just documented)

`src/authorization/workforce-configuration.ts` is the single source of truth, and it is far
stricter than documentation alone — the role vocabulary is a **hard runtime invariant**:

```
const roleList = parseJson('A2_FINANCE_ROLES_JSON', ..., z.array(roleSchema).min(4).max(4), []);
...
if (REQUIRED_ROLES.some((role) => !roleKeys.includes(role)) ||
    roleKeys.some((role) => !REQUIRED_ROLES.includes(role)))
  throw invalid('A2_FINANCE_ROLES_JSON: exact A2T11 Finance role vocabulary required');
```
(`workforce-configuration.ts:238-249`, `REQUIRED_ROLES` defined at line 147 as exactly
`['FINANCE_ADMIN','FINANCE_PREPARER','FINANCE_CONTROLLER','FINANCE_AUDITOR']`).

The application **fails closed at startup** if the configured role set is anything other than
exactly these four keys — not three, not five. A fifth role (e.g. a hypothetical
`SUPER_ADMIN` or `WORKFORCE_ADMIN`) cannot be added via configuration alone; it requires a code
change to the schema, which this audit is explicitly forbidden from making and does not
recommend making casually (§10).

A second, even more pointed invariant exists on the same file:

```
if (role.administrativeCapability && role.roleKey !== 'FINANCE_ADMIN')
  context.addIssue({ ..., message: 'is reserved for FINANCE_ADMIN in A2T11' });
```
(`workforce-configuration.ts:50-55`)

This is restated as inline operator documentation in the production deployment template,
`docs/deployment/config/v1-workforce-bootstrap.env.template:80-82`:
> `# STRUCTURAL INVARIANTS enforced at startup (fail-closed): - exactly these four roles, no
> more, no fewer; - administrativeCapability=true is reserved for FINANCE_ADMIN; ...`

**Finding:** the "administrative" designation is not a documentation convention that happens to
be applied to FINANCE_ADMIN — it is a **compiled-in constraint** that forbids any other role key
from ever holding it while this code is unchanged. Within the currently implemented system,
FINANCE_ADMIN is *structurally* singular as "the" administrative role; there is no code path by
which a second administrative role could coexist with it today.

### 1.3 The authoritative long-range platform roadmap — a *separate*, future, unbuilt authority

`docs/decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md` (status: **authoritative**, effective
2026-08-09, supersedes older roadmap interpretations) lists the full platform sequence. Of
direct relevance:

```
PHASE B — BUSINESS PLATFORMS
  -> B1 Commercial Platform
  -> B2 Finance Platform
  -> B3 Treasury Platform
  -> B4 Fraud & AML
  -> B5 Merchant Platform
  -> B6 Reporting Platform
  -> B7 Statement Platform
  -> B8 Configuration Platform
  -> B9 Identity & Access Administration
  -> B10 Developer & Integration Platform
```

| Order | Platform | Authoritative responsibility (verbatim) |
|---|---|---|
| B9 | **Identity & Access Administration** | "Administrative IAM, access administration, role/entitlement administration, reviews, and privileged governance." |

Guardrail #9 in the same document: *"B9 owns administrative IAM."* Section 9 ("Immediate
sequencing decision") states the **next** authoritative implementation platform is **B2
Finance**, i.e. B9 is not merely unimplemented — it is explicitly **seven platforms away** in
the roadmap's own stated order (B2→B3→B4→B5→B6→B7→B8→B9), with no date or commitment.

**This is the closest thing in the repository to a documented "platform-wide administrator"
concept — and it is not called SUPER_ADMIN, it is a whole future *platform* (B9), not a role
name, and it does not exist today.**

### 1.4 The explicit, code-level link between today's FINANCE_ADMIN and the future B9

Three independent documents, plus production source code, all describe the *same* relationship
— today's FINANCE_ADMIN/A2 system is explicitly, deliberately **interim**, pending B9:

- **ADR-0092** (`docs/decisions/ADR/ADR-0092-A2-Workforce-and-Privileged-Authentication.md`),
  accepted, "Permanent administration owner: **B9 Identity & Access Administration**":
  - "Persist bounded interim assignments under A2; **B9 remains permanent administrator**."
  - "No B9 behavior is implemented."
- **A2-FINANCE-ROLE-ENTITLEMENT-AND-BOOTSTRAP-CONTRACT.md**: the document's own title calls the
  whole FINANCE_ADMIN/role system the *"A2T11 Interim Finance Role, Entitlement, and Bootstrap
  Contract"* — the word **"Interim"** is in the title.
- **A2-B9-WORKFORCE-IAM-HANDOFF.md** (entire document, 7 lines, quoted in full):
  > "A2T11 is an explicitly interim assignment authority... When B9 becomes operational **it
  > becomes permanent authority for role definitions, assignments, entitlements, reviews,
  > revocation, and privileged administration**... This document does not implement B9 or
  > authorize cutover."
- **Production source code itself** contains a method named `exportForB9()`
  (`src/authorization/finance-role-administration.service.ts:287`) whose entire purpose is to
  produce a deterministic export of A2's interim role-assignment history "for B9 migration" —
  i.e. the running application already carries a stub for a handoff to a system that does not
  exist yet.

**Finding:** the repository is internally consistent and unambiguous that the *entire* A2
Finance role system — FINANCE_ADMIN included — was never intended to be the platform's
permanent, final identity/access authority. It is a **deliberately bounded placeholder**,
explicitly pending a future B9 platform. This is evidence-based, not inferred from convention.

---

## 2. What FINANCE_ADMIN actually means — exact scopes, capabilities, route reach

### 2.0 Correcting the trigger phrasing

No file in the repository contains the literal string `"System administrator with full
privileges"`. The two actual descriptions on record for `FINANCE_ADMIN` are:

| Source | `description` field (verbatim) |
|---|---|
| `docs/deployment/config/v1-workforce-bootstrap.env.template:87` (production template) | `"Initial privileged finance administration; bootstrap-only granting."` |
| `.env.example:98` (local dev) | `"Local dev Finance Admin"` |

Both are narrower and more precise than "system administrator with full privileges." This
report treats the UAT tester's phrase as an accurate *functional summary of observed behavior*
(the role does reach broad `/internal/**` surface — see §2.2), not a quotation, and flags the
discrepancy rather than silently assuming either version is correct.

### 2.1 FINANCE_ADMIN's declared configuration (unchanged since Task 13, re-verified at this commit)

From `A2_FINANCE_ROLES_JSON` (identical in `.env.example` and the production template, differing
only in `displayName`/`description` text):

| Field | Value |
|---|---|
| `roleKey` | `FINANCE_ADMIN` |
| `scopes` | `["privileged:execute"]` |
| `applicableActions` | `["FINANCE_ROLE_ASSIGN", "FINANCE_ROLE_REVOKE"]` |
| `mfaRequired` | `true` |
| `approvalCapability` | `false` |
| `makerEligible` | `true` |
| `checkerEligible` | `false` |
| `administrativeCapability` | `true` (schema-reserved exclusively for this role key — §1.2) |

FINANCE_ADMIN's *own declared scope set* is exactly two action keys, both about administering
the Finance role system itself (assigning/revoking the three non-admin finance roles). Nothing
in its own scope declaration mentions customers, agents, support, limits, products, fees,
commissions, rewards, aggregators, reconciliation, or configuration.

### 2.2 Why FINANCE_ADMIN nonetheless reaches a broad `/internal/**` surface — principal TYPE, not role-specific scope

`src/authorization/workforce-session.service.ts:152`:
```
type: roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' : 'OPERATOR',
```
This is the **only** place principal type is derived from role. It is a strict binary: holding
`FINANCE_ADMIN` yields type `PRIVILEGED`; holding **any other role (or combination of the other
three)** yields type `OPERATOR`. No other distinction is made at this layer.

`src/authorization/route-policy-registry.ts` then gates nearly every `/api/v1/internal/**`
branch purely by `allowedPrincipalTypes`, almost always written as
`['OPERATOR', 'SERVICE', 'PRIVILEGED']` (sometimes adding `SUPPORT` for read surfaces), with
**no `requiredScopes` check at all**. This applies to: agent lifecycle
(suspend/terminate/reactivate/activate), admin-agent-lifecycle, agent/customer credential
issuance, SUPPORT workforce-user provisioning, limit catalogue, commercial-decision snapshots,
product catalogue, fee-rule/commission-rule/reward-rule registries, capability registry,
aggregator management, agent funding/defunding, outlets/terminals, customer lifecycle PATCH, and
the generic internal catch-all (reconciliation, audit, outbox, metrics, diagnostics,
notifications, admin directories). Only a handful of routes (`/ledger`, `/fees`, `/deposits`,
`/withdrawals`, `/transfers`, via the final catch-all) require `requiredScopes: ['internal:access']`
— a scope **granted to no role at all**, finance or otherwise (already documented in Task 13).

`src/admin/admin-agent-lifecycle.controller.ts:76-89` is representative of the controller layer:
its own `requireOperational()` helper checks **only** `principal.type` against
`['OPERATOR','SERVICE','PRIVILEGED']` — it never inspects `principal.roles` or
`principal.scopes`. No controller-level `@Roles()` decorator, role-specific guard, or manual
`roles.includes('FINANCE_ADMIN')` check was found in any of the admin/limit/fee/commission
controllers searched.

**Finding — new, not previously documented in Task 13:** because principal type collapses
`FINANCE_PREPARER`, `FINANCE_CONTROLLER`, and `FINANCE_AUDITOR` into the *same* `OPERATOR` type
as each other, and because the route/controller layer gates almost everything outside the
Finance-role-administration domain by type alone, **all three non-admin finance roles have
exactly the same reach into the broad `/internal/**` administrative surface as FINANCE_ADMIN
does** (agent lifecycle writes, SUPPORT provisioning, product/fee/commission/reward rule writes,
credential issuance, etc.) — with the single, narrow exception of the Finance-role-
administration actions themselves (`FINANCE_ROLE_ASSIGN`/`REVOKE`, gated by
`administrativeCapability`/maker-checker business rules inside
`finance-role-administration.service.ts`, not by route policy). This means a role explicitly
documented as **"Read-oriented assurance role"** with `applicableActions: []` — `FINANCE_AUDITOR`
— would, if actually assigned to a live OIDC identity, be authorized by the route layer to
suspend/terminate agents, provision SUPPORT workforce users, and write fee/commission/reward
rules, none of which its own description implies. This is a **code-level, deterministic**
finding (not requiring live reproduction to be true, since the branching logic is an
unconditional boolean), but it has **not been reproduced over live HTTP this session** (no
FINANCE_AUDITOR/PREPARER/CONTROLLER OIDC identity exists to test with) — flagged as a
static-evidence-only finding, Category "repo inspection" per the Task 13 evidence taxonomy.

### 2.3 What is genuinely, uniquely exclusive to FINANCE_ADMIN

Tracing `src/authorization/finance-role-administration.service.ts`:

- `assign()` (line 246): unconditionally rejects any attempt to assign `FINANCE_ADMIN` through
  the normal HTTP path (`"FINANCE_ADMIN assignment prohibited"`) — there is no code path to
  create a *second* FINANCE_ADMIN at all, only the one-time signed bootstrap ceremony
  (`consumeBootstrap`) or the NODE_ENV-gated local-dev seed path
  (`grantLocalAdministratorFinanceAdmin`, same file, documented at lines 159–180 as strictly
  non-production). **FINANCE_ADMIN is structurally singular** — at most one ACTIVE assignment
  can exist system-wide.
- For the **first** assignment of each of the three non-admin roles, the initiating principal
  must literally hold `FINANCE_ADMIN` (`!c.principal.roles.includes('FINANCE_ADMIN')` →
  rejected, line 260). After the first assignment of a given role exists, subsequent
  assigns/revokes go through the maker-checker rule's `initiatingRoles` list instead.
  **FINANCE_ADMIN is the sole gatekeeper for ever bringing the other three roles into
  existence.**
- `A2_MAKER_CHECKER_RULES_JSON` names `FINANCE_ADMIN` as the sole `initiatingRoles` for both
  `FINANCE_ROLE_ASSIGN` and `FINANCE_ROLE_REVOKE` (approved by `FINANCE_CONTROLLER`).

**Conclusion:** FINANCE_ADMIN's genuinely unique, code-enforced privilege is narrow and
specific — it is the sole administrator **of the A2 Finance role system itself** (who can exist,
who initiates role grants/revocations). Its broad reach into agents/customers/support/products/
limits/etc. is not a FINANCE_ADMIN-specific privilege; it is a side effect of weak,
principal-type-only gating shared by every workforce role.

### 2.4 Answering the task's direct sub-questions

| Question | Answer | Evidence |
|---|---|---|
| Platform-wide access? | **Practically yes, for read/write access to most `/internal/**` back-office domains** — but this is a byproduct of permissive route-policy design shared by all four finance roles, not a FINANCE_ADMIN-specific grant. The five routes gated by `internal:access` (`/ledger`,`/fees`,`/deposits`,`/withdrawals`,`/transfers`) are unreachable by FINANCE_ADMIN or anyone else. | §2.2, §2.4 of Task 13 report |
| Administer workforce users? | **Only the A2 Finance role vocabulary (4 roles)** — assign/revoke FINANCE_PREPARER/CONTROLLER/AUDITOR, and is the sole party who can ever bring a new one into existence. Cannot create/modify SUPPORT workforce users at the role-definition level (that's a separate `AdminSupportCredentialsController` surface, reachable by any OPERATOR/SERVICE/PRIVILEGED type — i.e. also reachable by the other 3 finance roles, not FINANCE_ADMIN-exclusive). | `finance-role-administration.service.ts`, `route-policy-registry.ts` |
| Change system configuration? | **No dedicated "system configuration" authority exists for any role.** Fee-rule/commission-rule/reward-rule/product/limit *registries* are reachable (by all 4 finance roles, per §2.2), but there is no broader runtime-configuration platform (that is explicitly future B8 Configuration Platform, unbuilt, per the roadmap). | `AUTHORITATIVE-PLATFORM-ROADMAP.md` §4 |
| Administer non-finance domains (customer/agent/support/ops)? | **Yes in practice, but not uniquely** — reachable by any of the four finance roles equally, for the reasons in §2.2. | §2.2 |
| Is "full privileges" genuinely platform-wide or only finance-wide? | **Neither, precisely.** FINANCE_ADMIN's own declared scopes are finance-role-administration-only (§2.1, §2.3). Its *practical* reach is broad but **shared equally by all four finance roles** (§2.2) and still excludes five specific route families gated by a scope nobody holds. "Full privileges" is best read as "full privileges across whatever a workforce OIDC identity can reach today," which is an artifact of the current (interim) route-policy design, not a deliberately scoped FINANCE_ADMIN grant. | §2.1–§2.3 |

---

## 3. Was SUPER_ADMIN ever specified? — direct answers to A–E

**A. Was SUPER_ADMIN ever part of approved V1 requirements?**
No. §1.1 found zero occurrences of the term anywhere in the repository, including the full
`docs/archive/` history. There is no evidence it was ever proposed, drafted, or rejected.

**B. Was a platform-wide administrator role specified under another name?**
**Yes — but as a platform, not a role, and explicitly future/unbuilt.** `B9 Identity & Access
Administration` (`AUTHORITATIVE-PLATFORM-ROADMAP.md`) is authoritatively defined as owning
"administrative IAM, access administration, role/entitlement administration, reviews, and
privileged governance" — conceptually the eventual platform-wide administrative authority. It
is explicitly not implemented (`ADR-0092`: "No B9 behavior is implemented"), has no role name of
its own yet, and is sequenced after B2–B8 with no committed date.

**C. Was FINANCE_ADMIN explicitly intended to be the top-level administrator?**
**Yes, but only of the currently-implemented, explicitly-interim A2 system — not of the
platform in perpetuity.** `V1-BOOTSTRAP-AUDIT-01.md` §3 names the bootstrapped FINANCE_ADMIN
identity "the first legitimate administrator" of the workforce control plane, and the code
(§2.3) structurally enforces it as the system's sole administrative role and sole gatekeeper for
all other finance-role grants. At the same time, ADR-0092 and the B9 handoff document (§1.4)
explicitly and repeatedly state that A2/FINANCE_ADMIN's authority is "interim" pending B9's
"permanent authority." Both statements are true simultaneously, about different time horizons.

**D. Is the current terminology an implementation decision that diverged from the original
product requirement?**
**No evidence of divergence was found.** The "Finance" prefix is not a naming accident or scope
creep — `A2T11`'s own title is literally *"Finance Role, Entitlement, and Bootstrap Contract"*;
it was scoped from inception as a finance-role system, not relabeled after the fact from a
broader "admin" concept. Nothing in the archive shows an earlier, broader role name (e.g.
`ADMIN`, `WORKFORCE_ADMIN`) that was later narrowed to `FINANCE_ADMIN`.

**E. Is the role architecture currently incomplete?**
**Yes, by the repository's own account, but as a known and planned gap, not an unplanned
defect.** Three independent, direct pieces of evidence: (1) the roadmap explicitly sequences B9
(administrative IAM) as unbuilt future work; (2) ADR-0092 states A2's role model is "interim"
and B9 "remains permanent administrator"; (3) the Zod schema hard-locks the role vocabulary to
exactly 4 Finance-named keys with no extension point, so no additional role (named
`SUPER_ADMIN` or anything else) can be added without a code change. The repository treats this
as a sequencing decision (B9 comes later), not as an acknowledged bug.

---

## 4. Admin Web module → intended role reconciliation

Admin Web (`apps/admin-web`) is a single monolithic application. The authoritative roadmap's
frontend portfolio (`AUTHORITATIVE-PLATFORM-ROADMAP.md` §6) separately lists **Admin Portal,
Finance Portal, Operations Portal, Compliance Portal, and Treasury Portal** as five distinct
future products, gated on backend platform maturity — i.e. the long-term intended architecture
does **not** foresee one portal and one administrator role covering Finance + Ledger +
Transaction Ops + Reconciliation + Role Administration + Approvals at once. (A still older,
superseded P1 roadmap label, `"Admin & Operations Portal"`, combined admin and operations into
one portal — closer in shape to today's single Admin Web, but explicitly superseded by the
current 5-portal roadmap; see §9.) `apps/admin-web` was built ahead of the roadmap's own stated
gate ("frontend development follows backend platform maturity" — §6), which is a pre-existing,
already-known condition, not introduced by this audit.

| MODULE | INTENDED ROLE (per docs, if any) | CURRENT ROLE (code) | CURRENT ACCESS | CORRECT? | EVIDENCE |
|---|---|---|---|---|---|
| Operational Dashboard | Not documented per-role; shown to any authenticated session | any workforce role | Visible to all | N/A (no stated intent) | `Layout.tsx` — dashboard nav has no role gate |
| Customer & KYC Servicing | Not documented per-role | `isOperator` = any role (`principal.roles.length > 0`) | Visible to all 4 finance roles | **Matches code, but "intended role" is undocumented** | `Layout.tsx:19,54-61`; `route-policy-registry.ts` `/customers/*` branch allows `CUSTOMER, OPERATOR, SERVICE, PRIVILEGED` |
| Ledger & Reversals | Backend action `FINANCE_CONTROL_POLICY_ACTIVATE` is `FINANCE_PREPARER`-initiated per maker-checker rule | UI gated as `isOperator` (any role); screen itself exposes preparer/controller actions | UI is visible to FINANCE_ADMIN, but FINANCE_ADMIN is **not** in `FINANCE_CONTROL_POLICY_ACTIVATE`'s `initiatingRoles` (`["FINANCE_PREPARER"]` only) | **No — documented mismatch, carried over from Task 13** | `.env.example`/template `A2_MAKER_CHECKER_RULES_JSON`; `LedgerOperationsScreen.tsx` |
| Transaction & Fee Ops | Not documented per-role | `isOperator` (any role) | Visible to all 4 roles | **Undocumented intent; current code grants broadly** | `TransactionObservabilityScreen.tsx`, `Layout.tsx` |
| Reconciliation & Breaks | Not documented per-role | `isOperator` (any role) | Visible to all 4 roles | **Undocumented intent** | `ReconciliationObservabilityScreen.tsx` |
| Finance Role Admin | `administrativeCapability` reserved for FINANCE_ADMIN | `isAdmin` = `FINANCE_ADMIN` role OR `privileged:execute` scope | Visible only to FINANCE_ADMIN | **Yes — matches code-enforced invariant** | `Layout.tsx:17,90-97`; `workforce-configuration.ts:50-55` |
| Privileged Approvals | `FINANCE_ROLE_ASSIGN`/`REVOKE`/`FINANCE_CONTROL_POLICY_ACTIVATE` approvals require `FINANCE_CONTROLLER` (`checkerEligible`) | `isController` = `FINANCE_CONTROLLER` role OR `privileged:approve` scope | **Invisible to FINANCE_ADMIN** (its scopes are `[privileged:execute]`, not `privileged:approve`) | **Yes, matches code — but means the current logged-in local admin, who holds only FINANCE_ADMIN, can never see this screen** | `Layout.tsx:18,99-106`; `A2_MAKER_CHECKER_RULES_JSON` |
| Agent administration | Workforce-wide (`OPERATOR/SERVICE/PRIVILEGED`, SUPPORT explicitly denied for lifecycle writes) | No dedicated Admin Web screen exists at all (confirmed zero-UI in Task 13 Part C) | Backend-only; reachable by all 4 finance roles via direct API call, no UI surface | **No UI exists to evaluate "correct" against** | Task 13 report §Category-C backend-only endpoints |
| Workforce administration (SUPPORT provisioning) | `OPERATOR/SERVICE/PRIVILEGED` (SUPPORT denied from provisioning itself) | No Admin Web screen exists | Backend-only | **No UI exists** | `route-policy-registry.ts` support-workforce-provisioning branch |
| Support (tickets) | `SUPPORT, OPERATOR, SERVICE, PRIVILEGED` per generic internal catch-all (ticket-specific controller not separately reviewed this task) | No dedicated Admin Web screen (Task 13 finding) | Backend-only | **No UI exists** | Task 13 report |
| Audit | Generic internal catch-all, `OPERATOR/SERVICE/PRIVILEGED/SUPPORT` | No dedicated Admin Web screen | Backend-only | **No UI exists** | Task 13 report |
| Configuration (fee/commission/reward/product/limit registries) | `OPERATOR/SERVICE/PRIVILEGED` per dedicated route branches | No dedicated Admin Web screen for most; brokenness vs `internal:access` already documented for a subset in Task 13 | Backend-only or broken | **No UI exists for most; some documented-broken** | `route-policy-registry.ts`; Task 13 report |

**Key finding:** with the sole exceptions of "Finance Role Admin" (correctly FINANCE_ADMIN-only)
and "Privileged Approvals" (correctly FINANCE_CONTROLLER-only), **no other Admin Web module has
a documented "intended role" to check against at all.** The repository does not specify, for
example, that Ledger screens are "meant for" FINANCE_PREPARER/CONTROLLER rather than
FINANCE_ADMIN, or that Customer Servicing is "meant for" a future SUPPORT/Operations role rather
than any finance role. The only place role intent is formally documented is the maker-checker
action table (§5), which covers three specific actions, not whole UI modules.

---

## 5. Segregation of duties — maker/checker matrix (existing model, not modified)

| Role | Scopes | Maker-eligible | Checker-eligible | Approval capability | Administrative capability | Applicable actions |
|---|---|---|---|---|---|---|
| `FINANCE_ADMIN` | `privileged:execute` | Yes | No | No | **Yes (schema-reserved, §1.2)** | `FINANCE_ROLE_ASSIGN`, `FINANCE_ROLE_REVOKE` |
| `FINANCE_PREPARER` | `finance:prepare` | Yes | No | No | No | `FINANCE_CONTROL_POLICY_ACTIVATE` |
| `FINANCE_CONTROLLER` | `privileged:approve`, `privileged:execute` | No | Yes | Yes | No | `FINANCE_ROLE_ASSIGN`, `FINANCE_ROLE_REVOKE`, `FINANCE_CONTROL_POLICY_ACTIVATE` |
| `FINANCE_AUDITOR` | `finance:audit` | No | No | No | No | *(none)* |

| Action | Initiating role(s) | Approving role(s) | Min approvals | Self-approval | Notes |
|---|---|---|---|---|---|
| `FINANCE_ROLE_ASSIGN` | `FINANCE_ADMIN` | `FINANCE_CONTROLLER` | 1 | Prohibited | First assignment of each non-admin role is a direct FINANCE_ADMIN grant with no checker (one-time, per role key — §2.3); all subsequent assigns use this rule. |
| `FINANCE_ROLE_REVOKE` | `FINANCE_ADMIN` | `FINANCE_CONTROLLER` | 1 | Prohibited | — |
| `FINANCE_CONTROL_POLICY_ACTIVATE` | `FINANCE_PREPARER` **only** | `FINANCE_CONTROLLER` | 1 | Prohibited | **FINANCE_ADMIN is not an initiating role for this action**, despite the Admin Web Ledger screen being visible to it (§4) — the existing, unmodified mismatch already documented in Task 13. |

This maker/checker model is **fully preserved as-is** by this audit; nothing above represents a
proposed or made change. It governs exactly three named actions. It says nothing about agent
lifecycle, customer lifecycle, SUPPORT provisioning, or the fee/commission/reward/product/limit
registries — those surfaces have no maker/checker rule at all, and (per §2.2) are gated only by
principal type, which is shared identically by all four finance roles except FINANCE_ADMIN's
unique `PRIVILEGED` type label (which itself unlocks no route that `OPERATOR` does not already
reach — no `PRIVILEGED`-exclusive-without-`OPERATOR` route branch was found anywhere in
`route-policy-registry.ts`).

---

## 6. The product-level question: who is supposed to be the ultimate administrator of MonieNaija?

Evidence supports a **combination of outcomes (1) and (2), cleanly separated by time horizon —
not outcome (4) "ambiguous."** The repository is *not* ambiguous or self-contradictory; it is
simply answering two different questions that happen to look like one question from the UAT
vantage point:

- **For the system as it exists today (the implemented A2T11 interim Finance-role system):**
  Outcome **(1)** is correct and evidence-supported. FINANCE_ADMIN is intentionally the
  top-level administrator of the currently-running system — structurally singular, the sole
  gatekeeper for all other finance-role grants, and the only role the schema will ever let hold
  `administrativeCapability` (§1.2, §2.3). Its name is not "misleading" in the sense of being an
  accident or a bug — it is literally named after the initiative that built it (A2T11, a Finance
  role contract), and there is no evidence of an original broader-admin name having been
  narrowed later (§3D). The practical reach beyond its declared scopes is real but is shared
  equally by the other three finance roles (§2.2), so "full privileges" is better understood as
  "whatever any workforce identity can reach today" rather than a FINANCE_ADMIN-specific design
  choice.
- **For the platform's own stated long-term architecture:** Outcome **(2)** is also correct and
  evidence-supported, on a different axis. A distinct, more comprehensive administrative
  authority — **B9 Identity & Access Administration** — is explicitly named in the authoritative
  roadmap, explicitly described as the eventual "permanent authority for role definitions,
  assignments, entitlements, reviews, revocation, and privileged administration," and explicitly
  does not exist yet (§1.3, §1.4). It was never called `SUPER_ADMIN` and it is not a single role
  — it is a whole future platform — but it is the repository's own named answer to "what
  eventually administers everything," and it is currently missing exactly as the roadmap says it
  should be, this early in the B-phase sequence.
- Outcome **(3)** ("another existing role is intended as platform administrator") is **not
  supported** — no role other than FINANCE_ADMIN (and, prospectively, B9, which has no role names
  defined) is described anywhere as platform-administrative. `SUPPORT` is explicitly narrow
  (ticket queue, funding-maker, read) and was never pitched as an admin role.
- Outcome **(4)** ("ambiguous/conflicting, requiring an explicit product decision") is **not
  the best fit** for the *architecture question itself* — the roadmap and ADRs are internally
  consistent about B9 being the eventual answer. It *is* arguably the right frame for a narrower,
  practical question this audit surfaces but does not resolve: **should the single Admin Web app
  continue to let one Finance role reach non-finance domains (agent lifecycle, SUPPORT
  provisioning, product/fee/commission/reward registries) before B9 exists, or should that reach
  be deliberately narrowed now?** The repository has no documented answer to that narrower
  question — this is the one place a genuine, undocumented product decision is required (see §10).

---

## 7. No changes made

Per the binding instruction, no role was created or renamed, no migration was written, no
authorization logic was changed, no UI was changed, and no seeded account was changed in the
course of this audit. All findings above come from reading existing code and documentation at
commit `a0018e961a3b513c45fef40d89071c7bc687b8f1`.

---

## 8. Final report — the 11 items

1. **Authoritative role definitions found:** `A2_FINANCE_ROLES_JSON` (`FINANCE_ADMIN`,
   `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`), schema-enforced exactly 4 roles,
   validated by `src/authorization/workforce-configuration.ts`. No other role-definition source
   exists for the finance/workforce vocabulary. `SUPPORT` is a structurally separate, narrow
   principal type with its own login path, not part of this vocabulary.
2. **Does SUPER_ADMIN exist anywhere?** No — zero occurrences in source, tests, docs, or config,
   confirmed by exhaustive repository-wide search (§1.1).
3. **Was SUPER_ADMIN ever specified for V1?** No — no draft, proposal, rejection, or mention was
   found anywhere in the documentation archive (§1.1, §3A).
4. **Exact meaning of FINANCE_ADMIN:** Declared scope is `privileged:execute` with
   `applicableActions` limited to `FINANCE_ROLE_ASSIGN`/`FINANCE_ROLE_REVOKE` (§2.1). It is
   schema-reserved as the sole holder of `administrativeCapability` (§1.2), is structurally
   singular (at most one ACTIVE assignment can exist), and is the sole gatekeeper for ever
   creating the other three roles (§2.3). Its broad practical reach into non-finance domains is
   real but not unique to it — shared equally by FINANCE_PREPARER/CONTROLLER/AUDITOR because
   route-level gating is principal-type-based, not role-specific, outside the Finance-role-
   administration domain (§2.2).
5. **Role/capability matrix:** §5 (scopes, maker/checker/approval/admin flags, applicable
   actions for all four roles).
6. **Admin Web module → intended role matrix:** §4. Only two of the reviewed modules (Finance
   Role Admin, Privileged Approvals) have a documented intended-role mapping to check against;
   the rest have no stated per-module role intent in the repository, so "correct?" is either
   "matches code" (where an invariant exists) or "no documented intent to compare against."
7. **Maker/checker matrix:** §5, second table — three governed actions, all preserved unchanged.
8. **Evidence for intended top-level administrator:** `V1-BOOTSTRAP-AUDIT-01.md` names the
   bootstrapped FINANCE_ADMIN "the first legitimate administrator"; code structurally enforces
   singularity and sole gatekeeping (§2.3); simultaneously, ADR-0092 and the B9 handoff document
   state this authority is explicitly "interim" pending a separate, future, unbuilt B9 platform
   (§1.3, §1.4). Both are true, about different time horizons (§6).
9. **Documentation conflicts found:**
   - The UAT-reported phrase `"System administrator with full privileges"` does not appear
     literally anywhere in the repository (§2.0) — flagged, not resolved.
   - `V1-ADMIN-UAT-READINESS-01-REPORT.md` previously documented the local-admin login granting
     all 4 finance roles via a `mock-sandbox-subject` path; current live behavior (per Task 13,
     re-confirmed unchanged this session) grants only `FINANCE_ADMIN`. Root cause not determined
     by this audit — flagged as an open conflict, not resolved here.
   - An older, superseded roadmap label (`"Admin & Operations Portal"`, `docs/archive/a1-
     consolidation/ROADMAP.md`) combined admin and operations into one portal, closer in shape
     to today's single Admin Web; the current authoritative roadmap instead specifies five
     separate portals (Admin, Finance, Operations, Compliance, Treasury) — flagged as a
     historical/current roadmap divergence, not something this audit resolves (§4, §9).
10. **Exact product decision required, if one is required:** Not "should we invent
    SUPER_ADMIN" (no evidence supports that framing — see §6 outcome analysis). The actual open
    decision is narrower: **should FINANCE_ADMIN (and, identically, the other three finance
    roles) continue to reach non-finance administrative domains — agent lifecycle, SUPPORT
    provisioning, product/fee/commission/reward registries — through Admin Web and the API
    before B9 exists, or should that reach be deliberately narrowed to finance-only actions
    now, accepting that non-finance domains would then have no administrative UI/API access
    path at all until a dedicated role or B9 arrives?** This is a genuine, undocumented product
    choice with real tradeoffs on both sides; the repository does not currently answer it.
11. **Recommendation for next implementation task (not implemented here):** A dedicated,
    explicitly-scoped product/architecture decision task that (a) decides the §10 question, and
    (b) if the decision is "narrow non-finance reach now," specifies — without implementing —
    what a minimal, interim non-finance operations role would look like (name, scopes, which
    specific route branches it should and should not reach) as a bridge until B9 exists,
    **or**, if the decision is "leave broad reach as-is until B9," records that explicitly as an
    accepted risk in an ADR so it is not rediscovered as a surprise in a future audit. Either way,
    the task should **not** attempt to design or build B9 itself — B9 is a whole platform,
    sequenced seven platforms away in the authoritative roadmap, and is out of scope for any
    near-term V1 work.
