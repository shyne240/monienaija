# KYC governance, provider candidate, and customer pathway — acceptance handoff

**As of:** 2026-11-15 UTC

**Branch:** `arena/5b239ff5-monienaija` (active)

**Base commit:** `75300342666b7acc25207667a4a262fb23d4e191`.

**Durable checkpoint:** `449c4b0ffd31e6abbba5a2fcd39646a930ba848d`, pushed to this branch and verified as matching local and remote HEAD. The working tree was clean at checkpoint verification.

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
- Dojah's documented operations are candidates only. Confirm account entitlement, pricing, retention/data-processing terms, security controls and production approval before considering any provider activation. Existing Monnify route/documentation discrepancies also remain unconfirmed; do not change a paid endpoint without provider confirmation.
- The Dojah provider is not registered for dispatch, provider readiness is false, and the provider configuration remains disabled by default. Do not enable routing based on these tests.
- `KycTierEvidenceReader` returns unavailable in production. Consequently, no positive automated tier outcome should be inferred from the candidate adapter; evidence-dependent decisions must fail closed until a trusted, approved reader is deployed. Automated tier transitions cover Levels 1/2; Level 3/legacy review remains outside that automatic workflow.
- A separate protected-authority database credential still must be configured and verified by production readiness. The development/test fallback to the ordinary database connection is not an accepted production boundary.
- `LimitProfileResolverService.resolve` has no direct KYC-level input, and all limit assignment/enforcement paths have not been fully audited; tier support is not evidence that product limits are tier-adjusted.
- Browser smoke was not run: the environment lacks `libnspr4.so`, `libnss3.so` and `libnssutil3.so`.

## Current handoff

Changes are saved in the active branch's working tree. Before operational enablement, obtain the missing provider and regulatory approvals, configure and verify the protected authority credential and trusted evidence source, close the limit-path audit, and run a release-specific production-readiness review. Do not make provider calls or enable a live route until those prerequisites are documented and approved.
