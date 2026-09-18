# B2T04 — B2 Merchant and Agent Onboarding Readiness Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T04 — Merchant and Agent Onboarding Readiness and Verification
- **Contract:** `B2MerchantAgentActivationReadinessContractV1` (`B2-MERCHANT-AGENT-ACTIVATION-READINESS` v1) — merchant `B2MerchantActivationReadinessDecisionV1` / agent `B2AgentActivationReadinessDecisionV1` / unified `B2MerchantAgentActivationReadinessDecisionV1` / `B2MerchantAgentActivationReadinessRequestV1` / `B2MerchantAgentActivationReadinessReplaySafeResultV1` / `B2MerchantAgentActivationReadinessCompatibilityResultV1` / `B2MerchantAgentActivationReadinessConsumerPortsV1`
- **ADR:** ADR-0075 — B2 Merchant and Agent Onboarding Readiness
- **Status:** Accepted (B2T04 implementation)
- **Review snapshot:** `b2t04` (B2T04 implementation commit; B2T03 + B2T02 + B2T01 + B1 evidence is committed; B1 phase result is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`); B2 cohort `b2.activation.cohort.inbound-funding` v1 frozen, merchant/agent cohorts `DRAFT`→`VERIFIED` only through B2T04)

This document defines the B2 merchant and agent onboarding-readiness attestation contract.

## 1. Purpose and boundary

The B2 merchant and agent onboarding-readiness attestation is the only B2-side merchant/agent readiness authority for the bounded first cohort `b2.activation.cohort.inbound-funding` v1 restricted to the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`. At B2T01 the merchant and agent cohorts were `Prohibited`; B2T04 registers them as `DRAFT`→`PENDING_VERIFICATION`→`VERIFIED`→`SUSPENDED`→`REVOKED` through privileged approval and never through public input.

The attestation verifies business identity (`registrationReference`/`taxIdentifierReference`/`settlementAccountReference` for merchants; `agentNetwork`/`terminalReference`/`collectionModeReference` for agents), beneficial-owner linkage (`Customer.id` trace), settlement eligibility, commercial eligibility, A4 policy eligibility, and required `CustomerConsent` for `B2_ACTIVATION`. It is deterministic, replay-safe, and read-only. It never activates a merchant or an agent, never creates a public API, never creates a credential, never dispatches a notification, never posts a ledger entry, never executes a settlement, and never mutates an A1–A7/B1 authority.

## 2. Contract identity

- **Contract name:** `B2-MERCHANT-AGENT-ACTIVATION-READINESS`
- **Contract version:** `1`
- **Contract document:** `docs/B2-MERCHANT-AGENT-ONBOARDING-CONTRACT.md`
- **Cohort key/version:** `b2.activation.cohort.inbound-funding` 1 (frozen; see `docs/B2-ACTIVATION-BASELINE.md` §4 and `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md` §4)
- **B1 scope:** `commercial.virtual-account.inbound-funding` 1 (frozen; see `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`)
- **A7 product:** `VIRTUAL_ACCOUNT` 1, **A6 partner:** `NIBSS_NIP`, **Currency/Accounting/Region:** `NGN`/`CUSTOMER_FUNDS`/`NG`
- **Idempotency scopes:** `b2.merchant-activation-readiness.idempotency.v1` (merchant) and `b2.agent-activation-readiness.idempotency.v1` (agent) with `86400s` retention
- **Audit entity types:** `b2_merchant_activation_readiness` and `b2_agent_activation_readiness` with actor `b2-merchant-agent-activation-readiness`
- **Outbox event types:** `b2.merchant-activation-readiness.decided.v1` and `b2.agent-activation-readiness.decided.v1` (`INTERNAL`, `OPERATIONS_DEFAULT`)

## 3. Verification states and attestation vocabularies

- `verificationState`: `DRAFT` | `PENDING_VERIFICATION` | `VERIFIED` | `SUSPENDED` | `REVOKED` — the business-identity-derived state. `DRAFT` is the initial row before verification; `PENDING_VERIFICATION` requires a registration/tax/settlement reference to be pending privileged approval; `VERIFIED` requires all business-identity/beneficial-owner/settlement/commercial/A4 signals to be passing.

- `activationEligibility`: `ELIGIBLE` | `INELIGIBLE` | `REQUIRES_CONSENT` — the cohort-scoped eligibility. `ELIGIBLE` requires all business/beneficial-owner/settlement/commercial/A4 to be passing plus `CustomerConsent` `GRANTED`; `REQUIRES_CONSENT` is the sole `CUSTOMER_CONSENT` failure with all else `PASS`.

- `outcome`: `ATTESTED_READY` | `ATTESTED_NOT_READY` | `ATTESTED_REQUIRES_CONSENT` | `REJECTED` — the contract outcome. `ATTESTED_READY` is the only outcome that permits the B2T05 workflow to consider the merchant/agent activation-ready.

The rule-kind vocabulary is `BUSINESS_IDENTITY_VERIFICATION`, `BENEFICIAL_OWNER_LINKAGE`, `SETTLEMENT_ELIGIBILITY`, `COMMERCIAL_ELIGIBILITY`, `A4_POLICY_ELIGIBILITY`, `CUSTOMER_CONSENT`, `MERCHANT_IDENTITY`, `AGENT_IDENTITY`; each step carries `PASS`/`FAIL`/`SKIP`/`NOT_APPLICABLE` and a `B2MerchantAgentActivationReadinessFailureCode` where `FAIL`.

## 4. Request, decision, and persistence

### 4.1 Attestation requests

- `B2MerchantActivationReadinessRequestV1` (`kind: MERCHANT`) carries `merchantId`, `beneficialOwnerCustomerId`, `businessType`, `registrationReference`, `taxIdentifierReference`, `settlementAccountReference`, the six input states (`businessIdentityState`, `beneficialOwnerState`, `settlementEligibilityState`, `commercialEligibilityState`, `a4EligibilityState`, `consentState`), the cohort/B1 identity (`b2.activation.cohort.inbound-funding` 1, `commercial.virtual-account.inbound-funding` 1, `VIRTUAL_ACCOUNT` 1, `NGN`/`CUSTOMER_FUNDS`/`NG`), and `idempotencyKey`.

- `B2AgentActivationReadinessRequestV1` (`kind: AGENT`) carries `agentId`, `supervisingMerchantId`, `supervisingCustomerId`, `agentNetwork`, `terminalReference`, `collectionModeReference`, the same six input states, the same cohort/B1 identity, and `idempotencyKey`.

Both requests share the same cohort/B1 currency/region and are discriminated by `kind`. The `beneficialOwnerCustomerId`/`supervisingCustomerId` is the trace to `Customer.id` and never a second canonical identity.

### 4.2 Attestation decisions

`B2MerchantAgentActivationReadinessDecisionV1` carries the derived `attestationReference` (`b2-merchant-readiness-<uuid>` or `b2-agent-readiness-<uuid>`), `attestationVersion` 1, `kind` (`MERCHANT`|`AGENT`), `principalId` (`merchantId`|`agentId`), `beneficialOwnerCustomerId`, the cohort/B1 currency/region echo, the derived `verificationState`/`activationEligibility`/`activationReady`/`outcome`, `activationReadyAt` (ISO-8601 when `activationReady` true, otherwise null), `ruleTrace` of eight steps, `requestHash`, `decisionHash`, `decisionReplayHash`, `idempotencyScope` (per-kind), `idempotencyKey`, `correlationId`/`causationId`, `createdAt`, and `contractName`/`contractVersion`.

### 4.3 Persistence

Merchant attestations are persisted in `b2_merchant_activation_readiness` and agent attestations in `b2_agent_activation_readiness` (migration `1785753600040`). Each table is the only persistence surface for its kind, with unique `attestationReference,attestationVersion` and indexes on `principalId` (`merchant_id`/`agent_id`), beneficial-owner `customer_id`, `cohort`, `requestHash`, `idempotencyScope+key`, and `correlationId`. The `record` column stores the full decision JSONB. No table holds a second `Customer` table; neither infers an A3 binding.

## 5. Attestation rules

The attestation evaluates up to eight rules in the frozen order:

1. `BUSINESS_IDENTITY_VERIFICATION` — `businessIdentityState` must be `VERIFIED`; `PENDING` yields `PENDING_VERIFICATION` where it is the sole failure, `UNVERIFIED` yields `FAIL`.
2. `BENEFICIAL_OWNER_LINKAGE` — `beneficialOwnerState` must be `VERIFIED` (beneficial-owner `Customer.id` must be KYC `VERIFIED` and A3 `VERIFIED` upstream); otherwise `B2_MERCHANT_AGENT_READINESS_BENEFICIAL_OWNER_NOT_VERIFIED`.
3. `SETTLEMENT_ELIGIBILITY` — `settlementEligibilityState` must be `ELIGIBLE` (A3 settlement-account binding `VERIFIED` for `NGN`/`CUSTOMER_FUNDS`); otherwise `B2_MERCHANT_AGENT_READINESS_SETTLEMENT_NOT_ELIGIBLE`.
4. `COMMERCIAL_ELIGIBILITY` — `commercialEligibilityState` must be `ELIGIBLE` (B1 tier/entitlement compatible for the cohort); otherwise `B2_MERCHANT_AGENT_READINESS_COMMERCIAL_NOT_ELIGIBLE`.
5. `A4_POLICY_ELIGIBILITY` — `a4EligibilityState` must be `ELIGIBLE`; otherwise `B2_MERCHANT_AGENT_READINESS_A4_NOT_ELIGIBLE`.
6. `CUSTOMER_CONSENT` — `consentState` must be `GRANTED` for `B2_ACTIVATION`; `NOT_GRANTED`/`REVOKED` yields the consent failure; where only this rule fails the outcome is `ATTESTED_REQUIRES_CONSENT` with `REQUIRES_CONSENT`.
7. `MERCHANT_IDENTITY` (`AGENT_IDENTITY`) — `merchantId`/`agentId` must be uuid; otherwise the invalid-command failure. The peer identity kind is `NOT_APPLICABLE`.

Derivation matches the customer attestation pattern but with `DRAFT` initial and `PENDING_VERIFICATION` polling:

- all `PASS` → `VERIFIED`/`ELIGIBLE`/`ATTESTED_READY` with `activationReady` true and `activationReadyAt` populated;
- only `CUSTOMER_CONSENT` `FAIL` → `VERIFIED`/`REQUIRES_CONSENT`/`ATTESTED_REQUIRES_CONSENT`;
- only `BUSINESS_IDENTITY_VERIFICATION` `FAIL` with `PENDING` → `PENDING_VERIFICATION`/`INELIGIBLE`/`ATTESTED_NOT_READY`;
- otherwise → `DRAFT`/`INELIGIBLE`/`ATTESTED_NOT_READY`.

Compatibility of the frozen cohort (`b2.activation.cohort.inbound-funding` 1, `commercial.virtual-account.inbound-funding` 1, `NGN`/`CUSTOMER_FUNDS`/`NG`) is checked before rule evaluation; a mismatch is `REJECTED` with `B2_MERCHANT_AGENT_READINESS_INCOMPATIBLE`.

## 6. Idempotency, replay, and read-only consumer ports

### 6.1 Idempotency

Merchant attestations use `b2.merchant-activation-readiness.idempotency.v1` and agent attestations use `b2.agent-activation-readiness.idempotency.v1`, each `86400s` via the shared `IdempotencyService` (only idempotency authority). The attestation never stores `clientSecret`, webhook `secret`, PAN, account secret, PIN, OTP, callback signature, or private key.

### 6.2 Replay safety

`replaySafeGenerateAttestationDecision(request, existingByKey)` is replay-safe per-kind scope: same `idempotencyKey` + same cohort + same `b1ScopeKey` + same `requestHash` within the window replays the original `attestationReference` with `replayed:true`; same key + same cohort + different `requestHash` is `409` `B2_MERCHANT_AGENT_READINESS_REPLAY_CONFLICT` with `conflict:true`. The replay payload excludes the random `attestationReference`/`createdAt`.

### 6.3 Read-only consumer ports

The contract exposes `B2MerchantAgentActivationReadinessConsumerPortsV1` (`contractName` `B2-MERCHANT-AGENT-ACTIVATION-READINESS`, both merchant/agent `idempotencyScope` values, `cohortKey` `b2.activation.cohort.inbound-funding` 1) and `generateAttestationDecision`, `replaySafeGenerateAttestationDecision`, `compatibilityCheck`, `computeRequestHash` ports per-kind read-only to B2T05. The ports reuse `Customer.id` (canonical), merchant/agent `supervisingCustomerId`/`beneficialOwnerCustomerId` traces, A3 binding (only binding), A4 policy (only policy), `CustomerConsent` (only activation intent), and B1 catalog (only commercial) through read-only boundaries.

## 7. Compatibility and bounded scope

The attestation is bounded to the first activation cohort `b2.activation.cohort.inbound-funding` v1 for the first B1 scope. It does not expose a public API, a credential, a sandbox, a webhook, a second B1 scope, a second partner beyond `NIBSS_NIP`, a second currency, a second accounting unit, a second region beyond `NG`, a second webhook event, or a second public surface. Each additional cohort, product, scope, region, currency, or partner requires a separate reviewed capability and a separate B2 ADR. At B2T01 the merchant/agent cohorts were `Prohibited`; B2T04 makes them `DRAFT`→`VERIFIED` only through privileged approval (the attestation verifies the evidence reference; it does not call a live corporate registry).

## 8. Verification

- [x] The contract is frozen as `B2-MERCHANT-AGENT-ACTIVATION-READINESS` v1 with explicit merchant `B2MerchantActivationReadinessRequestV1`/`DecisionV1`/`ReplaySafeResultV1` and agent `B2AgentActivationReadinessRequestV1`/`DecisionV1` and unified `B2MerchantAgentActivationReadinessDecisionV1` types.
- [x] The cohort `b2.activation.cohort.inbound-funding` v1, B1 scope `commercial.virtual-account.inbound-funding` v1, `VIRTUAL_ACCOUNT` v1, `NIBSS_NIP`, `NGN`/`CUSTOMER_FUNDS`/`NG` are frozen per-kind.
- [x] The attestation verifies business identity, beneficial-owner linkage, settlement eligibility, commercial eligibility, A4 eligibility, and `CustomerConsent` with eight `PASS`/`FAIL` steps and derives `verificationState`, `activationEligibility`, `activationReady`, and `outcome` deterministically per §5.
- [x] The attestation is replay-safe per-kind scope (`86400s`, `decisionReplayHash` excludes `attestationReference`/`createdAt`, same-key/same-hash replays, same-key/different-hash conflicts).
- [x] The contract exposes only read-only consumer ports to B2T05 and reuses `Customer.id`, `Merchant.id`/`Agent.id` (distinct cohort identities with traces), `CustomerConsent`, A3/A4/B1 through read-only boundaries; it never activates a merchant/agent, never creates a public API, never creates a credential, never dispatches a notification, never posts a ledger entry, never executes a settlement, and never mutates an A1–A7/B1 authority.
- [x] The persistence `b2_merchant_activation_readiness` and `b2_agent_activation_readiness` with unique `attestationReference,attestationVersion` and indexes on `principalId`, beneficial-owner `customer_id`, `cohort`, `requestHash`, `idempotencyScope+key`, `correlationId` are the only B2 merchant/agent persistence surfaces; no table holds a second `Customer` table and neither infers an A3 binding.
- [x] No raw `clientSecret`, webhook `secret`, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, or unnecessary customer data are stored in broad records, logs, traces, events, or notification payloads.
- [x] No ADR beyond ADR-0075 is authored by this task; B2T02 ADRs ADR-0072/ADR-0073 and B2T03 ADR-0074 remain the first B2 ADRs and are not renumbered.

### Evidence limitations

- B2T04 is a read-only attestation. It does not call a live corporate registry, a live tax registry, a live bank settlement, or a live onboarding partner.
- B2T04 does not create a public API, a credential, a webhook, a sandbox, an activation workflow, or a settlement rail; those remain B2T05/B2T08/B2T09.
- B2T04 does not activate a merchant or an agent; B2T05 owns the workflow that consumes the two attestations, and A2 privileged-action is the only approval for `VERIFIED`→`ACTIVE` activation.
