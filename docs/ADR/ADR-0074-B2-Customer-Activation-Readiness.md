# ADR-0074 — B2 Customer Activation Readiness

- **ADR ID:** ADR-0074
- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T03 — Customer Activation Readiness and Onboarding Attestation
- **Status:** Accepted (B2T03 implementation)
- **Review snapshot:** `b2t03` (B2T03 implementation commit; A1–A7 + B1 + B2T01 + B2T02 evidence is committed; B1 phase result is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`); B2 phase result is `Planned`, cohort `b2.activation.cohort.inbound-funding` v1 frozen)
- **Scope:** B2 customer activation-readiness attestation for the bounded first activation cohort `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first commercial scope `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`; verification of KYC, A3 binding, A4 policy eligibility/currentness, A7 product compatibility, B1 tier/entitlement compatibility, and CustomerConsent; deterministic replay-safe attestation, read-only consumer ports
- **Authoritative boundary:** `B2CustomerActivationReadinessContractV1` per `docs/B2-CUSTOMER-ONBOARDING-CONTRACT.md`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, webhook, credential, secret, ledger, commercial, public-channel, and B2 activation changes beyond the B2T03 scope:** None (B2T03 is the only B2 customer activation-readiness authority; it never activates a customer)

This ADR is the decision record for the B2T03 customer activation-readiness attestation. It records the read-only attestation, the cohort freeze, the verification rule kinds, the compatibility rules, the ownership boundaries, the consumer contracts, the idempotency scope, the replay expectations, and the integration boundaries. It introduces no public API, no activation engine, no credential issuance, no webhook delivery, and no ledger posting.

## 1. Context

B2T01 selected the first bounded activation cohort `b2.activation.cohort.inbound-funding` v1 (inbound funding of the frozen B1 inbound-funding commercial capability) without fixing production rollout percent. B2T02 froze the B2 public API catalog `B2-PUBLIC-API-CATALOG` v1 (`/v1/commercial/activations` `POST` idempotent in scope `b2:commercial:activations:create`, `GET /commercial/catalog|plans|tiers` minimized reads) and the route-exposure contract with `v1` + `Accept: application/vnd.monienaija.v1+json` negotiation.

B2T03 must provide the customer activation-readiness attestation that later B2 tasks (B2T05 activation workflows) consume read-only. The attestation must verify KYC, A3 binding, A4 eligibility/currentness, A7 compatibility, B1 tier/entitlement, and `CustomerConsent` (`B2_ACTIVATION`) without creating a second `Customer` authority, a second binding, a second policy evaluator, a second ledger posting path, or a second consent vault.

## 2. Decision

### 2.1 Attestation

B2T03 freezes `B2-CUSTOMER-ACTIVATION-READINESS` v1 with a deterministic attestation `B2CustomerActivationReadinessDecisionV1` that carries `attestationReference` (`b2-activation-readiness-<uuid>`), `verificationState` (`UNVERIFIED`|`PENDING`|`VERIFIED`|`SUSPENDED`|`BLOCKED`), `activationEligibility` (`ELIGIBLE`|`INELIGIBLE`|`REQUIRES_CONSENT`), `activationReady` boolean, `outcome` (`ATTESTED_READY`|`ATTESTED_NOT_READY`|`ATTESTED_REQUIRES_CONSENT`|`REJECTED`), and `ruleTrace` of nine rule kinds.

The attestation is emitted only when all of the following hold: KYC `VERIFIED`, A3 binding `VERIFIED`, A4 `ELIGIBLE` + `CURRENT`, A7 `COMPATIBLE`, B1 tier `COMPATIBLE`, B1 entitlement `COMPATIBLE`, and `CustomerConsent` `GRANTED` for `B2_ACTIVATION`. Otherwise the attestation is `ATTESTED_NOT_READY` (with `UNVERIFIED` or `PENDING` where KYC is `PENDING`) or `ATTESTED_REQUIRES_CONSENT` where consent alone is missing.

### 2.2 Determinism and replay safety

The request hash is `sha256(stableJson(cohortKey, cohortVersion, b1ScopeKey, b1ScopeVersion, a7ProductKey, a7ProductVersion, currency, accountingUnit, region, consentPurpose, KYC, A3, A4 eligibility/currentness, A7, B1 tier/entitlement, customerConsentState, idempotencyKey, customerId))` and excludes `attestationReference` and `createdAt`. The decision hash and decisionReplayHash are computed from the request hash plus the deterministic outcome. Same `Idempotency-Key` + same scope + same cohort + same body hash within `86400s` replays the original decision; same key with different hash is `409` `B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_CONFLICT`.

### 2.3 Read-only consumer surface

The attestation exposes `getConsumerPorts(): B2CustomerActivationReadinessConsumerPortsV1` with `contractName` `B2-CUSTOMER-ACTIVATION-READINESS`, `contractVersion` 1, `idempotencyScope` `b2.customer-activation-readiness.idempotency.v1`, `cohortKey` `b2.activation.cohort.inbound-funding`. It reuses A1 `Customer.id` (only canonical identity), A3 binding (only binding authority), A4 policy (only policy authority), A7 `VIRTUAL_ACCOUNT` v1 (only product authority), B1 catalog (only commercial-decision authority), `CustomerPreference` (only delivery intent), and `CustomerConsent` (only activation intent where required) through read-only consumer boundaries; it never writes any A1–A7/B1 authority.

### 2.4 Persistence

The attestation is persisted in `b2_customer_activation_readiness` (migration `1785753600039`) with indexes on `customer_id`, `cohort`, `requestHash`, `decisionHash`, `idempotencyScope+key`, and `correlationId`. The table is the only B2 customer activation-readiness persistence surface.

## 3. Consequences

- B2T05 activation workflows have exactly one read-only source for customer activation-readiness and do not re-derive KYC/A3/A4/A7/B1/consent.
- No second writable `Customer` table is introduced; the attestation table is a projection keyed by `Customer.id`.
- No activation, credential, webhook, or notification is dispatched by this decision; activation remains the B2T05 workflow's responsibility.
- The decision is idempotent, replay-safe, and fixture-testable without a live onboarding partner call.

## 4. Alternatives considered

- **Inline KYC/A3/A4 checks in the activation workflow:** Rejected — would duplicate verification logic per route and weaken A1–A4 ownership.
- **A new writable Customer table for readiness:** Rejected — would create a second canonical identity and duplicate `Customer` authority.
- **Immediate activation on readiness emission:** Rejected — would collapse the read-only attestation into a stateful activation engine, violating the B2T03 non-goal.
