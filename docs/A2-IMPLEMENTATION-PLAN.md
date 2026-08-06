# A2 Runtime Identity & Access — Implementation Plan

- **Phase:** A2 Runtime Identity & Access
- **Status:** Planned
- **Scope:** Runtime authentication, session/access context, authorization, privileged access, and protected internal APIs
- **Implementation order:** First Architecture implementation phase after the completed A1 Foundation Consolidation
- **Source planning documents:** [`ROADMAP.md`](ROADMAP.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md)
- **A1 prerequisites:** A1 ownership, identifier, privacy, retention, ADR, dependency, and exit artifacts

## 1. Purpose of A2

A2 establishes the runtime trust boundary required to protect customer, operator, support, compliance, risk, service, and internal APIs. It consumes the P1.8 authentication metadata and the A1 ownership/privacy contracts without turning metadata tables into a second identity authority or exposing current internal routes as public APIs.

A2 must establish:

- Authentication execution against approved P1.8 credential metadata.
- Session, token, revocation, and request-principal context.
- Customer authentication and recovery execution.
- MFA challenge execution and trusted-device enforcement.
- Customer, operator, support, service, and privileged authorization.
- Privileged-action approval and immutable audit evidence.
- Protected internal API policy and route classification.
- Secret, hash, token, device-data, logging, and redaction controls.

## 2. A2 non-goals

A2 does not implement:

- Payment authorization, transfer authorization, or financial-product policy decisions.
- Customer-to-ledger account binding, wallet changes, balance changes, or ledger writes.
- External OTP, email, SMS, push, bank, NIBSS, partner, or notification delivery.
- AML, sanctions, fraud, PEP, transaction-monitoring, or risk-scoring engines.
- A4 capability/policy evaluation or product-specific eligibility rules.
- A5 money movement, external settlement, or financial activation.
- New customer identity, beneficiary, funding-instrument, preference, or risk authorities.
- A replacement for Operations audit, idempotency, outbox, metrics, diagnostics, or production readiness.

## 3. Architectural rules carried from A1

1. `Customer.id` remains the canonical customer UUID. Customer references are not credentials.
2. P1.8 `customer-authentication` remains the source of credential, recovery, MFA, device, and security metadata.
3. A2 owns runtime authentication and authorization decisions, but it must not duplicate password hashes, recovery material, or customer identity records in unrelated modules.
4. Operations owns immutable audit and shared operational evidence. A2 uses the existing `AuditService` and does not create a parallel audit store.
5. Request, correlation, trace, causation, and idempotency identifiers follow ADR-0023 and the A1 identifier controls.
6. Restricted and Highly Restricted data follows ADR-0024, the data-handling matrix, and the A2/A6 privacy inputs.
7. Current internal routes remain non-public until authenticated and authorized through the A2 boundary.
8. A2 fails closed when a principal, credential, session, authorization, MFA, or privileged approval requirement is missing or stale.
9. A2 does not mutate wallet, ledger, payment, transfer, deposit, withdrawal, reconciliation, or product-governance source records as part of access decisions.

## 4. Dependencies and required inputs

- A1 exit package and accountable approval.
- A1 canonical ownership matrix and ADR-0020/0021.
- ADR-0019 Customer Authentication Credentials & Identity Recovery.
- ADR-0023 Customer Identifier and Reference Conventions.
- ADR-0024 Customer Data Classification, Retention, and Privacy.
- `customer-authentication` P1.8 credential/recovery/MFA/device/security metadata.
- Operations audit, request-context, idempotency, diagnostics, configuration, and shutdown primitives.
- Production route inventory and current internal-route exposure report.
- Security threat model and privacy review before protected-route activation.

## 5. Sequential task breakdown

### A2T01 — Runtime Identity & Access Baseline and Threat Model

- **Type:** Documentation and architecture preparation
- **ADR input:** ADR-0025 — Authentication Execution Boundary

#### Objective

Establish the A2 runtime boundary, principal types, trust zones, threat model, route classes, and implementation contracts before authentication code is introduced.

#### Deliverables

- A2 principal and trust-zone matrix.
- Authentication/access threat model.
- Internal, operator, support, customer, service, and privileged route classification.
- P1.8 metadata-to-runtime contract.
- A2 implementation decision checklist.
- Initial ADR-0025 review input.

#### Dependencies

- A1 exit approval.
- A1T03 module/schema/API inventory.
- A1T04 trust-boundary inventory.
- A1T05 customer/authentication overlap decisions.
- A1T07 identifier/privacy controls.
- ADR-0019, ADR-0020, ADR-0021, ADR-0023, and ADR-0024.

#### Acceptance criteria

- Every A2 principal type has an owner, trust boundary, and minimum access context.
- P1.8 metadata and A2 runtime responsibilities are explicitly separated.
- Current unauthenticated internal routes are classified and no route is declared public by default.
- Threats include credential abuse, replay, session theft, privilege escalation, secret leakage, device misuse, and operator misuse.
- No payment, wallet, ledger, external-provider, or A4 policy behavior is included.

#### Exit criteria

- A2 threat model and privacy review inputs are recorded.
- A2T02-A2T09 dependencies and rollback assumptions are approved for implementation.
- ADR-0025 review status is recorded.

### A2T02 — Authentication Execution Boundary

- **Type:** Runtime implementation
- **ADR:** ADR-0025 — Authentication Execution Boundary

#### Objective

Implement the single runtime boundary that authenticates a principal using approved credential metadata and produces a validated authentication result without exposing secrets.

#### Deliverables

- Authentication execution service/contract.
- P1.8 credential lookup and status/expiry/lock checks.
- Approved password-hash verification adapter contract.
- Authentication result and failure reason model.
- Security-event and audit integration through Operations.
- Authentication failure and lockout behavior.

#### Dependencies

- A2T01.
- P1.8 credential metadata.
- Existing Operations audit and request-context primitives.
- Approved secret/hash handling from A1T12 and ADR-0024.

#### Acceptance criteria

- Only active, unexpired, unlocked credentials can authenticate.
- Password verification does not persist or log plaintext passwords.
- Unsupported or invalid hash algorithms fail safely and are auditable without exposing hash material.
- Repeated failures use the existing credential lock policy and produce security evidence.
- Authentication does not create or modify wallets, ledger records, balances, or payment state.
- Authentication errors do not disclose whether a sensitive account or credential exists beyond the approved error contract.

#### Exit criteria

- Verification, expired-credential, suspended/revoked, locked-account, invalid-password, and failure-threshold tests pass.
- Secret/hash redaction review passes.
- A2T03 can consume an authenticated principal result.

### A2T03 — Session and Token Lifecycle

- **Type:** Runtime implementation
- **ADR:** ADR-0026 — Session and Token Lifecycle

#### Objective

Create a bounded session/token lifecycle that turns a successful authentication result into revocable, expiring runtime access context.

#### Deliverables

- Session/token issuance contract.
- Opaque or signed token validation contract approved by A2 security review.
- Token expiry, revocation, rotation, logout, and replay handling.
- Hashed token persistence or equivalent protected session state.
- Request-principal context propagation.
- Session/security audit events.

#### Dependencies

- A2T02.
- Request, correlation, trace, and causation context.
- Configuration validation and secret/key lifecycle controls.
- ADR-0008/0009 operational and runtime contracts.

#### Acceptance criteria

- Tokens are never stored or logged in plaintext where persistence is required.
- Expired, revoked, malformed, replayed, and wrong-audience tokens fail closed.
- Session state is scoped to the authenticated principal and intended audience.
- Logout/revocation invalidates the token/session according to the approved lifecycle.
- Request context contains authenticated principal and correlation metadata without copying secrets.
- No external token provider or notification delivery is introduced.

#### Exit criteria

- Issuance, validation, expiry, revocation, rotation, logout, replay, and concurrent-use tests pass.
- Key/secret rotation and rollback behavior are documented.
- A2T04-A2T09 can consume the principal/session context.

### A2T04 — Customer Authentication and Recovery Execution

- **Type:** Runtime implementation
- **ADR:** ADR-0027 — Customer Authentication and Recovery Execution

#### Objective

Connect customer login and approved recovery completion to the P1.8 metadata lifecycle without duplicating credential or recovery authorities.

#### Deliverables

- Customer authentication command boundary.
- Recovery request/token validation contract.
- Controlled password-reset completion using approved hash inputs.
- Credential rotation and invalidation behavior after recovery.
- Customer security-event and audit integration.
- Generic failure and account-enumeration-safe response behavior.

#### Dependencies

- A2T02 and A2T03.
- P1.8 password-reset request/token metadata.
- ADR-0019 and ADR-0024 secret/recovery handling.
- Existing Operations audit and error contracts.

#### Acceptance criteria

- Recovery requires a valid, unexpired, unrevoked, correctly scoped recovery record.
- Raw reset tokens and plaintext passwords are never persisted, logged, or returned.
- Completion rotates/invalidates the relevant credential/session state through the approved contract.
- Recovery cannot bypass customer ownership, account lock, revocation, legal hold, or security-event requirements.
- No email, SMS, push, OTP delivery, wallet, ledger, or payment behavior is added.

#### Exit criteria

- Recovery success, expiry, replay, revocation, wrong-customer, stale-version, and failure tests pass.
- Password rotation and session invalidation evidence is auditable.
- A2T05 MFA execution can use the authenticated/recovery context.

### A2T05 — MFA Challenge Execution and Trusted-Device Enforcement

- **Type:** Runtime implementation
- **ADR:** ADR-0027 — Customer Authentication and Recovery Execution

#### Objective

Execute approved MFA and trusted-device decisions using P1.8 metadata while keeping delivery and external challenge providers outside A2.

#### Deliverables

- MFA challenge/request contract.
- MFA method status and enrollment checks.
- Challenge verification adapter boundary for approved in-process methods.
- Trusted-device status/fingerprint comparison contract.
- MFA step-up result in the principal context.
- Security-event and audit integration.

#### Dependencies

- A2T02-A2T04.
- P1.8 MFA and trusted-device metadata.
- A1 hash/device classification and retention controls.
- A2 threat model and secret handling review.

#### Acceptance criteria

- Disabled, revoked, expired, or wrong-customer MFA/device metadata cannot satisfy a challenge.
- Raw MFA secrets, OTPs, device proofs, and fingerprint values are not persisted or logged.
- Trusted-device decisions are purpose-bound and cannot become unapproved cross-domain tracking.
- Step-up requirements fail closed when the required method or evidence is missing.
- External SMS/email/push/OTP delivery is not implemented.

#### Exit criteria

- MFA enrollment/status, challenge success/failure, replay, expiry, revocation, and trusted-device tests pass.
- Security events and audit records are complete without sensitive payloads.
- A2T06 can consume MFA assurance context.

### A2T06 — Operator, Support, Service, and Customer Authorization

- **Type:** Runtime implementation
- **ADR:** ADR-0028 — Operator and Administrative Authorization

#### Objective

Authorize authenticated principals against route, resource, action, and scope policies without embedding conflicting authorization logic in domain modules.

#### Deliverables

- Principal/role/scope model.
- Route and action authorization policy contract.
- Customer self-access and support/operator scope checks.
- Service-to-service principal validation.
- Authorization guard/interceptor integration contract.
- Denial reason and audit behavior.

#### Dependencies

- A2T02-A2T05.
- A2T01 route classification.
- A1 canonical ownership and privacy classifications.
- Operations audit and error contracts.

#### Acceptance criteria

- Customer principals cannot access another customer’s restricted records.
- Support, Risk, Compliance, Finance, Security, and Operations scopes are explicit.
- Authorization is separate from authentication and A4 product-policy decisions.
- Missing, stale, or ambiguous permission context fails closed.
- Financial modules do not implement independent authorization policies.
- Authorization decisions are auditable without logging secrets or unnecessary sensitive payloads.

#### Exit criteria

- Customer, support, operator, service, denied, cross-customer, and scoped-resource tests pass.
- Route/action policy ownership is documented.
- A2T07 can consume authorization results for privileged actions.

### A2T07 — Privileged Actions and Approval

- **Type:** Runtime implementation
- **ADR:** ADR-0029 — Privileged Actions and Approval

#### Objective

Protect high-risk administrative, security, compliance, operational, and financial-control actions with explicit approval, separation of duties, and immutable audit evidence.

#### Deliverables

- Privileged-action classification.
- Approval and maker-checker contract.
- Step-up/MFA requirement integration.
- Approval expiry, rejection, cancellation, and replay rules.
- Privileged audit and security-event evidence.
- Emergency-access and break-glass control contract.

#### Dependencies

- A2T05 and A2T06.
- A2 threat model.
- Operations audit and request-context primitives.
- A1 legal-hold, retention, and security controls.

#### Acceptance criteria

- A principal cannot approve its own prohibited action where separation of duties is required.
- Approvals are scoped to action, resource, principal, and expiry.
- Replayed, expired, revoked, or changed approvals fail closed.
- Emergency access is time-bounded, justified, audited, and reviewable.
- Privileged actions do not introduce wallet/ledger/payment behavior in A2.

#### Exit criteria

- Maker-checker, step-up, expiry, rejection, cancellation, replay, emergency-access, and audit tests pass.
- A2T08 route-protection policy can enforce privileged action requirements.

### A2T08 — Protected Internal API Access Policy

- **Type:** Runtime integration
- **ADR:** ADR-0025 and ADR-0028 inputs

#### Objective

Apply the authenticated-principal and authorization contracts to current internal and customer routes without exposing them as public APIs prematurely.

#### Deliverables

- Protected-route policy registry or equivalent route metadata.
- Global/route authorization integration.
- Public, authenticated-customer, support, operator, service, and privileged route classifications.
- Safe unauthenticated route allowlist.
- Unauthorized/forbidden response and audit behavior.
- Route migration and rollback plan.

#### Dependencies

- A2T01-A2T07.
- Current module/schema/API inventory.
- Global validation, error, request-context, and shutdown contracts.

#### Acceptance criteria

- Protected routes require the expected principal and authorization scope.
- Only explicitly approved health/version/bootstrap routes remain unauthenticated.
- Current internal routes are not production-public by default.
- Route protection does not mutate domain data or alter financial ownership.
- Unauthorized access produces stable errors and auditable security evidence.
- A route rollback can disable protection changes without weakening credential/session security.

#### Exit criteria

- Protected-route integration tests pass for customer, support, operator, service, privileged, denied, and unauthenticated cases.
- Route exposure inventory and rollback procedure are updated within A2 artifacts.

### A2T09 — Secret, Hash, Token, Device, and Security-Event Protection

- **Type:** Runtime hardening
- **ADR:** ADR-0030 — Secret, Hash, Token, and Device-Data Protection

#### Objective

Verify that A2 runtime paths protect secret material and security metadata across persistence, logs, traces, errors, events, diagnostics, exports, and support access.

#### Deliverables

- Secret/hash/token/device handling checklist.
- Logging, tracing, error, audit, and event redaction controls.
- Key/configuration validation and rotation evidence.
- Security-event retention and legal-hold integration.
- Access review and incident-preservation evidence.
- Dependency and cryptography review.

#### Dependencies

- A2T01-A2T08.
- ADR-0024 and A2/A6 privacy inputs.
- Production configuration and Operations contracts.

#### Acceptance criteria

- Plaintext passwords, tokens, MFA secrets, recovery codes, device proofs, and unnecessary hashes are absent from observable outputs.
- Sensitive values are classified and access-controlled.
- Secrets are sourced from approved configuration/secret controls and are not committed.
- Security events preserve required evidence without copying sensitive payloads.
- Incident and legal-hold preservation does not bypass access controls.

#### Exit criteria

- Secret scanning, redaction, access-review, key-rotation, dependency, and incident-preservation checks pass.
- A2 security/privacy review is approved for final exit review.

### A2T10 — A2 Integration, Recovery, and Exit Evidence

- **Type:** Documentation and release evidence
- **ADR review:** ADR-0025 through ADR-0030

#### Objective

Validate the complete A2 trust boundary and prepare the phase exit package without beginning A3-A8 implementation.

#### Deliverables

- A2 integration test matrix.
- Authentication/session/MFA/recovery/authorization/privileged-action trace evidence.
- Route exposure and rollback evidence.
- Security/privacy review status.
- Operational runbook and incident/recovery evidence.
- ADR-0025 through ADR-0030 review status.
- A3/A4 handoff checklist.
- A2 exit checklist and approval package.

#### Dependencies

- A2T01-A2T09.
- A1 exit approval.
- Production, Operations, Security, Risk, Compliance, and accountable release-owner review.

#### Acceptance criteria

- Protected routes, login/session/revocation, MFA, recovery, lockout, authorization, privileged-action, secret-handling, and audit evidence pass.
- No A2 work changes wallet, ledger, payment, A4 policy, external partner, or product source authority.
- All unresolved issues have owners, target dates, severity, and rollback/mitigation state.
- A3/A4 handoff dependencies are explicit.
- ADR-0025 through ADR-0030 review status is recorded.
- A2 approval is explicitly recorded by accountable owners before A3/A4 implementation gates.

#### Exit criteria

- A2 Runtime Identity & Access is approved as a protected runtime boundary.
- A3 and A4 may begin only through their approved dependencies and contracts.
- No A3-A8 implementation is included in the A2 exit commit.

## 6. A2 critical path

```text
A2T01 Baseline / threat model
  -> A2T02 Authentication execution
  -> A2T03 Session/token lifecycle
  -> A2T04 Customer recovery execution
  -> A2T05 MFA/trusted-device enforcement
  -> A2T06 Authorization
  -> A2T07 Privileged actions
  -> A2T08 Protected internal APIs
  -> A2T09 Secret/hash/token/device hardening
  -> A2T10 A2 integration and exit evidence
```

A2T04 and A2T05 may share implementation review but remain separate acceptance gates. No task may bypass A2T02 authentication or A2T06 authorization to protect a route.

## 7. A2 prohibited edges

- Customer-authentication metadata writes to wallet, ledger, payment, or product state.
- A2 policy code replaces A4 capability decisions.
- A2 introduces external OTP, email, SMS, push, bank, NIBSS, partner, or notification delivery.
- Authentication tokens or device identifiers become customer identity or financial identifiers.
- A2 duplicates Operations audit, idempotency, outbox, metrics, diagnostics, or readiness.
- A2 exposes internal routes publicly without the approved authorization policy.
- A2 bypasses legal holds, retention controls, or A1 data classification.
- A2 starts A3 account binding, A4 policy implementation, or A5 financial activation.

## 8. A2 phase exit criteria

A2 is complete only when:

- The runtime trust boundary is protected and its route inventory is approved.
- Authentication, sessions/tokens, MFA, recovery, trusted devices, authorization, privileged actions, and security-data handling have passed their task gates.
- Login/session/revocation, MFA, lockout, operator-role, secret-handling, and privileged-audit evidence is complete.
- No plaintext credential, raw token, or secret leakage is present.
- A2 ADRs and privacy/security reviews are approved.
- A3/A4 entry conditions and rollback assumptions are recorded.
- A2 approval is explicitly recorded by accountable owners.
