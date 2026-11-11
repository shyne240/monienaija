# Batch 2C: partial activation/provisioning gate — not production ready

This increment is **not the completed Batch 2C financial-access boundary**. It must not be used as evidence that financial access is KYC-gated end to end.

## Implemented

`CustomerFinancialEligibilityService` locks a customer, reads the governed effective tier policy and trusted evidence adapter, rejects synthetic customers, holds and identity conflicts, checks a unique verified primary phone and a current unexpired approved assessment, and runs the existing tier evaluator. The approved level may not exceed the supported level. Activation and customer-wallet creation/reactivation call this gate. Canonical wallet provisioning calls it for IDs already known to be customers, in the wallet creation transaction. Existing onboarding and eligibility requirements for customer wallets remain in place. DRAFT records need no credentials.

No live trusted evidence adapter is configured: the production reader returns unavailable, so these new gates **deny activation and new wallet provisioning even for existing approved customers**. This is a significant behavior change; enabling this increment in a live environment requires coordinated rollout, an actual trusted adapter, policy/regulatory review and full end-to-end authorization coverage. Test-only evidence snapshots are not provider verification. The isolated tests override the reader only within the test module.

## Outstanding before Batch 2C can be considered complete

* Mobile claim/login still issues only restricted onboarding sessions. An eligible financial-session issuance path and session revalidation have not been implemented.
* Financial execution with an **existing wallet** does not yet universally recheck this eligibility gate. In particular, transfer, cash-in/out, and Cash-to-Cash execution retain their previous checks; withdrawal of KYC alone is not reliably enforced there. Do not rely on this increment to revoke financial privileges.
* The canonical wallet domain also accepts opaque system and agent owners. To preserve these, UUIDs not currently found in `customers` are not treated as customers. This is not a complete classification or bypass-proof customer-wallet boundary; explicit owner typing and a reviewed migration of existing internal/system callers are still needed.
* Production new-customer registration completion remains unavailable. Admin-assisted registration and internal binding/activation routes have not all been proven against a single end-to-end boundary. The gate does not replace account-policy, authorization, limit or risk controls.
* Concurrency and lock ordering across provider evidence updates, all financial execution paths and session issuance require an end-to-end review. The test adapter returns controlled snapshots rather than authenticated provider evidence and does not demonstrate production provenance or provider synchronization.
* Regulatory requirements, provider contract/provenance, evidence retention, role separation and deployment/legacy migration need independent review. No provider calls, notifications, real transactions, deployments or merges were performed.

## Verification

On a socket-only disposable PostgreSQL 16.14 cluster, the full AppModule tests exercised controlled Tier 1 and Tier 2 evidence, missing/synthetic/review evidence, approval expiry, holds, status suspension, activation, direct/customer wallet denial, concurrent canonical wallet uniqueness, and a credential-free customer. These fixtures manually supply approved assessments and a test-only reader; they do not establish a production KYC process. The same AppModule regression suite exercised restricted claimed-customer sessions. The new tests do not demonstrate financial-session issuance or financial-operation revocation.
