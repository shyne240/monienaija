# 29 — Gate B Decision Pack: D-01 Compliance Authorization Scope and D-04 Fraud Taxonomy

- **Prepared by:** Arena 3 (implementation agent) for the **Product Owner**, with Security as co-signer.
- **Application evidence baseline:** `8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4` (worktree verified identical; this document adds no code).
- **Governing records:** decision register `docs/audit/20261028/06-PRODUCT-DECISION-REGISTER.md` (D-01, D-04); acceptance `docs/audit/20261028/sprint1-security-acceptance/08-FINAL-INDEPENDENT-ACCEPTANCE-20261028.md` and `09-FINAL-INDEPENDENT-REACCEPTANCE-20261028.md` (P0-01 CONDITIONAL PASS pending these decisions); security baseline Report 28 (`c92efcf`) §8 priority 1.
- **Status: DECISION REQUIRED — nothing in this pack is implemented.** No authorization policy, enum, allowlist, database record, contract, seed or UI was changed while preparing it. Implementation starts only after the Product Owner signs §6 options (with Security co-signature where marked).
- All behavior statements below were read from source at the baseline SHA and cross-checked against the executed PostgreSQL suite `test/customer-compliance-authorization.integration.spec.ts` (14 tests, green in the standing battery and independently re-run in Report 28 §10).

---

## 1. D-01 — Compliance authorization: current state (with source references)

### 1.1 The enforcement stack as built (P0-01 remediation, independently accepted as CONDITIONAL PASS)

| Layer | What it enforces | Source |
|---|---|---|
| Route policy | `/api/v1/customers/:id/compliance-cases(/**)` is `WORKFORCE_SESSION`-only, principal types `OPERATOR`/`PRIVILEGED`, `customerAccess: 'SELF'` convention, resource `customer-compliance-case`; customer self-service can never reach it | `src/authorization/route-policy-registry.ts:200-216` |
| Class-level guard | `CustomerComplianceAccessGuard` on all **11 controller routes**: resolves the live DB grant (`authorization_role_functions` JOIN active `authorization_roles`, filtered by function code **and access type**), AND-combines with session scopes, routes the decision through the audited `AuthorizationService.authorize` (denials recorded even for VIEW-only/inactive grants) | `src/customer-compliance/customer-compliance-access.guard.ts`; routes `src/customer-compliance/customer-compliance.controller.ts:17-107` |
| Access-type gate | Reads (`GET`/`HEAD`) accept access types `VIEW` **or** `EXECUTE`; every mutation accepts **only** `EXECUTE`. `INITIATE`/`APPROVE` are explicitly not case access | guard L60-71; spec test "distinguishes VIEW from EXECUTE and does not treat INITIATE or APPROVE as case access" |
| Category isolation | Guard maps `compliance.manage_case` → the 8 non-FRAUD categories, `risk_fraud.manage_fraud_case` → FRAUD only; the service scopes **every** query (list, detail, update, comments, evidence, assignments, history) with `category IN (permitted)` plus the URL customer id, under a pessimistic row lock with concurrent-category recheck | `customer-compliance-access.ts:17-31`; `customer-compliance.service.ts:59,130,585`; spec tests "enforces category isolation … in both directions", "rechecks the category under the case row lock" |
| Audit separation | Case audit records are excluded from generic audit/dashboard views (symbol-gated `includeComplianceCaseRecords`; the only consumer is the internal maturity health check, **count-only**); compliance-prefixed reason codes are fail-closed masked | `src/operations/audit.service.ts:52-93`; `src/maturity/maturity.service.ts:43`; spec test "keeps case audit records off generic audit and dashboard views" |
| Dashboard summaries | The two case-summary widgets re-run the same live grant + access-type resolution (`resolveAccess`) and emit counts by status/category only | `src/dashboard/dashboard.controller.ts:137,144`; `src/dashboard/dashboard-widget-registry.ts:168-182` |
| Revocation | Already-issued sessions are re-checked against live grants; revoked/inactive grants fail closed | spec test "rechecks active grants on an already-issued session and fails closed after revocation" |

Seeded grants (`src/authorization-catalogue/authorization-catalogue.seed.ts`): `compliance.manage_case` EXECUTE → **SUPER_ADMIN** (L398) and **COMPLIANCE** (L571); `risk_fraud.manage_fraud_case` EXECUTE → **RISK_FRAUD only** (L585). SUPER_ADMIN deliberately does **not** hold the fraud function, and ADMINISTRATOR holds neither (L421-424, L603-606 — "no self-escalation" boundary). **No VIEW-type grant exists for either function today.**

### 1.2 Question 1 — Which compliance actions currently permit global access?

**All of them, within the holder's permitted categories.** A valid function holder may operate on **any customer's** cases: the workforce session carries `customerAccess: 'NONE'` (`src/authorization/workforce-session.service.ts:256`) and no `assignedCustomerIds` are ever populated for workforce principals; the guard passes `customerAccess: 'SELF'` purely as the established workforce route convention, with an explicit source comment that it "does not mean that an operator is assigned to this customer" (guard L92-97). Concretely, global-within-category applies to: case create, case list, case detail, case update (status/severity/resolution), comment add/list, evidence add/list, assignment add/list, history read — plus the two dashboard summary widgets (aggregate counts) and the Customer-360 entry points into both screens. The independent acceptance record states the same: "a COMPLIANCE principal with the grant can list/read/write any valid customer's non-FRAUD cases" (doc 08 §3).

### 1.3 Question 2 — What is restricted by assignment or resource ownership?

- **Category** (server-side, both directions): COMPLIANCE-role holders never see FRAUD rows; RISK_FRAUD holders never see non-FRAUD rows — enforced in every query, not in the UI (spec test at line 262).
- **Principal type**: genuine customer sessions (including the case's own customer), agents and SUPPORT are rejected; non-workforce types are denied even if somehow presented with an active function (spec tests 471, 502).
- **Case↔customer binding**: every read/write verifies the case belongs to the URL customer (spec test 374).
- **`compliance_case_assignments` is operational metadata, NOT an access control.** It records which worker a case is operationally assigned to (`assigned_to` varchar, entity `compliance-case-assignment.entity.ts`) and is written/read through the assignment routes; **no authorization check anywhere consumes it.** There is no worker→customer assignment table or session wiring at all.

### 1.4 Question 3 — How are VIEW and EXECUTE currently distinguished?

- **Mechanism exists and is enforced at the boundary**: the guard's live-DB intersection admits `VIEW` or `EXECUTE` for reads and only `EXECUTE` for writes (§1.1). The catalogue machinery supports VIEW grants for any assignable function, and the governed role-definition proposal flow (maker/checker) can create new grants.
- **No VIEW grant is seeded today** — both case functions are granted EXECUTE-only, so no read-only compliance user exists in the seed. Doc 08: "Seeded current case grants are EXECUTE, so no seeded view-only user is exposed today."
- **The Admin UI does not model VIEW vs EXECUTE**: `ComplianceScreen.tsx:27` and `RiskFraudScreen.tsx:12` check only function **presence** in session scopes. If a VIEW-only grant is ever created, the backend 403s mutations (authoritative), but the UI would still render write controls until updated (doc 08 requirement: "update UI before enabling VIEW-only grants").

### 1.5 Question 4 — Endpoints that could expose cross-customer information if assignment-scoped access is intended

If the Product Owner decides access must be assignment-scoped, **every** surface below is currently global-within-category and would need enforcement work:

| # | Surface | Exposure today (within permitted category, any customer) |
|---|---|---|
| 1-2 | `POST/GET /customers/:id/compliance-cases` | Create/list cases of any customer |
| 3-4 | `GET/PATCH /customers/:id/compliance-cases/:caseId` | Read/modify any case (status, severity, resolution text) |
| 5-6 | `POST/GET …/:caseId/comment(s)` | Read/write case commentary (investigation narrative) |
| 7-8 | `POST/GET …/:caseId/evidence` | Evidence metadata (documentName/documentType/reference — bounded strings; no file bytes in this entity) |
| 9-10 | `POST/GET …/:caseId/assignment(s)` | Operational assignment records (worker identities per case) |
| 11 | `GET …/:caseId/history` | Full case audit trail (actors, status/resolution transitions) |
| 12-13 | Dashboard widgets `compliance-case-summary`, `fraud-case-summary` | Aggregate counts only (no per-customer rows) — low sensitivity even under assignment scoping |
| 14 | Case-number 409 behavior | Caller-chosen `case_number` uniqueness is **global including soft-deleted rows** (`customer-compliance.service.ts:63-70,116`; DB `uq_customer_compliance_cases_case_number`): a cross-customer **existence oracle** (P2, already documented in doc 08/09) — independent of, but decided alongside, D-01 |
| 15 | Maturity health check | Count-only; no customer data (no action needed under any option) |

### 1.6 Question 5 — Operational consequences: global vs assignment-scoped

**Global-within-category (status quo):**
- *Advantages:* zero assignment administration; any on-duty holder can work any queue (follow-the-sun coverage, surge/absence resilience); no case starvation when workers are offline; smallest code surface (already built, tested, independently accepted at P0-01 conditional).
- *Consequences:* every COMPLIANCE/RISK_FRAUD holder can browse the entire customer book within their category — a large insider-threat blast radius and a harder least-privilege story for regulators/auditors; per-worker accountability exists only via audit records (actor is session-bound and immutable — spec test 173), not via access restriction; fraud investigations are visible to the whole RISK_FRAUD team by design.

**Assignment-scoped (if intended):**
- *Advantages:* least privilege per worker; defensible regulator narrative ("only assigned staff touched this case"); reduced insider-risk surface; natural fit for sensitive FRAUD investigations.
- *Consequences:* requires **new infrastructure that does not exist** — a worker↔customer (or worker↔case) assignment source of truth, session/principal wiring (`assignedCustomerIds` population), guard/service filtering, an admin surface to manage assignments, and coverage operations (unassigned-case triage, reassignment on leave/exit, urgent-override path); risk of **case starvation** if assignment lag leaves queues unworked; every one of the 11 routes + 2 widgets needs re-test; the operational team owns a new daily workflow.
- *Hybrid:* reads global-within-category (investigation flexibility), writes assignment-scoped (accountability where it matters) — halves the starvation risk, keeps a bounded browse exposure.

### 1.7 Question 6 — Recommended policy (with explicit supervisory exceptions)

**Recommendation R-D01: Hybrid, phase-gated** — *for Product Owner decision; Security co-sign required.*

1. **V1 (now, no code):** ratify **global-within-category** as the *documented, intentional* V1 policy for reads and writes, with the compensating controls already in place (category isolation, session-bound immutable audit actors, audit-record separation, revocation rechecks, count-only dashboards). This converts P0-01 from CONDITIONAL to unconditional **without pretending assignment scoping exists**.
2. **V1.x (if the PO wants least privilege):** introduce a **supervisory-exception model**: default access becomes assignment-scoped for EXECUTE writes; reads remain global-within-category; a new catalogue function `compliance.override_assignment` (EXECUTE, granted **only** to a designated supervisory role — e.g. a future `COMPLIANCE_LEAD` — through the governed role-definition proposal flow, never to SUPER_ADMIN, preserving the no-self-escalation boundary) permits working unassigned/other-assigned cases with a mandatory reason code recorded in the case history.
3. **Explicitly rejected default:** assignment scoping *without* a supervisory override (starvation risk during incidents/absences) and VIEW-only grants *before* the UI models them (doc 08 constraint).
4. **Companion decision (recommended regardless of scope choice):** replace caller-chosen `case_number` with **server-generated opaque case numbers** (or scope uniqueness per category+customer) to close the P2 existence oracle; this is an identifier-policy change requiring its own approval and migration plan for existing numbers (no rewrite of historical rows).

### 1.8 D-01 decision matrix

**Role-by-role (today → proposed defaults under R-D01; PO to confirm each cell):**

| Role | Non-FRAUD cases today | FRAUD cases today | R-D01 V1 proposal | R-D01 V1.x proposal |
|---|---|---|---|---|
| COMPLIANCE | EXECUTE, global within 8 non-FRAUD categories | none | unchanged (ratified) | reads global; writes assignment-scoped |
| RISK_FRAUD | none | EXECUTE, global within FRAUD | unchanged (ratified) | reads global; writes assignment-scoped |
| SUPER_ADMIN | EXECUTE, global (non-FRAUD) | **none by design** | unchanged | unchanged; **not** eligible for `compliance.override_assignment` |
| ADMINISTRATOR | none by design | none by design | unchanged | unchanged |
| New COMPLIANCE_LEAD (only if V1.x approved) | — | — | — | override function (EXECUTE) + reason code; created via governance flow |
| CUSTOMER_SERVICE / SUPPORT / customer / agent principals | rejected | rejected | unchanged | unchanged |
| VIEW-only grant holders (none seeded) | mechanism ready; UI not ready | same | **do not create until UI models VIEW** | same |

**Endpoint-by-endpoint (11 routes + 2 widgets; decision points per surface):**

| Surface | Who (role set) | Scope (global / assigned / hybrid) | Access type (VIEW+EXECUTE reads / EXECUTE writes) | PO decision |
|---|---|---|---|---|
| Create case | ☐ COMPLIANCE ☐ RISK_FRAUD (FRAUD cat.) | ☐ global ☐ assigned | EXECUTE | ______ |
| List cases | same | ☐ global ☐ assigned | VIEW or EXECUTE | ______ |
| Case detail | same | ☐ global ☐ assigned | VIEW or EXECUTE | ______ |
| Update case | same | ☐ global ☐ assigned | EXECUTE | ______ |
| Comment add / list | same | ☐ global ☐ assigned | EXECUTE / VIEW | ______ |
| Evidence add / list | same | ☐ global ☐ assigned | EXECUTE / VIEW | ______ |
| Assignment add / list | same (+ ☐ lead-only?) | ☐ global ☐ assigned | EXECUTE / VIEW | ______ |
| History read | same | ☐ global ☐ assigned | VIEW or EXECUTE | ______ |
| Dashboard summaries (×2) | function holders | counts only (recommend: stays global) | VIEW or EXECUTE | ______ |
| Case number policy | — | ☐ caller-chosen (status quo) ☐ server-generated (recommended) | — | ______ |

---

## 2. D-04 — Fraud taxonomy: current state (with source references)

### 2.1 The supported taxonomy today

- **Categories (9):** `KYC, AML, SANCTIONS, FRAUD, PEP, DOCUMENT, ACCOUNT_REVIEW, MANUAL_REVIEW, OTHER` — identical in three places: TypeScript enum (`src/customer-compliance/customer-compliance.enums.ts`), DB CHECK (`src/migrations/1785753600016-CreateCustomerComplianceCases.ts:30-32`), and the guard's fail-closed allowlists (`customer-compliance-access.ts:17-31`: 8 non-FRAUD + FRAUD, `Object.freeze`, "intentionally fail closed for any future category until it is reviewed").
- **Decision/lifecycle enums:** case status `OPEN, UNDER_REVIEW, PENDING_CUSTOMER, ESCALATED, RESOLVED, CLOSED` (enum + DB CHECK L36-38); severity `LOW, MEDIUM, HIGH, CRITICAL` (CHECK L33-35); history actions `CASE_CREATED, STATUS_CHANGED, ASSIGNMENT_CHANGED, CASE_CLOSED, RESOLUTION_UPDATED, COMMENT_ADDED, EVIDENCE_ADDED` (CHECK L64-66). **Resolution is free text** `VARCHAR(1000)` — there is no structured disposition/outcome enum (e.g. SUBSTANTIATED / UNFOUNDED) anywhere.
- **Role↔category split:** enforced server-side both directions (§1.1); `risk_fraud.manage_fraud_case` is catalogue-flagged `PARTIALLY_IMPLEMENTED` with the note "Decisions 8/9: FRAUD-category case authority only; no AML/SANCTIONS authority" (seed L215); `compliance.manage_case` is `IMPLEMENTED` (seed L209).
- **Reporting dependencies:** dashboard widgets split along the same boundary (`compliance-case-summary` = non-FRAUD counts by status/category; `fraud-case-summary` = FRAUD counts by status only — "no AML/SANCTIONS visibility, per the RISK_FRAUD scope boundary", widget registry L168-182); maturity health consumes audit **counts only**; generic audit views exclude case records and fail-closed-mask compliance-prefixed `reasonCodes` (audit.service L83-93).

### 2.2 Inconsistencies found across API, database and UI (evidence, not changes)

| # | Inconsistency | Where | Risk |
|---|---|---|---|
| I-1 | Catalogue description drift: `compliance.manage_case` is described as "AML/KYC/SANCTIONS categories" but the enforced allowlist is **8** categories (adds PEP, DOCUMENT, ACCOUNT_REVIEW, MANUAL_REVIEW, OTHER) | seed L209 vs access.ts L17-28 | Documentation-only drift; enforcement is the allowlist. Misleads future role designers |
| I-2 | **Stale UI warnings**: both screens still claim "the controller does not … enforce catalogue function checks" / "backend category isolation is a documented authorization gap" — untrue since the P0-01 guard (accepted CONDITIONAL PASS in docs 08/09) | `ComplianceScreen.tsx:176`, `RiskFraudScreen.tsx:45` | Operator mistrust/confusion; flagged as Admin follow-up in doc 08 ("stale Risk/Fraud warning … remain Admin follow-up") |
| I-3 | UI filters categories client-side (`ComplianceScreen.tsx:118-119` excludes FRAUD; `RiskFraudScreen.tsx:26` keeps FRAUD) even though the backend now returns only permitted categories | both screens | Display-only redundancy; harmless but confusing |
| I-4 | `risk_fraud.manage_fraud_case` v1Status = PARTIALLY_IMPLEMENTED while its enforcement path is identical to the IMPLEMENTED compliance function | seed L215 | Catalogue-status semantics need PO ratification (what "partial" refers to: the taxonomy decision itself) |
| I-5 | No structured disposition/outcome taxonomy (free-text resolution only); reason codes live in audit metadata (`new_values.metadata.reasonCodes`) and are masked from generic audit views | migration L17; audit.service L88-93 | Reporting on outcomes (substantiated rates, regulatory MIS) is not possible without a disposition enum — a V2 candidate, out of V1 scope unless the PO directs otherwise |
| I-6 | Caller-chosen `case_number` with global uniqueness incl. soft-deleted rows (pattern `^[a-z0-9][a-z0-9_.:-]{0,99}$`) | migration L26-29; service L63-70 | The P2 existence oracle (§1.5 row 14); identifier policy, decided with D-01 §1.7 item 4 |

### 2.3 Recommended V1 taxonomy

**Recommendation R-D04: ratify the current 9 categories and the FRAUD/non-FRAUD role split exactly as implemented — no additions, no renames, no removals in V1.** Rationale: the taxonomy is already triple-consistent (enum/CHECK/allowlist), fail-closed for unknown values, server-side isolated per role, covered by 14 executed PG tests, and matches the two-widget reporting split. Renaming or splitting categories now would require data migration of historical rows for zero demonstrated benefit. If approved, the accompanying corrections are documentation/UI only: fix I-1 (catalogue description via the governed catalogue process), I-2/I-3 (screen notes), I-4 (status flag semantics) — each is a small, separately testable change listed in §4.

### 2.4 Controlled process for future category changes (proposed standing policy)

A new or changed category is a **governed release item**, never a silent list edit (doc 08 rule: "do not silently add enum values to a list"):

1. Product proposal: category name, business definition, FRAUD-vs-non-FRAUD classification (determines the role split), reporting needs.
2. Security review: allowlist placement, principal/role mapping, audit-mask implications.
3. Implementation as one atomic change: TS enum + DB migration (CHECK constraint) + guard allowlist + catalogue note (+ widget mapping if reporting requires) + **negative tests** (new category denied to both roles until granted; unknown categories still fail closed).
4. Independent acceptance evidence (Report-28-style: executed PG suites + diff review) before release.
5. Historical rows are **never re-categorized in place** (see §2.5).

### 2.5 Implications for historical records and reporting

- **Historical rows:** categories are immutable in practice (case updates recheck the category under row lock; no re-categorization route exists). Under any option, existing rows keep their category; the only supported "reclassification" today is close-and-reopen as a new case in the correct category (audited via history). **Decision point:** ratify close-and-reopen as the official V1 reclassification path (recommended — no data rewrite) or defer a governed category-change action to V2.
- **Reporting:** widget counts and maturity counts are category-driven; a new category without a widget mapping decision would be counted only inside its role's summary (non-FRAUD widget counts "by status/category"; FRAUD widget "by status only"). Structured outcome/disposition reporting requires I-5's disposition enum — explicitly **not** proposed for V1.
- **Audit:** reason-code masking is prefix-fail-closed for future codes (audit.service L83), so taxonomy growth does not leak new reason families into generic audit views.

---

## 3. Product Owner decision options (with recommended defaults and trade-offs)

| Option | Decision | Recommended? | Trade-offs |
|---|---|---|---|
| **D-01-O1** | Ratify global-within-category for V1 (status quo, documented as intentional) | **YES (V1 default)** | Zero code/ops cost; P0-01 becomes unconditional; insider blast radius stays category-wide, mitigated by immutable session-bound audit actors |
| **D-01-O2** | Hybrid: reads global, writes assignment-scoped, supervisory override function (`compliance.override_assignment`, lead role only, reason-coded) | YES for V1.x if least privilege is required | Needs assignment infrastructure + admin surface + coverage ops; bounded starvation risk via override |
| **D-01-O3** | Full assignment scoping (reads and writes) | NO as default | Strongest least privilege; highest starvation/coverage risk and largest build; urgent-incident reads also gated |
| **D-01-V (sub-decision)** | Create VIEW-only grants now? | **NO until UI models VIEW vs EXECUTE** (doc 08 constraint) | Backend is ready (guard admits VIEW for reads); UI would render dead write controls |
| **D-01-N (sub-decision)** | Case-number policy: keep caller-chosen global (P2 oracle) vs server-generated opaque / scoped uniqueness | **Server-generated (or scoped)** | Closes the oracle; needs an identifier migration plan for future cases only; historical numbers untouched |
| **D-04-O1** | Ratify the 9-category taxonomy + FRAUD/non-FRAUD split as V1-final; approve the §2.4 change process | **YES** | No migration; documentation/UI corrections only (§4) |
| **D-04-O2** | Amend taxonomy now (add/split/rename categories, or add a disposition enum) | NO without a concrete regulatory/product driver | Requires the full governed change (§2.4 step 3) + possible data decisions; I-5 disposition enum is a V2 candidate |
| **D-04-H (sub-decision)** | Reclassification path: ratify close-and-reopen (no in-place category change) | **YES** | Preserves row immutability and audit integrity; slightly more operator steps |

---

## 4. Exact implementation scope if approved (nothing implemented yet)

**If D-01-O1 + D-04-O1 (recommended defaults):** documentation/UI-only, ~5 small changes:
1. Catalogue description correction for `compliance.manage_case` (I-1) via the governed catalogue/seed process (seed L209 text).
2. `RiskFraudScreen.tsx` / `ComplianceScreen.tsx`: replace stale gap warnings (I-2) and redundant client-side filter notes (I-3); no behavior change.
3. Catalogue `v1Status` semantics note for `risk_fraud.manage_fraud_case` (I-4).
4. Record the ratified policy + close-and-reopen reclassification path (D-04-H) in the product decision register (doc 06 successor entry).
5. Update Report 28 §8 priority-1 status via the next audit-cycle record (Arena 4).
   *No enum, allowlist, guard, migration, contract or DB record changes.*

**If D-01-N (case numbers):** service case-number generation (server-side opaque IDs), remove/relax caller-chosen path in `CreateComplianceCaseDto` + service L63-70 (contract change — needs its own approval), keep DB UNIQUE, no historical rewrite; collision 409 semantics replaced by generation.

**If D-01-O2/O3 (assignment scoping):** new worker↔customer (or worker↔case) assignment source of truth + admin management surface; workforce session population of `assignedCustomerIds` + `customerAccess: 'ASSIGNED'` (mechanism already exists in `authorization.service.ts:278-289`); guard/service filtering on all 11 routes; (O2) `compliance.override_assignment` function via role-definition governance + reason-coded history entry; widget policy decision (recommend counts stay global); UI assignment-management screens. This is a full feature milestone, not a patch.

## 5. Required negative authorization and PostgreSQL tests (per approved option)

**Baseline (already permanent, must stay green under any option):** the 14-test `customer-compliance-authorization` suite — unentitled/missing credentials on all 11 handlers; customer/agent/SUPPORT rejection; non-workforce rejection with active function; VIEW/EXECUTE distinction (INITIATE/APPROVE ≠ access); bidirectional category isolation on every subresource; case/customer binding on all reads/writes; grant-revocation fail-closed; concurrent category recheck under row lock; audit-record separation; dashboard-summary grant enforcement; transactional audit rollback.

**If D-01-O1 ratified:** add a PG test asserting the *documented* global-within-category behavior explicitly (same holder, two different customers' cases, both accessible) so the ratified policy is locked as intended behavior, not an oversight. (New test only — no code change.)

**If D-01-N:** negative tests — duplicate-opaque-generation never 409s; caller-supplied numbers rejected (400); historical caller-chosen numbers still resolve.

**If D-01-O2/O3:** per-route matrix: unassigned worker denied (403 `RESOURCE_SCOPE_MISSING`) on writes (O2) or all routes (O3); assigned worker allowed; lead override allowed **and** reason-code recorded in history; override denied for SUPER_ADMIN/ADMINISTRATOR; revoked assignment fails closed mid-session; dashboard counts unaffected; every test on real PG with disposable `mn_it_*` databases.

**If D-04-O2 (taxonomy change):** unknown-category still fails closed; new category denied to both roles until the grant exists; both-direction isolation extended to the new category; widget mapping assertions.

## 6. Approval block

| Decision | Chosen option | Product Owner | Security co-sign | Date |
|---|---|---|---|---|
| D-01 scope | O1 / O2 / O3 | ______ | ______ (required for O2/O3) | ____ |
| D-01 VIEW grants | defer / enable-with-UI | ______ | ______ | ____ |
| D-01 case numbers | keep / server-generated | ______ | ______ | ____ |
| D-04 taxonomy | O1 / O2(+list) | ______ | ______ | ____ |
| D-04 reclassification | close-and-reopen / V2 action | ______ | ______ | ____ |

## 7. Risks and dependencies

1. **Ratifying O1 without oversight tooling** leaves category-wide browse access; compensating controls (immutable actors, audit separation, revocation rechecks) are in place, but the PO accepts the insider-blast-radius trade-off explicitly. Mitigation option: periodic audit-review sampling of case access (operational, Gate C).
2. **O2/O3 depend on infrastructure that does not exist** (assignment store, session wiring, admin surface) — estimate as a milestone, not a fix; starvation/coverage ops must be staffed before enablement.
3. **VIEW-only grants depend on UI work** (doc 08 constraint) — sequencing dependency, not a blocker.
4. **Case-number change (D-01-N) is a contract change** for any external consumer that supplies numbers; dependency: confirm no partner integration supplies `case_number` (none found in-repo; PO to confirm operationally).
5. **Taxonomy amendments (D-04-O2)** carry migration + reporting dependencies (§2.4-2.5); the fail-closed allowlist makes silent drift impossible.
6. **D-02/D-03 remain separate open decisions** (notification/limit diagnostics scope) — this pack does not decide them; they follow the same pattern and can reuse the §2.4-style governed process.
7. **Gate structure dependency (Report 28):** P0-01 unconditional acceptance and Gate B progress both require these signed decisions; Gate C/D are unaffected by O1 vs O2 choice but inherit any new operational workflows.

---

**Stop condition honored:** this pack is the complete deliverable; no policy, enum, allowlist, seed, contract, database record or UI was modified. Implementation begins only after §6 is signed, scoped strictly to the approved options.
