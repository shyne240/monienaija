# Tier 1 Admin Web — checkpoint

## Pushed state

- Branch: `arena/0f3ce003-monienaija`
- Head: **`2e97200d`** (pushed)
- Draft PR: **#38** — https://github.com/shyne240/monienaija/pull/38 (open, draft, unmerged)
- Base: `arena/5-main-web-integration` @ **`85b8a953eb3563d800f5a50118c4dddbdaf04965`** — re-fetched
  at review time and unchanged, so this is the exact backend SHA the Customer App session should
  target.

Commits on top of the combined base:

| SHA | What |
| --- | --- |
| `4ec778a3` | merge of PR #24 head (`6985fe8f`) + PR #34 tip (`4c53728a`) onto `85b8a953` |
| `88feb8ec` | institution record scope on the two staff reads (guard added, provider later found missing) |
| `113c6750` | scope provider wiring, enrolment fallback for the tier ceiling, actionable refusal message, acceptance tooling |
| `360a8018` | drop unused probe principals; lint/format |
| `762edbef` | this checkpoint |
| `2e97200d` | refresh acceptance evidence from the re-run at `360a8018` |

Original PRs **#24** and **#34** remain open and unmerged; their 22 commits and authorship are
preserved in this branch.

## Verified green — Tier 1 Admin Web browser acceptance, 14/14

Re-run end to end at `360a8018` (the head the evidence belongs to). Real workforce session created
through the normal login form; production Admin Web bundle at `http://127.0.0.1:4501` with `/api/*`
proxied to the real NestJS `AppModule`; fully migrated disposable PostgreSQL (`monienaija_t1`);
headless Chromium `153.0.8010.0`. No console errors.

| Check | Result |
| --- | --- |
| Real workforce session | 33 nav sections; `POST /api/v1/internal/a2/workforce/local-admin-sessions` |
| Registration review renders | `GET /api/v1/internal/customers/:id/registration-review` |
| Verified tier + requirements | `LEVEL_1`, verified primary phone row satisfied |
| Staff completion | `PATCH /api/v1/customers/:id` → `200`, `status=ACTIVE` |
| Approved default class | `STANDARD — Standard (TIER_DEFAULT) · Eligible for verified tier` |
| Effective fee + quote | resolved rule; NGN 1,000 → fee NGN 100.00, VAT NGN 0.00, total NGN 1,100.00 |
| Effective limits | `MAX_AMOUNT_PER_TX` NGN 5,000,000, `source=TIER_POLICY` |
| Ready to claim, unclaimed | wallets 0, transaction PINs 0, `customer-api` sessions 0, claim credentials 0 |
| Lower ceiling governs at runtime | cap NGN 5,000,000 vs commercial NGN 10,000,000: NGN 4,990,000 `COMPLETED`, NGN 5,010,000 → `422 LIMIT_MAX_AMOUNT_EXCEEDED` |
| Safe same-request retry | replay of the browser's own body → `200` no-op, identical class + ceiling |
| Assigned principal | COMPLIANCE → `200` / `200` |
| Cross-institution denial | CUSTOMER_SERVICE (same `customer.view`) → `404` / `404`; unenrolled platform customer → `200` |
| Missing configuration | `409 ACTIVATION_CONFIGURATION_INCOMPLETE`, 2 issues, rendered to staff, customer stayed `DRAFT` |

Evidence in this directory: `fixture.json`, `ceiling.json`, `tier1-browser-result.json`,
`api-calls.json`. Screenshots are regenerable and written to `/tmp/tier1-admin-web-shots`
(`TIER1_SCREENSHOTS=keep` keeps them here instead).

Local checks at this head: `npm run lint` 0 errors (1 pre-existing warning in
`test/b9-custom-role.integration.spec.ts`), `npm run format:check` clean, `tsc --noEmit` clean, root
unit suite 310/311 suites / 3596 tests (the single failure,
`test/notification-direct-security-logging.unit.spec.ts`, is a pre-existing worker-parallelism flake
that passes in isolation and is untouched here), `apps/admin-web` 106/106 suites / 1079 tests.

## Defects this work found and fixed

1. **Institution scope not enforced on the staff reads.** `AdminCustomerController` takes
   `InstitutionWorkforceScopeService` as `@Optional()`, but `AdminModule` never imported
   `InstitutionModule`; the dependency resolved to `undefined` and `assertRecordScope` returned
   immediately, so any staff principal could read any enrolled customer. Fixed by importing it.
2. **Staff saw the commercial ceiling instead of the governed institution cap.** The effective
   configuration resolved the institution only from `wallet_accounts.institution_id`; before the
   wallet exists there is none, so NGN 10,000,000 was displayed while enforcement would apply NGN
   5,000,000. Now falls back to the ACTIVE enrolment.
3. **The activation refusal said "refresh and review"** — advice that cannot fix a missing fee rule.
   `ApiError` now carries the server's `issues` and the dialog names the missing products.

Pinned by `test/tier1-effective-configuration-institution-scope.unit.spec.ts` (both key assertions
fail without the fixes, verified by stashing them) and
`apps/admin-web/__tests__/api-client-request.test.ts`.

## CI at `2e97200d`

7 of 8 checks `success` (Classify changes, Backend lint/format/build/unit, Backend isolated
PostgreSQL, Backend container image builds, Admin Web, Agent Mobile, Customer Mobile).
**Backend (real PostgreSQL integration) still `in_progress`** after ~35 minutes in
`Run the real-PostgreSQL integration suites` — the full integration matrix, not a failure. It was
still running when this checkpoint was written; re-check
`gh pr checks 38` rather than assuming it passed.

## First remaining blocker

**Tier 2 and Tier 3 coverage — not started.** Only LEVEL_1 is seeded and exercised. Needed:

- LEVEL_2 requires both a verified BVN **and** a verified NIN; LEVEL_3 additionally requires a
  non-BVN/NIN evidence type on every satisfying path, and the approved tier policy in this
  environment currently has empty LEVEL_3 rules, so LEVEL_3 is *unavailable by policy* until a
  separately approved extra requirement is published.
- `approveKycEvidence` in `scripts/tier1-admin-web-fixture.ts` is hard-coded to a single BVN consent,
  attempt and claim, so it cannot yet reach LEVEL_2/3.
- Per-tier institution caps that differ from LEVEL_1's (today every tier maps to the same
  `T1_INSTITUTION_TIER_CAP`), plus browser walks showing each tier's own class and limits.

Also open: a browser walkthrough of the LEVEL_1 → LEVEL_2 transition (covered by
`test/kyc-tier-transition.isolated-pg.test.ts`, not by a browser). The Customer App claim journey is
out of scope here by design.

## Reproduce

See `docs/verification/TIER1-ADMIN-WEB-BROWSER-HARNESS.md`.
