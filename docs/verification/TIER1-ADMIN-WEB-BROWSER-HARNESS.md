# Tier 1 Admin Web Browser Harness (PR #24 + #34 follow-up)

## Verification status

- [x] **Admin Web browser walkthrough — RAN, 14 checks passed.** Chromium (Playwright, headless,
      `HeadlessChrome/153.0.8010.0`) against the production Admin Web bundle served at
      `http://127.0.0.1:4501` with `/api/*` proxied to the real NestJS `AppModule` on port 4500, over a
      fully migrated disposable PostgreSQL (`monienaija_t1`). A real workforce session was established
      through the normal login form. Evidence, screenshots and the API call log:
      `docs/integration/evidence/tier1-admin-web/` (`tier1-browser-result.json`, `api-calls.json`,
      `fixture.json`, `ceiling.json`, `01`–`04` screenshots).
- [x] **Tier 1 registration exercised end to end through the UI:** the Registration review panel
      showed `Verified tier LEVEL_1` and the 9 requirement rows; the `Activate` control issued
      `PATCH /api/v1/customers/:id` → `200 status=ACTIVE`; the reopened record showed the approved
      default class `STANDARD — Standard (TIER_DEFAULT) · Eligible for verified tier`, the resolved
      `WALLET_TRANSFER` fee with its worked quote (NGN 100.00 fee / NGN 0.00 VAT / NGN 1,100.00 total on
      NGN 1,000.00), and the effective limit table.
- [x] **Runtime ceiling proof (fully migrated disposable PostgreSQL):** approved synthetic
      institution Tier 1 cap (NGN 5,000,000) governs over a higher commercial cap (NGN 10,000,000).
      Displayed `MAX_AMOUNT_PER_TX` is the tier cap with `source=TIER_POLICY`. Runtime: NGN 4,990,000
      transfer `COMPLETED`; NGN 5,010,000 transfer denied `422 LIMIT_MAX_AMOUNT_EXCEEDED`.
      Proof: `test/tier1-runtime-ceiling.integration.spec.ts` and `test/tier1-runtime-ceiling-probe.integration.spec.ts`.
- [x] **Staff completion leaves the account ready to claim, and unclaimed:** after activation the DB
      has wallets `0`, transaction PINs `0`, `customer-api` sessions `0`, claim-issued credentials `0`;
      the staff wallet read returns 0 wallets. The fixture's only credential is the pre-claim onboarding
      session's decorative placeholder hash (marker `tier1fixture`), which authenticates nobody. No
      mobile passcode and no transaction PIN were issued by staff completion.
- [x] **Same-request retry:** replaying the browser's own activation body returns `200` as a no-op,
      and a repeated registration-review read returns the identical class and ceiling — no forked state.
- [x] **Institution access denial:** an assigned COMPLIANCE principal reads both scoped reads (`200`);
      a CUSTOMER_SERVICE principal holding the same `customer.view` function but no assignment gets
      `404` on both, while still reading an unenrolled platform customer (`200`) — scope, not function.
- [x] **Missing required configuration blocks staff completion:** `409 ACTIVATION_CONFIGURATION_INCOMPLETE`,
      two issues (`WALLET_TO_CASH:FEE_NOT_CONFIGURED`, `WALLET_TRANSFER:FEE_NOT_CONFIGURED`). The refusal
      is rendered to staff naming the missing products and stating nothing changed; the customer stayed
      `DRAFT`.
- [x] **Tier 2 runtime ceiling proof — RAN, passes.** A LEVEL_2 customer (BVN + NIN evidence) is
      corroborated as LEVEL_2 by the governed eligibility gate, its OWN approved institution cap
      (NGN 10,000,000, distinct from Tier 1's NGN 5,000,000) is what the effective configuration
      displays (`source=TIER_POLICY`) and what runtime admission enforces: NGN 9,990,000 `COMPLETED`,
      NGN 10,010,000 → `422 LIMIT_MAX_AMOUNT_EXCEEDED`, while a NGN 50,000,000 commercial cap is
      configured throughout. `test/tier2-tier3-ceiling-coverage.integration.spec.ts`, evidence in
      `tier-coverage-LEVEL_2.json`.
- [x] **Tier 3 — proved UNREACHABLE, which is a finding rather than a pass.** Tier 3 requires a
      non-BVN/NIN evidence type on every satisfying path (`tier3HasAdditionalRequirement`), and the
      decision model defines 18 evidence types, but every persistence surface the governed reader binds
      to — `kyc_consents`, `kyc_verification_attempts`, `kyc_identity_claims` — constrains `kind` to
      exactly `('BVN','NIN')` in a `varchar(3)` column. No Tier 3 evidence can be stored, so the tier
      cannot be reached. A policy demanding BIOMETRIC still tops out at LEVEL_2. Evidence:
      `tier-coverage-LEVEL_3.json`. The spec asserts the schema constraint so it starts failing the day
      the evidence store is widened.
- [ ] **Tier 2 browser walkthrough: NOT run.** Tier 2 is proved at runtime (eligibility gate,
      effective configuration, transfer admission, ledger) but not walked through the Admin Web UI. The
      fixture seeds only a LEVEL_1 customer, so the browser run still cannot show a Tier 2 record.
- [ ] **Customer App claim journey: NOT run here by design.** Owned by the separate Customer App
      Arena session; this repository only supplies the backend contract and fixture (see "Customer App
      contract" below).

## Defects this run found (both fixed and pinned by tests)

1. **Staff saw the commercial ceiling instead of the governed institution cap.**
   `CustomerEffectiveConfigurationService` resolved the institution only from
   `wallet_accounts.institution_id`. Between staff completion and the customer's claim there is no
   wallet, so the panel showed NGN 10,000,000 while the customer's first transfer would be governed
   by the approved NGN 5,000,000 tier cap. The read now falls back to the ACTIVE
   `customer_institution_enrolments` row (the institutional relationship that predates the wallet),
   so display and enforcement agree at every stage.
2. **Institution scope was not enforced on the staff reads.**
   `AdminCustomerController` takes `InstitutionWorkforceScopeService` as `@Optional()`, but
   `AdminModule` never imported `InstitutionModule`. The dependency resolved to `undefined`, the
   guard returned immediately, and any staff principal could read any enrolled customer. Fixed by
   importing the module.
3. **The activation refusal told staff to "refresh",** which can never fix a missing fee rule. The
   server already returned the exact issues; `ApiError` now carries them and the confirm dialog
   renders them.

Pinned by `test/tier1-effective-configuration-institution-scope.unit.spec.ts` (both new assertions
fail without the fixes) and `apps/admin-web/__tests__/api-client-request.test.ts`.

## Branch / head

- Branch: `arena/0f3ce003-monienaija` (the single integration path for PR #24 + the verified PR #34 follow-up)
- PRs #24 and #34 remain open and unmerged; this branch carries their combined history plus the fixes above.

## Reproduce this run

```bash
# 1. disposable PostgreSQL + migrations, then seed the workforce accounts
node scripts/prepare-pg-test-env.js --create-if-missing
npm run build
node scripts/local-dev-seed-admin.js
LOCAL_DEV_SEED_CONFIRM=disposable-local-database node scripts/local-dev-seed-11-roles.js

# 2. build and serve Admin Web + the real API behind one origin
(cd apps/admin-web && ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build --outDir /tmp/tier1-admin-dist)
DB_NAME=monienaija_t1 TIER1_FIXTURE_CONFIRM=disposable-database \
  npx ts-node -r tsconfig-paths/register scripts/tier1-admin-web-fixture.ts
node scripts/tier1-admin-web-server.cjs /tmp/tier1-admin-dist    # ports 4500 (API) / 4501 (preview)

# 3. the runtime ceiling probe (writes ceiling.json the harness requires)
DB_NAME=monienaija_t1 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=tier1 \
  node -r ./test/support/mission-25c-network-guard.cjs ./node_modules/jest/bin/jest.js \
  --runInBand --config jest.integration.config.js test/tier1-runtime-ceiling-probe.integration.spec.ts

# 4. the browser acceptance run
TIER1_BASE_URL=http://127.0.0.1:4501 node scripts/tier1-admin-web-browser-acceptance.cjs
```

The fixture is idempotent: it rewinds only what staff completion itself writes (the lifecycle status
and the `TIER_DEFAULT` class assignment), so the run is repeatable rather than passing once.

## Tier 2 / Tier 3 — what is proved, what is not

Proved at runtime on fully migrated disposable PostgreSQL
(`test/tier2-tier3-ceiling-coverage.integration.spec.ts`, 4 cases, all passing):

| Tier    | Corroborated tier | Approved cap   | Displayed source | Below cap               | Above cap            |
| ------- | ----------------- | -------------- | ---------------- | ----------------------- | -------------------- |
| LEVEL_1 | LEVEL_1           | NGN 5,000,000  | TIER_POLICY      | NGN 4,990,000 COMPLETED | NGN 5,010,000 → 422  |
| LEVEL_2 | LEVEL_2           | NGN 10,000,000 | TIER_POLICY      | NGN 9,990,000 COMPLETED | NGN 10,010,000 → 422 |
| LEVEL_3 | unreachable       | —              | —                | —                       | —                    |

Each tier maps to its OWN approved profile, so the numbers above cannot be produced by one profile
standing in for all three. A NGN 50,000,000 commercial cap is configured throughout and never
governs.

Two supporting cases pin how the gate behaves:

- a customer row that _claims_ LEVEL_3 while the evidence supports only LEVEL_2 is **refused**
  (`409`) rather than silently granted the lower tier's ceilings, and the displayed ceiling stays the
  assignment profile instead of any governance-approved Tier 3 cap;
- Tier 3 remains unavailable under a policy with no extra requirement (the
  `tier3HasAdditionalRequirement` guard).

**Not proved:**

- **No Tier 2 or Tier 3 walkthrough in the browser.** The Admin Web fixture seeds only a LEVEL_1
  customer, so the UI run cannot show a Tier 2/3 record, class or limit table. Closing this needs the
  fixture to seed LEVEL_2 evidence (BVN + NIN) and a LEVEL_2 tier-default class.
- **Tier 3 is not covered at all beyond the unreachability proof above.** There is no path to it in
  this backend.
- The LEVEL_1 → LEVEL_2 _transition_ driven from the Compliance screen is covered by
  `test/kyc-tier-transition.isolated-pg.test.ts` and the workforce suites, not by a browser.

## Customer App contract (hand-off to the parallel session)

The backend contract the Customer App session must accept, all synthetic:

- Customer reference `t1-sender-<uuid8>`, phone `+2348099000001`, `is_synthetic = FALSE`,
  `status = ACTIVE`, `kyc_level = LEVEL_1`, `kyc_status = APPROVED`.
- Identity evidence: one APPROVED current `customer_kyc_assessments` row, a verified primary phone,
  a verified ownership claim and a provider `MATCH` attempt bound to the current identity revision.
- Nothing claimable exists yet: `wallet_accounts` 0 rows, `customer_transaction_pins` 0 rows,
  `customer-api` sessions 0 rows. The claim flow must therefore provision the mobile passcode, the
  transaction PIN, the customer session and the wallet itself.
- Institution: the customer is enrolled (ACTIVE) with the synthetic institution, whose approved
  policy maps `WALLET_TRANSFER`/NGN at every tier to profile `T1_INSTITUTION_TIER_CAP`
  (`MAX_AMOUNT_PER_TX` NGN 5,000,000). A transfer above that ceiling must be denied
  `422 LIMIT_MAX_AMOUNT_EXCEEDED` after claim, so the two sessions agree on the governing cap.

## Preconditions

- Node/npm as per repo.
- Disposable PostgreSQL reachable; migrations applied.
- Backend built: `npm run build`
- Admin Web deps installed: `cd apps/admin-web && npm ci`
- Local admin seeded (development only): `NODE_ENV=development node scripts/local-dev-seed-admin.js`
- KYC ownership key configured for synthetic claim (dev/test only):
  - `KYC_OWNERSHIP_KEY_BASE64=zZluamosntOpfdOxLDfiKEk+9Tj3+5N99Xk2mDPAy1s=`
  - `KYC_OWNERSHIP_KEY_VERSION=test-v1`
  - Matching `kyc_ownership_key_state` row with proof `71db50bad487883cb68392342f12f69bfd6b174f6c9e1a67c1a6db220b3d716d`.

## Start services

Backend (port 3000, binds 0.0.0.0 by default in dev config used here):

```bash
source /tmp/backend-env.sh  # or export equivalent envs
node dist/main.js
```

Admin Web (port 5173):

```bash
cd apps/admin-web
VITE_API_PROXY_TARGET=http://localhost:3000 npm run dev -- --host 0.0.0.0 --port 5173
```

## Fixture (disposable DB only)

`scripts/tier1-admin-web-fixture.ts` seeds the entire Tier 1 state in one idempotent run. It refuses
to run without `DB_NAME` and `TIER1_FIXTURE_CONFIRM=disposable-database`, and it writes
`docs/integration/evidence/tier1-admin-web/fixture.json` for the acceptance run to consume (no
number in the harness is hand-written).

What it seeds, through the product's own governed services wherever a governed route exists:

- KYC tier policy v1 and an APPROVED synthetic institution (the lifecycle trigger is disabled only
  for that single INSERT, because no governed route approves an institution without a live ceremony).
- The institution tier policy through `InstitutionKycLimitPolicyService.propose` + `.decide` — real
  proposal, protected-authority head versioning, distinct maker and checker, approval state machine.
  Mappings: `WALLET_TRANSFER`/NGN at LEVEL_1–3 → profile `T1_INSTITUTION_TIER_CAP` (cap NGN 5,000,000).
- A higher commercial profile `T1_COMMERCIAL_HIGH` (cap NGN 10,000,000) assigned globally, so the
  lower institution cap is the one that must govern.
- `STANDARD` customer class, approved tier-default mappings for LEVEL_1–3, and fee rules
  (`WALLET_TRANSFER` flat 10000, 0 bps, 0 VAT; `WALLET_TO_CASH` explicit zero fee).
- The synthetic sender and receiver customers, the sender KYC-approved via `approveKycEvidence`
  (profile identity, verified primary phone, consent, provider `MATCH` attempt, VERIFIED ownership
  claim bound to the current identity revision, APPROVED assessment) and enrolled with the
  institution.
- A deliberately misconfigured control customer on an approved class with no effective fee rule,
  plus the workforce assignment used for the institution-scope matrix.
- After seeding it **rewinds only what staff completion writes** (lifecycle status and the
  `TIER_DEFAULT` class assignment), so the acceptance run is repeatable rather than passing once.

Expected state after the fixture (see `fixture.json` for the exact ids of the current run):

- sender: `t1-sender-<uuid8>`, `+2348099000001`, DRAFT → ACTIVE after activation, LEVEL_1/APPROVED,
  not synthetic, enrolled ACTIVE with the synthetic institution
- assigned class: `STANDARD` (`TIER_DEFAULT`), eligible for the verified tier
- effective `WALLET_TRANSFER` fee: RESOLVED flat 10000, 0 bps, VAT 0; quote 100000 → fee 10000 /
  VAT 0 / total 110000
- effective limits: `MAX_AMOUNT_PER_TX` NGN 5,000,000 with `source=TIER_POLICY` (the institution
  cap, not the NGN 10,000,000 commercial cap)
- before claim: wallets 0, transaction PINs 0, `customer-api` sessions 0

## HTTP evidence captured in sandbox (no browser)

- Registration review (workforce bearer) showed: `activatable=true`, `financialEligibility=ELIGIBLE`, `trustedEvidence=VERIFIED [BVN]`, assigned STANDARD/TIER_DEFAULT, effective WALLET_TRANSFER fee/limits RESOLVED, outstanding `[wallet]`.
- Pre-claim registration session cannot provision wallet: `POST /api/v1/customers/me/activation` with registration-session bearer + Idempotency-Key returned `401 Authentication required`.
- Claim with valid synthetic ownership evidence: `POST /customers/registration-sessions/claim-match` (BVN 22222222222, ownership key/mac aligned) returned `MATCH`; `claim-credentials` returned `SET_UP`.
- Post-claim access: onboarding-login returned customer-api session; `/customers/me`, `/customers/me/profile`, `/customers/me/wallets`, `/customers/me/activation` returned 200 with expected ACTIVE/LEVEL_1 profile and no provisioned wallet.
- Fee quote runtime comparison: effective-preview `amountMinor=100000` computed feeMinor 10000/vat 0/total 110000, matching displayed registration-review quote.
- Ceiling (commercial above tier, historical sandbox snapshot): MAX_AMOUNT_PER_TX bumped to 10,000,000 in commercial profile; effective-preview reflected 10,000,000. In that disposable env tier-limit enforcement activation was false and no institution tier policy was supplied, so preview did not apply a separate tier ceiling. Superseded for runtime control by the runtime ceiling proof above / `test/tier1-runtime-ceiling.integration.spec.ts`.
