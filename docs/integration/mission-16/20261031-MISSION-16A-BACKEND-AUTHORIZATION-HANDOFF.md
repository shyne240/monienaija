# Mission 16A — Agent read authorization regression

- **Baseline:** `c355430f7d302ed29ada12615092c60ac857c4a5` (`integration/mission-16-ordinary-agent-v1`)
- **Working branch:** `arena/92fd33dd-monienaija`
- **Correction:** `8a1f6fe937a6e84d668658649559d5623f8e2b73`
- **Scope:** backend authorization contract, tests and GOV-01 review. No merge into main/integration or deployment.

The session is pinned to the existing Arena branch, so a differently named dedicated branch could not be created. The assigned branch was fast-forwarded to the exact Mission 16 integration commit before reproducing or modifying the defect; its original remote tip is an ancestor. No unrelated branch was switched, rewritten or pushed.

## D-01 — reproduction and root cause

On the unmodified baseline, serial, real-PostgreSQL `a22-admin-foundation.integration.spec.ts` reproduced exactly **13 passed / 2 failed**. Tests 2 and 3 expected **401**, but received **403** on `GET /api/v1/internal/agents`.

A22 replaces `A2WorkforceSessionService.validate()` with a test double that can return synthetic `CUSTOMER` or `AGENT` principals, without the IDs required for those principal types. Before Mission 15A, this path fell through to the generic internal rule, and `AdminAgentController.requireWorkforce()` returned 401 `Privileged access required` before the function check. The new directory policy adds an `agent.view` catalogue gate, which the runtime guard evaluates before the controller. `AuthorizationService.evaluate()` rejects A22's incomplete synthetic identities as `INVALID_PRINCIPAL`, and the guard emits 403 before the controller runs. The guard intentionally evaluates declared gates without a blanket enforcement of `allowedPrincipalTypes`; its documented V1-HARDEN-01/Sprint 3 architecture preserves controller-specific type/status contracts. `AuthorizationService.requireFunction()` also documents the established distinction: wrong workforce identity shape may retain a controller's 401, while a valid permitted workforce type missing a required function is 403.

**This is a synthetic-validator-principal contract, not a general rule that every valid non-workforce bearer returns 401.** The real A2 session service issues only `OPERATOR` or `PRIVILEGED`; real SUPPORT sessions come from their own service. A genuine Agent or Customer token fails workforce validation and is deliberately recognized by the existing fallback as a valid wrong-family session, which returns **403**. A22's legacy real-Agent assertion permitted 401, 403 or 500 and therefore did not specify this distinction. Neither the old regression nor the correction grants access.

## Narrow correction

`src/authorization/route-policy-registry.ts` opts in **only** the `GET`/`HEAD` Agent directory, detail and financial-position resolution to `rejectNonWorkforcePrincipalWith401`. In `src/authorization/runtime-access.guard.ts`, after workforce validation and before the declared function gate, the guard returns the controller's established 401 for synthetic `CUSTOMER`, `AGENT` and `AGGREGATOR` principal results, even if supplied a forged `agent.view` scope. All other paths, real Agent/Customer fallback behavior, principal roles/functions, controller checks and success/denial auditing for workforce principals remain unchanged. The `agent.view` gate is neither removed nor bypassed for a workforce principal.

Regression coverage is in `test/runtime-access.guard.spec.ts`, `test/mission-15a-route-policy.spec.ts` and `test/mission-16a-agent-read-authorization.integration.spec.ts`; the pre-existing A22 assertions remain unchanged.

| Caller / condition | `GET`/`HEAD` Agent directory, detail, financial-position |
| --- | --- |
| No bearer or invalid bearer | 401 |
| Synthetic non-workforce result from workforce validator | 401 `Privileged access required`, including forged `agent.view` and existing/nonexistent IDs |
| Real authenticated Agent or Customer session | 403 from existing workforce-token fallback, including existing/nonexistent IDs |
| Valid workforce without `agent.view`, including real SUPPORT | 403; `FUNCTION_MISSING` audit for applicable workforce decisions |
| Valid workforce with `agent.view` | 200 for existing data; 404 for a nonexistent Agent after authorization |

No A22 expectation was weakened or revised. New tests include GET/HEAD, all three affected shapes, valid and nonexistent IDs, synthetic identities with and without forged scopes, real Customer and Agent sessions, real SUPPORT and catalogue-derived roles, and one authorization audit per eligible success/denial. A synthetic non-workforce call to a different function-gated route remains 403, proving the new precedence is not global.

## GOV-01 — expiry capability metadata

**Finding: stale governance/readiness evidence, not a runtime authorization inconsistency.** The seed still describes `CASH_TO_CASH_EXPIRY` as `apiStatus: NOT_EXPOSED` and `adminUiStatus: NOT_EXPOSED`, while the status-only `GET /api/v1/internal/admin/cash-to-cash/expiry-status` and an Admin Web status panel now exist. `CapabilityService` reads and summarizes this metadata; neither the route registry, runtime guard nor expiry-status controller uses it to authorize the endpoint. Both the registry policy and controller instead require `transaction.view`; the UI checks that same scope and the backend remains authoritative. PostgreSQL coverage verifies authorized 200 / missing-function 403 / anonymous 401 with the seeded metadata and again after changing the two statuses **in the disposable test database only**.

The metadata is left unchanged: the authorized registry owner should decide how to describe the **read-only status surface** without implying that manual expiry, refund, release or any other financial disposition is exposed. `CapabilitySeedService.seedIfEmpty()` inserts missing codes but does not update an existing persisted capability row, so changing a seed alone would not fix existing environments. Worker enablement is separately controlled by `CASH_TO_CASH_EXPIRY_WORKER_ENABLED` (default false); the `enabled` registry field is not that switch. Status is process-local and does not prove fleet health. No worker activation or financial-policy change is implied.

## Verification

All tests ran on Node 22 and an isolated local PostgreSQL 18.4 instance. The migration chain ran only in test databases; the registry status toggled in the test above was restored before teardown. No production data or credentials were used.

| Check | Result |
| --- | --- |
| A22 baseline reproduction (`m16arepro`) | **13 passed / 2 failed**, 401 expected vs 403 received |
| A22 + new Mission 16A PostgreSQL suite (`m16afix2`) | **2 suites / 19 tests passed** |
| Focused authorization/Agent/registry PG regression (`m16aauth`) | **8 suites / 145 tests passed** |
| Complete backend unit suite, `npx jest --runInBand` | **224 suites / 2,609 tests passed** |
| `npm run build`, `npx tsc --noEmit` | PASS |
| ESLint on all five changed source/test files; `git diff --check` | PASS |
| Complete PostgreSQL suite (`m16afull`, serial, batch size 10) | **130 suites / 2,419 tests passed**, 13/13 batches, exit 0. This includes A22 and the new four-test Mission 16A suite. |

The focused PG regression covers `mission-15a-management`, `v1-admin-authorization-hardening-01`, `v1-hardening-07-admin-agent-financial-position`, `v1-sprint3-agent-history-workforce`, `v1-harden-01-runtime-access-guard-boundary`, `v1-sprint1-notification-delivery-authorization`, `v1-capability-registry`, and `v1-admin-authorization-read-surface-01`. These results overlap the complete run; do not add their test counts together. The previous Mission 16 baseline had 129 suites / 2,415 tests; the additional suite contributes four tests.

No Admin Web/mobile source, migrations, capability seed, role/function grants, provider configuration or financial settlement/disposition code changed. No merge into main/integration, deployment, provider activation, external financial operation or production migration was performed. Existing unrelated Mission 16 and policy blockers remain open.
