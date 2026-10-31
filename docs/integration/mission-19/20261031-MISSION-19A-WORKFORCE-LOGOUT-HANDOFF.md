# Mission 19A — workforce current-session logout correction

- **Date:** 2026-10-31
- **Working branch:** `arena/92fd33dd-monienaija` (the session's fixed branch; no separate branch was created)
- **Integration baseline:** `bee4c00d1458128f3cc1e6d745983a16e3fc0ad8`, the verified tip of `integration/mission-17-ordinary-agent-v1-acceptance` at the start of this mission.
- **Code/test commit:** `2d5ab3a339995522d585ada427b0b6d11f43bc82` (pushed to the assigned branch).
- **Release action:** none. No merge or deployment was performed.

## Finding and reproduction

Mission 17 K-01 was independently reproduced on the exact baseline using a genuine catalogue-backed FINANCE_AUDITOR A2 session, a real Nest/Fastify listener over TCP, and an isolated, freshly migrated PostgreSQL database. The initial test deliberately asserted the desired behavior and failed:

| Request | Baseline | After correction |
|---|---:|---:|
| Protected read before logout | 200 | 200 |
| `DELETE /api/v1/internal/a2/workforce/sessions/:currentSessionId` | 403 | 200 |
| Protected read with the same bearer immediately afterwards | 200 | 401 |

The baseline session was created by the isolated fixture. A separate post-fix live TCP test also performs the local-admin password login over HTTP, obtains a genuine FINANCE_AUDITOR session, logs out, and observes 401 on replay. The disposable test identity, password and token are not recorded. Sanitized status-only evidence, including the eleven-role matrix, is in [`evidence/workforce-logout-http-status.txt`](evidence/workforce-logout-http-status.txt).

The guard's blanket read-only unsafe-method denial prevented the existing revocation controller and service from running. Testing the required replay guarantee also found a directly related pre-existing race: a validation could read an ACTIVE row, pause, and save the stale entity after a concurrent revocation, restoring that row to ACTIVE. The baseline race was reproduced with real PostgreSQL and the real session service. The corrected live HTTP interleaving returns logout 200, delayed read 401, subsequent replay 401, and retains `REVOKED` in PostgreSQL.

## Exact changes

- `src/authorization/runtime-access.guard.ts`: in the `WORKFORCE_SESSION` branch only, skip the read-only unsafe-method check for `DELETE` to the exact current A2 workforce session route. This requires a successful **A2** bearer validation, a read-only principal with a nonempty current `sessionId`, a decoded Fastify `params.id` equal to that ID, and the exact raw path (excluding the query string) equal to the canonical session path. SUPPORT fallback cannot claim the exception. The remaining route-policy pipeline, controller, reason DTO, and session-service ownership check still run.
- `src/authorization/workforce-session.service.ts`: replace full stale-entity saves during validation with partial updates conditional on status still being ACTIVE. If the normal validation update affects no row, reject the bearer as unauthorized. The expiry transition is likewise conditional so it cannot overwrite a concurrent revocation and its metadata. The configured TTL, role resolution, session ownership rules, and revocation reason behavior are unchanged.
- `test/mission-19a-workforce-logout.guard.spec.ts`: adversarial guard tests for exact method/path/parameter matching, missing and mismatched IDs, lookalikes, query strings, credential failures, SUPPORT fallback, unrelated unsafe methods and preservation of downstream declared authorization gates.
- `test/mission-19a-workforce-logout.integration.spec.ts`: real PostgreSQL and real TCP HTTP coverage, including password login/logout, sibling/other/unknown session denial, reason validation, all eleven existing roles, a test-only second catalogue-read-only role, and deterministic validation/revocation races.
- `test/workforce-session-principal-type.spec.ts`: add the conditional-update repository stub required by the existing unit fixture; its principal-type expectations are unchanged.

Read-only users cannot revoke a sibling session belonging to the same principal, another principal's session, or an unknown session; all receive the same 403 denial in the live test, and other active sessions remain usable. Unrelated DELETE/POST/PATCH/PUT operations remain forbidden. A query string does not change the path, but a non-canonical encoded path or a route lookalike does not receive the exception. Missing/invalid bearer credentials return 401, and invalid revocation bodies still return 400. Existing non-read-only workforce session ownership and privileged-scope behavior are not broadened or reduced.

## Verification

| Check | Result |
|---|---|
| Baseline live TCP K-01 regression | reproduced: read 200 / logout 403 / replay 200 |
| Baseline concurrent stale validation | reproduced: revoked row restored to ACTIVE |
| Targeted guard/session/DTO/authorization unit tests | **5 suites, 263 tests passed** |
| Focused PostgreSQL authorization/session/support regressions | **7 suites, 97 tests passed** |
| Complete backend unit suite (`npx jest --runInBand`) | **225 suites, 2,632 tests passed** |
| Complete PostgreSQL integration suite | **14/14 batches, 131/131 suites, 2,427/2,427 tests passed** |
| `npm run build` and `npx tsc --noEmit` | passed |
| ESLint on the five changed source/test TypeScript files | passed; full-repository lint was not run |

The focused PostgreSQL set included the new live TCP suite, A2 session lifecycle, local-admin login, authorization hardening, full-surface auth propagation, runtime-guard boundaries and SUPPORT operations. The full matrix ran as `PG_TEST_RUN_ID=m19afull PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=10 npm run test:pg`: all 14 serial batches exited zero, with all test databases isolated under the `m19afull` run namespace. Full-run status-only evidence from the new suite: `read=200 self-revoke=200 replay=401`; local login `201`; concurrent delayed read `401` with the session still `REVOKED`.

Reproduce the focused live test with a configured **test-only** PostgreSQL service:

```sh
PG_TEST_RUN_ID=m19arecheck PG_TEST_CONCURRENCY=1 npm run test:pg -- mission-19a-workforce-logout.integration.spec.ts
```

The concurrency regression deliberately controls one interleaving and is not a general load or stress test. A request that already completed authorization before a revocation is not retroactively cancelled; the correction prevents a stale validation write from resurrecting the token and fails validation if revocation won the conditional update.

## Scope and limitations

No frontend/mobile files, catalogue role permissions, session TTLs, product/financial policy, migrations, provider integrations, or financial operations were changed. Only isolated test databases and synthetic credentials were used; no production credentials, provider activation, migrations, merge, or deployment were involved. The policy-blocked decisions in the Mission 14 register remain untouched. These results are a targeted security correction and regression record, not a production-readiness or broader acceptance claim.
