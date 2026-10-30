# 30 — Gate B D-01/D-04: Approved Product Policy, Hybrid Authorization Architecture and Implementation Plan

- **Prepared by:** Arena 3 (implementation agent), for **Security review and approval** before any implementation begins.
- **Application evidence baseline:** `8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4` (worktree verified identical; this document adds no code).
- **Decision pack:** Report 29, `04645b29d0d916fca56ac337468c11722cbccf3d`. **Product Owner decisions: recorded in §1.**
- **STATUS BANNER — read first:**
  - The hybrid policy below is **APPROVED PRODUCT POLICY**. It is **NOT IMPLEMENTED**, **NOT Security-co-signed** (co-signature **PENDING**, §3), and **NOT independently accepted**.
  - Nothing in the current application behaves as described in §2; today's behavior remains global-within-category as documented in Report 29 §1.
  - Implementation is **stopped** until Security has reviewed this architecture and explicitly approved the relevant controls (mission stop condition).
  - No application code, enum, allowlist, seed, contract, migration, database record or Admin UI file was modified for this package. Admin UI items are handoff specifications for the dedicated frontend workstream (§5.3), not changes.

---

## 1. Formal decision record (Phase 1)

Product Owner selections (as issued 2026-10-30; Security co-signature **PENDING** for all rows):

| Decision | Selection | Binding content | Security co-sign | Implementation state |
|---|---|---|---|---|
| **D-01-O2 — Hybrid compliance authorization** | SELECTED | (a) category-authorized employees may **read** cases within their permitted categories (global-within-category reads, as today); (b) case **mutations require a valid assignment** to the employee; (c) designated supervisory leads may **override** assignment restrictions with a **mandatory reason** and an **immutable audit record**; (d) SUPER_ADMIN and ADMINISTRATOR must **not** automatically receive override authority or self-grant it; (e) customer, agent and SUPPORT principals remain excluded; (f) FRAUD vs non-FRAUD category isolation remains mandatory and unchanged | **PENDING** | NOT IMPLEMENTED |
| **D-01-V — VIEW-only grants** | DEFERRED | No VIEW-only grant may be created/seeded until the Admin UI models access-type distinctions (backend mechanism already distinguishes VIEW/EXECUTE at the guard) | **PENDING** | Deferred (no work scheduled) |
| **D-01-N — Case numbers** | SELECTED | Server-generated opaque case numbers for **new** cases, subject to compatibility and migration planning (§4); historical identifiers preserved and still resolvable | **PENDING** | NOT IMPLEMENTED (M5) |
| **D-04-O1 — Taxonomy** | SELECTED | The existing nine categories and the FRAUD/non-FRAUD authorization split are retained as ratified V1 policy; changes only via the governed procedure (§5.2) | **PENDING** | Ratified; corrections are documentation/UI-handoff only (§5.3) |
| **D-04-H — Reclassification** | SELECTED | Close-and-reopen is the V1 reclassification path; historical category records preserved; no in-place category rewrite | **PENDING** | Policy recorded (no code needed) |

The standing register `docs/audit/20261028/06-PRODUCT-DECISION-REGISTER.md` receives a dated update section pointing to this record (historical rows unchanged). Per Report 28 §7, Gate B remains **PARTIAL — NOT PASSED** until M6 acceptance; P0-01 remains **CONDITIONAL PASS** until then.

---

## 2. Hybrid authorization architecture (Phase 2 — design for Security review; not implemented)

### 2.1 Operational assignment metadata vs authoritative authorization assignments (the core distinction)

| Property | Operational assignment (EXISTS today) | Authoritative assignment (PROPOSED, new) |
|---|---|---|
| Store | `compliance_case_assignments` (append history rows) + denormalized `customer_compliance_cases.assigned_to` (`customer-compliance.service.ts:430-485`) | New table `compliance_case_authorization_assignments` (M1) |
| Meaning | Workflow information: who is working the case; displayed in Admin | The **only** source the mutation gate consults |
| Authorization effect | **None** (today and after implementation) | Decides mutation allowed/denied (with override) |
| Lifecycle | Append-only history; `assigned_to` holds the latest assignee as free text (`normalizeActor`, **not validated as an active workforce user** — improvement flagged to Security, §3 row 1) | Explicit `ACTIVE`/`REVOKED` lifecycle; append-only rows; revoke fields; one ACTIVE row per (case, worker) enforced by partial unique index |
| Writers | Assignment route (EXECUTE-gated today; management-gated in M4) | Only the management-governed path (§2.7), in the same transaction as the operational write |
| Consistency rule | — | Every assignment-management action writes **both** stores atomically; the authoritative table never feeds workflow display |

This separation means the existing operational table/history keeps its audit and UI role untouched, while authorization reads a purpose-built, integrity-constrained store — and a stale or free-text operational `assigned_to` value can never grant access by itself.

### 2.2 Authoritative table design (M1 migration)

`compliance_case_authorization_assignments`:
- `id uuid PK`; `case_id uuid NOT NULL` (FK → `customer_compliance_cases(id)`, application-consistent since cases are soft-deleted); `customer_id uuid NOT NULL` (denormalized for scoped queries); `worker_id varchar(160) NOT NULL` (workforce principal id).
- `status varchar(10) NOT NULL CHECK (status IN ('ACTIVE','REVOKED'))`.
- `granted_by varchar(160) NOT NULL`, `granted_at timestamptz NOT NULL`, `granted_via varchar(24) NOT NULL CHECK (granted_via IN ('ADMIN_ASSIGNMENT','CASE_CREATION'))`.
- `revoked_by varchar(160) NULL`, `revoked_at timestamptz NULL`, `revoke_reason varchar(500) NULL` (all-or-none via CHECK).
- **Partial unique index:** `UNIQUE (case_id, worker_id) WHERE status='ACTIVE'` — reactivation after revocation is a NEW row (append-only integrity; full revocation history preserved).
- Indexes: `(worker_id, status)`, `(case_id, status)`.
- No update trigger needed beyond repo conventions; rows transition ACTIVE→REVOKED exactly once (service-enforced under row lock; an immutability guard trigger on non-status columns is proposed for Security review).

### 2.3 Assignment lifecycle, revocation and reassignment

- **Assign:** management-governed action → one transaction: authoritative ACTIVE row (`granted_via='ADMIN_ASSIGNMENT'`) + operational history row + `assigned_to` update + case history `ASSIGNMENT_CHANGED` + audit records (existing pattern, service L434-485) — extended, never replaced.
- **Reassign:** atomic revoke-old + grant-new in one transaction (both stores), single history trail.
- **Revoke:** ACTIVE→REVOKED with `revoked_by`/`revoked_at`/`revoke_reason`; immediately effective for **new** mutation attempts (in-flight transactions are handled by the under-lock recheck, §2.8).
- **Case creation (U-1, recommended default):** the creator receives an authoritative ACTIVE row (`granted_via='CASE_CREATION'`) inside the creation transaction plus the standard history/audit trail — otherwise no case could ever be mutated by its creator without a second administrative step. Flagged for PO/Security confirmation.

### 2.4 Unassigned cases and urgent investigations

- **Reads stay global-within-category** (PO decision (a)): any category-authorized employee can always *see* unassigned cases — no discovery starvation, no dark queues.
- **Mutations** on an unassigned case require either (i) an assignment via the management path, or (ii) a lead **override** with mandatory reason (§2.6). The operational answer to urgency is therefore: work immediately under override (fully audited) or assign-then-work; both paths are single-request operations in the Admin surface (M4).
- Enablement transition (U-5): no silent auto-grants at flag flip; an operational assignment pass over in-flight cases precedes enablement, supported by an admin report of unassigned open cases (M4).

### 2.5 Guard-level enforcement across all 11 routes

Route classes under `COMPLIANCE_ASSIGNMENT_AUTHZ_ENABLED` (dark-launch flag, repo convention `booleanFromEnvironment.default(false)`, `environment.ts:49-171`):

| Routes | Gate today | Gate under hybrid |
|---|---|---|
| Reads: list, detail, comments GET, evidence GET, assignments GET, history GET (6) | VIEW-or-EXECUTE live grant + category (global) | **Unchanged** |
| Case create (1) | EXECUTE + category | EXECUTE + category + creator auto-assignment (U-1) |
| Mutations: update, comment add, evidence add (3) | EXECUTE + category | EXECUTE + category + (**authoritative ACTIVE assignment for (case, principal)** OR **override** with reason) |
| Assignment add (1) | EXECUTE + category | **Re-gated** to `compliance.manage_case_assignments` (§2.7) — never gated by the mutation-assignment rule (that would be circular) |

Enforcement is two-layer, mirroring the accepted category-recheck pattern (spec test "rechecks the category under the case row lock"): the class guard performs a fast pre-check (403 before opening a transaction), and the service performs the **authoritative recheck inside the existing `pessimistic_write` case-row transaction** — fail-closed against concurrent revocation. Denial vocabulary: new `ASSIGNMENT_MISSING` added to `AuthorizationDenialReason` (`authorization.types.ts:71-80`), distinct from existing `FUNCTION_MISSING`/`RESOURCE_SCOPE_MISSING`; denials remain audited through the existing authorize/deny path.

### 2.6 Supervisory override (reason-coded, immutable)

- New catalogue function **`compliance.override_assignment`** (domain COMPLIANCE governance, sensitivity OPERATIONAL, assignable, EXECUTE-only): created through the governed catalogue/role-definition process — never ad hoc.
- **Category-inherited:** an override grant is effective only within the holder's existing category scope (non-FRAUD lead overrides non-FRAUD cases only; FRAUD lead only FRAUD). Override never widens categories, principal types, or read/write classes.
- **Mandatory reason:** mutation DTOs gain an optional bounded `overrideReason` (≤500, trimmed, `normalizeSafe`); when the mutation proceeds without an assignment, the service **requires** it (missing/blank/oversized → 400) and recommends a governed reason-code prefix `compliance.override.<CODE>` (U-4) — compliance-prefixed codes inherit the existing fail-closed masking in generic audit views (`audit.service.ts:83-93`).
- **Immutable trail:** (i) new case-history action value `OVERRIDE_MUTATION` (additive extension of the history-action CHECK in the M3 migration; historical rows untouched); (ii) audit record with `metadata.override = { by, reasonCode, reason }`; audit immutability triggers already reject UPDATE/DELETE on `audit_events` (PG sentinel evidence exists in the standing battery).
- **No automatic holders:** SUPER_ADMIN and ADMINISTRATOR are **not** seeded and cannot self-grant (PO decision (d)); the seed gains an explicit exclusion NOTE alongside the existing ones (`authorization-catalogue.seed.ts:421-424, 603-606`), and a seed-assertion test locks this (NT-07). The only grant path is the maker/checker role-definition governance flow, to designated lead roles (U-2 recommendation: new `COMPLIANCE_LEAD` and `RISK_FRAUD_LEAD` roles — no LEAD role exists today, seed L266-325).

### 2.7 Assignment administration without circularity

- New catalogue function **`compliance.manage_case_assignments`** (EXECUTE): gates assigning/reassigning/revoking authoritative assignments (the existing POST assignment route + a new additive revoke endpoint, U-3 recommended shape `POST …/:caseId/assignments/:assignmentId/revoke`).
- **Anti-circular rules (the mission's explicit requirement):**
  1. `compliance.manage_case_assignments` grants **no** case-mutation rights — an assignment administrator can assign unassigned cases but cannot update/comment/evidence them.
  2. Case-mutation functions grant **no** assignment rights — a worker cannot self-assign (except the creation auto-grant, U-1) and cannot assign others.
  3. `compliance.override_assignment` is a **separate code** from both; a lead may hold all three, but each action is separately gated and separately audited.
  4. The assignment route is never itself gated by "must be assigned" (that would make first assignment impossible).
- **Validation improvement (Security review item):** `assignedTo`/`worker_id` should be validated as an **active workforce user** at the management boundary (today `normalizeActor` accepts a free string, service L433) — proposed for M4, decision requested in §3 row 1.

### 2.8 Concurrency and transactional integrity

- All authoritative reads/writes occur inside the existing case transaction under `pessimistic_write` (service pattern L434-441); the assignment recheck happens **after** acquiring the case row lock, so a concurrent revoke either precedes the lock (mutation denied) or follows the committed mutation (mutation valid at decision time, revocation recorded after) — no torn states.
- Revoke/grant on the authoritative table takes its own row locks in deterministic order (case row first, then assignment rows) to avoid deadlock; the partial unique index makes duplicate ACTIVE grants impossible at the DB level (last-resort 409 → retried as no-op).
- Flag semantics: with `COMPLIANCE_ASSIGNMENT_AUTHZ_ENABLED=false` every code path behaves exactly as at baseline `8a4a9f3` (the 14-test suite must pass identically in both flag states — NT-15).

### 2.9 Audit trails and assignment-history preservation

- Existing trails are preserved unchanged: session-bound immutable actors on every case/audit/history write (spec test L173), `ASSIGNMENT_CHANGED` history, dual audit records on assignment, transactional rollback when the business audit fails (spec test L844), case records excluded from generic audit/dashboard views (spec test L585).
- New trails (additive): authoritative grant/revoke rows (append-only, §2.2), `OVERRIDE_MUTATION` history action, override audit metadata (§2.6), management-action audit records reusing the existing `audit()` helper with `COMPLIANCE_CASE_ASSIGNMENT`-family entity types.

### 2.10 Administrative assignment-management workflows (M4; backend here, UI = frontend workstream)

- Backend: management-gated assign/reassign/revoke endpoints (§2.7) + an **unassigned-open-cases report** (read route, category-scoped) to support enablement and daily triage.
- Admin UI (handoff spec to the frontend agent; files not touched by this workstream): assignment-management panel (assign/reassign/revoke with reason), unassigned-queue view, override-reason capture on mutation forms when the user holds the override function, and VIEW-vs-EXECUTE-aware control rendering **only when D-01-V is later activated**.

---

## 3. Security approval matrix (Phase 3 — co-signature checklist; every row PENDING)

| # | Control area | Designed control (§ ref) | Verification method | Approval criterion | Security sign |
|---|---|---|---|---|---|
| 1 | Assignment ownership & verification | Authoritative table keyed by session-derived `principalId`; `worker_id` validated as active workforce user at management boundary (§2.1, §2.7) | NT-01/02/04 + management-boundary validation tests | No mutation possible for a worker without an ACTIVE row bound to their session identity; free-text assignee eliminated or explicitly risk-accepted | ☐ PENDING |
| 2 | Cross-customer / cross-category access | Category isolation unchanged and re-tested; customer↔case binding unchanged; reads intentionally global-within-category per PO decision (§2.5) | NT-05/09 + existing spec tests 262/374/471 | No category or principal-type regression; cross-customer *mutation* impossible without that case's assignment | ☐ PENDING |
| 3 | Unauthorized reassignment | Management function separate from mutation functions; self-assignment impossible except creation (U-1); assignment route never assignment-gated (§2.7) | NT-08 | A mutation-only holder cannot assign/reassign; a management-only holder cannot mutate cases | ☐ PENDING |
| 4 | Revoked / stale assignments | Append-only ACTIVE→REVOKED lifecycle; authoritative recheck under case row lock; partial unique index (§2.3, §2.8) | NT-03 (incl. concurrent revoke mid-transaction) | Revoked assignment denies immediately; no torn state under concurrency | ☐ PENDING |
| 5 | Supervisor override misuse | Category-inherited scope; mandatory bounded reason; governed reason codes; immutable history+audit trail; override ≠ assignment ≠ mutation codes (§2.6) | NT-06/13 | Override impossible without live EXECUTE grant + reason; every override reconstructable from immutable records; generic audit masking holds | ☐ PENDING |
| 6 | Self-escalation attempts | No seeded override/management grants for SUPER_ADMIN/ADMINISTRATOR; seed-exclusion NOTE + assertion test; only maker/checker governance can grant (§2.6) | NT-07 + governance-flow negative tests | No automatic or self-service path to override authority for any role | ☐ PENDING |
| 7 | Concurrent case changes | Single transaction ordering (case lock → assignment rows); deterministic lock order; DB-level uniqueness backstop (§2.8) | NT-03 concurrency variant + existing lock-recheck test pattern | No deadlock regressions; decisions linearizable at the case row lock | ☐ PENDING |
| 8 | Missing / invalid override reasons | Required-on-override validation (blank/whitespace/oversize → 400); reason-code prefix masking inherits fail-closed audit behavior (§2.6) | NT-06 reason variants | No override record without a valid, bounded, masked reason | ☐ PENDING |
| 9 | Dashboard & reporting behavior | Count-only widgets unchanged; reads global so unassigned queues visible; unassigned-case report added (§2.4, §2.10) | NT-12 + existing widget grant test (spec L732) | No new data class exposed; counts stay aggregate | ☐ PENDING |
| 10 | Audit integrity | Additive history action; existing immutability triggers; audit rollback coupling preserved; case records stay off generic views (§2.9) | NT-13 + existing spec tests 585/844 | Every new trail is append-only and excluded from generic audit surfaces | ☐ PENDING |

**Unresolved decisions requiring Product Owner approval before the affected milestone** (recommendations in parentheses):

| ID | Question | Recommendation | Blocks |
|---|---|---|---|
| U-1 | Creator auto-assignment on case creation? | YES (`granted_via='CASE_CREATION'`, audited) | M2 |
| U-2 | Which roles hold `compliance.override_assignment` / `compliance.manage_case_assignments`? | New `COMPLIANCE_LEAD` + `RISK_FRAUD_LEAD` via governance flow, category-mirrored; OPERATIONS may hold management (non-FRAUD) if PO wants a neutral assignment desk | M3/M4 |
| U-3 | Revoke endpoint shape | Additive `POST …/:caseId/assignments/:assignmentId/revoke` with reason | M4 |
| U-4 | Override reason taxonomy | Governed reason-code enum (`compliance.override.INCIDENT_URGENT`, `.STAFF_SHORTAGE`, `.ESCORTED_INVESTIGATION`, `.OTHER` + bounded free text) | M3 |
| U-5 | Enablement transition for in-flight cases | No silent auto-grants; operational assignment pass before flag flip; unassigned-report to confirm readiness | M2 rollout |
| U-6 | Case-number Stage 2 timing (reject caller-provided) | After one release of Stage 1 compatibility, on PO confirmation that no external consumer supplies numbers (none found in-repo) | M5 |

---

## 4. Case-number compatibility and transition (Phase 4 — proposal only; no contract or identifier changed)

### 4.1 Complete consumer inventory of caller-provided `caseNumber` (baseline `8a4a9f3`)

| Consumer | Reference | Behavior |
|---|---|---|
| Create-case DTO | `src/customer-compliance/dto/create-compliance-case.dto.ts:14` | **Required** string field (caller-provided) |
| Service normalization + global uniqueness | `customer-compliance.service.ts:63-70, 116, 734` | `normalizeSafe(…, 100)`; pre-check `findOne({caseNumber}, withDeleted)` → 409; DB-conflict fallback → 409 (the documented P2 existence oracle) |
| DB constraints | migration `1785753600016` L26-29; entity unique index | `UNIQUE(case_number)` + pattern CHECK `^[a-z0-9][a-z0-9_.:-]{0,99}$` |
| Response/type projection | `customer-compliance.types.ts:8`; service L676 | Returned in case views |
| Tests | `test/customer-compliance.service.spec.ts`, `test/customer-compliance-authorization.integration.spec.ts` | Supply caller-chosen numbers |
| Admin UI | **none** — screens display case `id`, not `caseNumber` (grep of `apps/admin-web/src`: zero consumers) | No UI change needed |
| External/partner integrations | **none found in-repo** (no partner/webhook/mobile contract references `caseNumber`) | PO to confirm operationally (U-6) |

### 4.2 Proposed two-stage transition (M5)

- **Stage 1 (additive, no breakage):** DTO `caseNumber` becomes **optional**; when absent the service generates an opaque server-side number `cc-<lowercase-uuid>` (39 chars, **satisfies the existing pattern CHECK and UNIQUE constraint — no DB migration required**; collision probability negligible, 409 fallback retained as dead-path safety). When present, caller values are still accepted (compatibility window) — the oracle persists only for callers who keep supplying numbers. Responses keep the same shape (`caseNumber` always populated).
- **Stage 2 (contract change — separate approval, U-6):** caller-provided values rejected with a clear 400 (`caseNumber is server-generated`); the 409 oracle closes for all new cases.
- **Preservation guarantees (both stages):** historical identifiers unchanged and still resolvable (no rewrite, no renumbering); lookups/detail-by-id behavior unchanged; the global UNIQUE constraint remains (historical + generated coexist safely); audit/history references to old numbers remain valid.
- **Tests:** NT-14 (§6) — generated format/uniqueness (incl. concurrent creation), historical resolution, Stage-2 rejection, zero change to existing rows.

---

## 5. D-04 taxonomy alignment plan (Phase 5 — documentation and handoff only)

### 5.1 Ratified taxonomy (PO decision D-04-O1 + D-04-H)

Nine categories, triple-consistent (TS enum `customer-compliance.enums.ts` / DB CHECK migration `1785753600016:30-32` / frozen fail-closed allowlists `customer-compliance-access.ts:17-31`): `KYC, AML, SANCTIONS, FRAUD, PEP, DOCUMENT, ACCOUNT_REVIEW, MANUAL_REVIEW, OTHER`; authorization split: `compliance.manage_case` ↔ the 8 non-FRAUD categories, `risk_fraud.manage_fraud_case` ↔ FRAUD only. Reclassification = close-and-reopen (audited); historical category records preserved; **no enum, constraint or record changes**.

### 5.2 Governed change procedure (standing policy, from Report 29 §2.4)

Product proposal (definition + FRAUD/non-FRAUD classification + reporting needs) → Security review (allowlist placement, role mapping, audit-mask impact) → atomic implementation (enum + CHECK migration + allowlist + catalogue note + widget mapping + negative tests: new category denied until granted, unknown categories still fail closed) → independent acceptance evidence → release. Never a silent list edit.

### 5.3 Exact corrections required (inventory; implementation deferred per workstream ownership)

| ID | Correction | File / location | Owner |
|---|---|---|---|
| C-1 | Catalogue description drift: `compliance.manage_case` says "AML/KYC/SANCTIONS categories" but the enforced allowlist is 8 categories → correct to "the eight non-FRAUD categories (KYC, AML, SANCTIONS, PEP, DOCUMENT, ACCOUNT_REVIEW, MANUAL_REVIEW, OTHER)" | `src/authorization-catalogue/authorization-catalogue.seed.ts:209` (governed catalogue change) | Arena 3 (backend), with catalogue governance |
| C-2 | `risk_fraud.manage_fraud_case` v1Status `PARTIALLY_IMPLEMENTED` → with D-04 ratified, propose `IMPLEMENTED` + note that "partial" referred to the open taxonomy decision, now decided | seed L215 | Arena 3, with catalogue governance |
| C-3 | **Stale UI warning (frontend workstream — handoff, not modified here):** replace "The current customer compliance controller does not accept a category filter or enforce catalogue function checks… backend access remains a documented authorization gap" with accurate text: backend enforces function + access-type + category isolation (P0-01); the UI list is category-scoped server-side; assignment-scoped mutations arrive with Gate B M2-M4 | `apps/admin-web/src/screens/authenticated/ComplianceScreen.tsx:176` | **Frontend agent** |
| C-4 | **Stale UI warning (handoff):** replace "The current compliance-case list endpoint returns all categories and has no catalogue function check… backend category isolation is a documented authorization gap" with accurate text (server-side FRAUD isolation via `risk_fraud.manage_fraud_case`; client filter is display-only redundancy) | `apps/admin-web/src/screens/authenticated/RiskFraudScreen.tsx:45` | **Frontend agent** |
| C-5 | Optional UI clarity: annotate client-side category filters as display-only (backend already scopes) | `ComplianceScreen.tsx:118-119,158`; `RiskFraudScreen.tsx:23-26` | **Frontend agent** |

Coordination note: C-3/C-4/C-5 are provided as an exact handoff specification (file, line, current text, required substance) for the dedicated frontend agent; this workstream does not modify Admin UI files. C-1/C-2 are backend catalogue-text changes scheduled in M4's governed catalogue batch (they alter no behavior).

---

## 6. Implementation milestones (Phase 6 — independently testable stages; none started)

Dark-launch flag for the whole model: **`COMPLIANCE_ASSIGNMENT_AUTHZ_ENABLED`** (`booleanFromEnvironment.default(false)`, repo convention). Flag OFF ⇒ byte-identical behavior to baseline `8a4a9f3`.

### M1 — Assignment authorization infrastructure (dark)
- **Files:** new migration `src/migrations/<ts>-CreateComplianceCaseAuthorizationAssignments.ts` (§2.2 schema); new entity `src/customer-compliance/compliance-case-authorization-assignment.entity.ts`; module registration.
- **Migration:** one additive table + indexes; no change to existing tables/constraints.
- **Tests:** `migration-chain` suite; new PG spec `test/compliance-assignment-infrastructure.integration.spec.ts` (insert, partial-unique ACTIVE constraint incl. reactivation-after-revoke, revoke field CHECK, append-only immutability trigger if Security approves it).
- **Dependencies:** none. **Rollback:** drop dark table (zero behavior impact).
- **Acceptance:** migration chain green; entity round-trip; no behavior change anywhere (flag absent from logic).

### M2 — Mutation assignment enforcement (flagged)
- **Files:** `src/config/environment.ts` (flag); `customer-compliance-access.guard.ts` (principal propagation + fast pre-check, mutation-basis resolution); `customer-compliance.service.ts` (authoritative under-lock recheck on the 3 mutation routes + creation auto-grant per U-1); `authorization.types.ts` (+`ASSIGNMENT_MISSING`).
- **Migration:** none.
- **Tests:** new PG negative suite `test/compliance-assignment-authorization.integration.spec.ts` (NT-01/02/03/04/05/09/10); existing 14-test compliance suite green in **both** flag states (NT-15); focused security battery + full unit + PG batteries.
- **Dependencies:** M1; U-1; U-5 rollout plan. **Rollback:** flag OFF (instant, no data change).
- **Acceptance:** every mutation route denies unassigned workers with audited `ASSIGNMENT_MISSING`; reads provably unchanged; zero behavioral diff with flag OFF.

### M3 — Governed supervisor override
- **Files:** `authorization-catalogue.seed.ts` (`compliance.override_assignment` + SUPER_ADMIN/ADMINISTRATOR exclusion NOTE); additive migration extending the case-history action CHECK with `OVERRIDE_MUTATION` (historical rows untouched); mutation DTOs (+optional `overrideReason`, bounded); `customer-compliance.service.ts` (override path: grant check → reason validation → history/audit markers with `compliance.override.*` reason codes).
- **Tests:** NT-06/07/13; seed-assertion (no automatic holders); governance-flow test creating the function via maker/checker; audit-masking regression (generic views still exclude).
- **Dependencies:** M2; U-2; U-4. **Rollback:** revoke grants via governance and/or flag OFF (override layer inert without flag).
- **Acceptance:** override works only with live EXECUTE grant + valid reason inside the holder's category scope; every override reconstructable from immutable history+audit; no self-escalation path.

### M4 — Assignment administration + catalogue/UI alignment
- **Files:** seed (`compliance.manage_case_assignments`; C-1/C-2 catalogue-text corrections); `customer-compliance.controller.ts` (re-gate POST assignment; additive revoke endpoint per U-3; additive unassigned-open-cases report route); `customer-compliance.service.ts` (dual-store atomic writes, active-workforce validation of `worker_id`); guard (management-function path, anti-circular rules §2.7).
- **Frontend handoff (not this workstream):** C-3/C-4/C-5 corrections + assignment-management panel + unassigned queue + override-reason capture (§2.10).
- **Tests:** NT-08/12; positive management flows (assign/reassign/revoke dual-store consistency); circularity negatives (management-only cannot mutate; mutation-only cannot assign; self-assignment denied).
- **Dependencies:** M1 (table), M2 (flag), U-2/U-3. **Rollback:** flag OFF reverts assignment routes to baseline gating; additive endpoints inert.
- **Acceptance:** an assignment administrator can assign any unassigned case in-category without case-modification rights; workers cannot self-assign; both stores always consistent in one transaction.

### M5 — Case-number transition
- **Files:** Stage 1: `create-compliance-case.dto.ts` (field → optional), `customer-compliance.service.ts` (generation `cc-<lowercase-uuid>` when absent; existing CHECK/UNIQUE untouched). Stage 2 (separate approval, U-6): reject provided values with 400.
- **Migration:** **none** (generated format satisfies existing constraints).
- **Tests:** NT-14; update `customer-compliance.service.spec.ts` caller-provided cases into compatibility tests; historical-resolution regression.
- **Dependencies:** U-6 (Stage 2 only). **Rollback:** Stage 1 is additive (revert restores required-field DTO).
- **Acceptance:** new cases carry server-generated opaque numbers; oracle closed at Stage 2; every historical identifier preserved and resolvable.

### M6 — Independent security acceptance (Arena 4)
- **Scope:** re-execute the full NT matrix + the 14-test compliance suite (both flag states) + focused battery + full unit + PG batteries at the final SHA; full diff review; verify §3 matrix rows against executed evidence; issue Report-28-style dispositions.
- **Outcome targets:** §3 co-signatures resolved; P0-01 CONDITIONAL → unconditional; Report 28 Gate B D-01 row closed; Gate B re-scored (D-02/D-03 and §5 gap rows remain separate).
- **Dependencies:** M1-M5 complete + Security architecture approval (this document) before M1 starts.

### PostgreSQL negative-test matrix (Deliverable 5)

| ID | Scenario | Expected | Milestone |
|---|---|---|---|
| NT-01 | Unassigned EXECUTE worker mutates (update / comment / evidence) | 403 `ASSIGNMENT_MISSING`, denial audited | M2 |
| NT-02 | Assigned worker mutates same routes | 200, history/audit as today | M2 |
| NT-03 | Revoked assignment mutates; + concurrent revoke during open transaction | 403; under-lock recheck denies, no torn state | M2 |
| NT-04 | Worker B uses worker A's assignment | 403 | M2 |
| NT-05 | FRAUD-lead override on non-FRAUD case (and inverse) | 403 (category-inherited override) | M3 |
| NT-06 | Override: no grant → 403; grant + missing/blank/oversized reason → 400; valid → 200 with `OVERRIDE_MUTATION` history + audit metadata | as stated | M3 |
| NT-07 | SUPER_ADMIN/ADMINISTRATOR: unassigned mutation → 403 (no automatic override); seed assertion: neither holds override/management; governance self-grant attempt → denied by maker/checker | as stated | M3 |
| NT-08 | Management-only holder: assigns unassigned case → 200 (dual-store rows consistent); mutates case → 403. Mutation-only holder: assigns → 403 `FUNCTION_MISSING`. Self-assign (non-creation) → 403 | as stated | M4 |
| NT-09 | Reads unchanged: unassigned worker reads in-category globally; cross-customer read allowed (ratified policy); cross-customer mutation without that case's assignment → 403 | as stated | M2 |
| NT-10 | Customer (incl. case's own customer), agent, SUPPORT sessions on all 11 routes | 401/403 as today | M2 (regression) |
| NT-11 | Ad-hoc DB VIEW-only grant: reads pass, mutations 403 (UI activation still deferred per D-01-V) | as stated | M2 (regression) |
| NT-12 | Dashboard widgets: counts unchanged by flag/assignment state; unassigned-open-cases report visible to category readers | as stated | M4 |
| NT-13 | Audit integrity: `audit_events` UPDATE/DELETE rejected by trigger for override/assignment records; compliance-prefixed reason codes masked in generic views; case records remain off generic audit/dashboard | as stated | M3 |
| NT-14 | Case numbers: generated format matches CHECK + unique under concurrent creation; historical caller-chosen numbers resolve; Stage 2 rejects provided values (400); existing rows byte-identical | as stated | M5 |
| NT-15 | Flag OFF: complete existing 14-test compliance suite + full battery byte-identical to baseline behavior | green both states | M2-M5 |

---

## 7. Deliverables map and stop condition

| Required deliverable | Location |
|---|---|
| 1. Updated Product Owner decision record | §1 + dated update appended to `docs/audit/20261028/06-PRODUCT-DECISION-REGISTER.md` (this commit) |
| 2. Hybrid authorization architecture | §2 |
| 3. Security co-signature checklist | §3 (all rows PENDING) |
| 4. File-level implementation plan | §6 (M1-M6, exact files/migrations/rollbacks/acceptance) |
| 5. PostgreSQL negative-test matrix | §6 matrix (NT-01…NT-15) |
| 6. Case-number transition proposal | §4 |
| 7. D-04 taxonomy alignment plan | §5 (incl. frontend handoff C-3/C-4/C-5) |
| 8. Milestone sequencing & dependencies | §6 (M1→M2→M3; M4 after M1/M2; M5 independent; M6 last; U-decisions gate their milestones) |

**Stop condition honored:** this package is the complete deliverable. No application code, seed, enum, constraint, contract, database record or Admin UI file was modified. Implementation of the new authorization model does **not** begin until Security has reviewed this architecture and explicitly approved the relevant controls (§3), and the U-1…U-6 decisions blocking each milestone are recorded.
