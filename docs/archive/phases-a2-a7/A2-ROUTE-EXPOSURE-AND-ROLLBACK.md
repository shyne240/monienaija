# A2 Route Exposure and Rollback Evidence

- **Task:** A2T10 — A2 Integration, Recovery, and Exit Evidence
- **Status:** Route exposure and rollback evidence input
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Route classes

| Route class                 | Authentication               | Authorization                                     | Current A2 treatment                             |
| --------------------------- | ---------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Process health              | None/process-level           | Explicit allowlist                                | `GET /api/v1/health`, `GET /api/v1/health/ready` |
| Version metadata            | None only for approved route | Explicit allowlist                                | `GET /api/v1/internal/version`                   |
| Customer routes             | Bearer session               | Customer self/resource scope                      | Runtime guard and authorization service          |
| Internal operational routes | Bearer session               | `internal:access` or explicit role/scope          | Protected by default                             |
| Security metadata routes    | Bearer session               | Customer/security role and step-up where required | Protected by default                             |
| Financial/control routes    | Bearer session               | Financial/control authorization                   | Protected; no A2 financial execution             |
| Governance routes           | Bearer session               | Governance/privileged scope                       | Protected by default                             |
| Future external callbacks   | Provider adapter boundary    | A6 callback contract                              | Not implemented by A2                            |

HTTP registration does not mean public authorization. A route is public only if it is explicitly in the approved allowlist.

## 2. Rollback procedure

If route protection causes an unsafe or unavailable deployment:

1. Stop affected deployment promotion and record release/application version, migration head, request/correlation/trace IDs, and incident ID.
2. Preserve audit, authorization, security-event, session, approval, and readiness evidence under the applicable legal-hold/incident process.
3. Disable the affected route-policy rollout using the approved deployment/feature control without disabling credential/session revocation or redaction.
4. Keep sensitive routes unavailable rather than falling back to unauthenticated behavior.
5. Revoke compromised sessions or privileged approvals through the existing A2 services.
6. Verify health, readiness, audit, reconciliation, and outbox signals.
7. Restore the last known-good route policy only after Security/Operations approval.
8. Re-run protected-route, customer-scope, operator/scope, denial, and public-allowlist tests before re-enabling traffic.
9. Record the root cause, affected routes, evidence, owner, remediation, and approval in the incident/release record.

No rollback step changes ledger truth, customer identity ownership, A4 policy state, or external partner state.

## 3. Route evidence

- Route registry: `src/authorization/route-policy-registry.ts`.
- Runtime guard: `src/authorization/runtime-access.guard.ts`.
- Authorization guard contract: `src/authorization/authorization.guard.ts`.
- Guard tests: `test/runtime-access.guard.spec.ts`, `test/authorization.service.spec.ts`.
- Public health/version integration evidence: `test/health.e2e.spec.ts`.

## 4. A2 route exit checklist

- [x] Public routes are explicit rather than implicit.
- [x] Protected customer routes require a bearer session and customer scope.
- [x] Protected internal routes require authenticated authorization context.
- [x] Unauthorized and forbidden outcomes use stable framework error handling.
- [x] Rollback keeps protected routes closed instead of weakening authentication.
- [ ] Security/Operations approve route exposure and rollback evidence.
