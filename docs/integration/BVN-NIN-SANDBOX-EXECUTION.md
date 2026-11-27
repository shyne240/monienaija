# BVN/NIN Sandbox Execution and Launch Gates

This guide reconciles the BVN/NIN provider execution posture with the latest consolidated implementation on the integration branch. It covers implementation readiness, synthetic/PostgreSQL testing, real provider sandbox verification, and production readiness as separate states. No state may be inferred from another.

## Consolidated implementation status

The repository implements the customer KYC journey end-to-end at the application layer: authenticated customer/onboarding-session access, verified-phone and identity-revision checks, explicit versioned consent, governed provider routing, durable request reservation, provider dispatch, evidence persistence, tier reevaluation, financial eligibility, activation/readiness gates, and idempotent wallet provisioning. Customer Mobile submits BVN/NIN only after availability and consent checks and never stores identifiers persistently.

## Verification outcome contract (backend `AttemptOutcome`)

The actual BVN/NIN verification attempt outcomes defined by backend contracts are:

| Backend status | Meaning | Customer presentation | Authoritative verified |
|---|---|---|---|
| `DISPATCHING` | Request sent; provider outcome not yet final. | Processing / in progress; do not resubmit. | No |
| `MATCH` | Provider returned an authoritative match. | Verified (identity check only; no tier/eligibility change by itself). | Yes |
| `REVIEW` | Provider/result requires review; not an authoritative match. May include mismatch or manual-review cases. | Needs review; not verified. | No |
| `UNKNOWN` | Provider outcome could not be confirmed. | Outcome unknown; do not resubmit duplicate; safe review required. | No |
| `CONSENT_WITHDRAWN` | Consent withdrawn before a verified outcome could be used. | Consent withdrawn; not verified. | No |
| `EXPIRED` | Verification outcome expired before use. | Expired; not verified. | No |

There is no separate backend `AUTHORITATIVE_MISMATCH`, `PENDING_VERIFICATION`, `MANUAL_REVIEW`, `PROVIDER_UNAVAILABLE`, or `SUPERSEDED` attempt outcome in the current BVN/NIN `AttemptOutcome` contract. Provider unavailability/configuration incompleteness is surfaced through availability/configuration states, not as a successful or verified attempt outcome. Any unrecognized status must fail closed in presentation and must never be rendered as verified.

## Provider reconciliation

### Dojah

| Area | Status |
|---|---|
| Supported verification operations | BVN and NIN identity verification through the Dojah adapter; additional Dojah assurance capabilities exist only as governed/candidate architecture entries and are not confirmed BVN/NIN sandbox execution paths. |
| Actual sandbox capability | Dojah has an explicit sandbox host selection via `DOJAH_VERIFICATION_ENV=sandbox`. No Dojah sandbox call was executed in this environment because no authorized sandbox credentials or provider-issued test identities were present. |
| Required secure configuration | `DOJAH_VERIFICATION_ENABLED=true`, `DOJAH_VERIFICATION_ENV=sandbox`, `DOJAH_SECRET_KEY` (secret), `DOJAH_APP_ID`, `KYC_PROVIDER_CONTRACTS_REVIEWED=true`, `KYC_PROVIDER_LIVE_CALLS_ENABLED=true` only in an isolated sandbox deployment, `KYC_CUSTOMER_VERIFICATION_ENABLED=true`, approved `KYC_VERIFICATION_POLICY_JSON`, `KYC_CONSENT_NOTICE_VERSION`, `KYC_CONSENT_NOTICE_TEXT`, `KYC_CONSENT_VALIDITY_SECONDS`, `KYC_OWNERSHIP_KEY_BASE64` (>=32 decoded bytes), `KYC_OWNERSHIP_KEY_VERSION`. Provider secrets must be injected through the deployment secret manager, never committed or passed as command-line arguments. |
| Provider routing and approval requirements | A maker/checker-approved Dojah BVN/NIN route must exist in KYC provider governance. Route approval is necessary but not sufficient; contract review, credential/configuration readiness, and explicit live-call release gates also apply. |
| Production execution restrictions | Production execution remains disabled by default. Do not enable production Dojah dispatch without explicit production release approval, reviewed contracts, authorized credentials, and deployment controls. |
| Outstanding contract verification requirements | Confirm authorized sandbox account entitlement, provider-issued test identities, expected BVN/NIN response contract, error/timeout semantics, and evidence-retention constraints before recording real sandbox evidence. |

### Monnify

| Area | Status |
|---|---|
| Supported verification operations | BVN/NIN verification adapter exists in codebase; exact account entitlement and NIN contract must be confirmed with Monnify. |
| Actual sandbox capability | Monnify adapter currently targets `api.monnify.com` without a sandbox/production host split in the verification adapter. No Monnify sandbox or live call was executed. |
| Required secure configuration | If Monnify confirms an authorized test environment/contract: `MONNIFY_VERIFICATION_ENABLED=true`, `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, plus the same KYC customer verification/policy/consent/ownership-key configuration and governance route approval. Secrets must be injected through the deployment secret manager. |
| Provider routing and approval requirements | Maker/checker-approved Monnify BVN/NIN route required in KYC provider governance. Route approval is not sufficient without confirmed contract, credentials, and release gates. |
| Production execution restrictions | Do not send Monnify verification requests until Monnify confirms in writing that the specific credentials and endpoint are sandbox/test-only for the intended operation. Production execution remains disabled. |
| Outstanding contract verification requirements | Written confirmation of test/sandbox entitlement, NIN endpoint/contract, BVN contract parity, error semantics, and data-handling terms. No request should be sent before confirmation. |

### Prembly

| Area | Status |
|---|---|
| Supported verification operations | BVN Basic (`/verification/bvn_validation`) and NIN Basic (`/verification/vnin-basic`) through `PremblyVerificationProvider` / `PremblyKycProvider`. Only documented Basic records are eligible for the existing consent-bound KYC flow. |
| Actual sandbox capability | Prembly sandbox calls are supported by code only when explicit release gates pass. `PremblyCredentialGovernanceService` supports encrypted sandbox/production credential storage, maker/checker proposal/approval, and a sandbox connection test that uses Prembly's published BVN test record. No real Prembly sandbox call was executed in this environment because no authorized credentials were present. |
| Required secure configuration | Deployment secret/config: `KYC_PROVIDER_ENCRYPTION_KEYRING_JSON` and active key version for governed provider secrets; `PREMBLY_SANDBOX_CALLS_ENABLED=true` only for isolated sandbox testing; `KYC_PROVIDER_CONTRACTS_REVIEWED=true`; `KYC_PROVIDER_LIVE_CALLS_ENABLED=true` only where the isolated deployment intentionally permits provider dispatch; `KYC_CUSTOMER_VERIFICATION_ENABLED=true` and approved KYC policy/consent/ownership-key config. Prembly API keys are managed through encrypted maker/checker credential governance (not plain env API key). `PREMBLY_PRODUCTION_RELEASE_ENABLED` must remain false outside approved production release. |
| Provider routing and approval requirements | Maker/checker-approved Prembly BVN/NIN route required in KYC provider governance. Credential proposal/approval is separate from route approval. Runtime readiness requires the approved route, configured credentials for the target environment, and release flags/gates. |
| Production execution restrictions | Production requires `NODE_ENV=production`, `PREMBLY_PRODUCTION_RELEASE_ENABLED=true`, contracts reviewed, live calls enabled, customer KYC enabled, approved production credential, approved route, and deployment authorization. Production execution remains disabled by default. |
| Outstanding contract verification requirements | Confirm Prembly account entitlement/commercial terms for BVN Basic and NIN Basic, sandbox key validity, provider-issued test identities where required, response/error semantics, and production launch approval. Record only outcome categories/correlation metadata; never record raw identity numbers, raw provider payloads, or secrets. |

## Readiness classification

| State | Meaning | Current posture |
|---|---|---|
| Implementation readiness | Code paths, contracts, governance gates, and tests exist in repository. | Present for consolidated BVN/NIN KYC flow; Prembly Basic BVN/NIN adapter/governance present. |
| Synthetic testing | Tests run with mocks/synthetic fixtures or local PostgreSQL without contacting real providers. | Executed in CI/local test runs as reported; not evidence of provider sandbox acceptance. |
| Real provider sandbox verification | Actual calls to provider sandbox/test endpoints using authorized sandbox credentials and provider-issued test identities. | Not executed. No sandbox credentials or provider-issued test identities were available. |
| Production readiness | Authorized production credentials, contracts, approvals, monitoring, runbooks, and release gates complete. | Not ready. Production execution remains disabled. |

## Evidence to record when authorized sandbox credentials are supplied

Record only: provider, environment, operation, timestamp, request/correlation ID, route/version identifiers, and provider outcome category. Do not record supplied identity numbers, returned identity attributes, secrets, raw provider responses, or customer PII.

Capture separate evidence for: consent capture, verified phone/identity preconditions, evidence persistence, current tier assessment, financial eligibility, activation/readiness outcome, and wallet idempotency. "Workforce activation" is not part of the customer wallet/KYC journey and must not be used as customer-journey evidence.

## Safety

- Never place secrets or identity numbers in source, tests, logs, issue/PR text, or shell history.
- Keep all provider flags off by default.
- Do not retry an `UNKNOWN` provider outcome as a fresh duplicate; unresolved attempts require safe reconciliation/review.
- Provider outages and malformed responses must remain `UNKNOWN`/fail-closed, not a mismatch or verified success.
- An authoritative `MATCH` alone does not directly grant a tier; the approved policy/assessment flow and eligibility/readiness gates apply.
- Do not perform real provider requests without authorized sandbox credentials and provider-issued test identities. Production execution remains disabled.
