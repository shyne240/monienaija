# Tier 1 Admin Web — checkpoint

State at `360a8018` (pushed; draft PR #38, base `arena/5-main-web-integration` @ `85b8a953`).

## Verified green

Tier 1 Admin Web browser acceptance: **14/14 checks pass** against a real workforce session on
fully migrated disposable PostgreSQL. Re-run at this exact SHA. Evidence in this directory
(`fixture.json`, `ceiling.json`, `tier1-browser-result.json`, `api-calls.json`).

Covered: staff completion → ACTIVE; approved default class (`STANDARD`, `TIER_DEFAULT`);
effective fee + quote; effective limits with the institution cap at `source=TIER_POLICY`;
ready-to-claim with no wallet/PIN/sign-in; lower tier ceiling governing over the higher commercial
cap at runtime; safe same-request retry; assigned vs unassigned institution access;
missing-configuration refusal rendered to staff.

## Open

1. **Tier 2 and Tier 3 coverage** — not started. Only LEVEL_1 is seeded and exercised. Needs:
   LEVEL_2/LEVEL_3 customers with evidence sufficient for their tier, per-tier institution caps that
   differ from LEVEL_1, and browser walks showing each tier's own class and limits.
2. Tier-transition walkthrough (LEVEL_1 → LEVEL_2) from the Compliance screen — covered by isolated
   PG suites, not by a browser.
3. Customer App claim journey — owned by the parallel session; contract documented in
   `docs/verification/TIER1-ADMIN-WEB-BROWSER-HARNESS.md`.

## Reproduce

See `docs/verification/TIER1-ADMIN-WEB-BROWSER-HARNESS.md`.
