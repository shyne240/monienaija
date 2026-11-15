# KYC governance, provider candidate, and customer pathway — acceptance handoff

**As of:** 2026-11-15 UTC

**Branch:** `arena/5b239ff5-monienaija` (active)

**Base commit:** `75300342666b7acc25207667a4a262fb23d4e191`.

**Checkpoint at original handoff:** `449c4b0ffd31e6abbba5a2fcd39646a930ba848d`, pushed to this branch and verified as matching local and remote HEAD. The subsequent checkpoint is recorded in the supplement below.

**Scope:** targeted acceptance only; the comprehensive provider, evidence, tier-to-limit and customer-journey mission remains in progress.

## Delivery summary

- Added protected checker evidence for KYC provider and tier-policy governance using the shared `protected_authority` schema and separate-authority connection. Runtime database credentials cannot directly write checker decisions or publish governed state. `KycTierModule` now explicitly imports `ProtectedAuthorityModule`.
- Added a disabled-by-default Dojah transport/verification candidate for documented BVN Validate and Advanced NIN operations. The transport is injectable, uses fixed Dojah hosts/routes, validates DNS/IP results, bounds request/response size and time, pins TLS hostname, and rejects redirects. BVN positive matches require all expected field statuses; Advanced NIN data is reduced to NIN/name/date-of-birth, discarding photo and extra fields. The adapter is not registered for production dispatch; no provider call was made.
- Added Dojah to provider governance as an unconfirmed candidate. Legacy two-provider configurations normalize the missing Dojah provider to disabled. Production provider readiness remains false; live-provider dispatch remains skipped and synthetic is test-only.
- Added an MFA `kyc.review` queue to the admin KYC workspace. It displays customer IDs, machine reason codes, policy version and timestamps only; opening an item goes to the customer-scoped review screen. The route remains server-authorized.
- Added a customer-mobile action that scrolls to published KYC requirements only. It does not submit identity data or initiate provider verification.

## Verification

| Check                                        |                                         Result | Acceptance record                                             |
| -------------------------------------------- | ---------------------------------------------: | ------------------------------------------------------------- |
| Root Jest suite                              |            **251 suites / 2,938 tests passed** | [root unit](root-unit-full.sanitized.md)                      |
| Isolated PostgreSQL KYC suites               |                 **6 suites / 77 tests passed** | [isolated PostgreSQL](kyc-all-isolated-postgres.sanitized.md) |
| Focused provider/tier unit tests             |                 **4 suites / 65 tests passed** | [provider/tier unit](kyc-provider-and-tier-unit.sanitized.md) |
| Admin Web KYC governance and workspace tests |                 **2 suites / 17 tests passed** | [admin Web](admin-web-kyc-operations.sanitized.md)            |
| Customer Mobile KYC status tests             |                   **1 suite / 8 tests passed** | [customer mobile](customer-mobile-kyc-upgrade.sanitized.md)   |
| TypeScript checks                            | **root, admin-web and customer-mobile passed** | [static checks](kyc-final-static-checks.sanitized.md)         |
| `git diff --check`                           |                                     **passed** | [static checks](kyc-final-static-checks.sanitized.md)         |

The first broader isolated-PostgreSQL attempt exposed missing authority providers/migrations in test setup; the fixtures were corrected and all six suites passed on rerun. The first root Jest run exposed missing `ProtectedAuthorityModule` wiring for KYC tier governance; the module now imports it explicitly and the complete suite passed. The admin-Web tests emitted a non-failing React `act(...)` warning from the existing Dashboard widget state update in a shell-navigation test.

## Approval and production-readiness boundaries

This work is **not** an enabled or approved production identity-verification integration.

- No provider live, billable, or sandbox API calls were made. No production database was used. No provider credentials, entitlement confirmation, contract approval or trusted production evidence-reader configuration was available.
- Dojah's documented operations are candidates only. Confirm account entitlement, pricing, retention/data-processing terms, security controls and production approval before considering any provider activation. The earlier Monnify NIN path discrepancy is resolved in source against the official documented `/api/v1/vas/nin-verification` route. The docs still conflict on environment availability (prose says live-only while the NIN example uses sandbox); account entitlement, environment approval, pricing and production approval remain unverified. No provider call or route activation is authorized by this handoff.
- The Dojah provider is not registered for dispatch, provider readiness is false, and the provider configuration remains disabled by default. Do not enable routing based on these tests.
- `KycTierEvidenceReader` returns unavailable in production. Consequently, no positive automated tier outcome should be inferred from the candidate adapter; evidence-dependent decisions must fail closed until a trusted, approved reader is deployed. Automated tier transitions cover Levels 1/2; Level 3/legacy review remains outside that automatic workflow.
- A separate protected-authority database credential still must be configured and verified by production readiness. The development/test fallback to the ordinary database connection is not an accepted production boundary.
- `LimitProfileResolverService.resolve` has no direct KYC-level input, and all limit assignment/enforcement paths have not been fully audited; tier support is not evidence that product limits are tier-adjusted.
- Browser smoke was not run: the environment lacks `libnspr4.so`, `libnss3.so` and `libnssutil3.so`.

## Current handoff

Before operational enablement, obtain the missing provider and regulatory approvals, configure and verify the protected authority credential and trusted evidence source, close the limit-path audit, and run a release-specific production-readiness review. Do not make provider calls or enable a live route until those prerequisites are documented and approved.

## Post-checkpoint supplement — 2026-11-15 UTC

**Current code checkpoint:** `caffebd715514fbe56b802bb6e1cdb0588c9b775` (`Align Monnify NIN verification with documented contract`), pushed to `arena/5b239ff5-monienaija`. Local and remote HEAD matched, and the working tree was clean before this documentation supplement.

### Revalidation of the Monnify change

- Official Monnify documentation specifies `POST /api/v1/vas/nin-verification` with `{ nin }`, and a response body with the NIN, identity fields, and boolean `ninInformationMatch`. The adapter now binds a valid returned NIN to the request; the KYC adapter returns MATCH only when the provider flag, identifier binding, and local identity comparison all pass.
- Focused Jest after the commit: `test/monnify-verification.unit.spec.ts` and `test/kyc-foundation.unit.spec.ts` — **2 suites, 36 tests passed**.
- `npx tsc --noEmit` — **passed**.
- Isolated PostgreSQL governance/policy rerun: `test/kyc-provider-governance.isolated-pg.test.ts` and `test/kyc-tier-policy.isolated-pg.test.ts` — **2 suites, 15 tests passed**. These disposable-cluster tests are not production database evidence.
- Prettier check on the five files in the Monnify commit and on this handoff — **passed**. The repository-wide formatting check still reports style issues in four files unchanged by the Monnify commit: `src/kyc-verification/kyc-governance-authority.ts`, `src/kyc-verification/kyc-tier-policy.service.ts`, `src/migrations/1785753600300-KycGovernanceProtectedAuthority.ts`, and `test/kyc-tier-policy.isolated-pg.test.ts`. They were not reformatted as part of this provider update. `git diff --check` after the handoff edits — **passed**.

### Broader evidence, limit and customer-journey audit

| Area                      | Source finding                                                                                                                                                                                                                                    | Consequence                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted evidence          | `KycTierEvidenceReader.read` returns `null`. `CustomerFinancialEligibilityService.require` treats that as unavailable and throws `ServiceUnavailableException` rather than accepting the customer.                                                | Evidence-dependent financial eligibility fails closed today; no trusted production evidence ingestion or automated reassessment is implemented.                                                                                             |
| Tier policy               | The governed policy describes evidence requirements for Levels 1 and 2. The decision workflow does not include Level 3, and the policy has no monetary limit values.                                                                              | Do not infer that a KYC tier is an approved financial-limit tier. Regulatory requirements and the approved tier scope remain a separate decision.                                                                                           |
| Limit resolution          | `LimitProfileResolverService` accepts principal/agent/segment inputs but no KYC tier. Missing or disabled assignments resolve to `null`; `LimitEnforcementService` returns allowed when no profile or no applicable rules resolve.                | The current implementation does not establish authoritative KYC-tier-to-limit assignment or the requested fail-closed behavior for missing tier/profile/rule configuration. Existing profile/rule enforcement is not proof of tier linkage. |
| Customer limit projection | `CustomerLimitViewService` uses the same independent limit-profile resolver. The `/customers/me/kyc` projection reports requirements/evidence status; `/customers/me/limits` reports profile/rule limits separately.                              | The app can show published requirements and current configured limits, but there is no source-backed contract tying those limits to the displayed KYC tier.                                                                                 |
| Customer journey          | The authenticated KYC screen shows the current record and approved policy requirements; its “See what the upgrade needs” action only scrolls to those requirements. Registration verification is synthetic-only and rejects non-test runtime use. | There is no production customer evidence-submission/provider-verification journey. The UI does not itself create an evidence record or award a tier.                                                                                        |
| Governance boundary       | The two isolated PostgreSQL suites passed with test-created roles/connections. Production role grants, separate credential configuration and operational one-use behavior remain unverified.                                                      | Test coverage does not establish production database authority or operational readiness.                                                                                                                                                    |

Google Drive searches during this checkpoint found only broad customer-lifecycle and Admin Console review documents, not the original KYC mission authorization, approved tier thresholds, or a tier-to-limit mapping decision. No monetary thresholds or provider entitlements are inferred from those reviews.

### Decisions/evidence still required

1. Compliance/regulatory-approved KYC tier definitions, the supported tier scope, and requirements by customer/product class.
2. Approved financial limits by tier **and** product, direction, currency, channel, dimension and effective window; mapping to governed limit profiles; precedence/override rules; and the behavior for missing, expired or disabled mappings. Do not populate or infer numerical limits before sign-off.
3. Written Monnify account entitlement, allowed environment, price/billing and production approval, plus the approved data-processing/retention terms for the chosen provider. The official documentation's environment inconsistency is not resolved by synthetic tests.
4. An approved trusted-evidence source and production reader design/configuration, including identity-revision binding, consent, retention, revocation, audit and reassessment semantics.
5. Production database role membership/grants and distinct runtime/authority credentials, verified against the deployed PostgreSQL configuration.

Until those inputs are approved and verified, keep provider routes disabled, make no live or billable provider requests, and do not represent current limits as KYC-tier-derived. This supplement records source/test evidence only; it is not production approval.
