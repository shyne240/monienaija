# V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01 — Closing the Four Governance Decisions

**Status:** Design-only. No source code, migration, catalogue entry, role assignment, API, or
Admin Web file was modified in the course of producing this document.
**Baseline commit:** `8a3f582c9581ef42ea4e917d94ded8bb9f724fc0` on `arena/01a10374-monienaija`
(the commit that introduced `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01.md`).
**Supersedes-by-closing:** §8 items 1–4 of `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01.md`
("Product Owner decisions that genuinely remain unresolved"). That document's current-state audit
(§1), proposed model (§2–3), and security invariants (§5) are the factual foundation this
document builds on and does not restate in full — read it first.
**Also builds on (unchanged):** `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md`,
`V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md` (Decisions 3, 7, 10 in particular).

---

## 0. Workspace integrity note (pre-work recovery, performed before any design work)

Before starting, local git state was verified against the instructions:

- `git fetch origin arena/01a10374-monienaija` → remote tip `8a3f582c9581ef42ea4e917d94ded8bb9f724fc0`.
- Local branch ref was stale at `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (the original
  branch-point commit) — `git reflog` showed only `clone` then `checkout: moving from main to
  arena/01a10374-monienaija` for this sandbox instance, confirming a fresh checkout whose local
  ref never advanced past the branch point, while the on-disk working tree content was already
  current (same recurring sandbox artifact observed and documented in earlier sessions on this
  task).
- **Proof the apparent differences were artifacts, not real changes:** `git diff`/`git status`
  against the stale local HEAD reported ~1,286 changed/untracked paths. Rather than trust that
  figure, every file was content-compared directly against the actual remote tip tree
  (`git archive origin/arena/01a10374-monienaija` extracted to a scratch directory, then
  `diff -rq` against the working tree, excluding `.git`/`node_modules`): **zero differences across
  all 1,826 files.** This proved conclusively that the working tree already matched the remote
  tip byte-for-byte and that nothing was at risk of being lost.
- **Reconciliation performed:** `git reset --mixed origin/arena/01a10374-monienaija`. This command
  only moves `HEAD` and rewrites the index to match the target commit — it does not touch a single
  file in the working tree, and no `--hard`, `clean`, or forced checkout was used, per the explicit
  constraint. Because the working tree already matched that tree exactly, the result was an
  immediately clean `git status` with no content change of any kind.
- **Verified outcome:** local HEAD = remote HEAD = `8a3f582c9581ef42ea4e917d94ded8bb9f724fc0`;
  `git status --porcelain` empty. This is the safe baseline the rest of this task builds on.

---

## 1. Decision — Approval authority for SUPER_ADMIN-initiated role-definition changes

### Chosen rule

`workforce.role.create` and `workforce.role.modify` (the still-unimplemented capability first
scoped by `DECISIONS-01` Decision 10) may only ever be **initiated by SUPER_ADMIN** (never by
`ADMINISTRATOR` — reaffirmed from `GOVERNANCE-01` §2.5) and must be **approved by
`FINANCE_CONTROLLER`**, using the existing, already-implemented, generic
`PrivilegedActionApprovalService` — the exact same request→approve→consume mechanism already
governing `workforce.role.assign`/`.revoke` today. No new approver role is introduced.

### Rationale

The task instruction is explicit: *"do not invent an approver role without specifying how it is
provisioned and constrained."* The Product Owner has also fixed the initial role roster at
**exactly eleven** roles (the existing ten plus `ADMINISTRATOR`) — so the only legitimate
candidates for an approver are roles that already exist in that roster. Of those eleven:

- `ADMINISTRATOR` is excluded by `GOVERNANCE-01` §2.5 (it must never be able to influence role
  *definitions*, only role *assignments* — conflating the two would let the "ordinary"
  administrative role indirectly rewrite its own or anyone else's authority).
- `FINANCE_CONTROLLER` is the **only** role in the existing catalogue that already has a proven,
  independent, MFA-mandatory, self-approval-forbidden checker function
  (`finance-role-administration.service.ts`'s `FINANCE_ROLE_ASSIGN`/`REVOKE` rule:
  `approvingRoles: ['FINANCE_CONTROLLER']`, 1 approval required, requester-cannot-approve-own-request).
  Reusing it for role-definition changes requires **zero new human process, zero new credential,
  zero new provisioning path** — the same individual(s) who already serve as Finance's checker
  simply gain one more catalogue function grant (`workforce.role.create`/`.modify`, APPROVE). This
  is the literal smallest secure implementation available inside the fixed eleven-role roster.
- `COMPLIANCE` was considered and rejected: it has no existing precedent as an approver for any
  privileged administrative action today, so using it would still require inventing a new
  approval pattern from scratch — more implementation surface than reusing `FINANCE_CONTROLLER`'s
  already-proven one, for no clear governance benefit.

This does **not** weaken "Finance maker/checker separation remains independent of administrative
seniority" (PO constraint): that principle governs whether *administrative seniority* can
substitute for or bypass Finance's own maker/checker chain on *financial* actions — it is silent
on, and not violated by, FINANCE_CONTROLLER additionally acting as an independent check on a
*non-financial*, structural governance action. If anything, this gives the organization a natural,
already-existing counterweight to the CEO's administrative authority without inventing a twelfth
role.

### Security invariants

- SUPER_ADMIN can never approve or consume its own `workforce.role.create`/`.modify` request —
  enforced today, generically, by `PrivilegedActionApprovalService.decide()`'s
  `approval.requesterPrincipalId === command.principal.principalId → 'SELF_APPROVAL_FORBIDDEN'`
  check (`src/authorization/privileged-action-approval.service.ts`). No new code is needed for
  this guarantee — it already applies to any action routed through this service, by any pair of
  principals.
- The approver must hold the specific approval scope and **MFA assurance**
  (`approval.requiredAssurance === 'MFA' && command.principal.assuranceLevel !== 'MFA' →
  'MFA_REQUIRED'`) — already generic, already enforced, no new code needed.
- `ADMINISTRATOR` can never be granted `workforce.role.create`/`.modify` INITIATE or APPROVE —
  must be enforced by catalogue seed composition (new role definitions simply never grant it these
  functions) and, as defense in depth, should be added as an explicit assertion in the integration
  test suite that proves the role's function bundle (same pattern already used by
  `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md`'s own verification approach).

### Repository evidence

- `src/authorization/privileged-action-approval.service.ts` (639 lines, read in full this task):
  `request()`/`approve()`/`reject()`/`consume()`/`cancel()` form a generic, action-agnostic,
  scope-gated, self-approval-forbidden, MFA-aware approval lifecycle, already used elsewhere in
  the codebase for privileged, sensitive actions unrelated to Finance maker/checker. It is **not**
  role-name-specific — it is driven entirely by `approvalScope` (a string like
  `privileged:approve`) and `requiredAssurance`, both supplied by the calling policy. This means
  "designate FINANCE_CONTROLLER as approver" is purely a catalogue/config wiring decision (which
  function grants FINANCE_CONTROLLER holds), not a service-layer change.
- `src/authorization/finance-role-administration.service.ts`'s existing
  `A2_MAKER_CHECKER_RULES_JSON` entry for `FINANCE_ROLE_ASSIGN`/`REVOKE` is the direct precedent:
  `initiatingRoles: ['SUPER_ADMIN']`, `approvingRoles: ['FINANCE_CONTROLLER']` — the exact shape
  being proposed for `workforce.role.create`/`.modify`.
- `authorization-catalogue.seed.ts`: FINANCE_CONTROLLER is the sole holder of
  `workforce.role.assign`/`.revoke` APPROVE today; SUPER_ADMIN is the sole holder of INITIATE.
  Granting FINANCE_CONTROLLER one more APPROVE-only function (`workforce.role.create`/`.modify`)
  is additive seed data, not a structural change to the entity model.

### Implementation consequences

1. `workforce.role.create`/`.modify` must be implemented (still FUTURE, per `DECISIONS-01`
   Decision 10 — unchanged by this document) wired through `PrivilegedActionApprovalService`
   exactly as role assignment is today: `request()` by SUPER_ADMIN → `approve()` by
   FINANCE_CONTROLLER → `consume()`/execute by SUPER_ADMIN (or a system actor on SUPER_ADMIN's
   behalf) once approved.
2. Catalogue seed addition: `workforce.role.create`/`.modify` functions (INITIATE→SUPER_ADMIN,
   APPROVE→FINANCE_CONTROLLER), `approvalRequired: true`, `makerCheckerRequired: true`.
3. No change to the existing `FINANCE_ROLE_ASSIGN`/`REVOKE` rule or to FINANCE_CONTROLLER's
   existing Finance-domain scope — this is a pure additive grant.

### Genuine residual limitation (not solvable by this mechanism alone — disclosed, not hidden)

SUPER_ADMIN, as the sole initiator of FINANCE_CONTROLLER's *own* first assignment (and of any
subsequent FINANCE_CONTROLLER change via the existing `FINANCE_ROLE_ASSIGN` rule, where SUPER_ADMIN
is also the sole initiator), retains indirect influence over who occupies the approver seat. A
single further-compromised or coerced SUPER_ADMIN could, over two separate actions, revoke the
sitting FINANCE_CONTROLLER and have an ally re-appointed, then push through a self-serving role
definition. This is an inherent structural limit of any design with exactly one highest
administrative authority and is **not** something application code can fully close — it requires
an out-of-system control (e.g., a board- or compliance-level policy requiring independent sign-off
before any FINANCE_CONTROLLER *re*-assignment, or multi-person custody of the Finance officer
appointment process) layered on top of, not instead of, the in-app approval gate described above.
This is flagged explicitly rather than silently assumed away.

---

## 2. Decision — ADMINISTRATOR's operational-role assignment/revocation authority

### Chosen rule

`ADMINISTRATOR` may assign and revoke exactly the six catalogue-only organizational roles
(`OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`,
`TREASURY`) by **direct execution — no second human approver** — gated by a **database-enforced**
structural check that makes it physically impossible for this action to ever reach `SUPER_ADMIN`
or any `FINANCE_*` role, regardless of maker/checker-rule misconfiguration, application bugs, or
direct SQL access. Every assignment and revocation remains fully audited.

### Rationale

This directly matches the task's own design instruction ("Recommend allowing ADMINISTRATOR to
assign and revoke the six permitted operational roles without a second approver, subject to a
database-enforced role-class restriction... Audit every assignment and revocation") and the
standing "keep it simple, no unnecessary approval layers for ordinary administration" constraint.
The six target roles are all already seeded with no financial, compliance-decision, or
administrative-capability authority of consequence beyond their own narrow domain (per
`SPEC-01` §6 and the catalogue's own `nowAssign` grants) — they are the correct shape for "routine
workforce administration." Requiring a second approver for every such routine assignment would
reintroduce exactly the friction the Product Owner asked this design to avoid, while a
database-enforced allow-list (rather than a human approver) gives an equally strong, and more
reliably-applied, guarantee against the one outcome that actually matters: `ADMINISTRATOR`
reaching `SUPER_ADMIN` or `FINANCE_*`.

### Repository evidence and the precise technical gap this closes

Two separate, currently-unconnected tables matter here, and the distinction is material to the
implementation shape:

- `authorization_role_functions` (migrated by `1785753600083-CreateAuthorizationCatalogue.ts`)
  already carries a proven DB-trigger pattern for exactly this kind of allow-list enforcement:
  `fn_authorization_enforce_finance_class_restriction()` rejects, at `INSERT`/`UPDATE` time
  (`BEFORE INSERT OR UPDATE ON authorization_role_functions`), any attempt to assign a
  `finance_class_restricted` function to a role whose `finance_role_class` flag is not `TRUE` —
  this is what governs which *functions* belong in a *role's bundle*.
- `a2_finance_role_assignments` (`src/authorization/workforce-authentication.entity.ts`) is the
  table that actually matters for this decision — it governs which *principal* holds which
  *role*. Direct inspection of its entity definition shows `role_key` is a bare
  `varchar(100)` **with no foreign key to `authorization_roles` at all** — the two tables are
  presently disconnected. This means the existing `finance_class_restriction` trigger, however
  good a pattern, **cannot be reused unmodified** for this decision; it would need to be
  reproduced, in its own self-contained form, directly on `a2_finance_role_assignments`.

Given that disconnect, and in the interest of the smallest secure implementation, the recommended
mechanism is a **`CHECK` constraint**, not a cross-table trigger — simpler than the existing
pattern, not more complex, because the set of "administrator-assignable" role keys is small,
fixed, and does not need a second table lookup:

1. Add a new column to `a2_finance_role_assignments`: `initiated_scope VARCHAR(32) NOT NULL`
   (e.g. `'SUPER_ADMIN_SCOPE' | 'ADMINISTRATOR_SCOPE'`), set by the service layer at write time
   based on which code path/initiating role performed the write — immutable after insert (no
   application code path ever updates it).
2. Add a `CHECK` constraint:
   ```sql
   ALTER TABLE a2_finance_role_assignments
     ADD CONSTRAINT chk_administrator_scope_role_allowlist
     CHECK (
       initiated_scope <> 'ADMINISTRATOR_SCOPE'
       OR role_key IN ('OPERATIONS', 'AGENT_NETWORK_MANAGER', 'COMPLIANCE', 'RISK_FRAUD', 'CUSTOMER_SERVICE', 'TREASURY')
     );
   ```
   This is enforced by PostgreSQL itself on every `INSERT`/`UPDATE`, for every caller, including a
   direct SQL session — the same structural guarantee class as the existing
   `finance_class_restricted` trigger, just self-contained to one table and therefore simpler to
   build and to reason about.
3. A new, dedicated action (e.g. `WORKFORCE_ROLE_ASSIGN_OPERATIONAL`/`..._REVOKE`) is added to
   `A2FinanceRoleAdministrationService`, structurally distinct from the existing
   `FINANCE_ROLE_ASSIGN`/`REVOKE` code path (which is untouched and keeps governing the three
   Finance roles exactly as today). This new action sets `initiated_scope = 'ADMINISTRATOR_SCOPE'`
   and performs a **direct EXECUTE** (no call into `PrivilegedActionApprovalService` — no second
   approver), relying on the CHECK constraint, not a human maker/checker pair, as the control.
4. `SUPER_ADMIN` retains unrestricted use of all role-assignment actions, including this new one
   (it is the highest authority and a strict superset of ADMINISTRATOR's capability, per PO
   direction point 1), but `SUPER_ADMIN` itself — and the `FINANCE_*` roles — remain unreachable
   through `WORKFORCE_ROLE_ASSIGN_OPERATIONAL` by construction (the `CHECK` constraint applies
   regardless of which principal is the initiator; it is keyed off `initiated_scope`, which the
   service only ever sets to `'ADMINISTRATOR_SCOPE'` for this specific new action — SUPER_ADMIN
   using *this* action is still bound by the same allow-list, which is fine, since SUPER_ADMIN has
   a separate, unrestricted path for the other roles).
5. `ADMINISTRATOR`'s own assignment is **not** included in the six-role allow-list — granting or
   revoking `ADMINISTRATOR` itself remains `SUPER_ADMIN`-only, via the existing
   `INITIAL_BOOTSTRAP_ASSIGNABLE_ROLES`-style first-assignment gate (extended to include
   `ADMINISTRATOR` alongside the three Finance roles) and the existing
   `FINANCE_ROLE_ASSIGN`/`REVOKE`-equivalent maker/checker rule for subsequent changes. This
   closes a gap that would otherwise be implicit: `ADMINISTRATOR` cannot mint peer `ADMINISTRATOR`
   accounts, matching the no-self-escalation / no-lateral-proliferation requirement.

### Security invariants

- Self-assignment/self-revocation prohibition (`c.principal.principalId === c.targetPrincipalId`)
  applies unchanged to this new action — it is already principal-agnostic in
  `A2FinanceRoleAdministrationService`.
- `SUPER_ADMIN` and all three `FINANCE_*` roles are categorically unreachable through
  `ADMINISTRATOR`-initiated assignment — enforced at the database layer, not merely by
  application code, by the proposed `CHECK` constraint.
- Every assignment and revocation performed under this action is audited with full before/after
  metadata by `AuditService`, exactly as the existing `FINANCE_ROLE_ASSIGN`/`REVOKE` actions are
  today (no new audit mechanism needed — `AuditService.record()` is already called generically
  from this service).
- `ADMINISTRATOR` cannot be assigned or revoked via this action (explicitly excluded from the
  allow-list), and cannot modify any role's function bundle (no access to
  `authorization_role_functions` at all, under any action).

### Implementation consequences

New migration (column + `CHECK` constraint on `a2_finance_role_assignments`), new service method
pair in `A2FinanceRoleAdministrationService`, new `ADMINISTRATOR` catalogue grants
(`workforce.role.assign`/`.revoke`, scoped operationally — this likely needs a distinct function
code, e.g. `workforce.role.assign_operational`, from the existing `workforce.role.assign` so the
two code paths remain independently auditable and independently revocable function grants, rather
than overloading one function code with two different authorization meanings). Admin Web changes
to surface this (out of scope for this document, per instruction) would follow in a later,
separate task.

---

## 3. Decision — SUPER_ADMIN recovery, revocation, and replacement

### Chosen rule

No administrative path exists today (confirmed, `GOVERNANCE-01` §1.6/§4) to revoke or replace a
SUPER_ADMIN. The recommended design is a **second, structurally separate offline ceremony**,
`SUPER_ADMIN_REVOCATION`, built on the exact same trust model as the existing, already-implemented
bootstrap ceremony (`consumeBootstrap()`) — external signing-key custody is the ultimate authority,
the application only *consumes* an already-signed statement, and **no in-app role, including
`ADMINISTRATOR`, can produce a valid statement on its own.** Replacement is simply "revoke" (new)
followed by the existing, unchanged bootstrap ceremony (already implemented) naming a new CEO
identity.

### Rationale

The task instruction is explicit that `ADMINISTRATOR` must not be able to elevate itself or
unilaterally replace `SUPER_ADMIN`. The only mechanism in this codebase that already achieves
"no single in-app actor can mint/alter the top role, no matter what scopes or collusion exist
inside the running application" is the existing bootstrap ceremony's design: the application
trusts an **externally produced, offline-signed artifact**, not any combination of in-app
sessions or scopes. Revocation needs the identical trust boundary, or it would be strictly weaker
than creation — an inconsistency the Product Owner's instruction ("controlled, independently
authorized recovery process") is clearly trying to avoid.

### Repository evidence

- `A2FinanceRoleAdministrationService.consumeBootstrap()` and
  `scripts/generate-bootstrap-statement.ts`: the existing creation ceremony is RS256-signed
  offline, environment-bound, audience-bound, nonce-replay-protected, and MFA-mandatory at
  consumption time — fully re-verified this session, unchanged.
- `validateCommand()` unconditionally rejects `roleKey === 'SUPER_ADMIN'` for both `assign()` and
  `revoke()` — confirmed, and this document does **not** propose relaxing that guard. Any
  recovery mechanism must be a structurally separate code path, not a loosening of this
  invariant, so that the ordinary assignment surface's SUPER_ADMIN-immunity remains absolute.
- `test/v1-workforce-bootstrap-01.integration.spec.ts` (11 scenarios: identity binding, scope
  lock, expiry, replay, malformed input, environment binding, MFA, kill switch) proves the
  creation ceremony's security properties are already battle-tested; the revocation ceremony
  should be designed, implemented, and tested to the same standard, not as an afterthought.

### Proposed shape (design-level; this document specifies the model, not working code)

1. **Statement:** a `SUPER_ADMIN_REVOCATION` JWS statement, signed offline by the same
   custody chain as the original bootstrap statement (same keys, same procedural control over who
   may produce one — this is an organizational/procedural decision, not a software one; see
   "Genuine blocker" below). The statement names the specific active assignment being revoked (by
   `assignment_reference`/id, not merely "the current SUPER_ADMIN", to prevent any ambiguity or
   race against a concurrent bootstrap), has a short validity window, and is single-use
   (nonce-replay-protected, exactly like the bootstrap statement).
2. **Consumption:** a new, narrow method, e.g. `consumeRevocation()`, structurally separate from
   `assign()`/`revoke()` (which remain untouched and keep refusing `SUPER_ADMIN` unconditionally).
   Consumption requires an authenticated, MFA-asserted in-app session — recommended to require the
   `ADMINISTRATOR` role as the consuming session (since it is the only other role with
   workforce-administration visibility), but **the application never trusts `ADMINISTRATOR`'s own
   judgment** — it only executes an already-externally-signed instruction, exactly as
   `consumeBootstrap()` already does for *any* OIDC-authenticated session today. This is what
   prevents unilateral action: `ADMINISTRATOR` can request/trigger consumption, but cannot produce
   a valid statement, so it cannot act alone.
3. **Outcome:** the targeted assignment row's `status` is set to `REVOKED` (mirroring the shape of
   the existing `revoke()` method's state transition, but via the separate code path). The system
   is left, legitimately and auditably, with **zero** active SUPER_ADMIN until a fresh
   `consumeBootstrap()` ceremony is run — reusing all of the existing, unchanged creation
   machinery for "replacement." No new creation logic is needed.
4. **Audit:** a new `SUPER_ADMIN_REVOKED` audit/security event, recorded with the same fidelity as
   `WORKFORCE_BOOTSTRAP_CONSUMED` (full statement metadata, signing-key reference, consuming
   session, timestamp).

### Security invariants

- `ADMINISTRATOR` alone can never produce a valid `SUPER_ADMIN_REVOCATION` statement — only the
  offline signing-key custodian(s) can; the application enforces signature verification exactly
  as it does for bootstrap statements today.
- `ADMINISTRATOR` cannot use the ordinary `revoke()` path to touch `SUPER_ADMIN` — that guard is
  untouched by this proposal.
- `ADMINISTRATOR` cannot self-promote to `SUPER_ADMIN` through this or any other path — the
  revocation ceremony only removes the *existing* SUPER_ADMIN's assignment; appointing a successor
  still requires a brand-new, independently-signed bootstrap statement naming whichever identity
  the organization intends to install, which is produced entirely outside the application by the
  same external authority — not a side effect of revocation.
- Revocation and the subsequent bootstrap are both independently, fully audited.

### Implementation consequences and genuine blocker

This is **new infrastructure and a new procedure**, not a configuration change:

- New statement type, new signing/verification code (can largely mirror the existing bootstrap
  statement's crypto/validation logic), new migration (revocation metadata/audit fields), new
  service method, new tests to the same standard as the 11 existing bootstrap tests.
- **Genuine, non-software blocker:** who custodies the offline signing key(s) and under what
  real-world policy (single officer, board quorum, independent security function, etc.) is an
  organizational governance decision this document cannot make on the Product Owner's behalf —
  software can only enforce that *whoever* holds that external authority is the only party able to
  mint or revoke the top role; it cannot substitute for an actual, named, accountable custody
  policy. This should be explicitly decided and documented (e.g. in the deployment runbook
  alongside `V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`) before this capability is built.

---

## 4. Decision — Organization model: separate deployments, not multi-tenant SaaS

### Chosen rule

V1 treats "separate organizations" as **separate deployments** (separate databases, separate OIDC
configuration, separate bootstrap ceremony and SUPER_ADMIN per deployment). True multi-tenant SaaS
— many organizations' SUPER_ADMINs and role catalogues coexisting inside one shared
database/schema — is explicitly **deferred**, not designed, and not implied by anything in the
current repository.

### Rationale

The task instruction directs exactly this unless the repository shows evidence of existing
multi-tenant support. It does not.

### Repository evidence

- No `organization_id`/`tenant_id` column exists anywhere in the authorization model:
  `authorization_roles`, `authorization_functions`, `authorization_role_functions`,
  `a2_finance_role_assignments`, `a2_workforce_sessions` — all confirmed, none scoped by
  organization.
- `consumeBootstrap()`'s "already completed" check
  (`ar.findOne({roleKey:'SUPER_ADMIN', status:'ACTIVE'})`) is a **global, deployment-wide
  singleton** with no scoping key — by construction, this codebase's data model supports exactly
  one active SUPER_ADMIN per database, full stop.
- Identity binding (`A2WorkforceOidcService`) is entirely environment-variable-driven
  (`A2_WORKFORCE_OIDC_*`) — each deployment points at its own organization's OIDC provider. This
  already gives each organization full identity independence without any hardcoded identity in
  source, satisfying the literal requirement in PO direction point 7 under the
  separate-deployments reading.

### Security invariants

- No change required to achieve this — it is the system's current, de facto behavior. The only
  "invariant" being stated here is a scope boundary: this design and its implementation must not
  attempt to introduce cross-organization data sharing, a shared SUPER_ADMIN pool, or any
  tenant-scoped relaxation of the global singleton check, since none of that exists today and
  retrofitting it would be a substantially larger, separately-scoped effort (full
  `organization_id` partitioning across roles, functions, assignments, approvals, and audit).

### Implementation consequences

None for this task. This decision closes `GOVERNANCE-01` §8 item 4 without requiring new work —
it simply confirms the existing architecture is the intended V1 shape and that multi-tenant SaaS,
if ever desired, is a distinct, future, much larger initiative requiring its own dedicated design
document.

---

## 5. Summary — all four decisions closed

| # | Decision | Closed as | New implementation required? |
|---|---|---|---|
| 1 | SUPER_ADMIN role-definition-change approver | `FINANCE_CONTROLLER`, via existing `PrivilegedActionApprovalService` | Yes — `workforce.role.create`/`.modify` itself (already FUTURE per Decision 10) + one new catalogue grant |
| 2 | ADMINISTRATOR operational-role assignment | Direct execute, no second approver, DB `CHECK`-constraint-enforced allow-list of the six roles | Yes — new column + constraint on `a2_finance_role_assignments`, new service action, new catalogue grants |
| 3 | SUPER_ADMIN recovery/revocation/replacement | New, structurally separate offline ceremony mirroring bootstrap's trust model; `ADMINISTRATOR` can trigger consumption but cannot produce a valid statement alone | Yes — new statement type, new service method, new migration, new tests; plus a **non-software** signing-key custody policy decision |
| 4 | Organization model | Separate deployments per organization (current architecture, unchanged) | No |

With these four decisions closed, `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01.md`'s §8 open
items are fully resolved. Implementation of `SUPER_ADMIN` recovery tooling and `ADMINISTRATOR` as
an eleventh role may proceed against this specification. No source code, migration, catalogue
entry, role, API, or Admin Web change has been made as part of producing either governance
document — both remain design-only deliverables pending a separate implementation task.
