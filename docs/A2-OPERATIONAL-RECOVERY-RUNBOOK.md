# A2 Operational Recovery Runbook

- **Task:** A2T10 — A2 Integration, Recovery, and Exit Evidence
- **Status:** A2 operational/recovery evidence input
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Authentication/session incident

1. Identify application version, migration head, route, principal/session ID, request/correlation/trace IDs, and incident owner.
2. Do not request or record raw passwords, tokens, recovery codes, MFA proofs, device fingerprints, or action fingerprints.
3. Revoke affected sessions using the A2 session lifecycle service.
4. Preserve redacted audit and security-event evidence under the incident/legal-hold scope.
5. Check authorization denials, privileged approvals, emergency access, logs, outbox, and readiness signals.
6. Keep affected protected routes unavailable if safe authentication cannot be established.
7. Re-run authentication, session, recovery, MFA, authorization, route, redaction, and readiness tests before recovery approval.

## 2. Privileged-action incident

1. Identify approval ID, action/resource type, customer/resource scope, principal IDs, approval status, expiry, and correlation IDs.
2. Reject or revoke pending/approved emergency or privileged approvals that are suspected compromised.
3. Never consume an approval with a changed action, resource, or fingerprint.
4. Preserve maker-checker, MFA, rejection, cancellation, expiry, replay, and emergency-access evidence.
5. Confirm no wallet, ledger, payment, or external state was changed by an A2 decision alone.
6. Escalate any financial impact to Finance/Reconciliation; A2 does not repair financial source records.

## 3. Secret or sensitive-data exposure

1. Contain the affected log, trace, audit, event, export, or support surface.
2. Revoke affected sessions, credentials, approvals, or keys according to the responsible owner.
3. Preserve redacted evidence and activate legal/security hold where required.
4. Review redaction paths for Pino, errors, audit, outbox, idempotency, security events, diagnostics, and exports.
5. Perform dependency/cryptography and access-review checks.
6. Record customer, regulator, partner, and incident communications through approved channels.

## 4. Recovery evidence

- A2T02 authentication tests.
- A2T03 session/revocation/rotation tests.
- A2T04 recovery/session-invalidation tests.
- A2T05 MFA/trusted-device tests.
- A2T06 authorization tests.
- A2T07 privileged-approval tests.
- A2T08 route-protection tests.
- A2T09 sensitive-data protection tests.
- Production readiness, migration-head, audit, reconciliation, and outbox evidence.

## 5. Ownership and change control

- Security owns credential, session, MFA, device, secret, and incident controls.
- Operations owns audit, outbox, diagnostics, and operational evidence.
- Production owns readiness, configuration, request draining, and deployment recovery.
- Finance/Reconciliation owns financial source verification.
- Privacy/Legal/Compliance owns classification, retention, legal holds, and regulated evidence questions.
- No operator clears an incident by editing audit, security-event, approval, ledger, or outbox facts.
