# Tier 1 customer onboarding — combined review (Admin Web #38 + Customer App claim #39)

Everything below ran on synthetic rows against a disposable PostgreSQL. **Nothing is merged.**
PRs #38, #39 (and #24, #34) remain open drafts; #28 and #37 are untouched by this pass.

---

## 1. Exact revisions

### Which revision carries Admin Web onboarding

**PR #38** (`arena/0f3ce003-monienaija`), *not* #24/#34. #38 is the maintained successor:

| Ref | SHA | State at review |
| --- | --- | --- |
| Integration base `arena/5-main-web-integration` | `39e0811d928c54537d120a5efad94cc76afb71ca` | advanced from `85b8a953` (PR #23 merged) |
| **PR #38** head, pinned for the walkthrough | `c21a3a4c4ea095ebee63b05240e69b30162f0bbb` | `MERGEABLE`; CI run `45859537524` success |
| PR #38 head, latest (Tier 2 work landed mid-review) | `fb900c757683b719bf03a8dbd2aa84387869991f` | CI in flight |
| PR #39 head | `2547e291f0b0a0ff6fbfded2d1ee6506779faea7` | `MERGEABLE`/`UNSTABLE` |
| PR #24 head | `6985fe8ff4f3c7e3f985c1b4a54da1921a82cc0f` | **conflicted** against base |
| PR #34 head | `4c53728a79faa0abcb8d32931a903db35312dd2b` | **conflicted** against base; contains #24 |

Combined trees built and tested locally:

| Tree | SHA |
| --- | --- |
| #38 → base | `139ecd5a` |
| #38 → base **+ #39** | `c2f132c24285ad937b9a7697355537bbad5900c1` |

#24 and #34 should not be merged into; they are superseded by #38.

### Conflicts resolved (all one class)

- **#38 vs `39e0811d`** — 10 files, every one a migration-ledger pin. The base gained `0806/0807`
  from PR #23 while #38 contributes `0810–0812`, so each expectation list had to become the
  applied-order **union**, the schema head had to advance to `1785753600812`, and the identity
  count from 171/172 to **174**. No production logic was changed by the resolution.
  `migration-inventory` 10/10 green; `tsc --noEmit` clean.
- **#39 vs the #38 stack** — 3 files (`customer.module.ts`, `customer.service.ts`,
  `kyc-tier.module.ts`), additive DI wiring only, resolved by union with `@Optional()` preserved.

---

## 2. Admin Web — PASSED, 14/14

Disposable PostgreSQL `monienaija_t1`: **174 migrations applied**, head
`CustomerRestrictionConfigurationReview1785753600812`.
Production Admin Web bundle served at `http://127.0.0.1:4501` with `/api/*` proxied same-origin to
the real NestJS `AppModule` (`:4500`); real workforce login through the normal form.
**0 console errors**, 60 API calls (55×200, 3×201, 1×404 and 1×409 by design).
Evidence: `tier1-browser-result.json`, `api-calls.json`, `fixture.json`, `ceiling.json`.

| Acceptance check | Observed |
| --- | --- |
| Staff record customer consent through the approved workflow | 5 agreements incl. `KYC_CONSENT` → `201`; `requiredAgreementsAccepted: true`; list visible to COMPLIANCE. CUSTOMER_SERVICE (holds `customer.view` only) `POST` → **403 `FUNCTION_MISSING`** |
| Identity verified | `verifiedTier=LEVEL_1`, `trustedEvidence.state=VERIFIED`, `verifiedKinds=[BVN]`, `kyc_status=APPROVED` |
| Approved Tier 1 default class | `STANDARD` — `source=TIER_DEFAULT`, `effectiveFrom` set by activation |
| Effective fees | `WALLET_TRANSFER` RESOLVED; worked quote NGN 100.00 fee, NGN 0.00 VAT, **NGN 1,100.00 total** on NGN 1,000.00 |
| Effective limits | `MAX_AMOUNT_PER_TX` **NGN 5,000,000 `source=TIER_POLICY`** (institution cap) |
| Lower ceiling really governs | NGN 4,990,000 → `COMPLETED`; NGN 5,010,000 → **`422 LIMIT_MAX_AMOUNT_EXCEEDED`**, against a NGN 10,000,000 commercial cap |
| Ready for mobile claim, **no passcode/PIN issued** | `wallets=0`, `transaction_pins=0`, `customer-api sessions=0`, claim credentials `=0`; staff wallet read returns 0 |
| Institution scope | assigned COMPLIANCE reads `200/200`; unassigned CUSTOMER_SERVICE `404/404` with the same function; unenrolled platform customer `200` |
| Retry safety | replaying the activation body → `200` no-op, identical class and ceiling |
| Missing configuration | `409 ACTIVATION_CONFIGURATION_INCOMPLETE`, issues named to staff, customer stayed `DRAFT` |

### Two environment issues that are *not* branch defects

1. **`KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=false`** left in the local `.env` by the earlier PR #28
   session. With it, tier governance is inert and the panel shows the NGN 10,000,000 commercial cap;
   the run fails with *"the displayed per-transaction ceiling must be the approved institution cap"*.
   Set to `true`, the check passes. A reviewer must not inherit that flag.
2. Chromium needs `LD_LIBRARY_PATH=/tmp/al2023/lib` for the harness's bundled build
   (`libnspr4.so`); unrelated to the branch.

---

## 3. Customer claim — BLOCKED, blocker isolated exactly

`test/v1-staff-account-claim-journey.integration.spec.ts` on the combined tree:
**1 passed / 2 failed**. The two failures are **PR #38's activation gates meeting a spec written
against the pre-#38 tree** — not a defect in #39's claim flow.

Measured blocker chain, in order, on the combined tree:

| # | Refusal | Why |
| --- | --- | --- |
| 1 | `TIER_DEFAULT_NOT_APPROVED` (`409`) | Migration `0810` deliberately seeds LEVEL_1/2/3 mappings as **`PENDING_APPROVAL`** — by design, so operators approve them explicitly. The claim spec never does. |
| 2 | `NO_ENABLED_PRODUCTS` (`409`) | #38's gate requires ≥1 `products` row with `domain='CUSTOMER'`, `status='ACTIVE'`, `enabled`, `configuration_status='CONFIGURED'`, `product_scope='V1'`. The claim spec seeds no catalogue. |
| 3 | `CONFIGURATION_REVIEW` (`409` *"commercial configuration requires review"*) | With (1) and (2) satisfied, #38's tier transition evaluates `eff.products`, finds issues on a half-configured catalogue, and writes an active `customer_restrictions` row. No workforce route clears it. |

**The exact missing step:** #39's journey needs approved tier-default mappings **and** a configured
CUSTOMER product catalogue before the customer can leave `DRAFT`; then the review restriction must
clear on a complete transition. Either #39's spec seeds both and re-runs, or the harness composes
#38's fixture with #39's journey. This is a composition gap between the two drafts.

Verified independently while getting there:

- consent attestation path works: `POST /internal/kyc/review-workspace/customers/:id/verify-identity`
  with `customerConsentConfirmed` → OPERATIONS gets **403 `FUNCTION_MISSING`** (separation of duties),
  COMPLIANCE reaches the provider.
- KYC approval before provider verification fails closed (`409`).
- the provider call returned **`503 KYC verification is not configured`** in this local environment —
  synthetic KYC provider governance was not seeded, so recipient evidence could not be produced live.

**No mobile device evidence could be captured**, because no claimed account could be created. A real
Customer App run also needs `apps/customer-mobile` built and pointed at this backend; neither is done.

---

## 4. Defect found in PR #38 (in scope, reproduced and fixed locally)

`src/kyc-verification/kyc-tier-transition.service.ts` writes `customer_class_assignments` using two
columns that **do not exist** — migration `0805` creates `created_by`, and there is no predecessor
column at all:

- at `c21a3a4c`: the `INSERT ... (… assigned_by, previous_class_id …)` — **two** bad names.
- at `fb900c75`: a *second* site was added, `UPDATE … SET assigned_by = $2`.

Observed: **`500 QueryFailedError: column "assigned_by" of relation "customer_class_assignments" does not exist`** — every
approved-tier-default transition fails, so a customer whose tier default is approved can never be
given its class. Patch (both sites, `assigned_by`→`created_by`, predecessor dropped, `precedence`/
`reason` added to the insert): **`fix-tier-transition.patch`** in this directory.

Regression check with the patch applied — `npm run test:pg:isolated-kyc`:
**152/152 pass** at `c2f132c2` **and** again at `fb900c75`, including
`kyc-tier-transition.isolated-pg.test.ts`. (`NODE_OPTIONS=--max-old-space-size=3584` is required;
the default heap OOMs on that suite set.)

Not pushed: the fix belongs on #38's branch, which this session does not own. Applying it locally is
what turned the `500` into the honest `NO_ENABLED_PRODUCTS` refusal above.

---

## 5. CI

| Ref | Result |
| --- | --- |
| #38 `c21a3a4c` | run `45859537524` — **success**, 8/8 |
| #38 `fb900c75` (latest) | `45864795142` / `45863580924` — in flight at time of writing |
| #39 `2547e291` | **Admin Web (types, tests, build) FAILS — `npm test`**; real-PG pending; everything else passes |
| #24 `6985fe8f` | **Backend (real PostgreSQL integration) fails** |
| #34 `4c53728a` | all 8 pass (but the branch is conflicted against the base) |
| #37 `698a154e` (earlier pass) | run `45846673283` — 8/8 success |

Job logs are not downloadable from this sandbox (the results blob host is outside the allowlist),
so #39's Admin Web failure was not read from CI; it was reproduced locally instead.

---

## 6. First remaining blocker

**#39's claim journey cannot start on the combined revision**, because #38's activation gate needs
approved tier-default mappings (`0810` seeds them `PENDING_APPROVAL`) and a configured CUSTOMER
product catalogue that #39's spec does not seed. Secondary, and independent: the approved-default
transition **itself 500s** at both current #38 heads until `fix-tier-transition.patch` is applied.

---

## 7. Preserved

11 workforce accounts and their passwords, configurable roles and function grants, institution
scope, and maker-checker controls are untouched: no seed, migration or catalogue was modified by
this review. All records are synthetic; no live provider was called and no real funds moved. The
mobile apps were not modified.
