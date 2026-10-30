# 08 — Test-Evidence Matrix

## Verification performed in this audit

| Check | Result | Evidence boundary |
|---|---|---|
| Source baseline / ancestry | Verified: application SHA `73eb1ca`; source docs tip `d93328d` parent equals app SHA | Git object and branch checks; not runtime verification |
| Static source inventory | Generated: 470 route decorators; 85 modules/controllers, 179 services, 131 DTO files, 156 entity files, 100 migrations | Declaration scan only; exact counts can miss runtime/dynamic constructs |
| Browser UAT | NOT EXECUTED | No browser-to-real-API workflow claimed |
| Backend build (`npm run build`) | PASS | Executed on the source-identical application tree at branch merge baseline; 73eb1ca application content, docs-only closure commit merged |
| Backend unit suite (`npm test`) | PASS: 201/201 suites, 2019/2019 tests | Executed serially by Jest configuration on the source-identical application tree |
| Admin TypeScript (`npm run ts:check`) | PASS | `apps/admin-web` |
| Admin tests (`npm test -- --runInBand`) | PASS: 26/26 suites, 179/179 tests | Serial rerun; an earlier parallel test attempt timed out/failures under contention, so it is not used as pass evidence |
| Admin production build (`npm run build`) | PASS, with large-chunk warning | Vite build succeeds; no code changes made |
| Current PostgreSQL integration suite (`npm run test:pg`) | INCOMPLETE / FAILED TO ESTABLISH DB | Runner could not connect to 127.0.0.1:5432; DB_HOST/DB_NAME/DB_USER/DB_PASSWORD were unset; no PG pass claim |
| Production database/migration/deployment | NOT EXECUTED | No migration or deployment action permitted |
| Live SMS/email provider delivery | NOT EXECUTED | No provider credentials/real recipient exercise |
| Unauthorized request / penetration testing | NOT EXECUTED | Security findings are static source findings only |

## Inherited integrated test evidence (not newly rerun here)

The `docs/ARENA3-NOTIFICATION-FINAL-CLOSURE-REPORT-20261027.md` reports testing on application SHA `73eb1ca`:

- backend production build passed;
- backend unit suite: 201/201 suites, 2019/2019 tests;
- targeted PostgreSQL sanity: 5/5 suites, 90/90 tests;
- full sequential PostgreSQL integration suite: 119/119 files, 2276/2276 tests;
- Admin Web TypeScript check passed, 26/26 suites / 179/179 tests, and production build passed.

This is inherited report evidence, not an execution performed by the present audit. It does **not** establish browser UAT, live SMS/email delivery, production migrations, production activation, or exhaustive security. The earlier notification integration report documents its own intermediate run with 2 failing integration test files subsequently fixed; final-closure report records the post-fix full green rerun. These are separate runs and should not be conflated.

The Ordinary Agent V1 completion report likewise records real PostgreSQL and HTTP evidence at its specific audited SHA `b8a5b94`, not this current source baseline. Its test counts are not interchangeable with the notification final-closure run.

## Current audit run detail

- `npm run build` (backend): PASS.
- `npm test` (backend): PASS, 201 suites / 2019 tests.
- `npm run ts:check` (Admin): PASS.
- `npm test -- --runInBand` (Admin): PASS, 26 suites / 179 tests. A prior parallel test attempt produced failures/timeouts and was not treated as a pass; the serial complete rerun is the accepted current evidence.
- `npm run build` (Admin): PASS; Vite emitted a chunk-size warning (>500 kB), not a build error.
- `npm run test:pg` (backend integration): attempted but did not complete. It reported `ECONNREFUSED` to `127.0.0.1:5432`, and DB_HOST/DB_NAME/DB_USER/DB_PASSWORD were unset; the runner was stopped after no DB became available. No current PG pass is claimed.
- `npm ci --ignore-scripts --no-audit --no-fund` completed for root and Admin dependencies. Install created ignored dependency/build artifacts only; no tracked application files changed.

## Minimum evidence required for later `COMPLETE`

1. Exact tested app SHA and clean source context.
2. Real HTTP route exercised through auth guard and DTO validation.
3. DB-backed persistence plus reload/read-after-write for mutations.
4. Authorization positive and negative tests including subject/resource scope.
5. Business/financial effect evidence or explicit read-only classification.
6. Browser interaction evidence for Admin workflow, including permissions, errors and concurrency.
7. Operational/config evidence where workers/providers are required; provider acceptance distinguished from user delivery.
8. Test logs/results and known exclusions. No single green suite substitutes for these independent conditions.
