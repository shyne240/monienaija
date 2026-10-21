# A2 Entry Checklist

- **Task:** A1T14 — A1 Review Package and Exit Evidence
- **Status:** Entry checklist prepared; A2 implementation is blocked pending accountable approval
- **Application code, API, entity, migration, and configuration changes:** None
- **A1 approval package:** [`A1-ARCHITECTURE-APPROVAL-PACKAGE.md`](A1-ARCHITECTURE-APPROVAL-PACKAGE.md)
- **A2 phase definition:** [`PHASES.md`](PHASES.md), Phase A2 — Runtime Identity & Access

## 1. A2 entry gate

A2 may enter implementation only after A1 is approved by accountable owners and the conditions below are recorded. A1 documentation does not authorize runtime authentication, authorization, sessions, tokens, MFA, privileged actions, or data-subject functionality.

## 2. Required A1 evidence

- [ ] A1 exit checklist is complete and approved.
- [ ] ADR-0020 through ADR-0024 review decisions are recorded.
- [ ] Open risks have owners, target dates, mitigations, and accepted residual risk where applicable.
- [ ] Canonical ownership and no-duplicate-writer rules are approved.
- [ ] Customer, wallet/ledger, case, beneficiary/funding, event/correlation/causation, and idempotency conventions are approved.
- [ ] Classification, minimization, retention, legal-hold, and external-sharing questions have owners.
- [ ] Product Roadmap P1.0-P1.15 and Architecture A1-A8 names remain unchanged.

## 3. Runtime identity and access conditions

### Principal and authorization

- [ ] Customer, operator, support, compliance, risk, finance, security, service, and privileged-admin principal types are defined.
- [ ] Canonical principal ID and relationship to Customer UUID are defined; references are not credentials.
- [ ] Role, scope, service identity, approval, session, token, revocation, and emergency-access rules are approved.
- [ ] Segregation of duties and access recertification are defined.
- [ ] Privileged actions require authorization, approval where applicable, and immutable audit evidence.

### Credential, recovery, and device protection

- [ ] P1.8 hash metadata is mapped without copying secrets.
- [ ] Password hash, reset-token, recovery-code, MFA, and device lifecycle/retention rules are threat-modeled.
- [ ] Plaintext secrets and unnecessary hashes are prohibited from logs, responses, audit, events, and support tools.
- [ ] Device identifiers are purpose-bound and cannot become unapproved cross-domain tracking keys.

### Protected routes and requests

- [ ] Current internal routes remain deployment/network restricted until A2 protection is live.
- [ ] Request, correlation, trace, causation, actor, and audit context is preserved.
- [ ] Error, log, metric, and diagnostic redaction is verified.
- [ ] Rate limits, lockout, replay, expiry, revocation, MFA, and incident controls are defined.

### Data-subject and support access

- [ ] Customer/support access is authenticated, scoped, minimized, and audited.
- [ ] Data-subject requests check legal, financial, security, compliance, and hold constraints.
- [ ] Immutable ledger/audit/held/investigative records are not promised for deletion by a generic endpoint.
- [ ] Restricted support reads exclude raw credentials, identity documents, risk reasoning, compliance comments, and unrestricted ledger internals.

## 4. A2 implementation evidence

Before A2 readiness review, attach:

- Threat model and privacy/security review.
- Authentication, session/token, MFA, reset, lockout, revocation, and authorization tests.
- Secret/hash/device handling and redaction evidence.
- Protected-route integration tests and internal/public route inventory.
- Privileged-action approval and audit evidence.
- Access recertification, incident-response, and rollback runbooks.
- Migration/rollback evidence for any A2 schema change.
- Confirmation that A2 preserves A1 customer identity, ledger authority, and retention decisions.

## 5. Entry decision

| Decision          | Accountable owner                        | Date    | Status                                      |
| ----------------- | ---------------------------------------- | ------- | ------------------------------------------- |
| A2 entry approved | Architecture / Security / release owners | Pending | Blocked until A1 approval package is signed |
