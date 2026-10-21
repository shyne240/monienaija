# A2 Privileged Workforce Authentication — Formal Decision Package

- **Package type:** Architecture decision package only
- **Status:** ACCEPTED — implemented by A2T11
- **Allocation:** A2 bounded workforce/privileged-authentication extension
- **Owner:** A2 Runtime Identity & Access
- **Permanent role-administration owner:** B9 Identity & Access Administration
- **Task number:** A2T11
- **ADR:** ADR-0092
- **Runtime status:** IMPLEMENTED — production provider/configuration not activated
- **Predecessor review:** [`A2-PRIVILEGED-WORKFORCE-AUTHENTICATION-ARCHITECTURE-PACKAGE.md`](A2-PRIVILEGED-WORKFORCE-AUTHENTICATION-ARCHITECTURE-PACKAGE.md)
- **Blocked dependency:** B2F06 production policy activation

This package presents explicit choices for the ten unresolved A2 trust-boundary decisions. It does not select an option, allocate a task or ADR, implement an identity system, or authorize production operation. Architecture must record each decision before implementation begins.

## Decision 1 — Workforce identity source and trust protocol

### 1. Exact architectural question

What authoritative source and protocol may A2 trust to authenticate a production workforce identity before establishing an `OPERATOR` or `PRIVILEGED` principal?

### 2. Repository-supported options

#### Option A — Cryptographically validated upstream workforce assertion

A2 receives a short-lived assertion from an approved workforce identity source and validates integrity, issuer, audience, environment, freshness, expiry, and replay controls.

**Repository support:** A2T02 defines a protocol-neutral authentication execution boundary. A2T03 allows opaque or signed token validation. The A2 threat model anticipates future operator identities. No concrete assertion protocol/provider is selected.

#### Option B — Trusted introspection result

A2 presents an opaque workforce credential/assertion to an approved trusted source and consumes a current introspection response bound to the subject, audience, assurance, expiry, and revocation state.

**Repository support:** A2 contracts require credential/session currentness and fail-closed validation, but no workforce introspection service or trust protocol exists.

#### Option C — A2-owned workforce credential authentication

A2 validates a workforce credential through an approved workforce credential authority, then establishes its own identity/session evidence.

**Repository support:** A2T02 owns authentication execution, but existing P1.8 credentials are customer-owned and cannot be repurposed. No workforce credential authority/schema is authorized.

#### Option D — Other mechanism

No other repository-supported mechanism was found. Service-to-service principal validation is planned by A2T06 but does not establish human maker/checker workforce identity.

### 3. Advantages

- **A:** Strong local validation, reduced per-request source dependency where assertions are short-lived, standard separation between source and A2 runtime trust.
- **B:** Immediate source-side disablement/currentness where introspection is available; opaque credential material can remain source-owned.
- **C:** Direct A2 control over session establishment and validation lifecycle.

### 4. Security implications

- **A:** Requires trusted issuer/key lifecycle, replay protection, strict audience/environment validation, and short expiry.
- **B:** Requires authenticated introspection, availability, response integrity, replay controls, and fail-closed outage behavior.
- **C:** Requires a new workforce credential authority, secret/hash protection, recovery, lockout, and compromise controls; highest risk of duplicating IAM.

All options must reject caller-supplied identity/role/MFA headers and isolate production from non-production.

### 5. Authority-boundary implications

A2 validates runtime authentication. The upstream source owns identity authentication facts. B9 later administers identity/role access. B2F06 remains a consumer. Option C risks making A2 a workforce credential-administration authority unless sharply bounded.

### 6. Operational implications

- **A:** Key/issuer rotation, assertion issuance, clock/freshness monitoring, and source outage policy.
- **B:** Highly available introspection dependency, latency/timeout budget, and outage handling.
- **C:** Credential operations, support/recovery, security monitoring, and secret lifecycle.

### 7. Migration implications

The selected source must provide stable subject correlation and later B9 migration. Existing customer credentials/sessions cannot be migrated into workforce identities.

### 8. B9 handoff implications

B9 must later administer identity status and entitlements while A2 continues runtime validation. Source subject and A2 principal mapping must remain stable or be explicitly migrated.

### 9. Already-supported choice?

**NO AUTHORIZED PROVIDER/PROTOCOL EXISTS.** A2 supports protocol-neutral validation patterns only.

### 10. Newly required authorization

Architecture must authorize the identity source, protocol, trust anchor, issuer/subject semantics, environment separation, compromise/revocation source, secret/key owner, and failure behavior.

### 11. Exact decision required

Choose Option A, B, C, or an evidence-backed alternative; name the authoritative source and approve its complete trust protocol. If none is acceptable, implementation remains **BLOCKED**.

---

## Decision 2 — Stable workforce-to-A2 principal-ID mapping

### 1. Exact architectural question

How is a validated workforce source subject mapped to one stable, unique A2 `principalId` across authentication, sessions, approvals, audit, revocation, and later B9 administration?

### 2. Repository-supported options

#### Option A — Approved immutable source subject becomes A2 principal ID

Use a canonical, environment-qualified immutable subject from the approved source directly as `principalId`.

#### Option B — Explicit source-subject to A2-principal mapping

Persist or consume a governed mapping from `(source, issuer/tenant, environment, subject)` to an A2-owned stable principal identifier.

#### Option C — Another mechanism

No other repository-supported mechanism was found. `Customer.id` applies only to customers and cannot identify workforce principals.

### 3. Advantages

- **A:** Minimal state and fewer synchronization points.
- **B:** Decouples A2 identity from provider migration/subject format and supports source replacement or multiple sources.

### 4. Security implications

- **A:** Subject reuse, issuer ambiguity, tenant collision, and source migration can misbind identity unless fully qualified and immutable.
- **B:** Mapping creation/change becomes privileged; duplicate/collision, takeover, stale mapping, and deletion controls are required.

### 5. Authority-boundary implications

A2 needs stable runtime correlation. Permanent workforce identity/assignment administration belongs to B9. Option B must not become an ungoverned A2 directory.

### 6. Operational implications

- **A:** Source must guarantee immutability/non-reuse and publish lifecycle events.
- **B:** Requires mapping lifecycle, versioning, lookup availability, reconciliation, and support controls.

### 7. Migration implications

- **A:** B9 must adopt or map existing qualified subjects.
- **B:** B9 can take over mapping administration while preserving A2 principal IDs, but cutover/reconciliation are required.

### 8. B9 handoff implications

B9 must preserve approval/audit correlation and prevent identity duplication during cutover. Conflicts fail closed.

### 9. Already-supported choice?

Neither. `AuthorizationPrincipal` accepts a string principal ID, but no workforce mapping authority or format is defined.

### 10. Newly required authorization

Principal-ID format, source qualification, uniqueness scope, collision handling, subject-reuse rules, mapping owner, lifecycle, effective dating, and B9 migration.

### 11. Exact decision required

Approve Option A or B and its uniqueness/lifecycle contract. Implementation remains **BLOCKED** without it.

---

## Decision 3 — Privileged session model

### 1. Exact architectural question

After workforce authentication, does A2 issue a locally revocable privileged session, or validate a short-lived upstream assertion on every protected request?

### 2. Repository-supported options

#### Option A — A2-issued opaque revocable privileged session

After validating workforce authentication, A2 issues an opaque token, stores only protected/hashed session state, and establishes principal/audience/assurance/expiry/revocation context.

**Repository evidence:** A2T03 and the customer `AuthenticationSessionService` demonstrate opaque, hashed, expiring, revocable session mechanics. That implementation is customer-only and cannot be reused without a bounded workforce contract.

#### Option B — Short-lived upstream assertion per request

Every protected request carries a short-lived approved workforce assertion; A2 validates it and establishes request principal context without a durable A2 access-token session.

**Repository evidence:** A2T03 permits signed-token or equivalent validation. No workforce assertion validator exists.

#### Option C — Other mechanism

No other approved mechanism was found. Caller-supplied principal objects, static headers, API keys, and test fixtures are not sessions.

### 3. Advantages

- **A:** Local revocation, explicit A2 audience/session reference, stable approval/session correlation, reduced identity-source dependence after establishment.
- **B:** Source remains current authority; short lifetime reduces persistent local token state and may propagate source disablement quickly.

### 4. Security implications

- **A:** Token theft/replay, session fixation, issuance security, token hashing, revocation synchronization, and rotation must be controlled.
- **B:** Assertion replay, key/issuer compromise, audience confusion, clock skew, and per-request source/key currentness must be controlled.

### 5. Authority-boundary implications

Both keep authentication validation in A2. Option A gives A2 session authority, already intended by A2T03. Neither allows B2F06 to create or trust sessions.

### 6. Operational implications

- **A:** Session store availability, revocation/cleanup, rotation, incident termination, and support diagnostics.
- **B:** Validator/key/introspection availability on each request, latency, cache/currentness policy, and source outage behavior.

### 7. Migration implications

Customer sessions remain separate. Any later model change must revoke or explicitly migrate privileged sessions; tokens cannot be silently reinterpreted.

### 8. B9 handoff implications

B9 entitlement removal must invalidate/narrow active access. Option A requires session invalidation on assignment changes; Option B requires current source/B9 claims or introspection.

### 9. Already-supported choice?

A2 architecture supports both abstractly. Option A has an implementation pattern in customer sessions, not workforce authorization. Neither is selected.

### 10. Newly required authorization

Token/assertion form, session storage, audience, TTL, refresh/rotation, binding to assurance/roles, revocation source, outage behavior, and environment isolation.

### 11. Exact decision required

Approve Option A or B and its complete lifecycle. Implementation remains **BLOCKED** without it.

---

## Decision 4 — MFA source, assurance, and freshness

### 1. Exact architectural question

What authoritative workforce MFA/step-up evidence may A2 accept, and how fresh must it be for Finance controller approval and privileged execution?

### 2. Repository-supported options

#### Option A — MFA assertion supplied by the approved workforce identity source

A2 validates an assurance/method/authentication-time claim from the approved source.

#### Option B — A2-executed workforce step-up through an approved MFA authority

A2 initiates/verifies a bounded step-up and records MFA assurance in the workforce context.

#### Option C — Existing customer MFA

Not valid. It is customer-bound and cannot establish workforce assurance.

No concrete provider/method is repository-authorized.

### 3. Advantages

- **A:** Reuses workforce authentication governance and avoids duplicate enrollment.
- **B:** Gives A2 direct control of step-up timing and action-bound freshness.

### 4. Security implications

Both require phishing/replay resistance appropriate to approval risk, method status, freshness, revocation, recovery, and secret minimization. A boolean/header claim is insufficient.

### 5. Authority-boundary implications

A2 owns runtime assurance. The approved MFA source owns enrollment/method facts until B9 administration exists. B2F06 only requires/consumes assurance.

### 6. Operational implications

Enrollment, lost-factor recovery, method revocation, step-up failure, source outage, incident reset, and support boundaries must be defined.

### 7. Migration implications

Customer MFA metadata is not migrated. Future B9 must administer or integrate workforce MFA governance without changing A2's `MFA` runtime contract.

### 8. B9 handoff implications

B9 later owns enrollment/access administration and reviews; A2 continues assurance validation.

### 9. Already-supported choice?

**ALREADY AUTHORIZED:** `FINANCE_CONTROLLER` approval requires A2 `MFA` assurance; `PrivilegedActionApprovalService` enforces it when configured.

**NOT VERIFIED / REQUIRES REVIEW:** provider/source, accepted methods, enrollment authority, step-up protocol, freshness, recovery, and revocation.

### 10. Newly required authorization

Choose Option A or B; authorize provider/source, method policy, freshness rule, recovery, revocation/currentness, outage behavior, and evidence minimization.

### 11. Exact decision required

Approve the workforce MFA source and complete assurance/freshness lifecycle. Implementation remains **BLOCKED** without it.

---

## Decision 5 — Interim Finance role/scope authority before B9

### 1. Exact architectural question

Who may authoritatively assign and revoke `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, approval/execution scopes, and internal Finance audience access before B9 exists?

### 2. Repository-supported options

#### Option A — Bounded interim assignment source consumed by A2

Architecture approves a temporary governed assignment authority/evidence source with versioned, effective, revocable, audited assignments and a mandatory B9 migration.

#### Option B — Wait for B9 administrative IAM

No interim assignments are permitted. Workforce authentication may exist, but Finance administration remains blocked until B9 assigns/reviews roles and entitlements.

#### Option C — Another existing authority

None found. B2F06 defines role semantics but cannot assign roles. A2 evaluates roles but has no workforce assignment store. Customer metadata and B10 API-consumer credentials are not valid role authorities.

### 3. Advantages

- **A:** Unblocks the bounded policy workflow before B9 while preserving explicit temporary governance.
- **B:** Avoids interim authority and migration risk; permanent governance starts with B9.

### 4. Security implications

- **A:** Assignment escalation, stale roles, self-assignment, dual authorities, inadequate review, and cutover risk require strong controls.
- **B:** Lower interim risk but prolongs the operational blocker.

### 5. Authority-boundary implications

A2 consumes role evidence; it must not silently become permanent administrator. B2F06 must not assign roles. Option A needs an explicitly named temporary owner. Option B preserves B9 exclusivity.

### 6. Operational implications

- **A:** Maker/checker assignment workflow, effective dates, revocation, periodic review, reconciliation, support, and emergency removal.
- **B:** B2F06 production activation waits for B9 implementation and production readiness.

### 7. Migration implications

- **A:** Every interim assignment must be inventoried, reconciled, approved, migrated, and retired at B9 cutover.
- **B:** No interim migration, but authenticated workforce identities must later link to B9.

### 8. B9 handoff implications

Option A requires no dual-active authority, conflict fail-closed behavior, stable principal/role IDs, historical audit preservation, and rollback. Option B is direct B9 ownership.

### 9. Already-supported choice?

Neither. The roadmap supports future B9 and B2F06's consumption of A2 evidence, but no interim authority exists.

### 10. Newly required authorization

For Option A: temporary owner, assignment model, approved roles/scopes/audience, maker/checker, version/effective window, review, revocation, audit, retention, and sunset. For Option B: explicit acceptance that B2F06 waits for B9.

### 11. Exact decision required

Approve Option A with a named interim authority and sunset contract, or Option B. This decision is a **BLOCKER**.

---

## Decision 6 — Protected internal administration ingress

### 1. Exact architectural question

Through what internal, authenticated, audience-bound ingress may an A2 workforce principal reach bounded administration operations without creating a public Finance API?

### 2. Repository-supported options

#### Option A — Internal authenticated administrative HTTP boundary

A controller/route exists only after A2 workforce authentication, behind internal network/deployment restrictions and exact route policies.

#### Option B — Authenticated internal operator command boundary

A controlled operator process validates the same A2 workforce/session evidence and invokes internal services without public HTTP exposure.

#### Option C — Existing administrative extension

None exists. Existing controllers do not expose privileged approvals or B2F06 administration.

### 3. Advantages

- **A:** Uses A2T08 route classification/guards and clear request/audit semantics.
- **B:** Smaller externally reachable surface where controlled deployment tooling exists.

### 4. Security implications

Both require real A2 authentication before command execution, exact audience/scope/role/MFA checks, request replay/CSRF controls as applicable, rate limiting, network restriction, and emergency disable. A CLI that accepts principal fields is prohibited.

### 5. Authority-boundary implications

Transport only; A2 authenticates/authorizes/approves, B2F06 owns policy. Neither option may become identity or approval authority.

### 6. Operational implications

- **A:** Internal DNS/network, TLS, route ownership, deployment allowlist, monitoring, and incident disable.
- **B:** Controlled execution environment, binary/script provenance, operator authentication handoff, audit context, and safe output handling.

### 7. Migration implications

Ingress must remain stable or versioned through B9 cutover. No public API compatibility promise should be created.

### 8. B9 handoff implications

B9-managed entitlements eventually feed the same A2 route/command authorization policies.

### 9. Already-supported choice?

A2T08 supports **internal authenticated administration** and protected operator/privileged route classes. It does not select HTTP versus command transport or implement workforce ingress.

### 10. Newly required authorization

Transport, network trust zone, audience, route/command scopes, credential conveyance, rate limits, CSRF/replay protections, emergency disable, monitoring, and exposure classification.

### 11. Exact decision required

Approve Option A or B and its complete protected-ingress contract. Implementation remains **BLOCKED** without it.

---

## Decision 7 — Session expiry, revocation, and outage behavior

### 1. Exact architectural question

What expiry, revocation, rotation, logout, compromise, stale-evidence, and dependency-outage rules apply to the session model selected in Decision 3?

### 2. Repository-supported options

#### If Decision 3 Option A — A2-issued session

- explicit short expiry;
- token hashing/protection;
- local revocation and logout;
- rotation with predecessor invalidation;
- role/MFA/source currentness revalidation;
- compromise-driven all-session termination;
- fail closed when required source currentness cannot be established.

#### If Decision 3 Option B — Upstream assertion per request

- reject expired/not-yet-valid/wrong-audience assertions;
- validate issuer/key/currentness each request or under an approved bounded cache;
- source-side revocation/introspection where supported;
- no refresh beyond obtaining a new upstream assertion;
- fail closed on stale key/status/introspection evidence or source outage under the approved policy.

No numerical TTL or outage grace interval is authorized.

### 3. Advantages

- **A:** Immediate local termination and stable A2 session evidence.
- **B:** Source-centric lifecycle and naturally short request credentials.

### 4. Security implications

Both must address theft, replay, fixation, key/source compromise, stale roles, stale MFA, logout races, and environment crossing. Fail-open behavior is prohibited.

### 5. Authority-boundary implications

A2 owns runtime session/currentness decisions. Identity source and later B9 provide disablement/entitlement signals. Domain services do not interpret tokens.

### 6. Operational implications

- **A:** Session storage, revocation operations, cleanup, incident bulk revoke, source synchronization.
- **B:** Per-request validation dependency, key/introspection monitoring, cache invalidation, outage impact.

### 7. Migration implications

Model changes require explicit revocation/cutover; active tokens/assertions cannot be silently reinterpreted.

### 8. B9 handoff implications

B9 role removal must invalidate/narrow active access within an approved maximum delay. Dual role sources are prohibited after cutover.

### 9. Already-supported choice?

A2T03 and current customer sessions establish general expiry/revocation/rotation principles. No workforce values/model are selected.

### 10. Newly required authorization

TTL/freshness values, refresh/rotation, revocation source, propagation bound, logout/termination, compromised-session response, source/A2 outage rules, cache policy, and recovery.

### 11. Exact decision required

Approve the complete lifecycle corresponding to Decision 3. Implementation remains **BLOCKED** without it.

---

## Decision 8 — Audit evidence and retention

### 1. Exact architectural question

What minimized immutable evidence must be retained for workforce authentication, privileged sessions, role/MFA evidence, protected ingress, authorization, approval, revocation, and incidents, and for how long?

### 2. Already authorized

- Shared Operations `AuditService` is the sole audit authority.
- A2 records authentication/security, authorization, session, and privileged-action events.
- Secrets/tokens/passwords/MFA values must not be logged.
- Request/correlation/trace evidence is preserved.
- Legal holds override ordinary disposal.

### 3. Evidence categories required

- authentication success/failure and safe reason;
- identity source/issuer and safe subject/principal reference;
- principal establishment/type;
- privileged session issue/validate/rotate/revoke/expire;
- audience and assurance result;
- MFA/step-up result, method class, authentication time/freshness without secrets;
- role/scope evidence source/version/effective status;
- protected-ingress authorization allow/deny;
- privileged approval request/approve/reject/cancel/consume/expire;
- maker/checker/executor, action, resource, fingerprint, and session references;
- role removal/session termination;
- source/A2 outage and stale-evidence denial;
- security incidents and emergency actions.

### 4. Repository-supported options

#### Option A — Existing shared audit plus dedicated A2 security-event evidence

Continue existing pattern: shared audit facts and A2 security-event records, with minimized workforce-safe schemas.

#### Option B — Shared audit only

Not sufficient where A2 security-event lifecycle/currentness is required by existing A2 contracts.

No second audit store is authorized.

### 5. Advantages

Option A preserves current separation between general immutable audit and security-event history while avoiding a new authority.

### 6. Security implications

Evidence is sensitive and must be access-controlled, redacted, integrity-protected, environment-bound, and protected from destructive incident cleanup.

### 7. Authority-boundary implications

Operations remains audit authority; A2 defines authentication/security event semantics. B9 later administers access/review, not audit truth.

### 8. Operational implications

Search/support access, incident preservation, legal hold, export minimization, storage growth, and deletion workflows require governance.

### 9. Migration implications

Existing customer events cannot be relabeled as workforce events. New schemas must remain compatible with future B9 access reviews and preserve history at cutover.

### 10. B9 handoff implications

B9 consumes historical evidence for access reviews but must not rewrite A2/Operations audit history.

### 11. Already-supported choice?

**ALREADY AUTHORIZED:** AuditService reuse, A2 security events, redaction, correlation, legal-hold principle.

**NOT VERIFIED / REQUIRES REVIEW:** exact workforce event schema, classification, retention durations, access roles, legal-hold workflow, incident/export requirements.

### 12. Exact decision required

Approve Option A, exact evidence schema/classification, retention/legal-hold/access requirements, and incident-preservation rules. Do not invent durations.

---

## Decision 9 — B9 migration and handoff

### 1. Exact architectural question

How will future B9 take over workforce principal mapping administration, Finance role/scope assignment, access reviews, revocation, and privileged governance without changing A2 runtime authorization or losing history?

### 2. Repository-supported options

#### Option A — Planned cutover from a bounded interim assignment authority

B9 imports/reconciles explicitly approved interim principals/assignments, becomes sole active administrator, and A2 switches role-evidence consumption to B9.

#### Option B — No interim authority

Wait for B9; no assignment migration is required, but A2 workforce authentication cannot authorize Finance operations before B9.

No other supported model exists.

### 3. Advantages

- **A:** Allows bounded earlier operation and preserves a planned path to permanent governance.
- **B:** Avoids dual-authority/migration risk.

### 4. Security implications

Option A risks duplicate/conflicting assignments, privilege persistence, identity mismatch, and rollback ambiguity. Option B delays operations but has cleaner authority.

### 5. Authority-boundary implications

After cutover B9 is the sole assignment/review authority; A2 remains runtime authentication/session/authorization; B2F06 remains role-policy consumer.

### 6. Operational implications

Inventory, reconciliation, dry-run, owner approval, access review, cutover freeze, session invalidation, conflict resolution, monitoring, rollback, and interim-source retirement.

### 7. Migration implications

Must cover:

- principal mapping;
- role/scope assignments and effective windows;
- active session revalidation/invalidation;
- revocations/suspensions;
- historical approvals/audit references;
- unresolved conflicts;
- idempotent restart/rollback;
- permanent interim-authority shutdown.

### 8. B9 handoff implications

This decision is the handoff contract itself. B9 implementation details remain future work, but interim architecture cannot be approved without a migration/sunset commitment.

### 9. Already-supported choice?

The roadmap authorizes B9 ownership but selects no migration model. Choice follows Decision 5.

### 10. Newly required authorization

Cutover owner, identity matching, conflict rule, freeze window, access review/sign-off, session handling, audit preservation, rollback, and interim-source termination.

### 11. Exact decision required

Approve Option A or B consistently with Decision 5 and ratify the complete handoff/cutover contract.

---

## Decision 10 — Formal allocation

### 1. Exact architectural question

What formal task and ADR allocation authorizes implementation of the bounded A2 workforce/privileged-authentication extension without reopening historical A2T02–A2T08 or pulling B9 forward?

### 2. Repository-supported options

#### Option A — New bounded A2 extension allocation

```text
Title: A2 bounded workforce/privileged-authentication extension
Owner: A2 Runtime Identity & Access
Permanent role-administration owner: B9 Identity & Access Administration
Task number: assigned by Architecture
ADR: assigned by Architecture
```

#### Option B — Existing unstarted extension point

No existing unstarted A2 extension point or B9 task was found.

#### Option C — Reopen A2T02–A2T08

Rejected by preservation rule; historical tasks cannot absorb new implementation by reinterpretation.

### 3. Advantages

Option A preserves history, authority, reviewability, and bounded scope.

### 4. Security implications

Formal allocation ensures provider/session/MFA/role/ingress decisions receive Security, Privacy, Operations, and Architecture review before code.

### 5. Authority-boundary implications

A2 owns runtime trust; B9 remains future assignment administrator; B2F06 remains unchanged.

### 6. Operational implications

Allocation establishes accountable owner, acceptance gates, threat model, production validation, rollback, and sequencing.

### 7. Migration implications

The task must include any approved interim evidence/session schema migration and B9 handoff preparation; none is authorized by this document.

### 8. B9 handoff implications

Task scope must include a handoff artifact but must not implement B9.

### 9. Already-supported choice?

Option A is consistent with the authoritative roadmap and historical preservation, but is not yet allocated.

### 10. Newly required authorization

Task number, ADR number/requirement, owner acceptance, scope, dependencies, implementation order, entry/exit criteria, and review owners.

### 11. Exact decision required

Architecture must assign a task number and ADR allocation to Option A. Until then status remains:

```text
PROPOSED / REQUIRES ARCHITECTURE APPROVAL
Task number: NOT ASSIGNED
ADR: NOT ASSIGNED
```

---

## Compact decision matrix

| Decision                           | Current status                 | Options                                                                 | Repository-supported choice?                                                   | Architecture approval required? |
| ---------------------------------- | ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| 1. Workforce identity source/trust | BLOCKED                        | Assertion; introspection; A2 workforce credential; approved alternative | Protocol-neutral patterns only; no provider/protocol                           | Yes                             |
| 2. Stable principal-ID mapping     | BLOCKED                        | Qualified immutable source subject; explicit mapping                    | `principalId` contract only; no workforce mapping                              | Yes                             |
| 3. Privileged session model        | PROPOSED                       | A2 opaque session; per-request upstream assertion                       | Both abstractly supported by A2T03; neither selected                           | Yes                             |
| 4. MFA source/freshness            | BLOCKED                        | Upstream MFA assertion; A2 workforce step-up                            | MFA assurance requirement ALREADY AUTHORIZED; source/method unresolved         | Yes                             |
| 5. Interim roles/scopes            | BLOCKED                        | Bounded interim authority; wait for B9                                  | No interim authority exists                                                    | Yes                             |
| 6. Protected internal ingress      | PROPOSED                       | Internal authenticated HTTP; authenticated operator command             | A2T08 internal protected-ingress direction only                                | Yes                             |
| 7. Expiry/revocation/outage        | BLOCKED                        | Lifecycle tied to Decision 3 Option A or B                              | General A2 lifecycle principles only                                           | Yes                             |
| 8. Audit/retention                 | NOT VERIFIED / REQUIRES REVIEW | Shared audit + A2 security events                                       | Audit authority/redaction ALREADY AUTHORIZED; exact schema/duration unresolved | Yes                             |
| 9. B9 handoff                      | PROPOSED                       | Interim-to-B9 cutover; wait for B9                                      | B9 ownership ALREADY AUTHORIZED; migration model unresolved                    | Yes                             |
| 10. Formal allocation              | BLOCKED                        | New bounded A2 extension                                                | Consistent with roadmap; no existing unstarted task                            | Yes                             |

## Implementation gate

Implementation cannot begin until:

1. all ten decisions are explicitly resolved;
2. the A2 extension receives a formal task number;
3. ADR allocation is approved;
4. the workforce identity source and trust protocol are approved;
5. stable principal-ID mapping is approved;
6. the privileged-session model is approved;
7. MFA source, assurance, freshness, recovery, and revocation are approved;
8. interim role authority is approved or waiting for B9 is accepted;
9. protected internal ingress, audience, transport, and scopes are approved;
10. expiry, revocation, rotation, outage, and stale-evidence behavior are approved;
11. audit schema, classification, retention, access, and legal hold are approved;
12. B9 migration/handoff is approved;
13. Security/Privacy/Operations/A2 owners approve the threat model and rollback boundary;
14. historical A2T02–A2T08 and all downstream authorities remain preserved.

## Future implementation sequence — not authorized by this package

```text
Architecture resolves Decisions 1–10
  -> formal A2 extension task allocation
  -> ADR allocation
  -> A2 workforce authentication implementation
  -> A2 privileged-session verification
  -> authoritative Finance role/scope evidence integration
  -> protected internal administration ingress
  -> A2 integration/security tests
  -> production readiness review
  -> B2F06 production policy creation/activation
  -> B2F06 ACTIVE/effective independent verification
  -> STOP
  -> A5T11 under separate authorization
```

No implementation step above is authorized merely by creating this package.

## Explicit non-goals

This package does not create or authorize:

- source code, migrations, entities, tests, controllers, routes, CLI, UI, or sessions;
- an identity provider, credential authority, protocol, trust anchor, key, or secret;
- workforce principals, MFA methods, roles, scopes, assignments, or approvals;
- B9 implementation;
- a second authentication, authorization, approval, or audit authority;
- B2F06 policy creation/activation or semantic changes;
- A5T11, A5 accounts, B2F03 mappings, B1 terms, B2F07, B2F08, or B2F09;
- historical A2T02–A2T08 changes;
- a task number or ADR number.

## References

- [`A2-PRIVILEGED-WORKFORCE-AUTHENTICATION-ARCHITECTURE-PACKAGE.md`](A2-PRIVILEGED-WORKFORCE-AUTHENTICATION-ARCHITECTURE-PACKAGE.md)
- [`A2-IMPLEMENTATION-PLAN.md`](A2-IMPLEMENTATION-PLAN.md)
- [`A2-TRUST-BOUNDARY-THREAT-MODEL.md`](A2-TRUST-BOUNDARY-THREAT-MODEL.md)
- [`A2-APPROVAL-PACKAGE.md`](A2-APPROVAL-PACKAGE.md)
- [`A2-OPERATIONAL-RECOVERY-RUNBOOK.md`](A2-OPERATIONAL-RECOVERY-RUNBOOK.md)
- [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)
- [`B2-FINANCE-PLATFORM-BOUNDARY.md`](B2-FINANCE-PLATFORM-BOUNDARY.md)
- [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md)
- [`B2F-FINANCE-CONTROL-CONTRACT.md`](B2F-FINANCE-CONTROL-CONTRACT.md)
- [`ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md`](ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md)
