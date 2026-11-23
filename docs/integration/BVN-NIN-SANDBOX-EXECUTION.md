# BVN/NIN sandbox execution and launch gates

This repository already implements the customer KYC journey: customer/onboarding-session authentication, verified-phone and identity-revision checks, explicit versioned consent, governed provider routing, durable request reservation, provider dispatch, evidence persistence, tier reevaluation, financial eligibility, activation readiness, and idempotent wallet provisioning. Customer Mobile submits BVN/NIN only after availability and consent checks and never stores identifiers persistently.

## Sandbox execution status

No sandbox credentials or provider-issued test identities were present in the execution environment, repository, `.env`, or connected credential files. Therefore no provider request was sent and no outcome is claimed. Synthetic/PostgreSQL tests are not provider sandbox results.

Dojah has an explicit sandbox host selected with `DOJAH_VERIFICATION_ENV=sandbox`. To perform an authorized BVN/NIN sandbox run, inject these values through the deployment secret manager (never a committed file or command-line argument):

- `DOJAH_VERIFICATION_ENABLED=true`
- `DOJAH_VERIFICATION_ENV=sandbox`
- `DOJAH_SECRET_KEY` (secret)
- `DOJAH_APP_ID`
- `KYC_PROVIDER_CONTRACTS_REVIEWED=true`
- `KYC_PROVIDER_LIVE_CALLS_ENABLED=true` (this code gate controls provider dispatch; use only in an isolated sandbox deployment)
- `KYC_CUSTOMER_VERIFICATION_ENABLED=true`, plus the approved `KYC_VERIFICATION_POLICY_JSON`, `KYC_CONSENT_NOTICE_VERSION`, `KYC_CONSENT_NOTICE_TEXT`, `KYC_CONSENT_VALIDITY_SECONDS`, `KYC_OWNERSHIP_KEY_BASE64` (at least 32 decoded bytes), and `KYC_OWNERSHIP_KEY_VERSION`

The governance database must also have a maker/checker-approved Dojah BVN/NIN route. Supply only provider-issued sandbox test identities through the approved secure test fixture/input path; never use live customer data or invent response fixtures and call them provider results.

Monnify configuration variables, if its account owner confirms an authorized test environment and contract, are `MONNIFY_VERIFICATION_ENABLED=true`, `MONNIFY_API_KEY`, and `MONNIFY_SECRET_KEY`. The Monnify adapter currently targets `api.monnify.com` without a sandbox/production host split. The existing Monnify integration note records that verification operations are live-only and that its NIN endpoint/contract requires confirmation. Do not send a Monnify verification request until Monnify confirms in writing that the specific credentials and endpoint are sandbox/test-only; production execution remains disabled.

## Safety

Never place secrets or identity numbers in source, tests, logs, issue/PR text, or shell history. Keep all provider flags off by default. Do not retry an `UNKNOWN` provider outcome: the durable attempt intentionally quarantines ambiguous dispatches. Provider outages and malformed responses remain `UNKNOWN`, not a mismatch. An authoritative `MATCH` alone does not directly grant a tier; the approved policy worker must assess evidence, after which the existing eligibility and activation gates apply.

## Evidence to record when authorized sandbox credentials are supplied

Record provider/environment, operation, timestamp, request correlation ID, and the provider outcome category only. Do not record the supplied identity number, returned identity attributes, secrets, or raw provider response. Capture the separate test evidence for consent, verified phone, evidence persistence, current tier assessment, financial eligibility, workforce activation, and wallet idempotency. Keep production execution disabled throughout.
