# Final Independent Integration Acceptance — 2026-10-30

## Decision

**Integration acceptance: FAIL — a clean full PostgreSQL matrix has not been demonstrated in this independent review.** The exact target's 127-suite `test:pg` run completed with one failure in batch 9. The failed test passed immediately when run alone and when the entire seven-suite batch was rerun, without changing source, but those retries do not turn the failed full-run exit status into a clean full-matrix run. Re-run the complete matrix successfully (or obtain an explicitly accepted disposition for the flaky test) before changing this verdict to PASS.

**Production release readiness: NOT READY.** The release conditions below remain open independently of the automated-test result. This report is not authorization to merge, deploy, apply production migrations, activate a provider, or implement Report 30.

## Scope and pinned source

- Reviewed integration branch: `integration/main-backend-frontend-20261030`
- Exact target commit: `bbf3efeeb4b87b5bed6afcef7dd7e96a35e96a6b`
- Security baseline: `3b488caddc2f68c28a5f06d1571dfd4311656a64`
- Customer-mobile incorporation commit: `e0203eeffb1cf90617d9ac65e4581a06beced32f` (source fix `171ac75e43ab54e0ef85645845cd5cbf0428657e`)
- Requested source report: `docs/integration/20261030-MOBILE-FIX-INCORPORATION-AND-FINAL-GATES.md`
- Review was performed in an isolated detached worktree at the pinned target. This reviewer branch contains only this documentation report; no application code, tests, or migrations were changed.

The target delta from the security baseline is limited to the three customer-mobile files, the requested integration report, and `test/final-integration-gates-focus.integration.spec.ts`. The customer-mobile implementation and its unit test are byte-identical to the corresponding files at the incorporated source fix. No backend authorization implementation or migration file changed from the reviewed security baseline.

## Independent verification

### PostgreSQL integration matrix and six real-HTTP gates

- `NODE_ENV=test npx jest --config jest.integration.config.js --listTests` discovered **127** integration suites, including `test/final-integration-gates-focus.integration.spec.ts`. The new suite is therefore registered for future `npm run test:pg` runs; it is not a one-off test invocation.
- The requested report records the pre-addition **126-suite / 2,376-test** PostgreSQL matrix as passing. I independently ran the current, superset **127-suite / 2,382-test** matrix on the pinned commit using the report's isolated embedded-PostgreSQL setup and `PG_TEST_CONCURRENCY=1`.
- Initial full-run result: **126 suites passed, 1 failed; 2,381 tests passed, 1 failed**. Batches 1–8 passed (120/120 suites, 2,356/2,356 tests). In batch 9, six suites passed and one existing suite failed: `test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts`, in its realistic concurrent SERIALIZABLE rate-limit contention assertion (`results.every(...status === 'fulfilled')`). The runner reported `9 batch(es), 127 files, concurrency=1 — FAILED`.
- With no source changes, I reran the failing suite alone: **1 suite / 5 tests passed**. I then reran all seven batch-9 suites together: **7 suites / 26 tests passed**. The full focused integration suite was also independently run standalone: **1 suite / 6 tests passed**.
- Interpretation: every one of the 127 suites has passed in at least one execution, and the new six-test gate is green; nevertheless, the full matrix command itself was red and the concurrency failure is non-deterministic. I do **not** certify the 126-suite baseline as independently green in one full run, nor issue an unconditional integration PASS, until a full rerun is green.

The focused real-HTTP suite exercises: customer login; the required `/api/v1` prefix and negative unprefixed/double-prefixed paths; bodyless logout versus the empty-JSON rejection; revoked-session rejection; wrong-PIN rejection preserving the session and leaving transfer/journal/balance state unchanged; and cross-customer source-wallet denial while the rightful owner can transfer.

The integration run included `migration-chain.integration.spec.ts`, notification and agent-application migration-upgrade tests, and the production-readiness migration-sync test. There are **102** migration files at the target, and the migration tree is unchanged from the security baseline. These were test-database exercises only; no production migration was run.

### Security, authorization, and customer-mobile fix

- The backend security/authorization source is unchanged from the previously independently reaccepted baseline. The current full unit run also passed the authorization HTTP matrix and security-related unit suites.
- The six real-HTTP gates passed when run standalone. In particular, wrong PIN returned 401 without revoking the valid bearer session or changing transfer, journal, or balance state; a different customer's source wallet was rejected; and the owning customer's transfer succeeded.
- The incorporated customer-mobile fix normalizes bare and pre-prefixed API base URLs without duplicating `/api/v1`, omits `Content-Type` for bodyless requests such as logout, and separates step-up credential failures from rejected bearer sessions. Its session-expiry handling clears the customer session keys and notifies the auth store while preserving pending transfer intent.
- Full customer-mobile verification: **14 suites / 118 tests passed**, TypeScript check passed, and an offline Android Metro/Hermes export passed. The modified API-client and auth-store suites specifically passed **2 suites / 25 tests**.
- Non-blocking follow-up: `/customers/sessions` 401s are intentionally exempted from secure-storage purge, while the auth-store login catch resets in-memory authentication state. If `login()` is invoked while an old session remains persisted, that can leave in-memory and persisted state inconsistent until restore/re-authentication. The current navigator exposes Login only in the unauthenticated stack and the normal logout path clears storage first; this edge was not demonstrated through the normal UI. Add a regression test and reconcile the states before introducing in-session account switching.

### Other reported test evidence

Independently rerun on the pinned target:

| Area | Result |
|---|---|
| Backend unit suite (`npm test -- --silent`) | **222 suites / 2,571 tests passed** |
| Backend Nest build (`npm run build`) | Passed |
| Agent Mobile unit suite | **20 suites / 297 tests passed** |
| Agent Mobile TypeScript check | Passed |
| Agent Mobile offline Android bundle export | Passed |
| Customer Mobile unit suite | **14 suites / 118 tests passed** |
| Customer Mobile TypeScript check | Passed |
| Customer Mobile offline Android bundle export | Passed |
| Admin Web unit suite | **33 suites / 243 tests passed** |
| Admin Web TypeScript check | Passed |
| Admin Web Vite production build | Passed |

The React Native and Admin Web suites emitted non-failing React `act(...)` warnings; the Admin Web build emitted Vite's non-failing large-chunk advisory. These did not cause test/type/build failures. No mobile binary, device install, or physical-device UAT was performed.

## Open owner ratifications and production-release dependencies

These are distinct from the test-matrix failure and are not satisfied by this acceptance review:

1. **Production workforce OIDC:** deploy/configure the identity provider and production issuer, JWKS URI, audience, client ID, and session TTL. `A2_WORKFORCE_ENABLED` remains false by default; the local admin authenticator is development/test-only. Keep the retired dev mock-sandbox bypass retired.
2. **Customer temporary-credential rotation UI:** Customer Mobile reports `rotationRequired` but does not implement `POST /customers/credentials/rotate` UI.
3. **Physical-device UAT:** login/logout, expiry, wrong-PIN and lockout UX, transfer-intent recovery across re-authentication, deep links, real secure storage, and real network conditions remain untested on devices.
4. **Mobile owner ratification:** ratify the four merge resolutions, this incorporated customer-mobile fix, and the OI-01 disposition. `FundWallet` and `Withdraw` are declared in route types but are not registered in `AppNavigator`.
5. **Admin Web owner ratification:** ratify the four reconstructed merge files.
6. **Product Owner ratification:** approve the selected V1 contract (`/customers/me/*`, OTP registration, generic customer commands disabled).
7. **Provider-audit oversight:** confirm the current SUPER_ADMIN/FINANCE_AUDITOR scope under the strict `audit.view` gate or approve the proposed dedicated route follow-up.
8. **Readiness metric decoupling:** approve the outstanding proposal to remove the operational duration metric write from the readiness GET path.

## Scope confirmation

This was review-only. No application code, tests, or migrations were modified; no merge to `main`, deployment, production migration, provider activation, or Report 30 implementation was performed. The only deliverable is this documentation-only report on the reviewer-owned branch.
