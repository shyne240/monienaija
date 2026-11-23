# Customer Onboarding End-to-End — Implementation Plan (Arena 6)

**Branch:** `arena/81d28050-monienaija` (branched from `arena/5-main-web-integration` @ `72997e7`, which already includes PR #12 customer classes)
**Mission:** finish customer onboarding end-to-end — admin-assisted registration, mobile self-registration, account claiming, credentials/PIN, wallet + activation, mobile integration — without inventing provider contracts, regulatory rules or credentials.

## 1. What already exists (verified from source)

| Capability | Where | State |
| --- | --- | --- |
| Admin customer create → DRAFT, default class, CREATED audit | `src/customer/customer.service.ts#create`, `CustomerClassAssignmentService.assignDefaultOnRegistrationInManager` | Complete, but no review projection and no evidence gate beyond phone + eligibility |
| DRAFT → ACTIVE gate | `CustomerService.updateStatus` → `assertVerifiedPrimaryPhone` + `CustomerFinancialEligibilityService.require(requireActive=false)` | Phone + tier/assessment + trusted evidence + restrictions. **Missing: explicit outstanding-requirement reporting and a class/tier defaults surface for admins** |
| Self-registration (mobile) phone → OTP → synthetic verify → DRAFT → credentials/PIN | `kyc-registration-session.service.ts`, `kyc-registration-verification.service.ts`, `kyc-registration-completion.service.ts`, `kyc-synthetic-credentials.service.ts` | Real, but completion is **synthetic-only** and fenced to a disposable socket cluster; the non-synthetic path ends at `ONBOARDING_PENDING` |
| Real BVN/NIN verification | `kyc-customer-verification.service.ts` + `KycProviderGovernanceService` + `DojahKycProvider` / `MonnifyKycProvider` | Real provider adapters exist; only dispatch when governance routes them SHARE + runtime readiness. `KYC_CUSTOMER_VERIFICATION_ENABLED` defaults false |
| Account claiming | `mobile-account-claim.service.ts` + `mobile-onboarding-auth.service.ts` | Complete for admin/pre-provisioned accounts with MONNIFY MATCH evidence and `KYC_OWNERSHIP_KEY_*`; identity conflicts fail closed. Retry hardening from PR #9 not applied yet |
| Credential + PIN setup | `mobile-account-claim.service.ts#setup` (claim) and `kyc-synthetic-credentials.service.ts` (synthetic) | Admin never sets/reads customer secrets. **No self-service PIN for a customer whose passcode was created elsewhere** |
| Wallet provisioning | `WalletService.createWalletInTransaction` (financial wallet + ledger account), `CustomerWalletService.createWallet` (P1.4 provisioning registry) | Real and idempotent; `CUSTOMER_FINANCIAL_ACCOUNT_BINDING_POLICY` allows only OPERATOR/SERVICE/PRIVILEGED — **no customer-accessible activation path** |
| Mobile onboarding UI | `apps/customer-mobile/src/screens/unauthenticated/RegistrationScreen.tsx` | Phases for PHONE/OTP/PROFILE/IDENTITY/RESULT/CREDENTIALS/CLAIM/ONBOARDING_PENDING/ONBOARDING_LOGIN/ONBOARDING_AUTHENTICATED. **No rejection state, no activation status poll, no pending-review detail** |
| Customer status read | `GET /customers/me/status` | Lifecycle + KYC state only |

## 2. Gaps this change closes

1. **Admin registration review surface.** `GET /internal/customers/:id/registration-review` (workforce, `customer.view`) returning: default customer class resolved through `CustomerClassResolverService`, KYC tier + assessment state, blocked-reason classification, and the exact outstanding requirements for DRAFT → ACTIVE (verified primary phone, approved assessment, live trusted evidence, completed onboarding, ELIGIBLE eligibility, no active restriction). Read-only; it never activates.
2. **Hard evidence gate before DRAFT → ACTIVE.** `CustomerService.updateStatus(ACTIVE)` must reject when the trusted-evidence snapshot is missing/stale rather than only when the tier decision fails downstream — and the gate must be *reported*, not guessed, by the admin surface. (The existing eligibility call already fails closed; this change makes the failure attributable and auditable.)
3. **Customer wallet provisioning and activation.** New privileged, idempotent `POST /customers/me/activation` that:
   - requires an authenticated CUSTOMER SELF principal,
   - requires the same gates (`CustomerFinancialEligibilityService`, exactly one verified primary phone, no `kyc_identity_conflicts`, no active restriction),
   - requires a non-deleted `COMPLETED` `customer_onboarding` and `ELIGIBLE` `customer_eligibility` (the P1.4 provisioning contract),
   - provisions the P1.4 `CustomerWallet` (`PRIMARY`) **and** the financial `WalletAccount` (+ ledger account) through the authoritative services, with idempotency keys derived from the customer and a caller-supplied `Idempotency-Key`,
   - never returns ledger account identifiers to the customer projection,
   - fails closed (409/503) when anything above is missing.
4. **Mobile onboarding states.** RegistrationScreen gains explicit `PENDING_REVIEW`, `REJECTED`, `ACTIVATED` states driven by a single `GET /customers/registration-sessions/onboarding-state`-style read that reports the authoritative backend state (`customer.status`, `kyc_status`, pending claim, missing requirements), and a customer-authenticated activation screen entry point.
5. **PR #9 claim hardening (only that hunk).** Delete an unconsumed `mobile_account_claims` row when a later `claim-match` returns non-MATCH, so a failed retry cannot leave an earlier MATCH usable.

## 3. Deliberately NOT done (documented blockers)

- **Live BVN/NIN submission without provider credentials.** `KYC_CUSTOMER_VERIFICATION_ENABLED=false` and no approved provider keys in this environment. The code path is real; it fails closed with `AVAILABILITY` reporting. No credentials invented.
- **Un-fencing `POST /customers/registration` (legacy completion).** It requires identity-bound KYC evidence which requires (1) above. Left 503.
- **Auto-provisioning a wallet from a webhook/callback.** No approved callback exists (`docs/integration/IMPLEMENTATION-GATES-AND-DECISION-REGISTER.md` decision 4a).
- **B2 activation workflow wiring.** `B2ActivationWorkflowService` consumes `ATTESTED_READY` from B2T03; the nine-rule contract is not satisfiable in this environment (B1 tier/entitlement + B2_ACTIVATION consent). The new activation endpoint does **not** claim to be the B2 workflow.
- **New limits.** Class/tier-specific limits are read from the existing limit catalog at runtime; no new thresholds are introduced.

## 4. Tests

- New real-PostgreSQL suite: admin registration review, activation evidence gate, wallet provisioning idempotency, claim replay/conflict, mobile onboarding state projection.
- Focused unit tests for the new services and the mobile state machine.
- CI: `npm run build`, `npm run lint`, focused jest, and the PG suite through the recorded port-55433 recipe.

## 5. Implementation record (what actually shipped)

| Gap | Delivered | Verification |
| --- | --- | --- |
| 1. Admin review surface | `GET /api/v1/internal/customers/:id/registration-review` (`AdminCustomerController`), `CustomerActivationReadinessService` (read-only) | `v1-customer-onboarding-03` proofs 1–3; SUPPORT readable, customer bearer refused |
| 2. Attributable DRAFT → ACTIVE gate | `CustomerService.updateStatus` now captures the gate's verified tier and audits `activationGate {verifiedPrimaryPhone, financialEligibility, verifiedTier, evidenceSource}` | `v1-customer-onboarding-02` (16/16), `v1-customer-onboarding-01` (15/15) |
| 3. Customer-owned wallet provisioning | `GET/POST /api/v1/customers/me/activation` — CUSTOMER SELF, `Idempotency-Key` (8–255) required, SERIALIZABLE + bounded retry, `replayed` reported, audit `CUSTOMER_WALLET_ACTIVATION` ACTIVE/REPLAYED | `v1-customer-onboarding-03` proofs 4–9 |
| 4. Mobile onboarding states | `POST /api/v1/customers/registration-sessions/onboarding-state` (public, session-scoped) + `RegistrationScreen` `PENDING_REVIEW` / `REJECTED` / `ACTIVATED` with the shared requirement list; client validates the payload and never invents a state | `v1-customer-onboarding-03` proofs 10–16; `apps/customer-mobile/__tests__/registration.test.tsx` (18/18) |
| 5. PR #9 claim hardening | Unconsumed `mobile_account_claims` row deleted when `claim-match` returns non-MATCH | `batch2-legacy-registration.isolated-pg` (8/8) |

### Corrections made during implementation

- `CustomerFinancialEligibilityService.require()` returns the **verified tier** (`LEVEL_1`), not a
  verdict. The activation response and audit now report `financialEligibility: 'ELIGIBLE'` plus
  `verifiedTier`, so a client can never read a KYC level as an eligibility decision.
- The readiness projection reports a **requirement code and label only**; it never reports identity
  MACs, document numbers or provider payloads, and the tests assert the absence of 11-digit values.
- `NEW` is never rendered as an outcome of the verified-phone flow: the screen falls back to the
  weaker `onboarding-route` read and displays an explicit "status could not be loaded" notice
  rather than showing a review state the backend never reported.

### Test evidence (this branch)

```
test/v1-customer-onboarding-03.integration.spec.ts   16 passed   (new, real PostgreSQL)
test/v1-customer-onboarding-02.integration.spec.ts   16 passed   (regression)
test/v1-customer-onboarding-01.integration.spec.ts   15 passed   (regression)
test/runtime-access.guard.spec.ts                    16 passed   (new route-policy pins)
test/batch2-legacy-registration.isolated-pg.test.ts   8 passed   (isolated socket cluster)
apps/customer-mobile  jest --runInBand              234 passed   (26 suites)
npm run lint / npm run format:check / npm run build           clean
```
