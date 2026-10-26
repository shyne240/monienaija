# A3/A4 Handoff Checklist

- **Task:** A2T10 — A2 Integration, Recovery, and Exit Evidence
- **Status:** Handoff input; A3/A4 implementation is blocked until A2 exit approval
- **Application code, API, entity, migration, and configuration changes:** None

## 1. A3 Customer-to-Financial Account Binding handoff

A3 may consume the following A2 contracts:

- Authenticated principal with canonical Customer UUID and session context.
- Authorization decision for customer/account actions.
- Protected route/service boundary and stable unauthorized/forbidden behavior.
- Audit and correlation context for account-binding commands.
- Sensitive-data redaction and access controls.
- Session revocation and recovery invalidation behavior.

A3 must not:

- Treat a session, token, customer reference, or authorization decision as financial truth.
- Copy credentials, tokens, MFA proofs, device fingerprints, or privileged approval payloads into account-binding records.
- Bypass A2 authorization or write customer identity outside the approved binding contract.

A3 entry conditions:

- [ ] A2 protected service context is approved.
- [ ] Customer UUID and authorization scope checks are approved.
- [ ] Binding commands define idempotency, audit, reconciliation, and rollback.
- [ ] A2 security/privacy review has no blocking conditions.

## 2. A4 Capability & Policy Engine handoff

A4 may consume:

- Authenticated principal and assurance context from A2.
- Authorization context without treating authorization as product eligibility.
- Customer, onboarding, eligibility, restriction, limit, enrollment, risk, compliance, and account evidence through their owning contracts.
- Correlation/request context and source-version references.
- Redacted audit/event behavior and approved data classifications.

A4 must not:

- Replace A2 principal authentication or authorization.
- Treat an A2 role or session as an eligibility/risk decision.
- Copy credential, token, recovery, MFA, device, or privileged approval secrets.
- Write customer, risk, compliance, eligibility, wallet, or ledger source records to make a policy output pass.

A4 entry conditions:

- [ ] A2 principal/authentication context contract is approved.
- [ ] A4 policy request/result and versioning contract is approved.
- [ ] Source evidence references and privacy classifications are approved.
- [ ] Fail-closed behavior for missing/stale authorization is defined.
- [ ] A2 route/access and A4 policy responsibilities are separated.

## 3. Shared handoff constraints

- A3 and A4 cannot treat A2 as authorization to begin production financial activation.
- A5 still requires A2, A3, and A4 gates together.
- Existing Operations audit, idempotency, outbox, diagnostics, and reconciliation controls remain shared infrastructure.
- No A3/A4 implementation is introduced by this checklist.
