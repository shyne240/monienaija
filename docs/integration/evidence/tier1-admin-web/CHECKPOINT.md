# Tier 1 Admin Web — checkpoint

## Pushed state

- Branch: `arena/0f3ce003-monienaija`
- Head: **`4177e183`** (pushed)
- Draft PR: **#38** — https://github.com/shyne240/monienaija/pull/38 (open, draft, unmerged)
- Base: `arena/5-main-web-integration` @ **`85b8a953eb3563d800f5a50118c4dddbdaf04965`** — re-fetched
  at review time and unchanged, so this is the exact backend SHA the Customer App session should
  target.

Commits on top of the combined base:

| SHA        | What                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `4ec778a3` | merge of PR #24 head (`6985fe8f`) + PR #34 tip (`4c53728a`) onto `85b8a953`                                    |
| `88feb8ec` | institution record scope on the two staff reads (guard added, provider later found missing)                    |
| `113c6750` | scope provider wiring, enrolment fallback for the tier ceiling, actionable refusal message, acceptance tooling |
| `360a8018` | drop unused probe principals; lint/format                                                                      |
| `762edbef` | this checkpoint                                                                                                |
| `2e97200d` | refresh acceptance evidence from the re-run at `360a8018`                                                      |
| `0d9c2365` | record pushed SHAs, verified checks and CI state in this checkpoint                                            |
| `4177e183` | Tier 2 runtime proof + Tier 3 unreachability finding (`test/tier2-tier3-ceiling-coverage.integration.spec.ts`) |

Original PRs **#24** and **#34** remain open and unmerged; their 22 commits and authorship are
preserved in this branch.

## Verified green — Tier 1 Admin Web browser acceptance, 14/14

Re-run end to end at `360a8018` (the head the evidence belongs to). Real workforce session created
through the normal login form; production Admin Web bundle at `http://127.0.0.1:4501` with `/api/*`
proxied to the real NestJS `AppModule`; fully migrated disposable PostgreSQL (`monienaija_t1`);
headless Chromium `153.0.8010.0`. No console errors.

| Check                            | Result                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Real workforce session           | 33 nav sections; `POST /api/v1/internal/a2/workforce/local-admin-sessions`                                                 |
| Registration review renders      | `GET /api/v1/internal/customers/:id/registration-review`                                                                   |
| Verified tier + requirements     | `LEVEL_1`, verified primary phone row satisfied                                                                            |
| Staff completion                 | `PATCH /api/v1/customers/:id` → `200`, `status=ACTIVE`                                                                     |
| Approved default class           | `STANDARD — Standard (TIER_DEFAULT) · Eligible for verified tier`                                                          |
| Effective fee + quote            | resolved rule; NGN 1,000 → fee NGN 100.00, VAT NGN 0.00, total NGN 1,100.00                                                |
| Effective limits                 | `MAX_AMOUNT_PER_TX` NGN 5,000,000, `source=TIER_POLICY`                                                                    |
| Ready to claim, unclaimed        | wallets 0, transaction PINs 0, `customer-api` sessions 0, claim credentials 0                                              |
| Lower ceiling governs at runtime | cap NGN 5,000,000 vs commercial NGN 10,000,000: NGN 4,990,000 `COMPLETED`, NGN 5,010,000 → `422 LIMIT_MAX_AMOUNT_EXCEEDED` |
| Safe same-request retry          | replay of the browser's own body → `200` no-op, identical class + ceiling                                                  |
| Assigned principal               | COMPLIANCE → `200` / `200`                                                                                                 |
| Cross-institution denial         | CUSTOMER_SERVICE (same `customer.view`) → `404` / `404`; unenrolled platform customer → `200`                              |
| Missing configuration            | `409 ACTIVATION_CONFIGURATION_INCOMPLETE`, 2 issues, rendered to staff, customer stayed `DRAFT`                            |

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

## Tier 2 / Tier 3 — added, and what it found

`test/tier2-tier3-ceiling-coverage.integration.spec.ts` — 4 cases, all passing on disposable
PostgreSQL:

| Tier    | Corroborated | Approved cap   | Displayed source | Below cap               | Above cap            |
| ------- | ------------ | -------------- | ---------------- | ----------------------- | -------------------- |
| LEVEL_1 | LEVEL_1      | NGN 5,000,000  | TIER_POLICY      | NGN 4,990,000 COMPLETED | NGN 5,010,000 → 422  |
| LEVEL_2 | LEVEL_2      | NGN 10,000,000 | TIER_POLICY      | NGN 9,990,000 COMPLETED | NGN 10,010,000 → 422 |
| LEVEL_3 | unreachable  | —              | —                | —                       | —                    |

Each tier maps to its own approved profile, so one profile cannot stand in for all three; a
NGN 50,000,000 commercial cap is configured throughout and never governs. Two supporting cases pin
the failure modes: a row claiming LEVEL_3 on LEVEL_2 evidence is refused `409` (fail-closed) rather
than granted a lower tier's ceilings, and Tier 3 stays unavailable under a policy with no extra
requirement.

**Tier 3 is structurally unreachable — a backend finding, not a test gap.** `tier3HasAdditionalRequirement`
demands a non-BVN/NIN evidence type on every satisfying path and the decision model defines 18
evidence types, but `kyc_consents`, `kyc_verification_attempts` and `kyc_identity_claims` all
constrain `kind` to `('BVN','NIN')` in a `varchar(3)` column. A policy demanding BIOMETRIC still tops
out at LEVEL_2. The spec asserts those schema constraints so it fails the day the store is widened.
Evidence: `tier-coverage-LEVEL_1.json`, `tier-coverage-LEVEL_2.json`, `tier-coverage-LEVEL_3.json`.

## First remaining blocker

**No Tier 2 walkthrough in the browser.** Tier 2 is proved at runtime (eligibility gate, effective
configuration, institution policy, transfer admission, ledger) but the Admin Web fixture seeds only a
LEVEL_1 customer, so the UI run cannot show a Tier 2 record, class or limit table. Closing it needs
`approveKycEvidence` in `scripts/tier1-admin-web-fixture.ts` to seed BVN + NIN for a LEVEL_2
customer plus a LEVEL_2 tier-default class, then the same 14 checks re-run against it.

Second: the LEVEL_1 → LEVEL_2 transition from the Compliance screen is covered by
`test/kyc-tier-transition.isolated-pg.test.ts`, not by a browser. The Customer App claim journey is
out of scope here by design.

## Reproduce

See `docs/verification/TIER1-ADMIN-WEB-BROWSER-HARNESS.md`.
