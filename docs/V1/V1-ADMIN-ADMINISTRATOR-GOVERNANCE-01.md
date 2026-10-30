# V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01 — Administrator Governance Design

**Status:** Design-only. No source code, migration, catalogue entry, role assignment, API, or
Admin Web file was modified in the course of producing this document.
**Baseline commit:** `c8da4d4157f4baa81725bd2155fc29cc10db4679` on `arena/01a10374-monienaija`.
**Builds on (unchanged, re-verified this session):**
`docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md`,
`docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md`,
`docs/V1/V1-ADMIN-AUTHORIZATION-RUNTIME-01-REPORT.md`,
`docs/V1/V1-ADMIN-AUTHORIZATION-FOUNDATION-01-REPORT.md`.

---

## 0. Why this document exists

The Product Owner has now stated an organizational model (SUPER_ADMIN = CEO, reserved for
exceptional governance; an ordinary `ADMINISTRATOR` handles day-to-day workforce
administration). Prior work (`SPEC-01` §19/§20/§28, `DECISIONS-01` Decisions 3 and 10) already
decided the *shape* of the target architecture (configurable function/role model; independent
dual control for role-definition changes) but explicitly left the mechanics of an ordinary
administrator role, and several structural details, undesigned. This document is the concrete
proposal those decisions call for — **grounded in what the repository actually does today**, not
only in what prior specs intended.

---

## 1. Current-state audit (repository facts, re-verified this session)

### 1.1 The authorization catalogue (function/role model) — `src/authorization-catalogue/`

- `authorization_functions`, `authorization_roles`, `authorization_role_functions` are real,
  migrated tables (`src/migrations/1785753600083-CreateAuthorizationCatalogue.ts`). `role_key` is
  a free-form, unbounded `VARCHAR` — **not** a fixed-size enum. Two DB-level triggers are
  structural, non-bypassable invariants, enforced regardless of which code path writes the row:
  - `fn_authorization_enforce_finance_class_restriction` — a `finance_class_restricted = TRUE`
    function (currently `ledger.post`, `ledger.reverse`, `ledger.approve_adjustment`, all
    `CRITICAL_FINANCIAL`) can **never** be assigned to a role whose `finance_role_class = FALSE`.
    `SUPER_ADMIN` is seeded with `finance_role_class` unset (`false`), so this trigger already,
    structurally, prevents SUPER_ADMIN from ever being granted a critical-financial function —
    this is **not** merely an absence-of-seed-row convention; it is enforced at the data layer
    even against a direct SQL insert. This is the concrete mechanism that already satisfies PO
    direction point 4.
  - `fn_authorization_enforce_read_only_role` — a `read_only = TRUE` role (`FINANCE_AUDITOR`) can
    never be assigned a non-READ function.
  - A `super_admin_excluded` column exists on `authorization_functions` but is **metadata only**
    — no trigger or application check reads it anywhere (`grep` confirms zero non-seed call
    sites). It currently does no enforcement work; the finance-class trigger above is what
    actually protects SUPER_ADMIN from critical-financial functions.
- Seeding is idempotent, insert-missing-only, performed at application bootstrap by
  `AuthorizationCatalogueSeedService` from static TypeScript data in
  `authorization-catalogue.seed.ts` — **there is no HTTP endpoint anywhere that creates, edits,
  or deletes a row in any of these three tables.** The catalogue is entirely
  deployment/code-controlled today, confirmed by a full-repo search for any controller touching
  `AuthorizationFunction`/`AuthorizationRole`/`AuthorizationRoleFunction` (zero results).
- `AuthorizationCatalogueRuntimeService.resolveForRoleKeys()` is the only reader: given a set of
  role keys, it unions their active functions and flags (`administrative_capability`,
  `read_only`). It is role-count-agnostic by design (confirmed in
  `V1-ADMIN-AUTHORIZATION-RUNTIME-01-REPORT.md` §10) — adding an 11th role requires **no code
  change** to this service.

### 1.2 The ten seeded roles — `authorization-catalogue.seed.ts`

`SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `OPERATIONS`,
`AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY`. Each role is
a named bundle of `authorization_functions` rows (`role = bundle of functions`, matching PO
direction point 6 exactly — this is already how the system works, not a proposal). SUPER_ADMIN's
own bundle is broad (customer/agent/aggregator/workforce-role administration, every `*.view`
function, KYC decisioning, compliance case management) but — confirmed by direct inspection of
every `nowAssign('SUPER_ADMIN', ...)` row — **contains zero `ledger.post`/`.reverse`/
`.approve_adjustment`, zero `agent.fund`/`.defund` APPROVE grant, and zero FINANCE_ROLE_ASSIGN
APPROVE grant** (only `FINANCE_CONTROLLER` holds that APPROVE). This matches PO direction points
4 and 5 as already-implemented fact, not aspiration.

### 1.3 Where role **assignment** actually happens — `A2FinanceRoleAdministrationService`
**(the single most important finding for this task)**

The catalogue above governs what a role *means* once a principal holds it. A **separate**,
older, schema-locked subsystem governs who can be *granted* a role at all:

- `src/authorization/workforce-configuration.ts`'s `A2_FINANCE_ROLES_JSON` is validated by a Zod
  schema with a hard `z.array(roleSchema).min(4).max(4)` bound, further constrained by
  `REQUIRED_ROLES = ['SUPER_ADMIN', 'FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'FINANCE_AUDITOR']`
  — **exactly these four role keys, no more, no fewer, ever.** This is not a soft default; the
  app fails closed at startup if any other set is supplied.
- `A2FinanceRoleAdministrationService.assign()`/`.revoke()` (the only HTTP-reachable mutation
  path, `POST`/`DELETE /internal/a2/workforce/roles`) calls `validateCommand()`, which looks up
  `this.config.roles.find(r => r.roleKey === c.roleKey && r.enabled)` — i.e. **the 4-role legacy
  list, not the ten-role catalogue.** Consequently:
  - `assign()`/`revoke()` **structurally refuse `roleKey === 'SUPER_ADMIN'` outright** (explicit
    check, independent of the 4-role lookup) — SUPER_ADMIN can never be assigned or revoked
    through this endpoint, by anyone, under any circumstance. This is the existing self-escalation
    guard for the top role and must be preserved exactly.
  - The only roles this endpoint can **ever** grant or revoke, today, are `FINANCE_PREPARER`,
    `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`.
  - **None of the six catalogue-only organizational roles — `OPERATIONS`,
    `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY` — can be
    granted to any principal through any production HTTP call.** This was already identified and
    explicitly recorded as an open gap in `V1-ADMIN-AUTHORIZATION-RUNTIME-01-REPORT.md` §12 item
    4 and §34 ("Test/ops provisioning for those seven roles requires a direct SQL insert... there
    is no code path, tested or untested, that grants them via HTTP") — re-confirmed, unchanged,
    this session. The integration tests this project ships for those six roles (including the
    two most recent authorization tasks this session's own history produced) grant them via a
    direct `dataSource.getRepository(A2FinanceRoleAssignment).save(...)` insert, deliberately
    bypassing `assign()` entirely, because there is no other way to reach that state.
  - First-ever assignment of a role (`count === 0` active rows for that `roleKey`) additionally
    requires the assigning principal to hold `SUPER_ADMIN` **and** the role to be one of exactly
    `{FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR}` (`INITIAL_BOOTSTRAP_ASSIGNABLE_ROLES`).
    Every subsequent assignment goes through the legacy `FINANCE_ROLE_ASSIGN` maker/checker rule
    (`A2_MAKER_CHECKER_RULES_JSON`: `initiatingRoles: ['SUPER_ADMIN']`,
    `approvingRoles: ['FINANCE_CONTROLLER']`, 1 approval, self-approval prohibited, MFA required).
  - **Net effect: today, SUPER_ADMIN is the only principal in the entire system that can ever
    initiate a role grant of any kind, for any of the three roles the mechanism even recognizes.**
    This directly contradicts PO direction points 1–3 (the CEO's account reserved for
    *exceptional* governance; an ordinary Administrator handling *day-to-day* workforce
    administration) — there is currently no "ordinary" administrative actor at all. Closing this
    gap is the central problem this design must solve, not an incidental detail.
- `revoke()` also calls `validateCommand()` first, so **SUPER_ADMIN additionally can never be
  revoked** through this endpoint — there is no production-reachable way to deactivate a
  compromised or departed SUPER_ADMIN's assignment today (see §6 below).

### 1.4 "Workforce user" — there is no single meaning of this phrase in the repository

- For **SUPPORT** workforce identities specifically: `AdminSupportCredentialsController`
  (`POST /internal/admin/support/workforce-users`, `.../enable`, `.../disable`) is a real,
  function-gated (`workforce.user.create`, `workforce.user.suspend`) provisioning flow with its
  own local username/password credential table (`SupportAuthenticationService`). Today only
  `OPERATIONS` and `SUPER_ADMIN` hold `workforce.user.create`/`.suspend` in the catalogue.
  `.../enable` has **no** catalogue function at all yet (documented gap, same file, same
  convention as this document follows: never invent a function).
- For every **other** role (the nine non-SUPPORT roles) a "workforce user" is simply an external
  identity asserted by the organization's own OIDC provider — the platform never creates a
  password or account for these; it only grants/revokes a **role assignment** against whatever
  `principalId` (`<issuer>:<subject>`) the IdP already authenticates. "Creating a workforce user"
  in this sense is a misnomer — the real administrative action is "assign a role to an external
  identity," which is exactly what §1.3 is about.
- `LocalAdminAuthenticationService`/`LocalAdminCredential` is a **NODE_ENV=development|test-only**
  convenience with no production relevance (four independent gates documented in the source;
  hard-refuses in production with a 404).
- **There is currently no GET endpoint anywhere that lists existing role assignments.**
  `A2FinanceRoleAdministrationService.exportForB9()` exists but has zero callers in the entire
  codebase (dead code, presumably reserved for a future external integration). The catalogue
  function `workforce.role.view` is seeded (to `SUPER_ADMIN`, `FINANCE_AUDITOR`) but is never
  checked by any controller — it is currently decorative. Admin Web's `RoleAssignmentScreen.tsx`
  is a pure write-only form (assign/revoke); it cannot display who currently holds what. This is
  a real, independent gap for "day-to-day workforce administration," not specific to this task's
  role model.

### 1.5 Dynamic role creation / modification (`workforce.role.create` / `.modify`)

Confirmed, unchanged: **no code path of any kind creates or edits a role definition.** Roles are
either the static TypeScript seed (catalogue) or the static 4-entry env-var JSON (legacy). This
was explicitly scoped as FUTURE by `SPEC-01` §23/§26 step 11 and its governance model was already
decided by `DECISIONS-01` Decision 10 (independent dual control; no self-approval; **no SUPER_ADMIN
carve-out even for the administrative role**). This document does not reopen Decision 10 — it is
carried forward as binding (see §5).

### 1.6 SUPER_ADMIN provisioning (the "CEO's account") — already fairly mature

- The **only** way a real deployment can ever mint a SUPER_ADMIN is
  `A2FinanceRoleAdministrationService.consumeBootstrap()`: a one-time, externally-signed
  (RS256), environment-bound, audience-bound, nonce-replay-protected, MFA-mandatory JWS statement
  naming an arbitrary external `principalId`, produced entirely offline by
  `scripts/generate-bootstrap-statement.ts` per `docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`.
  **No CEO identity, email, or name is hardcoded anywhere in application code** — the identity is
  a runtime parameter of the ceremony, supplied by the operator from the organization's own OIDC
  provider. This already satisfies PO direction point 7's literal requirement ("without
  hard-coding a CEO identity into the application").
- `consumeBootstrap()` enforces a **global, deployment-wide singleton**: it refuses if any
  `A2FinanceRoleAssignment` row already has `roleKey = 'SUPER_ADMIN', status = 'ACTIVE'` — there
  is no organization/tenant key anywhere in this check or in the underlying table. This is a
  **single-tenant-per-deployment** assumption, not a multi-tenant-SaaS one. "Separate
  organizations" today means separate deployments (separate databases, separate OIDC
  configuration) — each gets its own one-time bootstrap ceremony naming its own CEO. True
  multi-tenancy (many organizations' SUPER_ADMINs coexisting inside one shared database/schema)
  is **not implemented and not designed** anywhere in this codebase; see the unresolved item in §8.
- Every bootstrap consumption is audited (`WORKFORCE_BOOTSTRAP_CONSUMED`, full statement metadata
  including the operational change reference) and well tested
  (`test/v1-workforce-bootstrap-01.integration.spec.ts`: identity binding, scope lock, expiry
  window, replay protection, MFA mandatory, environment binding, bootstrap-disable kill switch —
  11 scenarios, all currently passing).
- **Gap:** there is no revoke/rotate path for an existing SUPER_ADMIN assignment at all (§1.3 —
  `validateCommand` blocks any `roleKey === 'SUPER_ADMIN'` mutation). The only ways the single
  active row ever stops being active are (a) its own `effectiveTo` window lapsing naturally, or
  (b) a direct, out-of-band database/operations intervention with no application-level audit
  trail of its own. See §6.

### 1.7 Audit logging

`AuditService.record()` persists `actor` as a plain string (`command.actor`/`principal.principalId`)
— **never a role**, confirmed unchanged from `SPEC-01` §22's finding. Every `requireFunction()`/
`authorize()` call records a decision via `recordDecision()` regardless of outcome. Role
assignment/revocation and bootstrap consumption are both audited with full before/after metadata.
This is adequate for "who did what, as which principal" but does not yet capture "under which
specific role" when a principal holds more than one — a pre-existing, carried-forward limitation,
not something this task's model changes or needs to change to be usable.

### 1.8 Admin Web

`apps/admin-web/src/screens/authenticated/RoleAssignmentScreen.tsx` only exposes
`FINANCE_PREPARER`/`FINANCE_CONTROLLER`/`FINANCE_AUDITOR` in its role dropdown — an exact mirror
of the backend's real 4-role-capped assignment surface (§1.3), not an independent limitation.
`Layout.tsx` still checks `principal.roles.includes('FINANCE_ADMIN')` (a stale literal predating
the `RUNTIME-01` rename to `SUPER_ADMIN` — currently dead code masked by its own
`principal.scopes.includes('privileged:execute')` fallback, which still works correctly). Per
`SPEC-01` §21 (explicitly reaffirmed, unchanged) and `RUNTIME-01-REPORT` §23/§33, Admin Web is
untouched by every authorization task to date and remains out of scope here as instructed.

---

## 2. Proposed model

### 2.1 `ADMINISTRATOR` is a configurable role, not a new hardcoded system concept — but
seeded the same pragmatic way the existing ten roles were

`DECISIONS-01` Decision 3 is explicit: do **not** just widen a hardcoded bound again; move toward
the catalogue model. The catalogue model (§1.1) already supports this with zero schema change —
`authorization_roles.role_key` is unbounded. The *honest* middle path, consistent with how the
existing ten roles themselves were introduced (as static seed data, per `SPEC-01` §20's own
framing — "seeded/configured starting roles, not an immutable list"), is:

- Add `ADMINISTRATOR` as an **eleventh seeded row** in `AUTHORIZATION_ROLE_SEED`/
  `AUTHORIZATION_ROLE_FUNCTION_SEED`, assembled **entirely from functions that already exist in
  the catalogue** — no new function is invented for it, mirroring the existing-functions-only
  composition `SPEC-01` §20 already describes for a hypothetical `KYC_ANALYST`.
- This is explicitly **not** the same thing as implementing `workforce.role.create`/`.modify`
  (Decision 10's dual-control capability). Seeding an eleventh static role via code+migration is
  today's only implemented role-creation mechanism; true runtime role authoring remains FUTURE
  and ungoverned-by-implementation exactly as Decision 10 left it. `ADMINISTRATOR` must not be
  used as a precedent to skip that governance later — any *future* role, including edits to
  `ADMINISTRATOR`'s own bundle, created after dynamic role editing exists must go through
  Decision 10's dual control.
- Why not reuse an existing role (e.g. `OPERATIONS`)? `OPERATIONS` is already a defined,
  function-scoped organizational role in `SPEC-01` §6.5 with its own, narrower, already-audited
  boundary (no agent-lifecycle, no financial mutation). Overloading it with
  workforce-role-assignment authority would silently broaden an existing, already-reviewed role
  rather than introduce a new, purpose-built one — exactly the kind of scope-creep this project's
  authorization tasks have consistently avoided (see e.g. the explicit "never repurpose an
  existing function/role" convention in `V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01.md`).
  `ADMINISTRATOR` should be its own distinct role.

### 2.2 `ADMINISTRATOR`'s function bundle (proposed, all pre-existing functions)

| Function | Why | Already assigned elsewhere |
|---|---|---|
| `workforce.user.view` *(new function — see §9)* | Visibility into provisioned SUPPORT workforce users | — |
| `workforce.user.create` | Day-to-day SUPPORT workforce-user provisioning | OPERATIONS, SUPER_ADMIN |
| `workforce.user.suspend` | Day-to-day SUPPORT workforce-user suspension | OPERATIONS, SUPER_ADMIN |
| `workforce.role.view` *(needs wiring — see §9)* | Visibility into current role assignments | SUPER_ADMIN, FINANCE_AUDITOR (seeded, unwired) |
| `workforce.role.assign` — **scoped**, see §2.3 | Day-to-day role assignment within delegation | SUPER_ADMIN only (unscoped) |
| `workforce.role.revoke` — **scoped**, see §2.3 | Day-to-day role revocation within delegation | SUPER_ADMIN only (unscoped) |
| `customer.view`, `agent.view`, `aggregator.view` | Ordinary operational visibility, READ-tier, freely reassignable per `SPEC-01` §19 tier 1 | multiple roles already |

Explicitly **excluded** from `ADMINISTRATOR`, by design, never to be added without a fresh PO
decision: `workforce.role.create`/`.modify` (Decision 10 territory); any `ledger.*`,
`agent.fund`/`.defund` APPROVE, `finance.control_policy.activate` (Finance maker/checker stays
independent of administrative seniority — PO point 5); `kyc.approve`/`.reject`,
`compliance.manage_case`/`.manage_risk_profile` (Compliance-specific, per Decision 5/role
boundary — administrative seniority does not confer compliance decision authority either);
`risk_fraud.manage_fraud_case`. `ADMINISTRATOR` is deliberately **not** a second, lesser
SUPER_ADMIN — it is a narrow, workforce-administration-only role.

### 2.3 The one genuinely new mechanism this design requires: a scoped, role-class-based
assignment allow-list

This is the actual implementation gap (§1.3) the whole task hinges on. Today
`A2_MAKER_CHECKER_RULES_JSON`'s `FINANCE_ROLE_ASSIGN`/`REVOKE` rule has one flat
`initiatingRoles` list with no concept of "which *target* roleKey may this initiator touch."
Proposed structural rule, modeled directly on the existing, already-proven
`finance_class_restricted` DB trigger pattern (§1.1) rather than inventing something new:

- Introduce an **assignable-role-class** flag per catalogue role (`authorization_roles` already
  has `finance_role_class`/`administrative_capability`/`read_only`; add one more,
  e.g. `administrator_assignable: BOOLEAN`), set `TRUE` on exactly the six catalogue-only
  organizational roles (`OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`,
  `CUSTOMER_SERVICE`, `TREASURY`) and `FALSE` on `SUPER_ADMIN` and the three `FINANCE_*` roles.
- A **new, dedicated** maker/checker-style rule (NOT a relaxation of the existing
  `FINANCE_ROLE_ASSIGN`/`REVOKE` rule, which stays exactly as-is for the three Finance roles) —
  e.g. `WORKFORCE_ROLE_ASSIGN_OPERATIONAL`/`..._REVOKE` — whose `initiatingRoles` includes
  `ADMINISTRATOR` (and `SUPER_ADMIN`, who retains every capability `ADMINISTRATOR` has, per PO
  framing of SUPER_ADMIN as the highest authority), gated at the service layer by a structural
  check mirroring the DB trigger: **the target `roleKey`'s `administrator_assignable` flag must
  be `TRUE`**, enforced regardless of which principal calls it (so even a mis-configured
  `initiatingRoles` list cannot let `ADMINISTRATOR` reach `SUPER_ADMIN` or a Finance role — the
  restriction is structural, not just a maker/checker role list).
- `ADMINISTRATOR` is never added to `FINANCE_ROLE_ASSIGN`/`REVOKE`'s existing `initiatingRoles`
  (which stays `['SUPER_ADMIN']`) — Finance role grants remain exactly as mature, seniority-gated,
  and SUPER_ADMIN-initiated as they are today, directly satisfying PO point 5 ("Finance
  maker/checker separation remains independent of administrative seniority" — read here as:
  *assigning* a Finance role is itself part of that same separation, not just *executing*
  Finance actions once assigned).
- Whether `ADMINISTRATOR`-initiated assignment needs its own checker approval, or can be a direct
  EXECUTE (no second approver), for these six already-lower-sensitivity organizational roles is
  the one piece of this sub-design genuinely left to the Product Owner — see §8 item 2. The
  "keep it simple, no unnecessary approval layers for ordinary tasks" instruction argues for
  direct EXECUTE (no second approver) for this specific, narrowly-scoped action, since the
  structural role-class allow-list (not a human approver) is what prevents misuse — but this is a
  judgment call the PO should confirm, not something this document silently decides.

### 2.4 Self-escalation / privilege-expansion prevention — reuse what already works, generalize nothing new that isn't load-bearing

Four independent, already-proven mechanisms, none requiring new invention, must all continue to
hold for `ADMINISTRATOR` exactly as they hold today for the existing assignment path:

1. **Self-assignment/self-revocation prohibited** — `c.principal.principalId === c.targetPrincipalId`
   check in `assign()`/`revoke()` is principal-agnostic already; it applies to `ADMINISTRATOR`
   automatically once it becomes a caller of this service, with zero new code.
2. **SUPER_ADMIN is permanently unassignable/unrevokable via this surface** —
   `validateCommand()`'s unconditional `roleKey === 'SUPER_ADMIN'` reject must remain exactly as
   strict when the service gains a second class of initiator (`ADMINISTRATOR`). This is the
   single most important invariant not to regress while implementing §2.3.
3. **`finance_class_restricted` DB trigger** — already prevents any CRITICAL_FINANCIAL function
   from ever reaching a non-Finance-class role, regardless of who initiates the write; continues
   to apply unchanged.
4. **New: `administrator_assignable` role-class check (§2.3)** — the one net-new structural gate,
   deliberately modeled on invariant 3's proven shape (a boolean role/function-class flag checked
   server-side, not a human-maintained list), so `ADMINISTRATOR` categorically cannot reach
   `SUPER_ADMIN` or any `FINANCE_*` role even if a future configuration change accidentally adds
   it to the wrong `initiatingRoles` array.

No role, including `ADMINISTRATOR` itself, should ever be able to **modify its own function
bundle** — that remains exclusively `workforce.role.modify` territory (Decision 10, independent
dual control, no self-approval, not implemented, not delegated to `ADMINISTRATOR` in this design).

### 2.5 Role-definition creation/modification governance — reaffirmed, not redesigned

`DECISIONS-01` Decision 10 already closed this (independent dual control, no self-approval, no
SUPER_ADMIN carve-out, modeled on `PrivilegedActionApprovalService` — the same mechanism already
governing `FINANCE_ROLE_ASSIGN`/`REVOKE`). This document does not reopen it. It adds one
clarification Decision 10 left implicit: **`ADMINISTRATOR` must never be an eligible initiator or
approver for `workforce.role.create`/`.modify`** — editing what a role *means* is a materially
different, higher-governance action than assigning an *existing* role to a person, and conflating
the two would silently hand `ADMINISTRATOR` the power to redefine its own or any other role's
authority. One genuine open question Decision 10 did not resolve (see §8 item 1): when
`SUPER_ADMIN` itself is the initiator of a role-definition change, who is the required
*independent* approver, given that the architecture deliberately allows only one active
SUPER_ADMIN at a time (§1.6)?

---

## 3. Function-level authority matrix (proposed, V1)

| Function | SUPER_ADMIN | ADMINISTRATOR (new) | FINANCE_* roles | Other 6 roles |
|---|---|---|---|---|
| `workforce.user.view` *(new)* | ✅ | ✅ | — | OPERATIONS only |
| `workforce.user.create` | ✅ | ✅ | — | OPERATIONS |
| `workforce.user.suspend` | ✅ | ✅ | — | OPERATIONS |
| `workforce.role.view` | ✅ | ✅ (new grant) | FINANCE_AUDITOR | — |
| `workforce.role.assign` — SUPER_ADMIN/FINANCE scope | ✅ (unchanged) | ❌ | — | — |
| `workforce.role.assign` — operational-role scope (new) | ✅ | ✅ (new grant, role-class-gated to the 6 operational roles only) | ❌ | ❌ |
| `workforce.role.revoke` — SUPER_ADMIN/FINANCE scope | ✅ (unchanged) | ❌ | — | — |
| `workforce.role.revoke` — operational-role scope (new) | ✅ | ✅ (new grant, role-class-gated) | ❌ | ❌ |
| `workforce.role.create` / `.modify` *(FUTURE, Decision 10)* | Initiator only, never self-approver | ❌ (never) | ❌ | ❌ |
| `ledger.post` / `.reverse` / `.approve_adjustment` | ❌ (DB-trigger-enforced) | ❌ | FINANCE_PREPARER (INITIATE) / not yet assignable (APPROVE) | ❌ |
| `agent.fund` / `.defund` approval | ❌ | ❌ | FINANCE_CONTROLLER (APPROVE) | AGENT_NETWORK_MANAGER (INITIATE) |
| `kyc.approve` / `.reject` | ✅ (unchanged, pre-existing) | ❌ | ❌ | COMPLIANCE |
| Assignment of `SUPER_ADMIN` itself | Only via one-time external bootstrap ceremony (§1.6), never via `assign()` | ❌ | ❌ | ❌ |

Everything not listed here is unaffected by this task and keeps its exact, already-decided
assignment from `DECISIONS-01`/`authorization-catalogue.seed.ts`.

---

## 4. Account provisioning and recovery (CEO / SUPER_ADMIN)

**Provisioning (unchanged, already implemented, already tested):** the one-time, externally
signed, environment- and audience-bound, replay-protected, MFA-mandatory offline bootstrap
ceremony (§1.6). No source change needed. The existing runbook's terminology
(`docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md` still says "FINANCE_ADMIN" in places) is
stale relative to the `RUNTIME-01` rename and should be corrected as a documentation-only fix
when this task's implementation work begins — not a design change.

**Protection (unchanged, already implemented):** SUPER_ADMIN cannot be assigned or revoked
through the ordinary role-administration HTTP surface at all (§1.3); cannot hold any
critical-financial function (DB-trigger-enforced, §1.1); the global-singleton-ACTIVE-row check in
`consumeBootstrap()` prevents a second SUPER_ADMIN from being minted by accident while one is
already active.

**Audit (unchanged, already implemented):** `WORKFORCE_BOOTSTRAP_CONSUMED` captures the full
statement (issuer, subject, principalId, scopes, environment, audience, validity window,
`approvalChangeReference`, signing-key reference) via `AuditService`.

**Recovery — the one genuine gap (new implementation required, §8 item 3):** there is currently
**no** administrative path to revoke or rotate a SUPER_ADMIN assignment (compromised credential,
departed CEO, lost MFA device, etc.). The only ways the single active row ever stops being active
are (a) its own `effectiveTo` expiring naturally, or (b) an out-of-band database intervention
with no application-level audit trail. Recommended shape (design-level, not committed): a
**second, equally offline, equally signed ceremony** — e.g. `SUPER_ADMIN_EMERGENCY_REVOKE` —
structurally distinct from the ordinary `assign()`/`revoke()` surface (which must keep refusing
`SUPER_ADMIN` unconditionally), requiring the same external signing-key custody discipline as the
original bootstrap, so that neither `ADMINISTRATOR` nor a single compromised SUPER_ADMIN session
can revoke/replace the CEO's own access unilaterally. The exact quorum/ceremony design is a
genuinely open Product Owner decision (§8 item 3), not something this document resolves — the
repository gives no precedent to extrapolate from (the existing bootstrap ceremony only covers
*creation*, never *revocation*, of SUPER_ADMIN).

---

## 5. Security invariants (must hold regardless of implementation detail)

1. SUPER_ADMIN is never assignable or revocable through the ordinary workforce role
   administration endpoint, under any configuration (existing, must not regress).
2. No role, including SUPER_ADMIN or ADMINISTRATOR, may hold a `finance_class_restricted`
   (CRITICAL_FINANCIAL) function — structurally enforced at the database layer (existing).
3. No principal may assign or revoke a role for itself (existing, principal-agnostic, must not
   regress).
4. ADMINISTRATOR may only target the explicit, structurally-flagged set of
   `administrator_assignable` roles (new — §2.3); it can never reach SUPER_ADMIN or any
   `FINANCE_*` role regardless of maker/checker-rule configuration mistakes.
5. Finance maker/checker separation (`FINANCE_ROLE_ASSIGN`/`REVOKE`'s existing rule: SUPER_ADMIN
   initiates, FINANCE_CONTROLLER approves, self-approval prohibited) is untouched and
   independent of whatever ADMINISTRATOR can or cannot do (existing, PO point 5).
6. `workforce.role.create`/`.modify`, whenever implemented, requires independent, non-self
   approval with no SUPER_ADMIN carve-out (Decision 10, reaffirmed, not re-decided here) and is
   never delegated to ADMINISTRATOR.
7. Every role/function mutation and every authorization decision remains unconditionally audited
   (existing `AuditService`/`AuthorizationService.recordDecision()` behavior, unchanged).
8. No CEO/organization identity is ever hardcoded in application source; all identity binding is
   OIDC-configuration- and ceremony-parameter-driven (existing, re-verified).

---

## 6. Implementation dependencies — what exists vs. what is new work

| Capability | Status |
|---|---|
| Catalogue tables, idempotent seed service, role-count-agnostic runtime resolution | **Exists** — `ADMINISTRATOR` can be seeded with zero schema change |
| SUPER_ADMIN bootstrap ceremony (provisioning) | **Exists**, tested |
| SUPER_ADMIN unassignable/unrevocable via `assign()`/`revoke()` | **Exists** |
| Self-assignment/self-revocation prohibition | **Exists**, principal-agnostic |
| `finance_class_restricted` / `read_only` DB-trigger invariants | **Exists** |
| `workforce.user.create`/`.suspend` (SUPPORT provisioning) | **Exists** — ADMINISTRATOR can be granted these with zero new code, only a seed-data change |
| `ADMINISTRATOR` role + its proposed bundle, seeded | **New** — seed-data-only change, same mechanism as the existing ten roles |
| `administrator_assignable` role-class flag + DB trigger analogous to `finance_class_restricted` | **New** — one migration (additive column + trigger), modeled directly on the existing pattern |
| A new, dedicated maker/checker-style rule for ADMINISTRATOR-initiated operational-role assignment, structurally gated by the flag above | **New** — service-layer logic in `A2FinanceRoleAdministrationService`, new action name, does not touch the existing `FINANCE_ROLE_ASSIGN`/`REVOKE` rule |
| A GET endpoint (or equivalent) to list current role assignments, gated by `workforce.role.view` | **New** — the function already exists in the catalogue but is unwired to any controller; closing this is independent of the ADMINISTRATOR work but materially needed for "day-to-day administration" to be usable at all |
| `workforce.role.create`/`.modify` (dynamic role editing, Decision 10's governance) | **New**, FUTURE, out of this task's recommended implementation scope — V1 can launch with ADMINISTRATOR as a statically seeded eleventh role without this |
| SUPER_ADMIN revoke/rotate (emergency recovery) ceremony | **New**, genuinely undesigned — see §8 item 3 |
| `workforce.user.enable` catalogue function (re-enabling a suspended SUPPORT user) | **New** — pre-existing, independently documented gap (`admin-support-credentials.controller.ts`), unrelated to this task but adjacent; not required to ship ADMINISTRATOR |
| Admin Web role-administration screens (assignment-with-roster-view, ADMINISTRATOR-scoped) | **New**, explicitly out of this task's scope per instruction — design only |

---

## 7. Compatibility with the existing ten roles

Adding `ADMINISTRATOR` changes nothing about the ten roles' own definitions, function bundles, or
assignment paths. FINANCE_PREPARER/CONTROLLER/AUDITOR's existing 4-role-capped assignment
mechanism is untouched (ADMINISTRATOR is never added to its `initiatingRoles`). SUPER_ADMIN's own
authority is unchanged — it retains every capability ADMINISTRATOR has (ADMINISTRATOR is a
strict subset) plus everything else it already holds. The six catalogue-only organizational roles
(`OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`,
`TREASURY`) gain, for the first time, an actual production-reachable way to be assigned to a real
workforce principal (today impossible via any HTTP path, per §1.3) — a net improvement to V1
launch-readiness unrelated to the ADMINISTRATOR concept itself, but unlocked by the same §2.3
mechanism this design requires regardless of who the initiator is.

---

## 8. Product Owner decisions that genuinely remain unresolved

Everything else in this document follows directly from repository fact or from `DECISIONS-01`'s
already-final decisions. Only the following require fresh Product Owner input:

1. **Who approves a role-definition change (`workforce.role.create`/`.modify`, once built) when
   the initiator is SUPER_ADMIN itself?** Decision 10 mandates no self-approval and no SUPER_ADMIN
   carve-out, but the architecture deliberately allows only one active SUPER_ADMIN at a time
   (§1.6), so there is categorically no second SUPER_ADMIN-equivalent principal available as
   approver. Candidates: `ADMINISTRATOR` as approver (but then ADMINISTRATOR gains indirect
   influence over role definitions, in tension with §2.5); `FINANCE_CONTROLLER` (precedent:
   already approves `FINANCE_ROLE_ASSIGN`/`REVOKE`, but has no organizational mandate over
   non-Finance role design); or a new, dedicated governance-approver eligibility distinct from
   both. This was already flagged as open by `SPEC-01` §28 item 10's closing remark and was not
   finally pinned down by Decision 10.
2. **Should ADMINISTRATOR-initiated assignment of the six operational roles require a second
   approver, or is direct execution (structurally role-class-gated, no human approver) sufficient
   for V1?** This document recommends direct execution per the "keep it simple" instruction, but
   it is a judgment call the PO should explicitly confirm rather than have silently decided for
   them.
3. **How should a compromised or departed CEO's SUPER_ADMIN assignment be revoked or rotated?**
   No such path exists today in any form (§1.6/§4). This is not a minor gap — it is a complete
   absence of a disaster-recovery mechanism for the organization's highest authority, and
   designing its ceremony/quorum requires explicit Product Owner risk-tolerance input this
   document cannot supply on its own.
4. **Does "separate organizations" mean separate deployments (today's model, already satisfied —
   no hardcoded identity, independent OIDC configuration and bootstrap ceremony per deployment)
   or genuine multi-tenant SaaS (many organizations' SUPER_ADMINs coexisting in one shared
   database/schema)?** The former requires no new work; the latter would require an
   `organization_id` partition across the entire authorization model (roles, functions,
   assignments, approvals) and is a materially larger undertaking not implied by anything in the
   repository today. The two readings lead to very different implementation scopes.

No other open question remains — every other aspect of this design is either already decided
(`DECISIONS-01`) or already implemented and merely being extended by the same established
patterns (catalogue seeding, DB-trigger-style structural invariants, maker/checker rule
configuration).
