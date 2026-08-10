# A2 Privileged Workforce Authentication Architecture Package

- **Package type:** Architecture allocation and decision package only
- **Status:** ACCEPTED — implemented by A2T11
- **Allocation:** A2 bounded workforce/privileged-authentication extension
- **Task number:** A2T11
- **ADR:** ADR-0092
- **Runtime status:** IMPLEMENTED — production provider/configuration not activated
- **Blocked dependency:** B2F06 production policy activation
- **Scope:** Missing production workforce/operator trust boundary only

This package does not select a workforce identity provider, credential technology, federation protocol, MFA provider, role-administration system, operator transport, or production principal. It records the minimum A2-owned contract and the exact decisions Architecture must approve before implementation.

## 1. Current A2 capability

### 1.1 Implemented reusable authority

A2 currently provides:

- an `AuthorizationPrincipal` model with `CUSTOMER`, `SUPPORT`, `OPERATOR`, `SERVICE`, and `PRIVILEGED` principal types;
- role, scope, audience, customer-access, and assurance evaluation;
- `PASSWORD` and `MFA` assurance vocabulary;
- authorization decisions and audit evidence;
- privileged-action request, approve, reject, cancel, consume, expiry, and emergency-access semantics;
- maker/checker self-approval rejection;
- exact action, resource, principal, fingerprint, approval-scope, expiry, and MFA checks;
- route classification for customer, support, operator, service, and privileged principals;
- customer credential authentication, customer MFA execution, and customer session issuance/validation/revocation.

The existing `PrivilegedActionApprovalService` is the sole privileged-approval authority. The existing `AuthorizationService` is the sole runtime authorization-decision authority.

### 1.2 Implemented authentication limitation

The production authentication path is customer-only:

```text
AuthenticationExecutionService
  -> authenticates Customer/P1.8 credential metadata

AuthenticationSessionService
  -> principalType: CUSTOMER
  -> customerId-based session
  -> audience: customer-api by default

RuntimeAccessGuard
  -> type: CUSTOMER
  -> roles: []
  -> scopes: []
  -> customerAccess: SELF
  -> assuranceLevel: PASSWORD
```

No implemented ingress establishes an authenticated `OPERATOR`, `SUPPORT`, `SERVICE`, or `PRIVILEGED` session. The broader principal vocabulary is an authorization contract, not proof of production authentication for those principal types.

## 2. Exact missing trust boundary

The missing capability is:

> **A2 production workforce/operator authentication and privileged-session establishment.**

It must validate an external or internal workforce authentication fact and establish a current A2 principal without trusting caller-controlled identity, role, scope, MFA, or session fields.

The missing boundary includes:

1. workforce identity authentication;
2. stable workforce principal correlation;
3. privileged/operator session issuance or validation;
4. audience restriction;
5. authoritative role and scope evidence consumption;
6. MFA/step-up assurance evidence;
7. expiry, currentness, and revocation;
8. propagation into protected internal requests;
9. immutable authentication/session/security audit evidence;
10. later B9 administrative-IAM handoff.

This is not missing B2F06 policy semantics, A2 approval semantics, or Finance control semantics.

## 3. Existing roadmap and architecture evidence

### 3.1 A2 plan evidence

[`A2-IMPLEMENTATION-PLAN.md`](A2-IMPLEMENTATION-PLAN.md) assigns runtime authentication and authorization to A2 and explicitly intends protection for customer, operator, support, compliance, risk, service, privileged, and internal APIs.

Relevant historical task intent is:

- **A2T02 — Authentication Execution Boundary:** authenticate a principal and produce validated authentication evidence;
- **A2T03 — Session and Token Lifecycle:** issue/validate revocable principal sessions with audience, expiry, and request context;
- **A2T05 — MFA Challenge Execution and Trusted-Device Enforcement:** establish MFA/step-up assurance;
- **A2T06 — Operator, Support, Service, and Customer Authorization:** define principal/role/scope authorization and service-to-service principal validation;
- **A2T07 — Privileged Actions and Approval:** enforce approval, MFA, separation of duties, expiry, and audit;
- **A2T08 — Protected Internal API Access Policy:** protect internal operator/service/privileged routes.

These task identities are historical and must not be reopened or rewritten. Their intended boundary supports this extension, but their current runtime does not implement workforce authentication.

### 3.2 A2 threat-model evidence

[`A2-TRUST-BOUNDARY-THREAT-MODEL.md`](A2-TRUST-BOUNDARY-THREAT-MODEL.md) already identifies:

- Finance/Operations principals as future A2 operator identities;
- Security and privileged administrators as future A2 privileged identities;
- service principals as future A2 service identities;
- operator/admin role escalation, session theft, MFA bypass, self-approval, and unauthenticated internal-route exposure as A2 threats.

It does not choose a workforce credential or identity provider.

### 3.3 B9 roadmap evidence

[`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md) assigns B9 Identity & Access Administration:

- administrative IAM;
- access administration;
- role/entitlement administration;
- access reviews;
- privileged governance.

No B9 implementation plan or allocated B9 task was found. B9 remains a future platform and must not be silently pulled forward.

### 3.4 No provider or credential decision found

Repository-wide inspection found no approved workforce:

- identity provider;
- credential authority;
- OIDC issuer/client;
- SAML identity provider/service provider;
- LDAP/directory contract;
- certificate/mTLS workforce identity contract;
- API-key operator identity contract;
- service-principal authentication implementation;
- workforce MFA provider;
- operator session issuer;
- administrative role-assignment source.

References to operator/service/privileged identities are future contracts, not provider selections.

## 4. Ownership

| Concern                                   | Authoritative owner               | Boundary                                                                              |
| ----------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| Workforce authentication validation       | A2                                | Validates the approved workforce identity evidence and establishes runtime trust.     |
| Operator/privileged session               | A2                                | Issues or validates current, audience-bound, revocable runtime context.               |
| MFA/step-up assurance                     | A2                                | Establishes and validates assurance; no Finance-local MFA.                            |
| Principal propagation                     | A2                                | Supplies trusted `AuthorizationPrincipal` to protected ingress.                       |
| Authorization and privileged approval     | A2                                | Existing services remain authoritative.                                               |
| Permanent role/entitlement administration | B9 (future)                       | Assigns/reviews/revokes administrative access; does not replace A2 runtime decisions. |
| Finance role/control semantics            | B2F06                             | Defines required Finance roles and segregation; does not assign identities.           |
| Policy-administration transport           | Future bounded internal mechanism | Orchestrates only after A2 authenticates/authorizes the principal.                    |
| Ledger account identity/value             | A5                                | Unchanged.                                                                            |
| Commercial payment terms                  | B1                                | Unchanged.                                                                            |
| Finance-to-A5 mapping metadata            | B2F03                             | Unchanged.                                                                            |

## 5. Existing-task absorption analysis

### 5.1 Historical A2 tasks

A2T02–A2T08 describe the intended boundary but are completed historical task identities. Reopening them would alter implementation history and is prohibited.

### 5.2 B9

B9 is the future permanent administrator of workforce roles/entitlements and privileged governance. It is not an available current task or runtime. Pulling all B9 behavior forward would violate the platform sequence.

### 5.3 B2F06 and adjacent tasks

B2F06, A5T11, B2F03, B1T12, B2F07, B9, and B10 must not absorb workforce authentication. In particular:

- B2F06 defines Finance controls but does not authenticate or assign roles;
- B10 developer/API credentials are not workforce identities;
- customer authentication cannot be promoted into operator authentication;
- A5T11 cannot establish the operator principal that authorizes its own execution.

### 5.4 Allocation conclusion

The missing capability can be represented as:

```text
A2 bounded workforce/privileged-authentication extension
Status: PROPOSED / REQUIRES ARCHITECTURE APPROVAL
Task number: NOT ASSIGNED
```

Architecture must allocate the task number and ADR, if any, separately. This package does neither.

## 6. Proposed bounded extension

The extension is limited to an A2 trust adapter and privileged-session boundary that:

1. accepts only evidence from an explicitly approved workforce identity source;
2. validates the evidence cryptographically or through an approved trusted introspection boundary;
3. maps the external subject to one stable A2 workforce principal ID;
4. consumes authoritative role/scope assignments without becoming their permanent administration authority;
5. establishes A2 audience, assurance, authentication time, expiry, and revocation evidence;
6. creates or validates an A2 operator/privileged session;
7. propagates a trusted `AuthorizationPrincipal` into internal protected requests;
8. reuses `AuthorizationService` and `PrivilegedActionApprovalService` unchanged;
9. records immutable audit/security evidence;
10. supports later replacement of interim role evidence by B9 without changing domain consumers.

The extension must not include B2F06 policy creation, a Finance controller, a CLI, an operator UI, A5T11, or any downstream Finance operation.

## 7. Required architecture decisions

### 7.1 Workforce identity source

**Status: PROPOSED / REQUIRES ARCHITECTURE APPROVAL**

No source is selected. Architecture must approve one authoritative source and trust model. Candidate technology must be evaluated only after requirements are approved; this package does not choose passwords, OIDC, SAML, LDAP, certificates, API keys, cloud IAM, or another provider.

Required decision fields:

- identity source owner;
- issuer/trust anchor;
- canonical subject identifier;
- credential/assertion validation mechanism;
- production and non-production separation;
- compromise/revocation signal;
- availability/failure behavior;
- privacy/classification/retention;
- onboarding/offboarding responsibility;
- later B9 integration.

### 7.2 Operator authentication protocol

**Status: PROPOSED / REQUIRES ARCHITECTURE APPROVAL**

Minimum protocol-independent rule:

- A2 accepts an authentication assertion only from the approved source;
- verifies issuer, audience, integrity, freshness, expiry, and replay controls;
- rejects missing, stale, unverifiable, wrong-environment, or wrong-audience evidence;
- never accepts identity, role, scope, or MFA claims from ordinary caller headers/body;
- correlates the validated subject to one stable A2 principal ID;
- emits no reusable secret into logs, audit, traces, or domain records.

The concrete protocol remains unresolved.

### 7.3 Session model

**Status: PROPOSED / REQUIRES ARCHITECTURE APPROVAL**

Architecture must decide whether A2 issues its own opaque privileged session after workforce authentication or validates a short-lived upstream assertion on each request. Either model must satisfy the contract in §8 and cannot reuse customer sessions as privileged sessions.

### 7.4 Interim role evidence

**Status: BLOCKER / REQUIRES ARCHITECTURE APPROVAL**

No current authority legitimately assigns `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, or privileged scopes to workforce identities. Architecture must approve a bounded interim source until B9 exists, including owner, change approval, versioning, effective dates, revocation, access review, and migration to B9.

A2 may consume interim role evidence but must not silently become permanent role administration. B2F06 may define required roles but must not assign them.

### 7.5 Protected ingress

**Status: PROPOSED / REQUIRES ARCHITECTURE APPROVAL**

A2T08 establishes the intended pattern: internal authenticated administration protected by route classification and A2 authorization. The concrete network/transport exposure, audience, operator route inventory, and deployment restriction remain unresolved. No route may be created before workforce authentication is production-capable.

## 8. Minimum principal and session contract

A validated workforce context must produce at least:

```text
principalId:        stable A2 workforce principal identifier
principalType:      OPERATOR or PRIVILEGED
sessionId:          stable current A2 session/reference
audience:           approved internal administration audience
roles:              authoritative effective role set
scopes:             authoritative effective scope set
customerAccess:     NONE unless separately approved for an assigned support use case
assuranceLevel:     PASSWORD or MFA, with privileged Finance approval requiring MFA
authenticatedAt:    canonical UTC instant
issuedAt:           canonical UTC instant
expiresAt:          canonical UTC instant
lastValidatedAt:    canonical UTC instant
identitySource:     approved source/reference/version
roleEvidence:       source/reference/version/effective window
mfaEvidence:        method/reference/freshness without secret material
revocationState:    current/non-revoked
correlation:        request/trace/audit context
```

Required invariants:

- principal ID cannot be supplied by the protected operation;
- roles/scopes cannot be supplied by the protected operation;
- principal type follows approved source/mapping evidence;
- audience must match the internal administration policy;
- expired/revoked sessions fail closed;
- role/entitlement revocation invalidates or narrows subsequent access;
- session replay/rotation rules are explicit;
- customer sessions cannot be converted into workforce sessions;
- production and non-production identities/sessions cannot cross environments.

The existing `AuthorizationPrincipal` can carry the runtime subset (`type`, `principalId`, `sessionId`, `audience`, `roles`, `scopes`, `customerAccess`, `assuranceLevel`). Additional authentication/session provenance must remain in the A2 session/evidence boundary rather than being copied into every domain command.

## 9. MFA and assurance contract

The existing A2 assurance vocabulary is:

```text
PASSWORD
MFA
```

For the B2F06 activation workflow:

- the policy maker/requester must be an authenticated workforce principal with the approved Finance maker role;
- the controller approving the privileged action must be a distinct authenticated workforce principal;
- approval requires `MFA` when the A2 approval policy specifies MFA;
- assurance must be established by A2 from the approved workforce authentication/MFA source;
- the caller cannot claim MFA through a header or command field;
- assurance must include authentication/step-up time and freshness policy;
- expired/revoked MFA evidence fails closed;
- the approval service's existing self-approval, scope, and assurance checks remain unchanged.

The concrete MFA method/provider, enrollment owner, recovery model, and freshness duration are **PROPOSED / REQUIRES ARCHITECTURE APPROVAL**. B9 may later administer enrollment/access policy; A2 remains runtime assurance authority.

## 10. Finance role and scope evidence contract

The bounded B2F06 workflow currently requires:

```text
maker role:             FINANCE_PREPARER
checker/executor role:  FINANCE_CONTROLLER
approval scope:         privileged:approve (or the exact approved A2 approval scope)
execution scope:        privileged:execute where consumption requires it
route scope:            approved internal Finance administration scope
audience:               approved internal Finance administration audience
```

Evidence requirements:

- stable role/scope identifiers;
- assignment source and assignment version;
- assignment approver/owner;
- effective-from/effective-to;
- current/not-revoked status;
- environment;
- principal binding;
- access-review reference where required;
- audit correlation.

A2 consumes and evaluates this evidence. B2F06 consumes resulting principal/approval evidence. Permanent assignment ownership remains B9.

The exact interim assignment source, route scope string, audience string, approval scope, and entitlement-mapping rules remain **PROPOSED / REQUIRES ARCHITECTURE APPROVAL**.

## 11. Protected internal ingress contract

The intended mechanism is an internal authenticated administration boundary, consistent with historical A2T08—not a public/customer Finance API.

Minimum contract:

1. network/deployment policy restricts the ingress to the approved internal administration zone;
2. A2 workforce authentication runs before route authorization;
3. A2 establishes the request principal; caller-supplied principal headers/body fields are ignored/rejected;
4. route policy permits only approved `OPERATOR`/`PRIVILEGED` principal types;
5. route policy requires exact audience, scope, role, and assurance;
6. customer sessions are denied regardless of customer status;
7. Finance transport invokes existing A2/B2F06 services only after authorization;
8. request, approval, and activation operations remain separate to preserve maker/checker control;
9. errors do not disclose sensitive identity or approval data;
10. no route is externally/publicly exposed merely because a controller exists.

Unresolved architecture decisions:

- transport type;
- internal network/ingress owner;
- audience;
- route scope;
- credential/assertion conveyance;
- CSRF/replay requirements where applicable;
- operator rate limits;
- deployment and emergency-disable control.

No controller, CLI, or route may be selected until these are approved.

## 12. Revocation, expiry, and currentness contract

A2 must fail closed when any of these is expired, revoked, stale, or unavailable:

- workforce identity/assertion;
- operator session;
- role or scope assignment;
- MFA/step-up evidence;
- privileged approval;
- audience/trust configuration.

Minimum required behavior:

- short, explicit session/assertion expiry;
- authoritative revocation signal or introspection;
- local session revocation where A2 issues sessions;
- logout/administrative termination;
- role-revocation propagation within an approved maximum delay;
- periodic/current-request validation appropriate to risk;
- token/session rotation and replay handling;
- deny on identity-source outage when currentness cannot be proven;
- session invalidation after principal disablement or critical entitlement removal;
- no destructive deletion of audit/security history.

Exact TTLs, refresh model, revocation propagation bound, outage behavior details, and emergency termination mechanism remain **PROPOSED / REQUIRES ARCHITECTURE APPROVAL**.

## 13. Audit requirements

A2 must record minimized immutable evidence for:

- workforce authentication success/failure;
- identity source/issuer and safe subject reference;
- principal establishment;
- session issuance/validation/rotation/revocation/expiry;
- role/scope evidence source/version and changes observed;
- MFA/step-up success/failure and freshness (without secrets);
- route authorization allow/deny;
- privileged approval request/decision/consume;
- maker, checker, executor, action, resource, fingerprint, and correlation;
- trust-source outage or stale-evidence denial;
- emergency access and subsequent review where separately approved.

Audit must exclude raw passwords, assertions/tokens, MFA secrets/codes, private keys, and unnecessary directory attributes. Shared Operations `AuditService` remains the audit authority. Retention and legal hold follow A1/A2 controls and later B9 governance; exact new evidence retention must be approved before production activation.

## 14. B9 handoff

The interim design must be replaceable by B9 administration without changing A2 runtime consumer contracts or B2F06.

Required handoff principles:

1. stable A2 principal IDs survive or are explicitly mapped during migration;
2. role/scope names consumed by domain policy remain stable/versioned;
3. B9 becomes authoritative for assignment, review, suspension, revocation, and privileged-governance administration;
4. A2 continues to authenticate, establish sessions/assurance, and authorize runtime requests;
5. B2F06 continues to define required Finance roles/segregation and consume A2 evidence;
6. interim assignments are inventoried, reviewed, and migrated—never silently copied;
7. conflicting or unmapped assignments fail closed;
8. migration preserves approval and audit history;
9. a cutover/rollback plan prevents dual conflicting assignment authorities.

Exact B9 data/interface contracts remain future B9 architecture work and are not defined here.

## 15. B2F06 dependency

The required dependency chain is:

```text
A2 workforce authentication extension approved
  -> approved workforce identity and interim-role sources connected
  -> authenticated privileged A2 principal
  -> legitimate FINANCE_PREPARER and FINANCE_CONTROLLER sessions
  -> bounded internal Finance administration transport
  -> B2F06 DRAFT policy
  -> A2 privileged approval
  -> B2F06 ACTIVE/effective verification
  -> STOP
  -> A5T11 under separate authorization
```

B2F06 must not create or activate the production policy until the A2 trust boundary is production-capable and independently verified. A valid `AuthorizationPrincipal` object constructed by application/test code is not sufficient evidence.

## 16. Explicit non-goals

This package does not authorize or implement:

- a workforce identity provider or provider selection;
- operator credentials/passwords;
- OIDC, SAML, LDAP, certificates, API keys, or cloud IAM;
- customer-to-operator identity promotion;
- role or entitlement assignment;
- permanent IAM administration;
- B9 implementation;
- a service-principal replacement for human maker/checker approval;
- MFA enrollment/provider/delivery;
- a privileged session, controller, route, CLI, UI, or operator portal;
- a second authorization or approval authority;
- a B2F06 policy or approval;
- A5T11, A5 accounts, B2F03 mappings, B1 terms, AR, B2F07, B2F08, or B2F09;
- public/developer Finance APIs;
- historical A2T02–A2T08 changes.

## 17. Acceptance criteria for the architecture package

- A2 runtime authentication and B9 administration ownership remain distinct.
- Existing A2 customer authentication is not reinterpreted as workforce authentication.
- Existing `AuthorizationService` and `PrivilegedActionApprovalService` remain canonical.
- Missing provider, session, MFA, interim-role, ingress, and B9-handoff decisions are explicit.
- No provider/protocol/task/ADR number is invented.
- B2F06 remains a consumer and is not expanded into IAM.
- The minimum principal/session/evidence contracts are sufficient for later implementation planning.
- All downstream production actions remain blocked.

## 18. Entry criteria for implementation

Implementation must not begin until Architecture/Security/Operations/A2 owners explicitly approve:

1. task allocation and owner;
2. ADR allocation or documented decision that no ADR is needed;
3. workforce identity source and trust protocol;
4. stable principal-ID mapping;
5. operator/privileged session model;
6. MFA/step-up source, method, and freshness;
7. interim role/scope assignment authority and governance;
8. exact Finance audience and route scopes;
9. protected internal ingress/transport and network boundary;
10. session/assertion TTL, revocation, rotation, and outage behavior;
11. audit, classification, retention, legal hold, and incident response;
12. environment separation and secret/key ownership;
13. B9 migration/handoff contract;
14. focused threat model and abuse cases;
15. rollback/emergency-disable behavior;
16. proof that no customer or test principal can enter the workforce boundary.

## 19. Exit criteria for the future extension

The future extension is complete only when:

- a real production workforce identity authenticates through the approved source;
- A2 establishes a stable `OPERATOR` or `PRIVILEGED` principal;
- a current audience-bound session/assertion is validated;
- authoritative role/scope evidence is attached from the approved interim source;
- MFA assurance is established for privileged approval;
- customer sessions and caller-supplied principal claims fail closed;
- revocation, expiry, role removal, wrong audience, stale MFA, replay, and source outage fail safely;
- internal ingress propagates trusted principal context;
- existing authorization and privileged-approval services operate without semantic duplication;
- distinct Finance maker/controller flows pass end to end;
- audit/security evidence is complete and secrets are absent;
- no B2F06 policy is activated merely by extension tests;
- production/security/privacy/operations review approves the trust boundary;
- B9 handoff evidence is prepared without implementing B9 early.

## 20. Exact unresolved items

The following require Architecture approval and must not be inferred:

1. task number and formal allocation;
2. ADR number/requirement;
3. workforce identity source/provider owner;
4. authentication/assertion protocol;
5. trust anchors, issuer, and key/secret ownership;
6. stable principal-ID format and mapping lifecycle;
7. operator versus privileged principal classification rules;
8. A2-issued session versus upstream-assertion validation model;
9. internal administration audience;
10. route scope vocabulary;
11. interim role/entitlement source before B9;
12. interim assignment maker/checker/change governance;
13. exact mapping for `FINANCE_PREPARER` and `FINANCE_CONTROLLER`;
14. exact approval and execution scopes;
15. MFA method/provider and enrollment owner;
16. MFA/step-up freshness;
17. session/assertion TTL and refresh/rotation;
18. revocation source and maximum propagation delay;
19. source-outage behavior and recovery;
20. protected ingress transport and network boundary;
21. environment separation;
22. audit classification/retention/legal hold;
23. incident response and emergency termination;
24. B9 cutover, migration, conflict, and rollback contract;
25. production validation and accountable approval owners.

Until these decisions are approved, no A2 workforce extension, operator administration mechanism, B2F06 policy activation, or downstream prerequisite may proceed.

## References

- [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)
- [`A2-IMPLEMENTATION-PLAN.md`](A2-IMPLEMENTATION-PLAN.md)
- [`A2-TRUST-BOUNDARY-THREAT-MODEL.md`](A2-TRUST-BOUNDARY-THREAT-MODEL.md)
- [`A2-APPROVAL-PACKAGE.md`](A2-APPROVAL-PACKAGE.md)
- [`A2-OPERATIONAL-RECOVERY-RUNBOOK.md`](A2-OPERATIONAL-RECOVERY-RUNBOOK.md)
- [`B2-FINANCE-PLATFORM-BOUNDARY.md`](B2-FINANCE-PLATFORM-BOUNDARY.md)
- [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md)
- [`B2F-FINANCE-CONTROL-CONTRACT.md`](B2F-FINANCE-CONTROL-CONTRACT.md)
- [`ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md`](ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md)
