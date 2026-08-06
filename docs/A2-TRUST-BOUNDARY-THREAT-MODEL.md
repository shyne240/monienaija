# A2 Runtime Identity & Access Baseline and Threat Model

- **Task:** A2T01 — Runtime Identity & Access Baseline and Threat Model
- **Phase:** A2 Runtime Identity & Access
- **Status:** A2 implementation baseline and ADR-0025 input
- **Classification:** Documentation-only preparation; no runtime behavior changed
- **Application code, API, entity, migration, and configuration changes:** None
- **Sources:** [`ROADMAP.md`](ROADMAP.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md), [`A2-IMPLEMENTATION-PLAN.md`](A2-IMPLEMENTATION-PLAN.md)

## 1. A2 boundary

A2 establishes the runtime trust boundary required to protect customer, operator, support, compliance, risk, service, and privileged APIs. It consumes P1.8 authentication metadata and A1 ownership/privacy contracts without making metadata tables a second identity authority.

A2 begins after A1 approval and before customer-facing or financial activation. Existing HTTP registration and DTO validation do not constitute authentication or authorization.

## 2. Principal and trust-zone matrix

| Principal / zone             | Authority or source                                                         | Required context                                                                | Default access                                      | A2 control                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Unauthenticated caller       | External or internal network input                                          | Request, trace, and correlation context only                                    | Health/version allowlist only                       | Reject protected routes; rate-limit and redact errors                                        |
| Customer principal           | Future A2 authenticated customer identity mapped to canonical Customer UUID | Principal ID, customer UUID, session/token, assurance/MFA state, correlation ID | Own customer data and explicitly authorized actions | Enforce subject ownership and capability scope; never use customer reference as a credential |
| Support principal            | Future A2 operator/support identity                                         | Principal, role, case/task scope, approval context, audit context               | Assigned support views and approved support actions | Need-to-know, masked data, case scope, access audit                                          |
| Compliance/Risk principal    | Future A2 operator identity                                                 | Role, case/assessment scope, approval, correlation                              | Assigned compliance/risk evidence                   | Segregated access, sensitive-data logging, no financial execution by implication             |
| Finance/Operations principal | Future A2 operator identity                                                 | Role, operational scope, approval, correlation                                  | Financial-control and operational evidence by role  | Read/write separation, immutable audit, no unrestricted customer export                      |
| Security administrator       | Future A2 privileged identity                                               | MFA/step-up, approval, emergency-access reason, expiry                          | Credential/device/security administration           | Separation of duties, time-bounded access, security audit                                    |
| Service principal            | Future A2 service identity                                                  | Service ID, audience, command, correlation/causation                            | Contract-specific service reads/commands            | Mutual authentication/authorization contract; no ambient trust                               |
| Privileged administrator     | Future A2 privileged identity                                               | Principal, action, resource, approval, MFA, expiry                              | Explicitly approved privileged actions              | Maker-checker, replay/expiry protection, immutable audit                                     |
| External provider/partner    | Future A6 adapter boundary                                                  | Validated provider identity, provider reference, mapped internal resource       | Contract-specific fields only                       | Not an A2 principal; callbacks remain untrusted until A6 validation                          |

## 3. P1.8 metadata/runtime contract

| P1.8 metadata                                   | A2 runtime use                                                                           | Boundary                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `CustomerAuthenticationCredential`              | Credential status, password-hash algorithm/version, expiry, lock state, failure evidence | A2 reads through a controlled contract; it does not duplicate hashes                  |
| `PasswordHistory`                               | Password rotation/reuse evidence                                                         | A2 preserves append-only history and approved retention                               |
| `PasswordResetRequest` and `PasswordResetToken` | Recovery request/token state                                                             | A2 validates status, scope, expiry, and replay; raw token values are never persisted  |
| `MfaEnrollment` and `MfaMethod`                 | MFA assurance and method state                                                           | Delivery/provider execution is outside A2 initial boundary unless separately approved |
| `TrustedDevice`                                 | Trusted-device status and purpose-specific fingerprint comparison                        | No cross-domain tracking key or raw fingerprint disclosure                            |
| `RecoveryCode`                                  | Recovery assurance state                                                                 | Raw recovery codes are never stored or returned                                       |
| `SecurityEventHistory`                          | Authentication/security evidence                                                         | Events are append-only, minimized, access-controlled, and audited                     |

P1.8 remains metadata-only until the relevant A2 execution task is approved. A2 runtime state must not become a replacement source for Customer identity, eligibility, risk, compliance, wallet, or ledger data.

## 4. Route classification inputs

| Route class                | Examples                                                                         | Authentication                               | Authorization                             | A2 status                                   |
| -------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Process health             | `/health`, readiness probe where explicitly approved                             | Public/process-level only                    | None beyond deployment policy             | Allowlist requires review                   |
| Runtime metadata           | Version/configuration/deployment views                                           | Internal principal or deployment restriction | Operations/Production scope               | Protect before public exposure              |
| Customer metadata          | `/customers/:id/...` and Customer Foundation subresources                        | Customer or approved operator principal      | Customer subject/role scope               | Protected                                   |
| Security metadata          | Credential, recovery, MFA, trusted-device, security-event routes                 | Security/customer principal as approved      | Strong role and step-up requirements      | Protected and restricted                    |
| Financial/internal control | Ledger, wallet, transfer, deposit, withdrawal, reconciliation, operations routes | Authenticated service/operator principal     | Financial/control role and command policy | No public exposure before A2/A3/A4/A5 gates |
| Product governance         | Product scope, readiness, launch, governance routes                              | Product/governance principal                 | Governance role and approval              | Internal and privileged                     |
| Future external callback   | Provider callback/webhook routes                                                 | Future A6 provider authentication            | Adapter contract and replay controls      | Not implemented by A2T01                    |

No route is public merely because it is registered under `/api/v1`. The final allowlist and guard behavior are implementation deliverables of later A2 tasks.

## 5. Threat model

| Threat                                  | Affected boundary                                   | Required control input                                                                   | A2 task handoff       |
| --------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| Credential stuffing/brute force         | Customer authentication                             | Failure counters, lockout, rate limiting, generic errors, security events                | A2T02                 |
| Password-hash misuse or downgrade       | Credential execution                                | Algorithm/version allowlist, controlled verifier, no plaintext/hash logging, rotation    | A2T02/A2T09           |
| Session theft/replay                    | Token/session context                               | Opaque or signed token contract, expiry, rotation, revocation, audience, replay handling | A2T03                 |
| Recovery-token replay                   | Password reset                                      | Hashed token state, scope, expiry, one-time use, invalidation                            | A2T04                 |
| MFA bypass                              | Step-up/authentication                              | Method status, challenge freshness, replay protection, assurance context                 | A2T05                 |
| Device tracking or spoofing             | Trusted-device metadata                             | Purpose-bound comparison, fingerprint-hash protection, revocation                        | A2T05/A2T09           |
| Cross-customer data access              | Customer route                                      | Canonical Customer UUID, subject/resource authorization, generic denial behavior         | A2T06/A2T08           |
| Role/privilege escalation               | Operator/admin route                                | Role scope, approval, separation of duties, audit                                        | A2T06/A2T07           |
| Self-approval or approval replay        | Privileged actions                                  | Maker-checker, action/resource binding, expiry, revocation                               | A2T07                 |
| Secret leakage                          | Logs, traces, errors, audits, events, support tools | Field redaction, safe views, secret configuration, access audit                          | A2T09                 |
| Unauthenticated internal route exposure | HTTP boundary                                       | Route classification, authentication guard, deployment restriction, public allowlist     | A2T08                 |
| Policy/financial bypass                 | A2-to-A4/A5 handoff                                 | A2 authorization context; A4 policy and A3 binding remain separate gates                 | A2T06/A2T08 and A3/A4 |
| Security evidence deletion              | Audit/security history                              | Append-only events, retention owner, legal holds, restricted maintenance                 | A2T09/A2T10           |

## 6. A2 implementation constraints

- A2 must use the existing Operations audit, request-context, error, configuration, and shutdown primitives.
- A2 must not create a parallel Customer, credential, risk, compliance, financial, audit, or idempotency authority.
- A2 must not add wallet, ledger, payment, transfer, deposit, withdrawal, settlement, or external-provider behavior.
- A2 must not implement A4 capability decisions or independently interpret eligibility, risk, compliance, or limits.
- A2 must not add external OTP, email, SMS, push, or notification delivery.
- A2 must fail closed for missing principal, expired/revoked context, insufficient scope, stale approval, or invalid security evidence.
- All Restricted/Highly Restricted reads and privileged actions must be purpose-bound and auditable.

## 7. Privacy and operational controls

- Passwords, tokens, recovery codes, MFA secrets, device proofs, and unnecessary hashes never appear in plaintext in persistence, logs, traces, errors, audits, events, or exports.
- Authentication and security decisions carry request/correlation/trace context without copying secrets.
- Security events identify the action and safe outcome, not raw credential or device material.
- Retention and legal holds follow ADR-0024, the data-handling matrix, and the A2/A6 privacy inputs.
- Security and privileged access review is separate from customer-facing financial authorization.
- A2 incidents preserve relevant evidence without bypassing access controls or hold ownership.

## 8. A2T01 acceptance checklist

- [ ] Principal and trust-zone owners are documented.
- [ ] P1.8 metadata-to-runtime responsibilities are explicit.
- [ ] Current routes are classified as public/process, internal, customer, operator, service, privileged, or future external.
- [ ] Threats cover credentials, sessions, recovery, MFA, devices, authorization, privileged actions, secrets, route exposure, and evidence preservation.
- [ ] A2 dependencies on A1, Operations, Production, and P1.8 are recorded.
- [ ] A2 non-goals prohibit wallet/ledger/payment/external/A4 behavior.
- [ ] ADR-0025 review input is ready for the authentication execution boundary task.
- [ ] No application code or runtime behavior is changed by A2T01.

## 9. A2T01 exit criteria

A2T01 is complete when the threat model, principal/trust-zone matrix, route classifications, P1.8 runtime contract, privacy constraints, and handoff criteria are reviewed by Security, Operations, Customer Engineering, and accountable A2 owners. A2T02 may begin only after those review conditions are recorded.
