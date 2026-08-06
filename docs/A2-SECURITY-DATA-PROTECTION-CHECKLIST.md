# A2 Security Data Protection Checklist

- **Task:** A2T09 — Secret, Hash, Token, Device, and Security-Event Protection
- **Status:** Runtime hardening evidence and review checklist
- **Scope:** A2 runtime authentication, sessions, recovery, MFA, authorization, privileged actions, routes, audit, events, diagnostics, and support access
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Protected data classes

| Data                             | Required treatment                                              | Current control                                |
| -------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Passwords and password hashes    | Never plaintext in storage, logs, errors, events, or exports    | A2T02 hash adapters and redaction utility      |
| Session/access tokens            | Return only at issuance; persist only SHA-256 token hashes      | A2T03 session entity/service and log redaction |
| Reset/recovery values            | Controlled hash inputs; no raw token/code in metadata or output | A2T04 boundary and redaction utility           |
| MFA challenge/proof values       | Hash-only, purpose-bound, never logged or exported              | A2T05 challenge contract and redaction utility |
| Device fingerprints              | Hash-only comparison; no cross-domain tracking                  | A2T05 device check and redaction utility       |
| Privileged action fingerprints   | SHA-256 action binding; never copied to audit/event payloads    | A2T07 approval service and redaction utility   |
| Security events and audit values | Safe metadata only; source ownership and legal holds preserved  | Operations audit/security event controls       |

## 2. Observable-output controls

- [ ] Pino request redaction covers authorization, cookies, API keys, passwords, password hashes, tokens, secrets, recovery/code hashes, MFA hashes, and device fingerprints.
- [ ] Audit values are recursively redacted before persistence.
- [ ] Outbox payloads are recursively redacted before persistence.
- [ ] Idempotency response bodies are recursively redacted before persistence.
- [ ] Error responses redact recognized sensitive key/value patterns.
- [ ] Unhandled-error logs contain a safe error message and request context, not raw exception payloads.
- [ ] Security-event metadata is redacted before persistence.
- [ ] Diagnostics, support views, and exports expose safe identifiers and minimum necessary fields only.

## 3. Configuration, keys, and cryptography

- A2T03 uses opaque random tokens and SHA-256 token hashes; no signing key is introduced by the current session contract.
- Password verification uses the approved hash adapter contract; unsupported algorithms fail safely rather than being silently downgraded.
- Secrets and database credentials remain environment/secret-manager inputs and are never committed or logged.
- Any future signing key, encryption key, hash pepper, or provider credential must be validated through the existing configuration boundary and have an owner, rotation procedure, expiry/revocation behavior, and rollback evidence.
- Dependencies and cryptographic algorithms require security review before adding a new provider or algorithm.

## 4. Retention, legal holds, and incident preservation

- Security events, audit events, session records, privileged approvals, and A2 logs retain only the minimum evidence required by their owners and approved schedules.
- Legal, regulatory, security, fraud, dispute, or financial-control holds override ordinary cleanup.
- Incident preservation captures IDs, timestamps, action/resource context, and safe outcomes without copying raw secrets or hashes.
- Hold scope may expand through customer UUID, session ID, approval ID, correlation ID, security-event ID, or audit entity ID.
- Access to held or incident evidence is itself authenticated, authorized, and audited.
- Retention cleanup must not be used to remove evidence of authentication failure, privilege denial, emergency access, or secret exposure.

## 5. Access review

- [ ] Customer self-access is restricted to the authenticated customer subject.
- [ ] Support/operator/service/privileged access requires explicit role and scope.
- [ ] Security, compliance, finance, and operations access is need-to-know and separately auditable.
- [ ] Raw credential, token, recovery, MFA, device, and action-fingerprint values are excluded from support/diagnostic exports.
- [ ] Emergency access is time-bounded, justified, audited, and reviewable.
- [ ] Access recertification and break-glass review owners are recorded.

## 6. Incident and dependency review

- [ ] Secret scanning covers source, configuration, tests, logs, fixtures, and generated artifacts.
- [ ] Dependency review covers cryptography, token handling, logging, and serialization libraries.
- [ ] Redaction tests cover nested objects, arrays, error text, audit values, outbox payloads, response bodies, and security events.
- [ ] Incident response preserves evidence without bypassing authorization or legal holds.
- [ ] A2T10 receives the completed checklist, review owners, unresolved items, and approval status.

This checklist is A2T09 evidence. It does not implement A2T10 integration/exit work or any A3-A8 capability.
