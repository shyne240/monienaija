# Checkpoint — combined Tier 1 onboarding + customer claim review

Nothing here is merged. All drafts stay open.

## Combined revision under test

| Component | Ref | SHA |
| --- | --- | --- |
| Integration base | `arena/5-main-web-integration` | `39e0811d928c54537d120a5efad94cc76afb71ca` |
| PR #38 — successor to #24/#34 | `arena/0f3ce003-monienaija` | `c21a3a4c4ea095ebee63b05240e69b30162f0bbb` |
| PR #39 — customer claim | `arena/f37becb5-monienaija` | `2547e291f0b0a0ff6fbfded2d1ee6506779faea7` |
| Combined (#38 onto base) | local | `139ecd5a` |
| Combined (+ #39) | local | `c2f132c24285ad937b9a7697355537bbad5900c1` |

**Answer to "which revision for Admin Web onboarding": PR #38, not #24/#34.** #38 is the maintained
successor (`#24 6985fe8f` and `#34 4c53728a` are both *conflicted* against the advanced base; #34's
head already contains #24). The base moved from `85b8a953` to `39e0811d` (PR #23 merged), which is
what turned #38's `CONFLICTING` badge on.

## Conflicts resolved locally

- **#38 vs `39e0811d`** — 10 files, all migration-ledger pins (base gained 0806/0807 from PR #23;
  #38 contributes 0810–0812). Resolved as the applied-order **union**, head
  `1785753600812`, identity count **174**. `migration-inventory` 10/10 green; `tsc` clean.
- **#39 vs the #38 stack** — 3 files, additive DI wiring only. `tsc --noEmit` clean.

## Admin Web — PASSED (14/14)

Disposable PostgreSQL `monienaija_t1`, **174 migrations, head `0812`**. Production Admin Web
bundle at `:4501` behind a same-origin `/api` proxy to the real Nest `AppModule`; real workforce
login form; 0 console errors; 60 API calls (55×200, 3×201, 1×404 and 1×409 by design).

- consent through the approved workflow: 5 agreements (incl. `KYC_CONSENT`) → 201,
  `requiredAgreementsAccepted: true`, visible to COMPLIANCE; CUSTOMER_SERVICE POST → 403
  (`FUNCTION_MISSING`)
- identity verified: `verifiedTier=LEVEL_1`, `trustedEvidence.state=VERIFIED`, `verifiedKinds=[BVN]`
- approved Tier 1 default class: `STANDARD` / `source=TIER_DEFAULT`
- effective fee: RESOLVED, NGN 100.00 fee on NGN 1,000.00 (total NGN 1,100.00)
- effective limit: `MAX_AMOUNT_PER_TX` NGN 5,000,000 `source=TIER_POLICY` (institution cap beats
  the NGN 10,000,000 commercial cap; 4,990,000 `COMPLETED`, 5,010,000 → `422`)
- ready for mobile claim: wallets 0, PINs 0, customer sign-ins 0, claim credentials 0 — no passcode
  or PIN issued by staff completion

### Caveat (environment, not branch)
First run failed `displayed ceiling must be the approved institution cap`. Cause was
`KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=false` left in the local `.env` by the earlier PR #28 session,
which makes tier governance inert. With the flag on it passes. A reviewer must not inherit that flag.

## Customer claim — BLOCKED, blocker isolated exactly

`test/v1-staff-account-claim-journey.integration.spec.ts` (PR #39's 1203-line real-HTTP journey):
`1 passed / 2 failed`. The two failures are **PR #38's activation gates meeting a spec written
against the pre-#38 tree**, not defects in the claim flow itself.

Blocker chain, each step measured on the combined tree:

1. `TIER_DEFAULT_NOT_APPROVED` — migration 0810 deliberately seeds all three tier-default mappings
   as `PENDING_APPROVAL`. The claim spec never approves them, so the customer can never leave DRAFT.
   Missing step: an operator approval of the tier-default mappings. (#38's own fixture approves them,
   which is why its walkthrough works.)
2. `NO_ENABLED_PRODUCTS` — #38 requires ≥1 row in `products` with
   `domain='CUSTOMER' AND status='ACTIVE' AND enabled AND configuration_status='CONFIGURED' AND product_scope='V1'`.
   On an otherwise-real chain only `LIMIT_RULE_UNLIMITED`-style config exists; the claim spec seeds
   no catalogue. This is seed/config data, not a claim-flow dependency.
3. `CONFIGURATION_REVIEW` — with (1) and (2) satisfied, #38's tier transition writes an active
   `customer_restrictions` row (`TIER_CONFIGURATION_REVIEW_REQUIRED`) because it evaluates
   `eff.products` and finds issues when the catalogue is only half-configured. Financial access is
   then refused with *"Customer commercial configuration requires review before financial access"*.
   No workforce route clears it; it clears only on a tier transition whose evaluation is complete.

**Verdict:** #38's activation gate now requires commercial configuration the #39 claim spec does not
own. Either #39's spec must seed approved tier defaults + a configured CUSTOMER catalogue (and then
clear the review restriction), or the harness must compose both fixtures. That is a real
composition gap between the two drafts, not a claim-flow failure.

## Defect found in PR #38 (in scope, fixed locally)

`src/kyc-verification/kyc-tier-transition.service.ts:528` inserted into `customer_class_assignments`
using **`assigned_by`** and **`previous_class_id`**, neither of which exists (migration 0805 creates
`created_by`; there is no predecessor column). Every approved-tier-default transition therefore
failed **500 `QueryFailedError: column "assigned_by" ... does not exist`**. Patch:
`fix-tier-transition.patch` (uses `created_by`, adds `precedence`/`reason`).

Regression check after the fix: `npm run test:pg:isolated-kyc` → **152/152 pass**, including
`kyc-tier-transition.isolated-pg.test.ts`. (Needs `NODE_OPTIONS=--max-old-space-size=3584`;
the default heap OOMs on that suite set.)

## Open items

- Mobile device evidence for the claim flow: not yet captured (blocked by the chain above).
- CI for the combined revision: cannot be run from here (no push of a combined branch; #38's own
  head is `UNSTABLE`, #39's Admin Web job fails `npm test` at `2547e291`).
