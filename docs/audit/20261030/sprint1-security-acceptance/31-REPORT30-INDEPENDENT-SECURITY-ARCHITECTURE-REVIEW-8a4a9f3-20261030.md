# Report 31 — Independent security architecture review of Report 30

- **Reviewer:** Arena 4 — Independent Security Architecture Review
- **Review date:** 2026-10-30
- **Repository:** `shyne240/monienaija`
- **Documentation branch:** `arena/870f970d-monienaija` (verified to be the reviewer/session branch; current remote tip before this report was `b7fdc9a70b374d572d01caee7c61c4f6f9b4182e`)
- **Application evidence baseline:** `8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4`
- **Architecture report reviewed:** Report 30, commit `06dc30b3cd2ad80f6c50b566575fe6ea2581ec85`, on application branch `arena/8e59e188-monienaija`
- **Independent security baseline:** Report 28, commit `c92efcf9bc2835bcf34be3c5edf4eaf644ea2fab`
- **Review scope:** challenge Report 30's D-01 hybrid compliance authorization architecture, its governance and database assumptions, feature-flag/rollout plan, unresolved U-1…U-6 decisions, and planned NT-01…NT-15 coverage. No application code or test was changed.

## Executive verdict

**Architecture verdict: CONDITIONAL PASS for the Product Owner's hybrid policy direction; FAIL for Report 30's current implementation plan as an executable security design.**

The base authorization boundary is real and sensibly structured: the compliance controller applies a dedicated guard; the guard limits principals to workforce `OPERATOR`/`PRIVILEGED`, separates `compliance.manage_case` from `risk_fraud.manage_fraud_case`, and directly queries active role-function rows by `VIEW`/`EXECUTE`; service lookups bind case, customer, and category. Global-within-category reads and case-assignment-required mutations are compatible with the approved product direction if the visibility risk is explicitly accepted and the new controls are independently rechecked in the service transaction.

However, Report 30 is **not ready for security co-signature as written**. Its main gaps are:

1. The plan sequences M2 mutation enforcement before M3 supervisory controls and M4 assignment management. If the enforcement flag is enabled at M2, existing unassigned/in-flight cases cannot reliably be managed through the proposed new workflow. The flag's OFF mode returns to the current, broader category-wide mutation policy; that is an availability rollback, not a security-safe rollback.
2. FRAUD/non-FRAUD management and override separation is described by role names and category inheritance, but not fully encoded as separate permission checks for the new functions. A single `compliance.manage_case_assignments` function is proposed for both categories. Generic role governance can propose arbitrary combinations of assignable functions; it does not enforce category-pure bundles. The new functions must be checked for **live EXECUTE** access, not merely presence in the flattened `principal.scopes` array.
3. The authoritative assignment table is not yet specified with enough database invariants to support the claimed immutable, single-owner authorization source. In particular, the proposed partial unique index permits multiple active workers per case, the customer/case binding is only described as application-consistent, and immutable status/identity transitions are left to a proposed optional trigger.
4. The maker/checker design does prevent the simplest same-principal approval and the existing role-assignment service prevents direct self-assignment, but the new lead-role provisioning path is incomplete. The system has a real dynamic role-definition governance route; absence of seeded override grants is not an adequate control. The design does not show how the first custom supervisory role gets an authorized workforce assignment without introducing a one-person bootstrap exception.
5. NT-01…NT-15 are a useful outline, not yet an adequate acceptance suite. They omit or under-specify several requested abuse cases: first-grant/self-escalation through governance, both-direction category-crossing assignment administration, forged/inactive worker identities, duplicate/conflicting assignments, override access-type misuse, flag transitions, and direct database tampering of the authoritative assignment and case-history stores.

**Implementation-start decision:** Arena 3 is **not authorized to implement Report 30 as written**. A narrowly scoped **M1 dark-infrastructure-only start may be conditionally authorized after the M1 schema and data-integrity changes in §10 are incorporated into a revised design**. That allowance would cover only additive, behavior-inert assignment infrastructure and its database tests; it would not authorize M2 mutation enforcement, role provisioning, supervisor controls, or any flag activation.

**Assignment enforcement activation:** **NOT AUTHORIZED.** It must remain disabled until M1, M3, M4, operational assignment reconciliation, shadow evaluation, the approved U-decisions, Admin workflow support, and all security acceptance tests are complete. Dark development approval is not approval to enforce the hybrid policy.

## 1. Evidence and current-state architecture

### 1.1 Existing authorization path

Report 28's baseline (`8a4a9f3…`) is the actual code baseline for this review. The relevant immutable source references are:

- [`CustomerComplianceAccessGuard`](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/customer-compliance/customer-compliance-access.guard.ts#L20-L113) uses the two category functions and permits only `OPERATOR`/`PRIVILEGED`. GET/HEAD accepts active `VIEW` or `EXECUTE`; all other methods require active `EXECUTE`. The SQL checks the live `authorization_role_functions.access_type`, then intersects with the principal's function-code scope. The guard itself notes that the general catalogue runtime flattens access types.
- [`CustomerComplianceController`](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/customer-compliance/customer-compliance.controller.ts#L12-L114) has 11 current routes: six GET/read routes, one create route, three case-content mutations (PATCH case, POST comment, POST evidence), and POST assignment. The new revoke and unassigned-workflow endpoints in Report 30 do not exist at baseline.
- [`RoutePolicyRegistry`](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/route-policy-registry.ts#L197-L215) routes the case surface through a workforce session and allows only `OPERATOR`/`PRIVILEGED`; customer, agent, support, service, and aggregator identities are not allowed by this policy.
- [`CustomerComplianceService`](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/customer-compliance/customer-compliance.service.ts#L154-L260) locks the case row for update/comment operations; evidence creation also locks the case row ([lines 350–399](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/customer-compliance/customer-compliance.service.ts#L350-L399)). `requireCase()` binds `id`, `customerId`, and an authorized category in one query and can apply the requested row lock ([lines 577–591](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/customer-compliance/customer-compliance.service.ts#L577-L591)). Wrong customer/category and missing case are intentionally indistinguishable.
- Existing assignment writes are in the same transaction as case-row locking, the operational assignment/history rows, audit events, and `assigned_to` update ([service lines 424–488](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/customer-compliance/customer-compliance.service.ts#L424-L488)). But `assignedTo` is currently normalized free text; this is workflow metadata, not a safe authorization identity by itself.

### 1.2 Actual role and maker/checker authority

The current role catalogue and governance implementation show why “no seeded override permission” is not a sufficient security proof:

- `COMPLIANCE` is seeded with `compliance.manage_case` as `EXECUTE`; `RISK_FRAUD` has `risk_fraud.manage_fraud_case` as `EXECUTE`. `SUPER_ADMIN` and `ADMINISTRATOR` do not receive either case function by default. The seeded roles and grants are in [`authorization-catalogue.seed.ts`](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization-catalogue/authorization-catalogue.seed.ts#L325-L370) and [lines 560–590](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization-catalogue/authorization-catalogue.seed.ts#L560-L590).
- `ADMINISTRATOR` and `SUPER_ADMIN` both have `workforce.role.assign_operational`/`revoke_operational`. The role administration service allows them to assign the six fixed operational roles—including `COMPLIANCE` and `RISK_FRAUD`—without a second approver, but prohibits self-assignment and restricts this direct path to the database-checked allowlist. See [`finance-role-administration.service.ts`](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/finance-role-administration.service.ts#L291-L365) and [migration 1785753600085](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/migrations/1785753600085-AddAdministratorRoleAssignmentScope.ts#L39-L55). This grants category functions, not the proposed new assignment-management or override functions.
- The dynamic role-definition workflow is live, not hypothetical: [`RoleDefinitionGovernanceService`](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/role-definition-governance.service.ts#L27-L36) defines `SUPER_ADMIN` as initiator and `FINANCE_CONTROLLER` as sole approver; submit requires MFA, a proposal fingerprint, and independent approval ([lines 101–215](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/role-definition-governance.service.ts#L101-L215)). The existing approval service rejects approval by the requester ([`privileged-action-approval.service.ts` lines 445–474](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/privileged-action-approval.service.ts#L445-L474)); the governance service requires a `SUPER_ADMIN` to apply an approved proposal ([lines 350–370](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/role-definition-governance.service.ts#L350-L370)). This is a real two-person path, so it blocks a simple self-approved grant.
- That workflow can create new roles and assign function bundles. Its validator rejects nonassignable functions, every `workforce.role.*` function, and critical-financial/finance-class functions, but otherwise accepts function grants and access types ([`assertGrantable()` and `mutateCatalogue()` lines 603–690](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/role-definition-governance.service.ts#L603-L690)). It does **not** enforce “FRAUD-only role,” “non-FRAUD-only role,” or a supervisory function bundle. If the proposed codes are `assignable`, this route becomes their governance path.
- The runtime catalogue resolves role keys to a flat union of function codes, without retaining `accessType` in `principal.scopes` ([`authorization-catalogue-runtime.service.ts`](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization-catalogue/authorization-catalogue-runtime.service.ts#L12-L70)); workforce session resolution unions those codes ([`workforce-session.service.ts` lines 182–245](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/workforce-session.service.ts#L182-L245)). Compliance's current guard compensates by doing its own access-type SQL. New `override` and `manage_case_assignments` checks must do likewise; a scope-only check would allow a `VIEW` grant to satisfy a mutation permission.
- The existing A2 role assignment service recognizes catalogue-created custom role keys, but a first assignment is separately restricted to `INITIAL_BOOTSTRAP_ASSIGNABLE_ROLES` (Finance roles and ADMINISTRATOR); later assignments use legacy maker/checker rules ([`finance-role-administration.service.ts` lines 31–36, 291–324, 532–544](https://github.com/shyne240/monienaija/blob/8a4a9f3b43881a81aeeaf40d4e5be987d62bd8a4/src/authorization/finance-role-administration.service.ts#L31-L36)). Report 30 recommends new `COMPLIANCE_LEAD` and `RISK_FRAUD_LEAD` roles but does not define a safe first-assignment procedure. Adding these keys to the one-person initial allowlist would silently create an exceptional, one-actor route for granting the very authority intended to be segregated.

**Assessment of self-escalation:** I found no current code path that lets a SUPER_ADMIN or ADMINISTRATOR directly self-assign the new, not-yet-created override/management grants. The existing self-assignment check, seeded-role immutability in the role-definition workflow, and self-approval check are meaningful controls. But that is not enough to approve the proposed extension: the policy relies on custom role creation, role assignment, category-pure grants, and access-type semantics that the design does not yet close end-to-end. The FINANCE_CONTROLLER checker is independent by principal ID, but the system does not currently constrain it to compliance/risk domain policy or enforce the proposed category-split bundles.

## 2. Authorization-boundary review

### 2.1 Global reads and cross-customer exposure

“Global within category” is not merely a global count. Each route takes `:id` as a customer ID, and the workforce policy uses `customerAccess: SELF`; `AuthorizationService` expressly treats SELF as a customer-self restriction only when the principal is `CUSTOMER`. A permitted workforce principal therefore may request another customer's ID, subject to the category function. The service then returns that customer's case or child rows if the category matches.

The six GET surfaces are:

| Endpoint | Current entitlement | Cross-customer data available to an in-category VIEW/EXECUTE role |
|---|---|---|
| `GET /customers/:id/compliance-cases` | `VIEW` or `EXECUTE` for matching categories | Case numbers, category/severity/status, opened/closed/assigned metadata and resolution fields for that customer's cases in authorized categories. |
| `GET /customers/:id/compliance-cases/:caseId` | Same | Full case record; customer ID and case state/details. |
| `GET …/:caseId/comments` | Same | Case comments/content (up to the configured 4,000-character limit per comment). |
| `GET …/:caseId/evidence` | Same | Evidence metadata including document name/type/reference and uploader/time. |
| `GET …/:caseId/assignments` | Same | Assignment history, worker/assigner identifiers and timestamps. |
| `GET …/:caseId/history` | Same | Status/resolution/assignment history and actor metadata. |

The category predicate and customer/case pair are enforced by the service for case/subresource reads, and the category lists are explicit and fail closed. Thus **cross-category reads are not permitted by the current design**; **cross-customer reads within a granted category are intentionally permitted**. If Product's approved hybrid decision meant a narrower read boundary than that, these six routes—not only list/detail—are the cross-customer exposure set requiring an additional read policy.

### 2.2 Mutations, assignment, and category isolation

Current mutation behavior is `EXECUTE` plus category, without an authoritative assignment requirement. POST assignment currently shares the same generic case function as create/update/comment/evidence. Report 30 correctly proposes distinct assignment-management and mutation authority; this anti-circular structure is necessary, but not yet sufficient.

Required separation:

- Case mutation: category-specific `EXECUTE` **and** active case assignment, or a separately authorized, category-bound override.
- Assignment administration: a separate management function **and** the corresponding category authorization. A management-only principal may assign but may not mutate. A mutation-only principal may not assign/reassign/revoke.
- FRAUD and non-FRAUD: implement separate permission codes, e.g. `compliance.manage_non_fraud_case_assignments` and `risk_fraud.manage_fraud_case_assignments`; likewise separate `compliance.override_non_fraud_assignment` and `risk_fraud.override_fraud_assignment`, or prove an equivalent category-intersection check at every read/write. One generic `compliance.manage_case_assignments` code is not enough to guarantee isolation.
- A principal holding both category grants can still have the union of both authorities. If Product means “no single person may bridge the two categories,” separate functions alone are insufficient; add a combination/role-assignment constraint or explicitly approve dual-category holders and require independent higher-level approval. Do not rely on role names.
- Supervisory override must not add a category to the principal. The service must compute `authorizedCategories ∩ overrideCategories ∩ case.category` from live `EXECUTE` grants; it must never treat possession of an override function as a substitute for `compliance.manage_case`/`risk_fraud.manage_fraud_case`.
- Case creation is a special case: no pre-existing assignment exists. If U-1 is approved, create the case and creator assignment atomically and only after the creator passed the category-specific create/execute check. Creator auto-assignment must use the session-bound actor—not a DTO `assignedTo` or caller-supplied principal ID. Because the route is customer-ID-scoped and workforce SELF does not bind operators to one customer, Product should expressly approve the ability of an in-category worker to create a case for any customer.

### 2.3 Role-by-role decision and privilege matrix

| Principal/role | Current category/read/mutation authority | Current assignment/role governance | Report 30 target authority and security condition |
|---|---|---|---|
| `COMPLIANCE` | Non-FRAUD case function `EXECUTE`; current global-within-category reads and mutations. | `ADMINISTRATOR`/`SUPER_ADMIN` can assign this fixed operational role via the direct operational-role path; self-assignment is denied. | After enforcement: non-FRAUD reads remain global; mutations only when assigned or valid non-FRAUD override. It must not automatically receive assignment-management or override functions. |
| `RISK_FRAUD` | FRAUD case function `EXECUTE`; no non-FRAUD case function by default. | Same fixed operational-role assignment pathway. | After enforcement: FRAUD reads global; mutations only when assigned or valid FRAUD override. No non-FRAUD management/override authority. |
| `SUPER_ADMIN` | No seeded case-category function by default; `PRIVILEGED` type alone is not the case entitlement. | Can initiate/apply governed role-definition proposals; FINANCE_CONTROLLER must independently approve. Can assign/revoke the six fixed operational roles, including COMPLIANCE/RISK_FRAUD, but not self-assign. | No implicit override/assignment-management right. Must not be proposer+checker for one grant, direct target, or bootstrap exception. Must not be able to create a category-crossing custom bundle without domain-specific independent governance. |
| `ADMINISTRATOR` | No seeded case-category function by default. | Can directly assign/revoke fixed operational roles including COMPLIANCE/RISK_FRAUD; cannot create/modify role definitions through the existing governance path. Self-assignment is denied. | No override/management authority from ADMINISTRATOR status. Existing ability to appoint a COMPLIANCE/RISK_FRAUD worker remains only role assignment, not a case assignment or case mutation. Must not be allowed to assign new supervisory roles without separate dual control. |
| `FINANCE_CONTROLLER` | No seeded case-category function by default. | Sole independent checker for role definitions and approver for other governed actions. | May review/approve a proposed bundle only if a domain-specific policy permits it; finance checker status must not itself confer compliance/fraud authority. Add a non-compliance domain checker or a distinct Compliance/Risk checker for the sensitive new grant class. |
| Proposed `COMPLIANCE_LEAD` | Not present in baseline. | Report 30 proposes custom role-definition grant but does not establish the role-assignment bootstrap path. | Non-FRAUD assignment management and/or non-FRAUD override only; no FRAUD functions. Every assignment should require independent approval and active workforce identity validation. |
| Proposed `RISK_FRAUD_LEAD` | Not present in baseline. | Same gap. | FRAUD assignment management and/or FRAUD override only; no non-FRAUD functions. Same independent assignment and active identity controls. |
| `OPERATIONS` / neutral assignment desk | No case function by default. | Operational workforce role. | If chosen as assignment administrator, restrict to non-FRAUD only by code and service predicate; no mutation/override authority. U-2/Product must confirm. |
| `SUPPORT`, `CUSTOMER`, `AGENT`, `SERVICE`, `AGGREGATOR`, unauthenticated | Denied by the workforce-session route policy and the compliance guard's allowed principal types. | No permitted route-level grant should override these principal-type checks. | Preserve the principal-type deny boundary on every added assignment, revoke, report, and override route. New endpoint tests must assert the negative cases, not infer from a class-level annotation. |

### 2.4 Endpoint-by-endpoint hybrid authorization matrix

| Route(s) | Current access | Required hybrid rule | Security decision |
|---|---|---|---|
| `GET /customers/:id/compliance-cases` | VIEW/EXECUTE + non-FRAUD category; cross-customer query by `:id` is possible | Keep category-restricted global read if the PO's cross-customer visibility risk is explicit; never grant to customer/agent/support. | **Conditional pass** on category boundary; global visibility is a policy risk acceptance. |
| `GET /customers/:id/compliance-cases/:caseId` | Same, with service customer/case/category binding | Same global-within-category read policy. Assignment not required under approved PO direction. | **Conditional pass**; test cross-customer and cross-category separately. |
| `GET …/:caseId/comments` | Same | Same read rule; recognize this returns comment text, not just metadata. | **Conditional pass**; global visibility should be explicit. |
| `GET …/:caseId/evidence` | Same | Same read rule; minimum disclosure of evidence name/type/reference; no document bytes here. | **Conditional pass**. |
| `GET …/:caseId/assignments` | Same | Same read rule; worker/assigner identity is visible globally within category. | **Conditional pass**. |
| `GET …/:caseId/history` | Same | Same read rule; actor/status/resolution history visible globally within category. | **Conditional pass**. |
| `POST /customers/:id/compliance-cases` | EXECUTE + category; caller may identify any customer in the URL | U-1 creator assignment is the only viable first owner; use authenticated actor, atomic write, explicit create capability/category check and audit. | **Conditional pass** after U-1 and cross-customer case-creation risk approval. |
| `PATCH /customers/:id/compliance-cases/:caseId` | EXECUTE + category; service locks case row | Active authoritative assignment for exact `case_id` + `worker_id`, or audited category-specific override; repeat check under case lock. | **Fail until implemented and tested**. |
| `POST …/:caseId/comment` | EXECUTE + category; service locks case row | Same assignment/override policy; mutation check before comment/history/audit writes, in the same transaction. | **Fail until implemented and tested**. |
| `POST …/:caseId/evidence` | EXECUTE + category; service locks case row | Same assignment/override policy; no evidence row may be written before check. | **Fail until implemented and tested**. |
| Existing `POST …/:caseId/assignment` | EXECUTE + category, arbitrary normalized `assignedTo` string; operational metadata only | Re-gate to management function plus matching category scope; validate target workforce identity; atomically update operational and authoritative stores. | **Fail as currently designed** until category-specific management and identity checks are specified. |
| Proposed revoke endpoint + unassigned report | Not present | Revoke only active target assignment for exact case; report category-bound and least-privilege, with no accidental case body exposure. | **Not yet verifiable**; contract and policy require U-2/U-3. |

## 3. Risk-ranked architecture findings

### R1 — Category separation and live access-type enforcement are not fully specified (**HIGH — design blocker**)

Report 30 proposes one assignment-management function for both categories and describes category inheritance for the override, but does not specify the SQL/live-grant check for those new functions. The current runtime flattens `VIEW`/`EXECUTE`/`INITIATE`/`APPROVE` into function codes; the existing compliance guard deliberately adds its own live SQL access-type filter. Copy that pattern for each proposed management and override function and require exact `EXECUTE` at the mutation site. Separate FRAUD/non-FRAUD codes (or an equally explicit category intersection) are necessary. A code naming/domain convention alone is not enforcement.

**Required:** category-pure function codes; validation that custom role proposals cannot bundle both category-management/override grants without an explicit, separately approved dual-category policy; reject `VIEW`/`INITIATE`/`APPROVE` for mutating functions; repeat live checks in the service transaction.

### R2 — Privileged role governance is real, but the proposed supervisory-role lifecycle is incomplete (**HIGH — design blocker**)

The current maker/checker workflow gives `SUPER_ADMIN` proposal initiation and application, `FINANCE_CONTROLLER` independent approval, and rejects same-principal approval. Existing operational role assignment prevents direct self-assignment and uses a database allowlist. These are positive controls. They do not answer who may provision the new custom lead roles, how the first holder is installed, how domain scope is enforced on arbitrary role bundles, or why Finance Controller is the appropriate checker for compliance/fraud powers.

The Report 30 proposal currently relies on new `COMPLIANCE_LEAD`/`RISK_FRAUD_LEAD` role definitions, but those keys are not seeded in the baseline. Existing first-assignment logic only admits the fixed bootstrap set; ordinary custom roles require an existing assignment before the maker/checker assignment path is used. If developers solve this by adding the lead roles to the one-person bootstrap allowlist, a SUPER_ADMIN could make the first grant to another identity without a second approver (direct self-assignment is separately blocked, but indirect delegation/collusion remains). The role-definition workflow can also propose assignable function bundles; it does not enforce the category-pure policy.

**Required:** a dedicated dual-control path for every first and subsequent assignment of these powers; target not proposer, checker, or same controlling identity; MFA and active workforce validation; role-bundle constraints; checker authority specific to Compliance/Risk; independent audit of create/approve/apply/assign/revoke; regression tests against direct and indirect escalation. Do not treat seed assertions alone as evidence.

### R3 — Authoritative assignment schema does not yet guarantee singular, immutable, case-bound authority (**HIGH — M1 design blocker**)

Report 30's proposed partial unique index is `UNIQUE (case_id, worker_id) WHERE status='ACTIVE'`. That allows multiple active workers on a single case, while the existing operational state is a singular `assigned_to` field and the proposal describes revoke-old/grant-new reassignment. The product model must say whether a case has one active assignee or a team. Default security recommendation: **one current active assignee per case** and a partial unique index on `case_id WHERE status='ACTIVE'`. If team assignment is intended, specify how the operational view, revocation and mutation decision represent multiple active members before using the composite index.

The proposed `customer_id` is denormalized and independently references `customers`; `case_id` references the case. No database constraint ties the pair together. The existing service binds them in SQL, but the new table is advertised as authoritative and should not admit an inconsistent pair through direct SQL or a future writer. `worker_id` is free text; active-workforce validation is proposed at the service boundary but has no database/identity-reference contract. Finally, status and immutability are mostly service-enforced; the report explicitly leaves an immutability trigger as a question.

**Required M1 database protections:**

- composite case/customer integrity (unique `(id, customer_id)` on case or equivalent constraint, then composite FK); exact worker identity validation at the management transaction boundary against the authoritative workforce assignment/session identity;
- status/revoke CHECK: ACTIVE iff revoke fields are null; REVOKED iff required revoker/time/reason fields are present;
- DB trigger or restricted stored procedure that permits only one `ACTIVE → REVOKED` transition; immutable `case_id`, `customer_id`, `worker_id`, `granted_by`, `granted_at`, `granted_via`; no hard delete; no reactivation/update-to-ACTIVE (new row only);
- partial unique active assignment per case if the approved model is one assignee;
- if multiple active workers are approved, use explicit unique identity semantics and make operational metadata consistent; never allow mismatched customer/case pairs;
- owner-separated migration/runtime DB roles where feasible; tests must attempt UPDATE/DELETE/direct invalid INSERT through the same DB role used by the application, not only service methods.

### R4 — M2-before-M4 and OFF rollback are not safe activation semantics (**HIGH — activation blocker**)

M2 adds assignment enforcement; M4 adds assignment management, revoke and the unassigned-case report, yet the plan schedules M4 after M2. M2's dependency on U-5 says an operational assignment pass precedes the flag flip, but the design does not provide an executable, validated assignment-reconciliation mechanism before M4 exists. Case-creation auto-assignment covers only new cases; it cannot resolve legacy open cases. If the flag is turned on after M2 alone, legitimate staff may be denied work on unassigned/in-flight cases with no supported reassign flow. If it is turned off as the proposed immediate rollback, the baseline permits category-wide mutations again and therefore abandons the approved assignment control.

**Required:** reorder delivery/activation so assignment infrastructure, management/revoke, supervisor controls, Admin UI, and validated reconciliation are complete before `ENFORCE`. Treat `OFF` as a pre-release state only, not a routine post-activation rollback. After activation, fail closed on missing/corrupt assignment data; any emergency return to legacy broad writes needs explicit, time-bounded Product+Security+Operations approval, mitigation, alerting, and a record. Never auto-grant all existing operational assignees into the authoritative store without identity/category/case validation.

### R5 — Governance and assignment-service decisions must be tied to one consistent lock and transaction boundary (**MEDIUM/HIGH — M2/M4 blocker**)

The proposed case-row-first, then assignment-row lock ordering is sound **if every writer follows it**. The mutation recheck must occur after acquiring the case row lock and must use the same transaction/manager as the mutation. Assignment create/reassign/revoke must also lock that same case row first, then assignment rows in deterministic order; otherwise a revoke can race a mutation or assignment writers can deadlock. Dual writes to operational history/`assigned_to`, authoritative assignment state, case history, and audit must commit or roll back together. The management target must be validated as an active workforce identity, not accepted as arbitrary free text.

**Required:** document one lock order and shared service helper; add tests for both revoke-first and mutation-first interleavings, two concurrent assignments, reassignment conflict, session/role revocation and rollback after every failure point.

### R6 — Global-within-category reads are broad and include case content/history (**MEDIUM — PO visibility acceptance required**)

The current service binds customer, case and category, so it prevents category crossover. It does not bind a workforce principal to a customer. In-category staff can query a supplied customer UUID and read case detail, comments, evidence metadata, assignment history and case history. That is consistent with the stated Product Owner hybrid direction, but is a meaningful cross-customer confidentiality boundary, not just a queue/list visibility rule.

**Required:** retain only with explicit PO acceptance that comments, evidence references, actor identities, status/resolution history, and case details are visible to every appropriately category-authorized staff principal. If not accepted, scope any or all detail/subresource routes to assignment/resource ownership while retaining category-wide aggregate/list data. Add cross-customer positive and negative tests for every GET route.

### R7 — NT-01…NT-15 do not yet cover the stated threat model (**MEDIUM — acceptance blocker**)

The planned matrix is a good start but several tests are phrased as single outcome tests without exercising the bypass paths or concurrent states that justify the design. See §9. The tests have not been executed because the architecture is not implemented; Report 28's existing baseline test results are not evidence for the future assignment/override model.

## 4. Database and concurrency review

### 4.1 Proposed table and integrity gaps

The proposed schema has a case FK, a denormalized customer ID, a worker string, lifecycle fields, and uniqueness on active `(case, worker)`. The case FK is appropriate because cases are soft-deleted, but does not itself enforce the denormalized customer match. The proposed unique index prevents duplicate active rows for the same worker/case, not multiple active assignees for that case. The proposal says historical rows are append-only, but its status transition/immutable fields are still a service promise unless the optional trigger is adopted.

The authoritative table should be genuinely authoritative under direct SQL and future services. For M1, require database tests for: wrong customer for valid case; unknown/inactive worker; forged/foreign principal ID; ACTIVE row with revoke fields; REVOKED row missing revoke metadata; REVOKED→ACTIVE; changing worker/case/customer/grantor; deleting rows; two simultaneous active assignees; duplicate grants in parallel; and grant after revoke as a new history row. If the chosen identity directory cannot be represented by an FK, document why and validate it in the transaction with a clear consistency/expiry strategy.

### 4.2 Locking and deadlock order

The Report 30 case-row-first order is a sound starting point. Make it normative across all paths:

1. Lock case row by both `case_id` and `customer_id` (and category check) with `FOR UPDATE`.
2. Lock current authoritative assignment rows in a deterministic key order.
3. Validate live worker entitlement, assignment state, category function/access type, and override state.
4. Perform case/comment/evidence writes, operational assignment projection, assignment history, case history and immutable audit in one transaction.
5. Commit; only after commit may the user observe success.

Every assign/reassign/revoke writer must take the same case lock first. A revocation that obtains the lock first makes the later mutation fail; a mutation that obtains it first is valid at the serialized decision point and commits before revocation. Tests must assert exact ordering and database state, not merely an expected HTTP status. Include two concurrent assignment requests for different workers, revoke-vs-mutation both ways, and rollback on audit/history failure.

## 5. Feature flag, sequencing, and shadow evaluation

### 5.1 Finding on the proposed flag

`COMPLIANCE_ASSIGNMENT_AUTHZ_ENABLED` is not present at the application baseline; it is a proposed future flag. Report 30 says OFF is byte-identical to baseline and describes OFF as rollback. This is backward-compatible for dark deployment, but OFF explicitly restores broad category-wide mutation authority and therefore is not a safe security rollback after assignment enforcement is active.

### 5.2 Required deployment order

Replace the current activation dependency/order with:

1. **M1 — dark schema only:** assignment table/entity/DB constraints/triggers and migration tests; no request behavior change and no assignment-based decisions.
2. **M4 — management and reconciliation tooling:** category-specific management functions, active-workforce target validation, assignment/revoke workflows, dual-store transactions, unassigned queue, least-privilege Admin UI, and historical in-flight case reconciliation with an exception queue. Management endpoints remain unavailable to ordinary callers.
3. **M3 — supervisory controls:** category-specific overrides, reason-code contract, independent grant/assignment governance, immutable audit and masked projections. No emergency override path before all hardening/tests.
4. **M2 — enforcement implementation behind an explicit mode:** assignment precheck and authoritative service recheck, all mutation paths including create semantics, and fail-closed data/error behavior. Not activated yet.
5. **Shadow phase:** separate `OFF | SHADOW | ENFORCE` mode (or equivalently constrained controls). SHADOW computes would-allow/would-deny using the same authoritative assignment and access checks but does not alter response or write business state. Emit only bounded aggregate metrics/denial reason codes; do not log case contents, customer IDs, free-form reasons, or assignment payloads. Run against reconciled existing cases and production-like PostgreSQL data with privacy review.
6. **Enforcement activation:** only after zero unexplained reconciliation exceptions, approved decisions, UI and operational readiness, shadow review, full acceptance tests, and an owner-signed change record.

Mode transitions must be tested in a real application lifecycle and database. Invalid mode, missing assignment table, migration mismatch, unavailable workforce identity source, and unknown role/function data must never silently become a permissive grant. After ENFORCE, fail closed on control-plane failure. A normal flag flip to OFF is prohibited; emergency rollback requires a documented, signed, time-limited exception and compensating restrictions.

## 6. U-1 through U-6 recommendations

The Product Owner has approved the hybrid direction, but these choices remain unresolved in Report 30. Record them as binding decision-register entries before their affected milestones. Where a question changes an endpoint contract or privilege assignment, PO confirmation remains mandatory.

| Decision | Recommendation | Security trade-off / safeguard | PO confirmation? | Blocks |
|---|---|---|---|---|
| **U-1 — creator auto-assignment** | **YES**, for the authenticated creator only, inserted atomically with a new case as `CASE_CREATION`; never accept creator/worker identity from the DTO. | Avoids newly created unassigned cases. Creation remains a privileged action on any customer UUID within the role's categories; require explicit cross-customer case-creation approval, create audit, rate controls, no side effect before category `EXECUTE` check, and exact row owner from session principal. | **Yes**, because it defines the exception to assignment-required mutation and the worker/customer workflow. | Blocks M2 create behavior and activation; does not block dark M1. |
| **U-2 — holders of override/management functions** | Create `COMPLIANCE_LEAD` and `RISK_FRAUD_LEAD` as distinct, category-pure roles; distinct FRAUD/non-FRAUD management and override functions. Do not give a neutral Operations desk FRAUD authority. If a single person may hold both, require separate explicit dual-category approval and audit. | New roles need a real first-assignment workflow; never add them to a one-person bootstrap allowlist. Require an independent Compliance/Risk checker for role definition and assignment; target must be an active workforce principal and not maker/checker. | **Yes**; role names, supervisory scope and segregation are business decisions. | Blocks M3/M4 implementation of grants and all activation. |
| **U-3 — revoke endpoint** | Add idempotent `POST /customers/:id/compliance-cases/:caseId/assignments/:assignmentId/revoke` with required bounded reason code, expected active version/state, and response indicating the one transition. Avoid hard delete and avoid silently revoking a different worker's row. | Case-row-first lock; exact customer/case/assignment binding; only management function plus category authority; immutable actor/time/reason; retries return current revoked state without new history duplicates. | **Yes**, endpoint contract and operational revocation workflow. | Blocks M4 endpoint contract; activation also blocked until available and tested. |
| **U-4 — override reason taxonomy** | Use a closed enum `INCIDENT_URGENT`, `STAFF_SHORTAGE`, `ESCORTED_INVESTIGATION`, `OTHER` plus required bounded justification only where `OTHER` or policy demands it. Store code separately from text; never accept a caller-chosen `compliance.override.<anything>` namespace. | Exact EXECUTE-only override permission; reason required only when a valid assignment is absent; redact/mask text in generic views; controlled access to raw justification; immutable audit plus case history; audit actor derives from session. | **Yes**, taxonomy and what can justify exceptional access are compliance policy. | Blocks M3; not M1. |
| **U-5 — in-flight cases at rollout** | **No silent auto-grants.** Reconcile each open case from operational assignment history only after validating worker identity, current workforce activity, category, case/customer binding, and whether multiple rows mean reassignment or collaboration. Unresolvable records stay unassigned and enter an owner-managed queue; use override for urgent work only after M3 is complete. | A controlled report, signed reconciliation totals, exception queue, and approval for any bulk conversion; preserve original history and import provenance. No direct mass SQL inserts that bypass the new writer. | **Yes** for operational transition and accepted unassigned-case backlog. | Blocks enforcement activation, not M1 dark development. |
| **U-6 — case-number Stage 2 timing** | Defer rejecting caller-supplied numbers until external consumers, imports, and client contracts are independently inventoried; Stage 1 generation when absent is a compatible intermediate. Keep legacy identifiers resolvable and avoid exposing uniqueness conflicts. | In-repo absence is not proof no external integration exists. Do not renumber or change historical rows. Separately review the current caller-chosen global-uniqueness oracle. | **Yes** before Stage 2 contract break. | Blocks only M5 Stage 2; not assignment-enforcement activation unless another dependency is found. |

## 7. NT-01 through NT-15 test adequacy review

All NT items are proposed future tests, not executed evidence. The dispositions below assess whether each test as written is sufficient and list required additions.

| Test | Assessment | Required additions before acceptance |
|---|---|---|
| **NT-01** unassigned worker mutates | **Partial** | Exercise PATCH, comment, evidence separately; assert no case, comment, evidence, case-history, or audit success record is written; denial audit records correct actor/category/reason. Test role with VIEW only and role with no category grant. |
| **NT-02** assigned worker mutates | **Partial** | Assert exact worker/case/customer/category match; wrong customer path, wrong category, closed case, revoked row, inactive worker, and assignment belonging to another principal all deny. Verify all three mutation forms and audit actor. |
| **NT-03** revoked/concurrent revoke | **Partial** | Run both serializations (revoke gets case lock first; mutation gets lock first), plus repeat under parallel PostgreSQL transactions. Assert one legal order, no torn writes, no stale successful post-revoke mutation, no deadlock, and rollback of all three stores. |
| **NT-04** worker B uses worker A assignment | **Partial** | Also forge `assignedTo`/`worker_id` in a management request; inactive/expired/non-workforce/customer/agent/support IDs; malformed/case-variant identifiers; target active role revoked during assignment. Verify worker identity is not taken from actor/request body. |
| **NT-05** FRAUD/non-FRAUD override inverse | **Insufficient** | Test assignment management cross-category both directions, a management-only role with the wrong category, a role bundle with both function codes, a principal holding two category roles, and category changes/races. Require category-intersection check at service layer. |
| **NT-06** override grant/reason variants | **Partial** | Include VIEW/INITIATE/APPROVE grant denied; EXECUTE allowed; assigned worker does not need override; wrong-category grant, revoked grant, forged reason-code prefix, controls/Unicode/oversize, reason omitted after a concurrent revoke, and safe masking of raw justification. Assert no writes on invalid reason. |
| **NT-07** SUPER_ADMIN/ADMINISTRATOR and governance self-escalation | **Insufficient** | Execute full proposal→independent checker→apply→role assignment path. Same-principal approval denied; verify proposer/checker/target identities differ; attempt combined FRAUD/non-FRAUD grants; attempt create/modify built-in seeded roles; attempt a sensitive custom role first assignment; test direct operational assignment of COMPLIANCE/RISK_FRAUD doesn't confer override/management; test ADMIN/SUPER cannot acquire via multi-role union or an assigned delegate. Seed absence alone is not enough. |
| **NT-08** manager-only/mutator-only/circularity | **Partial** | Add cross-category manager tests, duplicate assignments, two concurrent different assignees, self-assignment except creator path, manager target identity validation, manager cannot change case status/comment/evidence, mutator cannot call assign/revoke or alter `assigned_to`, and reassignment old/new row consistency. |
| **NT-09** unchanged global reads | **Partial** | Assert positive cross-customer reads and negative cross-category reads for all six GET routes (case, comments, evidence, assignment, history); include nonexistent/wrong-customer indistinguishability and data minimization. Product must accept the content/actor exposure. |
| **NT-10** customer/agent/SUPPORT on all 11 routes | **Partial** | Include CUSTOMER, AGENT, SUPPORT, SERVICE, AGGREGATOR, unauthenticated, invalid/expired/revoked workforce session, and principals with fake `roles`/`scopes`; run every new management/revoke/report/override endpoint too. |
| **NT-11** VIEW-only function | **Insufficient** | Test VIEW for each new management/override code; INITIATE/APPROVE and inactive role/function rows must also deny execution. Verify GET succeeds on VIEW-only and POST/PATCH fails despite `principal.scopes` union containing function code. |
| **NT-12** dashboards/unassigned report | **Partial** | Test user with category VIEW only, management-only, no category function, cross-category query, hidden customer IDs, aggregates and pagination; ensure report cannot expose case detail or serve as a read-scope bypass. |
| **NT-13** audit integrity/masking | **Insufficient** | Attempt UPDATE/DELETE on authoritative assignment rows, case-history override rows, and audit rows through the app DB role; attempt invalid lifecycle transitions and customer/case mismatch direct SQL. Test reason masking in each generic projection and ensure immutable record still has the exact actor, code, and timestamp. A trigger on `audit_events` alone does not protect other tables. |
| **NT-14** case number generation | **Partial** | Include cross-customer uniqueness/existence-oracle behavior and compatibility of callers outside the repo; keep separate from D-01 assignment tests. Not an assignment-enforcement gate unless M5 is coupled to activation. |
| **NT-15** flag OFF baseline behavior | **Insufficient** | Add explicit `OFF → SHADOW → ENFORCE` transitions, premature ENFORCE rejection before M3/M4/readiness, invalid config/missing table fail-closed, post-activation attempt to set OFF, emergency override approval/expiry, and confirmation that OFF would reopen broad writes (so it is not considered a security rollback). |

### Additional permanent PostgreSQL cases required

1. Database constraint and trigger matrix from §4.1, including two concurrent active grants for the same case and direct status/identity edits.
2. Exact cross-store atomicity: authoritative row, operational assignment history, `assigned_to`, case history, and audit all commit or roll back together.
3. Active-worker lifecycle: assignment to an unknown/inactive principal fails; role/session/workforce revocation prevents new mutation immediately; no stale cached grant survives longer than policy permits.
4. Governance separation: role definition with either category's new management/override code can only be approved by its domain-authorized independent checker; first and repeat role assignments require dual control; no role can grant itself or its maker/checker the new permission.
5. Mutation race and deadlock tests under concurrent case change + assign + revoke, with deterministic lock ordering and no duplicate/partial rows.
6. Feature-mode tests use the actual environment/config path and production route wiring—not only direct service calls or mocked guard outcomes.

## 8. Security approval matrix disposition

| # | Control area | Disposition | Reason / condition for co-signature |
|---|---|---|---|
| 1 | Assignment ownership and identity | **CONDITIONAL** | Session-bound `principalId` is the correct authority key; free-text operational assignment is not. Need active workforce validation, an explicit custom-role assignment lifecycle, forged identity negatives, and DB integrity controls. |
| 2 | Cross-customer/category access | **CONDITIONAL** | Existing category guard and case/customer binding are strong for current case reads/writes. Global-within-category reads expose comments/evidence/history across customers by design; PO acceptance and all-route category tests required. New management/override category checks are underspecified. |
| 3 | Unauthorized reassignment / anti-circularity | **CONDITIONAL** | Separate concepts are right; distinct executable function checks and custom role bootstrap/assignment controls are missing. |
| 4 | Revoked/stale assignments | **CONDITIONAL** | Case-row lock recheck is sound if every writer follows case-first ordering. DB transition protection and race tests are not yet specified strongly enough. |
| 5 | Supervisor override misuse | **FAIL AS WRITTEN** | One generic override code, unproven EXECUTE-only check, free-form reason namespace, and incomplete role-grant/assignment lifecycle can widen category authority. |
| 6 | Self/indirect escalation | **CONDITIONAL / BLOCKER** | Current maker/checker rejects self-approval and current assignment rejects self-assignment. But new roles and function bundles are dynamically governed; first grant, domain checker, category purity, and grant→assignment chain are not closed. |
| 7 | Concurrent case changes | **CONDITIONAL** | Proposed locking direction is good; assignment/revoke writes need same ordered lock protocol, single-active-owner semantics, and two-sided concurrency tests. |
| 8 | Invalid/missing override reasons | **CONDITIONAL** | Bound and required reason is correct; reason-code source must be closed/allowlisted, masked, and transactionally tied to an immutable audit. |
| 9 | Dashboard and reporting | **CONDITIONAL** | Aggregate counts may remain unchanged; new unassigned report needs category/data minimization and a no-bypass test. |
| 10 | Audit integrity | **FAIL AS WRITTEN** | `audit_events` immutability does not make authoritative assignments and `compliance_case_histories` immutable. Proposed optional trigger is not an approval criterion yet. |

## 9. Required architecture changes before security co-signature

1. **Split permissions or specify an enforceable category intersection.** Prefer separate FRAUD/non-FRAUD assignment-management and override functions. Enforce live `EXECUTE` in guard and service, intersect with the existing category function, and reject all wrong access types. Decide explicitly whether one principal may hold both category powers.
2. **Constrain governed role definitions.** Add policy for who may create/approve Compliance/Risk roles and which function bundles/access types are permitted. Do not rely on a role key string, seed exclusion comments, or an absent seeded grant. Restrict one-actor bootstrap. Bind custom role assignment to active workforce identities and independent maker/checker for every assignment/revocation of management or override authority.
3. **Complete assignment database contract.** Specify one-vs-many active assignees; composite customer/case binding; worker identity validation; row lifecycle CHECKs; append-only trigger for assignment identity/grant fields; only ACTIVE→REVOKED; no deletes/reactivation; immutable case-history override records. Add database tests via application DB role.
4. **Define one atomic transaction/lock protocol.** Case row first; assignment row(s) second; live access checks under the same manager; all operational/authoritative/history/audit writes atomic. Mutations re-check after obtaining case lock.
5. **Reorder rollout and change flag semantics.** M1 dark schema; M4 assignment management/reconciliation and UI; M3 override; M2 enforcement code last. Keep `ENFORCE` unavailable until all controls complete. Add shadow mode and reject premature transitions. OFF is not a safe post-enforcement rollback.
6. **Close PO decisions U-1…U-6** as in §6. U-1/U-2/U-3/U-4 affect implementation contracts or privilege; U-5 gates activation; U-6 gates only the case-number Stage 2 contract.
7. **Expand NT suite** per §7 and run the full matrix against disposable PostgreSQL after implementation. Each test should assert denied side effects and authoritative DB state, not just status code.

## 10. Exact permissible implementation scope

**Conditional dark infrastructure authorization, not current blanket approval:** after Report 30 is revised to incorporate the M1 requirements below, Arena 3 may start **M1 only**:

- add the new assignment authorization table/entity and only additive schema/index/trigger changes;
- implement no route behavior, no new role grants, no category function seeds, no enforcement guard, no override, no assignment workflow, and no feature-mode activation;
- add migration-chain and PostgreSQL tests for lifecycle constraints, customer/case binding, active-assignment uniqueness, append-only controls, and safe down/rollback behavior;
- prove the new table is unused by existing request handling and has no effect with the flag absent;
- keep the implementation on its own active implementation branch, with no cross-branch changes by this reviewer.

M1 may not start until its revised DDL explicitly resolves singular/multiple active assignees, identity validation, composite binding, and immutable lifecycle. M2, M3, M4, role-definition/assignment changes, Admin UI, and any activation require the revised architecture and recorded U decisions. This is **permission for a limited dark foundation only**, not approval of the rest of Report 30.

## 11. Conditions for enabling assignment enforcement

The Product Owner and Security must both approve activation only after all of the following are evidenced at one exact SHA:

- U-1 through U-5 recorded and the U-6 Stage 2 choice separately recorded if in scope;
- authoritative assignment table and DB protections accepted; all active/in-flight cases reconciled or explicitly in an exception queue with no silent grant;
- assignment/reassign/revoke workflows operate, validate worker identity, preserve case/customer/category binding, and write both stores atomically;
- supervisory override exists with category-specific `EXECUTE` checks, closed reasons, mandatory reason, immutable audit, and controlled grant/role assignment path;
- every mutation path including create/update/comment/evidence is checked before any write and rechecked under the same case lock/transaction;
- assignment-management never implies mutation; mutation never implies assignment management; FRAUD/non-FRAUD remain isolated; cross-category dual-role decision is explicit;
- Admin UI supports assignment queue, assignment/revoke, valid override reason capture, and role/access display without hiding backend denials;
- NT-01…NT-15 plus the additional cases in §7 pass against real PostgreSQL and actual HTTP route wiring; existing compliance tests pass with OFF/SHADOW/ENFORCE modes as specified;
- shadow period reviewed by Product, Compliance, Security and Operations; no unexplained would-deny or category-crossing decisions remain;
- deployment, rollback/incident handling, monitoring/alerting, and operational owner sign-off are complete.

No single `COMPLIANCE_ASSIGNMENT_AUTHZ_ENABLED=true` environment change should be sufficient to bypass these gates. Activation must be controlled, auditable, staged, and unavailable to ordinary runtime operators.

## 12. Final decision and boundaries

| Decision | Status |
|---|---|
| Product Owner hybrid direction (category-global reads, assignment mutations, audited supervisory exception) | **Conditionally supportable**; preserve the explicit cross-customer read acceptance. |
| Report 30 as written | **Not Security co-signed**; architecture changes in §9 required. |
| M1 additive dark schema work | **Conditional limited authorization** after revised DDL and this review's M1 constraints are acknowledged. |
| M2/M3/M4 role, enforcement, assignment, or override implementation | **Not authorized under current design**; revise and obtain explicit Security review/co-signature. |
| Assignment enforcement flag / production activation | **NOT AUTHORIZED** until every condition in §11 is met. |
| Production operations, live financial operations, or deployment | **Not authorized by this review.** |

This is a documentation-only review. No application code, test, migration, seed, database record, branch other than the reviewer's own documentation branch, deployment, production configuration, provider activation, or financial operation was changed. Stop condition honored: this review ends with the above implementation/activation decision; it does not begin implementation.
