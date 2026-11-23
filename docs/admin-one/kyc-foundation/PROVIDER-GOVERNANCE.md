# KYC provider governance and Prembly integration

This remains a fail-closed identity-verification foundation, not authorization for live customer calls. Provider route selection, secrets, customer consent, evidence provenance, and release approval are separate controls. Migrations `1785753600109` (provider routing) and `1785753600507` (Prembly credential governance) have not been applied to a real environment as part of this work.

## Provider routing and customer flow

Provider routing is a maker/checker-governed, versioned configuration. MFA workforce authorization uses the existing functions: SUPER_ADMIN plus `kyc.provider.propose` proposes; an independent COMPLIANCE principal plus `kyc.provider.approve` approves or rejects; `kyc.provider.view` permits reads. The route table contains provider enablement, candidate capabilities, and primary/fallback routes only—never credentials. Route approval alone cannot make a provider dispatch-ready.

Provider codes are MONNIFY, DOJAH, PREMBLY, and test-only SYNTHETIC. PREMBLY supports the BVN and NIN identity capabilities only. Customers cannot choose the provider. Selection stays in the existing pre-dispatch governance/orchestration path; after a provider invocation or uncertain outcome, no fallback or automatic retry is attempted. Customer consent remains provider-, route-version-, and identity-revision-bound. A verified provider result is not by itself a tier, account-activation, wallet, or financial-eligibility decision.

## Prembly contract and credentials

The adapter is limited to the official BVN Basic and NIN Basic operations documented by Prembly:

- `POST https://api.prembly.com/verification/bvn_validation`
- `POST https://api.prembly.com/verification/vnin-basic`
- JSON request field: `number`
- Authentication header: `x-api-key` (Prembly server-side API/Secret Key)

References: [BVN Basic](https://docs.prembly.com/reference/bvn-basic), [NIN Basic](https://docs.prembly.com/reference/national-id-basic), and [Authentication](https://docs.prembly.com/docs/authentication). A separate `appToken` is not sent: the reviewed SDK example uses that token for Radar and does not establish BVN/NIN authentication. No arbitrary base URL, redirect, or request retry is allowed.

Prembly credentials are separate from route configuration and from notification/ownership keys. Admin Web writes sandbox and production keys through an MFA maker/checker flow. The application stores AES-256-GCM envelopes bound to provider, environment, and key version; status and proposal APIs return only a masked suffix, never the key or ciphertext. A versioned external keyring is required to encrypt/decrypt. Sandbox and production keys are never substituted for one another.

Customer dispatch remains closed unless all applicable gates pass:

- the approved provider route and capability;
- `KYC_PROVIDER_CONTRACTS_REVIEWED=true`;
- `KYC_PROVIDER_LIVE_CALLS_ENABLED=true` and `KYC_CUSTOMER_VERIFICATION_ENABLED=true`;
- a checker-approved credential for the matching environment;
- `PREMBLY_SANDBOX_CALLS_ENABLED=true` for non-production sandbox calls, or `PREMBLY_PRODUCTION_RELEASE_ENABLED=true` with `NODE_ENV=production` for production calls.

The optional Admin Web connection test is a distinct MFA-authorized action using Prembly's documented BVN test value `54651333604`. It makes a real sandbox BVN Basic request and may consume sandbox quota or provider usage; it is not a synthetic check or a free credential-validation endpoint. The test path has a per-actor rate limit and writes audit events. No connection test or other provider request was made during this implementation. No authorized Prembly NIN sandbox value has been confirmed, so do not use an unverified NIN sample.

## Data minimization and fail-closed outcomes

Only the existing consent-bound BVN/NIN orchestration invokes the adapter. The raw provider response is not persisted or returned; the adapter extracts the minimum identity fields needed for name/date-of-birth matching and rejects unexpected identifiers or response shapes. Provider failures and ambiguous outcomes remain `UNKNOWN` for safe review. Customer identifier input stays within the existing protected attempt/ownership handling and is not added to logs or API error messages.

The evidence readers accept PREMBLY only alongside their existing explicit provider allowlists and still require a successful non-synthetic attempt, matching live consent, route version and identity revision, an unexpired evidence window, and no identity conflict. The mobile account-claim path now explicitly accepts only MONNIFY and PREMBLY provider attempts; it continues to exclude synthetic evidence and does not call a provider itself.

## Remaining approval and verification gates

- Public API documentation does not prove account entitlement, contractual terms, pricing, commercial authorization, or production approval. These remain deployment/account-owner decisions.
- No dedicated safe credential-test endpoint was found. Do not probe credentials with a customer identity request, and do not use an NIN sample unless Prembly confirms the value is sandbox test data.
- No migration has been applied, and no production secrets, route decisions, or release flags have been supplied by this implementation.
- Synthetic results are test-only and cannot qualify as customer identity evidence. Address verification and enhanced due diligence remain candidate operation families with no Prembly adapter or active evidence workflow.
