# Operator journey checkpoint — Tier 1 registration → consent → identity verification → KYC approval

**Status: the operator journey passes end to end. The mobile claim flow is the remaining work and is
blocked on a missing delivery seam, described at the end.**

## Tested revision

| Item | Value |
| --- | --- |
| Tested commit | `6d4a82c7740471d0b161e1a5c2599d1b5e9a19d8` |
| Branch | `arena/0f3ce003-monienaija` (PR #38, draft) |
| Combined from | PR #38 `c270f09a`, PR #39 `2547e291` (already merged into #38), PR #41 `dccea76a`, plus this turn's fixes |
| Base | `arena/5-main-web-integration` @ `85b8a953` |
| Database | disposable PostgreSQL 55432 / `monienaija_t1`, freshly recreated and fully migrated (172 migrations) |

Ancestry was verified before combining: `git merge-base origin/pr41 HEAD` returned `c270f09a`, i.e.
PR #41 is stacked directly on this branch's earlier head, not on #39 as the task note assumed.
Merging `origin/pr41` produced **no conflicts**.

PR #41 turned out to be a follow-up to *this branch's own* fix: `c270f09a` had corrected the phantom
`assigned_by` / `previous_class_id` columns, but still re-activated the historical tier-default row
*before* closing the live one, which violates `uq_customer_class_assignments_active` (a real partial
unique index from migration 0805). #41 reorders that write; it is correct and is now merged.

## What the browser run proves (13 steps, 0 console errors)

Evidence: `journey-result.json`, screenshots in `screens/`.

1. **Real workforce sign-in.** `admin@monienaija.local` authenticates through the normal login form
   (`POST /api/v1/internal/a2/workforce/local-admin-sessions`); 33 nav sections render.
2. **Registration through the supported workflow.** The Admin Web registration wizard creates the
   customer via `POST /api/v1/customers` (201). No SQL inserted this customer.
3. **Phone verified by real OTP.** `POST /customers/registration/otp` then `/otp/verify` (200).
4. **BVN recorded by the operator** via `POST /customers/:id/identity-document` (201). This is data
   entry only — no consent, attempt or claim.
5. **Registration completed**, customer left as an unverified DRAFT.
6. **Tier 1 default class assigned by registration**: `STANDARD`, source `REGISTRATION_DEFAULT`.
7. **Compliance operator signs in separately** — separation of duties preserved.
8. **Consent notice served**: `consentNotice.version = v1.0-ng`, and
   `approvalEligibleNow = false` before verification (fail-closed).
9. **Consent captured + identity verified**: `verify-identity` → 200, `status: MATCH`, provider
   `PREMBLY`, route v1. The server created consent `b0ca6c13…`, attempt `c7b6fbd2…`.
10. **Consent is linked to the attempt and the claim**: dossier reports `consents=1`,
    `verificationAttempts=1`, `identityClaims=1`, `readerStatus=READY`; the attempt's `consentId`
    equals the consent the verification call returned.
11. **Tier 1 KYC approved** (`POST /customers/:id/kyc-assessment` → 201). This exercises the
    TIER_DEFAULT re-assignment that PR #41 fixed.
12. **Ready to claim**: `verifiedTier=LEVEL_1`, `customerClass=STANDARD`,
    `trustedEvidence.state=VERIFIED`, `wallet=null`, `outstanding=["account_active","wallet"]` —
    fully verified and still unclaimed, with no wallet and no customer credential.

**Nothing about consent, verification or the verified claim was seeded.** `evidenceStatus.consents`
was `[]` immediately before the verification call.

## Configuration the journey needed (all through supported surfaces)

| Setting | Value | Why |
| --- | --- | --- |
| Governed KYC provider routing | published v1 via maker/checker (`POST /internal/kyc/providers/proposals`, approve as COMPLIANCE) | `providerRouting.version` was 0, so `consentNotice` stayed `null`. PREMBLY enabled for BVN+NIN. |
| `KYC_CONSENT_NOTICE_VERSION` / `_TEXT` | `v1.0-ng` / authorisation text | `consentNotice()` returns null without both. |
| `KYC_CUSTOMER_VERIFICATION_ENABLED` | `true` | `verify-identity` answered 503 "not configured". |
| `KYC_VERIFICATION_POLICY_JSON` | enabled v1 policy | `policy()` requires an enabled versioned policy. |
| `PREMBLY_DETERMINISTIC_FIXTURES` | synthetic registry | deterministic identity-provider adapter (no egress in this sandbox). |

No `CONFIGURATION_REVIEW` state arose; the activation guards were never weakened.

## First remaining blocker: no supported way to read the mobile claim OTP

The #39 claim journey's next step is the customer's own phone OTP, passcode/PIN setup, sign-in and
activation of exactly one NGN wallet. In the backend HTTP integration suite this is proven with an
in-process recording SMS provider (`test/support/desk-otp-fixture.ts`), which is guarded to
`NODE_ENV=test`.

For the browser-driven run, `scripts/tier1-admin-web-server.cjs` now binds an equivalent recording
provider when `JOURNEY_RECORD_SMS=1`, and the registration OTP already flows through it. The mobile
claim OTP will as well **provided the claim flow routes through `NOTIFICATION_PROVIDER_TOKEN`**. The
registration path does; that is confirmed. The claim path has not yet been exercised against the
bound override, so whether it uses the same abstraction is unverified.

Two facts worth recording about this seam:

- The OTP is stored as a **salted hash** (`kyc_registration_otps.code_hash` + `salt`) and the console
  SMS provider deliberately discards the message body. There is no way to recover the plaintext from
  the database, by design — the recording provider is the correct seam, not a shortcut.
- The override is refused under `NODE_ENV=production`.

## Preserved

- All 11 workforce accounts plus `admin@monienaija.local` authenticate with their documented
  passwords (`MonieNaija_<ROLE>_123!`, `MonieNaijaAdmin123!`). Verified by logging in as each of the
  twelve.
- Synthetic data only. Both PR #38 and #39 remain **draft and unmerged**.
- Tier 3 implementation untouched.

## Guards added or relied on

- `verify-identity` refuses without a single active 11-digit BVN document (409) — the operator must
  key the identifier before the provider is asked to corroborate it.
- A BVN already claimed by another customer is refused (409 evidence/ownership conflict).
- Approval is refused until the trusted evidence reader is ready (`approvalEligibleNow=false`).
- The deterministic provider adapter answers only declared synthetic identifiers and fails closed
  for any other, and is only selected when `PREMBLY_DETERMINISTIC_FIXTURES` is set with
  `NODE_ENV != production`.
