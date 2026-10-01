# A2 Integration Test Matrix

- **Task:** A2T10 — A2 Integration, Recovery, and Exit Evidence
- **Status:** A2 exit evidence input; accountable approval pending
- **Scope:** A2 Runtime Identity & Access only
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Integration coverage

| Boundary                  | Required scenarios                                                                                                                 | Evidence                                                       | Result |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------ |
| Authentication execution  | Valid PBKDF2/scrypt, invalid password, malformed/unsupported hash, expired, suspended/revoked, locked credential                   | `test/authentication-execution.service.spec.ts`                | Passed |
| Session/token lifecycle   | Issue, hashed persistence, validation, audience mismatch, expiry, revocation/logout, rotation, replay                              | `test/authentication-session.service.spec.ts`                  | Passed |
| Customer recovery         | Successful reset, token/request scope, expiry, replay, wrong customer, stale version, locked credential, session invalidation      | `test/customer-authentication-runtime.service.spec.ts`         | Passed |
| MFA and trusted devices   | Challenge issue/verify, mismatch, replay, expiry, wrong customer/session, method status, device fingerprint/status                 | `test/mfa-execution.service.spec.ts`                           | Passed |
| Authorization             | Customer self-access, cross-customer denial, support assignment, service audience/scope, missing principal/policy/role/scope/MFA   | `test/authorization.service.spec.ts`                           | Passed |
| Privileged actions        | Maker-checker, self-approval denial, MFA/scope, expiry, rejection, cancellation, fingerprint/resource binding, replay, break-glass | `test/privileged-action-approval.service.spec.ts`              | Passed |
| Runtime route boundary    | Public allowlist, missing/malformed bearer, customer principal propagation, route authorization denial                             | `test/runtime-access.guard.spec.ts`, `test/health.e2e.spec.ts` | Passed |
| Sensitive-data protection | Recursive audit/outbox/idempotency redaction, error/log redaction, security metadata safety                                        | `test/sensitive-data-protection.spec.ts`                       | Passed |
| Migration/readiness       | A2 session, MFA challenge, and privileged approval migration-head compatibility                                                    | `test/production-readiness.spec.ts`                            | Passed |

## 2. A2 cross-boundary scenarios

- A successful A2T02 authentication can issue an A2T03 session.
- A2T04 customer recovery invalidates relevant sessions.
- A2T05 MFA assurance is consumable by A2T06 authorization and A2T07 approval policies.
- A2T06 authorization denies cross-customer access before route/action execution.
- A2T07 approval cannot be self-approved, replayed, expired, or applied to a changed resource/fingerprint.
- A2T08 protects non-public routes while preserving only the explicit public health/version allowlist.
- A2T09 redaction applies to audit, event, outbox, idempotency, errors, logs, and observable security data.
- No A2 path mutates wallet, ledger, payment, A4 policy, or external partner source state.

## 3. Required A2 exit evidence

- [x] Targeted A2 test suites pass.
- [x] Full test suite passes.
- [x] Lint and build pass.
- [x] Changed-file formatting passes.
- [x] Route, authorization, audit, migration, redaction, and recovery evidence is traceable.
- [ ] Security/Privacy and accountable-owner approval is recorded.
- [ ] ADR-0025 through ADR-0030 review status is approved.
