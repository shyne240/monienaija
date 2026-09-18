# ADR-0075 — B2 Merchant and Agent Onboarding Readiness

- **ADR ID:** ADR-0075
- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T04 — Merchant and Agent Onboarding Readiness and Verification
- **Status:** Accepted (B2T04 implementation)
- **Review snapshot:** `b2t04` (B2T04 implementation commit; B2T03 + B2T02 + B2T01 + B1 evidence committed; B1 phase result is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`); B2 cohort `b2.activation.cohort.inbound-funding` v1 frozen)
- **Scope:** B2 merchant and agent onboarding-readiness attestations for the bounded first activation cohort `b2.activation.cohort.inbound-funding` v1 restricted to `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`; verification of business identity, beneficial-owner linkage, settlement eligibility, commercial eligibility, A4 policy eligibility, and required consents; deterministic replay-safe attestations with separate idempotency scopes for merchant and agent; read-only consumer ports
- **Authoritative boundary:** `B2MerchantAgentActivationReadinessContractV1` per `docs/B2-MERCHANT-AGENT-ONBOARDING-CONTRACT.md`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, webhook, credential, secret, ledger, settlement, commercial, public-channel, and B2 activation changes beyond the B2T04 scope:** None (B2T04 never activates a merchant or an agent)

This ADR records the merchant/agent readiness attestation for activation without a second Customer table, a second binding, or a second policy evaluator.

## 1. Context

B2T01 selected the single `b2.activation.cohort.inbound-funding` v1 cohort (customer `VERIFIED` segment; merchant/agent cohorts `Prohibited` at T01). B2T02 froze the `B2-PUBLIC-API-CATALOG` v1 with `POST /v1/commercial/activations` isolated by audience `public:commercial:activation:b2:inbound-funding:write`. B2T03 implemented the customer readiness attestation (`UNVERIFIED`→`VERIFIED`, `A3`+`A4`+`B1`+`CustomerConsent`).

B2T04 must provide the sibling attestations for merchant and agent. A merchant is `merchantProfile` + `registrationReference` + `taxIdentifierReference` + `settlementAccountReference` with a beneficial-owner `Customer.id` trace; an agent is `agentProfile` + `terminalReference` with a supervising `Merchant.id` + `Customer.id` trace. Neither may be inferred from public input, and neither may create a second `Customer` table or become an A3 binding, an A4 policy decision, a ledger entry, or a settlement.

## 2. Decision

### 2.1 Two attestations, two idempotency scopes

B2T04 freezes `B2-MERCHANT-AGENT-ACTIVATION-READINESS` v1 with two deterministic attestation kinds:

- `MERCHANT` in scope `b2.merchant-activation-readiness.idempotency.v1` with reference prefix `b2-merchant-readiness-`;
- `AGENT` in scope `b2.agent-activation-readiness.idempotency.v1` with reference prefix `b2-agent-readiness-`.

Each attestation carries `verificationState` `DRAFT`|`PENDING_VERIFICATION`|`VERIFIED`|`SUSPENDED`|`REVOKED`, `activationEligibility` `ELIGIBLE`|`INELIGIBLE`|`REQUIRES_CONSENT`, and `outcome` `ATTESTED_READY`|`ATTESTED_NOT_READY`|`ATTESTED_REQUIRES_CONSENT`|`REJECTED`. `VERIFIED`→`ELIGIBLE`→`ATTESTED_READY` requires business identity `VERIFIED`, beneficial-owner `VERIFIED`, settlement `ELIGIBLE`, commercial `ELIGIBLE`, A4 `ELIGIBLE`, and `CustomerConsent` `GRANTED`; only a sole `CUSTOMER_CONSENT` fail maps to `REQUIRES_CONSENT`.

### 2.2 Determinism and replay

Request hash is `sha256(stableJson(kind, cohortKey, cohortVersion, b1ScopeKey, b1ScopeVersion, currency, accountingUnit, region, businessIdentityState, beneficialOwnerState, settlementEligibilityState, commercialEligibilityState, a4EligibilityState, consentState, idempotencyKey, principalId...))` excluding the random `attestationReference`/`createdAt`. Decision hash/replayHash follow the B1/B2T03 pattern keyed per-kind scope; same `Idempotency-Key`+same scope+same cohort+same hash within `86400s` replays; same key+same scope+different hash is `409` `B2_MERCHANT_AGENT_READINESS_REPLAY_CONFLICT`.

### 2.3 Separate persistence, single beneficial-owner invariant

Persistence is two tables (`b2_merchant_activation_readiness`, `b2_agent_activation_readiness`), each the only surface for its kind, each with unique `attestationReference,attestationVersion`, indexes on `principalId` (`merchant_id`/`agent_id`), beneficial-owner `customer_id`, cohort, `requestHash`, `idempotencyScope+key`, and `correlationId`. Neither table duplicates `Customer`; both hold a FK-traceable `beneficialOwnerCustomerId` / `supervisingCustomerId` and never infer an A3 binding.

### 2.4 Read-only surface

The module exposes `getConsumerPorts()` with both merchant and agent scopes and `generateAttestationDecision` / `replaySafeGenerateAttestationDecision` / `compatibilityCheck` / `computeRequestHash` ports read-only to B2T05. It reuses A1 `Customer.id` (canonical), A2 privileged-action (only approval), A3 binding (only binding), A4 policy (only policy), `CustomerConsent` (only activation intent), and shared `IdempotencyService`/`AuditService`/`OutboxService`/`MetricsService` without mutation.

## 3. Consequences

- B2T05 has exactly one read-only source for merchant readiness and one for agent readiness, each with its own idempotency scope, without re-deriving business identity, beneficial-owner linkage, settlement eligibility, or A4 policy.
- No second writable `Customer` table is created; merchant/agent tables are distinct cohort identities with explicit traces.
- No merchant/agent activation, credential, webhook, notification, ledger entry, or settlement is dispatched; activation remains B2T05's workflow.
- The attestations are idempotent, replay-safe, approval-gated (`VERIFIED` must come through privileged approval), and fixture-testable.

## 4. Alternatives considered

- **Single table with kind discriminator:** Rejected — weaker cohort FK invariants and cross-kind idempotency collisions.
- **Unified customer/merchant/agent table:** Rejected — collapses the A1 canonical identity and creates a second `Customer` authority.
- **Immediate merchant/agent activation on readiness:** Rejected — conflates the read-only attestation into a stateful activation engine, violating B2T04's non-goal.
