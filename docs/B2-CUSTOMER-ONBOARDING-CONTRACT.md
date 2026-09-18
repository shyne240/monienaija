# B2T03 — B2 Customer Activation Readiness and Onboarding Attestation Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T03 — Customer Activation Readiness and Onboarding Attestation
- **Contract:** `B2CustomerActivationReadinessContractV1` (`B2-CUSTOMER-ACTIVATION-READINESS` v1) — read-only attestation `B2CustomerActivationReadinessDecisionV1` / `B2CustomerActivationReadinessRequestV1` / `B2CustomerActivationReadinessReplaySafeResultV1` / `B2CustomerActivationReadinessCompatibilityResultV1` / `B2CustomerActivationReadinessConsumerPortsV1` / `B2CustomerActivationReadinessPersistenceRecordV1`
- **ADR:** ADR-0074 — B2 Customer Activation Readiness
- **Status:** Accepted (B2T03 implementation)
- **Review snapshot:** `b2t03` (B2T03 implementation commit; A1–A7 + B1 + B2T01 + B2T02 evidence is committed; B1 phase result is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`); B2 phase result is `Prepared` for the cohort `b2.activation.cohort.inbound-funding` v1)

This document defines the B2 customer activation-readiness attestation contract that verifies customer eligibility for activation without activating a customer.

## 1. Purpose and boundary

The B2 customer activation-readiness attestation is the only B2-side customer activation-readiness authority for the bounded first activation cohort `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`. It is a deterministic calculator that verifies KYC, A3 binding, A4 policy eligibility/currentness, A7 product compatibility, B1 commercial tier/entitlement compatibility, and `CustomerConsent` (`B2_ACTIVATION`) and emits an attestation that the B2T05 activation workflows consume read-only.

The B2 customer activation-readiness attestation is a read-only service; it never activates a customer, never creates a public API, never creates a credential, never dispatches a notification, never mutates an A1–A7/B1 authority, never posts a ledger entry, and never performs commercial execution.

## 2. Contract identity

- **Contract name:** `B2-CUSTOMER-ACTIVATION-READINESS`
- **Contract version:** `1`
- **Contract document:** `docs/B2-CUSTOMER-ONBOARDING-CONTRACT.md`
- **Cohort key:** `b2.activation.cohort.inbound-funding` v1 (frozen; see `docs/B2-ACTIVATION-BASELINE.md` §4 and `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md` §4)
- **B1 scope reference:** `commercial.virtual-account.inbound-funding` v1 (frozen; see `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`)
- **A7 product reference:** `VIRTUAL_ACCOUNT` v1
- **A6 partner reference:** `NIBSS_NIP` (planning rail)
- **Currency / accounting unit / region:** `NGN` / `CUSTOMER_FUNDS` / `NG`
- **Idempotency scope:** `b2.customer-activation-readiness.idempotency.v1` with `86400s` retention
- **Audit entity type / actor:** `b2_customer_activation_readiness` / `b2-customer-activation-readiness`
- **Outbox event type:** `b2.customer-activation-readiness.decided.v1` (`INTERNAL`, `OPERATIONS_DEFAULT` retention)

## 3. Verification states and attestation vocabularies

The B2 customer activation-readiness attestation carries three vocabularies:

- `verificationState`: `UNVERIFIED` | `PENDING` | `VERIFIED` | `SUSPENDED` | `BLOCKED` — the KYC/A3-derived verification state. `VERIFIED` requires KYC `VERIFIED` + A3 binding `VERIFIED` before any other rule is `PASS`. `PENDING` is emitted only where KYC is `PENDING` and no other rule outside consent has failed.

- `activationEligibility`: `ELIGIBLE` | `INELIGIBLE` | `REQUIRES_CONSENT` — the cohort-scoped eligibility for the frozen cohort. `ELIGIBLE` requires all nine rule kinds to be `PASS`; `REQUIRES_CONSENT` is `VERIFIED` + every rule `PASS` except `CUSTOMER_CONSENT` (`NOT_GRANTED`).

- `outcome`: `ATTESTED_READY` | `ATTESTED_NOT_READY` | `ATTESTED_REQUIRES_CONSENT` | `REJECTED` — the contract outcome for the attestation. `ATTESTED_READY` is the only outcome that permits the B2T05 workflow to consider the customer activation-ready. `REJECTED` is emitted only for `INCOMPATIBLE` cohort/currency/region/b1Scope inputs before rule evaluation; otherwise a failing rule yields `ATTESTED_NOT_READY` or `ATTESTED_REQUIRES_CONSENT`.

The rule-kind vocabulary is `A3_BINDING_RECHECK`, `A4_POLICY_ELIGIBILITY`, `A4_POLICY_CURRENTNESS`, `A7_PRODUCT_COMPATIBILITY`, `B1_TIER_COMPATIBILITY`, `B1_ENTITLEMENT_COMPATIBILITY`, `CUSTOMER_CONSENT`, `KYC_VERIFICATION`, `CUSTOMER_IDENTITY`; each step carries `PASS` | `FAIL` | `SKIP` | `NOT_APPLICABLE` and a `B2CustomerActivationReadinessFailureCode` where `FAIL`.

## 4. Request, decision, and persistence

### 4.1 Attestation request

`B2CustomerActivationReadinessRequestV1` carries the cohort identity (`b2.activation.cohort.inbound-funding` 1, `commercial.virtual-account.inbound-funding` 1, `VIRTUAL_ACCOUNT` 1, `NGN`/`CUSTOMER_FUNDS`/`NG`, `B2_ACTIVATION`), the principal identity (`customerId` uuid), the nine input states (`kycVerificationState`, `a3BindingState`, `a4EligibilityState`, `a4CurrentnessState`, `a7CompatibilityState`, `b1TierState`, `b1EntitlementState`, `customerConsentState`), the `idempotencyKey` uuid, and the `requestContext`/`causationId`.

### 4.2 Attestation decision

`B2CustomerActivationReadinessDecisionV1` carries the derived attestation reference `b2-activation-readiness-<uuid>`, the cohort/B1 currency/region echo, the derived `verificationState`/`activationEligibility`/`activationReady`/`outcome`, `activationReadyAt` (ISO-8601 when `activationReady` is true, otherwise null), `ruleTrace` of nine steps, `requestHash` (`sha256(stableJson(payload))` of the frozen payload excluding `attestationReference`/`createdAt`), `decisionHash` (outcome+ruleTrace), `decisionReplayHash` (replay scope excluding `attestationReference`/`createdAt`), `idempotencyScope`/`idempotencyKey`, `correlationId`/`causationId`, `createdAt`, and `contractName`/`contractVersion`.

### 4.3 Persistence

The attestation is persisted in `b2_customer_activation_readiness` (migration `1785753600039`) with unique `attestationReference,attestationVersion`, indexed `customer_id`, `cohort`, `requestHash`, `decisionHash`, `idempotencyScope+key`, and `correlationId`. The `record` column stores the full `B2CustomerActivationReadinessDecisionV1` JSONB. The table is the only B2 customer activation-readiness persistence surface.

## 5. Attestation rules

The B2 customer activation-readiness attestation evaluates nine rules in the frozen order:

1. `CUSTOMER_IDENTITY` — `customerId` must be uuid; otherwise `B2_CUSTOMER_ACTIVATION_READINESS_INVALID_COMMAND`.
2. `KYC_VERIFICATION` — `kycVerificationState` must be `VERIFIED`; `PENDING` yields `FAIL` with `B2_CUSTOMER_ACTIVATION_READINESS_KYC_NOT_VERIFIED` and `verificationState` `PENDING` where only this rule fails.
3. `A3_BINDING_RECHECK` — `a3BindingState` must be `VERIFIED`; otherwise `B2_CUSTOMER_ACTIVATION_READINESS_A3_BINDING_INVALID`.
4. `A4_POLICY_ELIGIBILITY` — `a4EligibilityState` must be `ELIGIBLE` and `a4CurrentnessState` must be `CURRENT`; otherwise `B2_CUSTOMER_ACTIVATION_READINESS_A4_NOT_ELIGIBLE`.
5. `A4_POLICY_CURRENTNESS` — `a4CurrentnessState` must be `CURRENT`; otherwise the same failure code.
6. `A7_PRODUCT_COMPATIBILITY` — `a7CompatibilityState` must be `COMPATIBLE`; otherwise `B2_CUSTOMER_ACTIVATION_READINESS_A7_INCOMPATIBLE`.
7. `B1_TIER_COMPATIBILITY` — `b1TierState` must be `COMPATIBLE`; otherwise `B2_CUSTOMER_ACTIVATION_READINESS_B1_TIER_INELIGIBLE`.
8. `B1_ENTITLEMENT_COMPATIBILITY` — `b1EntitlementState` must be `COMPATIBLE`; otherwise `B2_CUSTOMER_ACTIVATION_READINESS_B1_ENTITLEMENT_INELIGIBLE`.
9. `CUSTOMER_CONSENT` — `customerConsentState` must be `GRANTED` for purpose `B2_ACTIVATION`; `NOT_GRANTED` or `REVOKED` yields `FAIL` with `B2_CUSTOMER_ACTIVATION_READINESS_CONSENT_NOT_GRANTED`; where only this rule fails the outcome is `ATTESTED_REQUIRES_CONSENT` with `activationEligibility` `REQUIRES_CONSENT`.

The attestation derivation is:

- all nine `PASS` → `VERIFIED` / `ELIGIBLE` / `ATTESTED_READY` with `activationReady` true and `activationReadyAt` populated;
- only `CUSTOMER_CONSENT` `FAIL` → `VERIFIED` / `REQUIRES_CONSENT` / `ATTESTED_REQUIRES_CONSENT` with `activationReady` false;
- only `KYC_VERIFICATION` `FAIL` with `PENDING` → `PENDING` / `INELIGIBLE` / `ATTESTED_NOT_READY`;
- any other `FAIL` → `UNVERIFIED` / `INELIGIBLE` / `ATTESTED_NOT_READY`.

Compatibility of the frozen cohort (`b2.activation.cohort.inbound-funding` 1, `commercial.virtual-account.inbound-funding` 1, `VIRTUAL_ACCOUNT` 1, `NGN`, `CUSTOMER_FUNDS`, `NG`, `B2_ACTIVATION`) is checked before rule evaluation; a mismatch is `REJECTED` with `B2_CUSTOMER_ACTIVATION_READINESS_INCOMPATIBLE` without emitting a readiness outcome.

## 6. Idempotency, replay, and read-only consumer ports

### 6.1 Idempotency

The B2 customer activation-readiness attestation uses the shared `IdempotencyService` (only idempotency authority) in scope `b2.customer-activation-readiness.idempotency.v1` with `86400s` retention. The attestation never stores raw `clientSecret`, webhook `secret`, PAN, account secret, PIN, OTP, callback signature, or private key.

### 6.2 Replay safety

`replaySafeGenerateAttestationDecision(request, existingByKey)` is replay-safe: same `idempotencyKey` + same scope + same cohort + same cohortVersion + same `b1ScopeKey` + same `requestHash` within the window replays the original `attestationReference` with `replayed:true`; same key + same scope + same cohort + same `b1ScopeKey` but different `requestHash` is `409` `B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_CONFLICT` with `conflict:true`. The replay payload excludes the random `attestationReference` and `createdAt`.

### 6.3 Read-only consumer ports

The contract exposes `B2CustomerActivationReadinessConsumerPortsV1` (`contractName` `B2-CUSTOMER-ACTIVATION-READINESS`, `contractVersion` 1, `idempotencyScope` `b2.customer-activation-readiness.idempotency.v1`, `cohortKey` `b2.activation.cohort.inbound-funding` 1). Later B2 tasks (B2T05 activation workflows) consume the `generateAttestationDecision`, `replaySafeGenerateAttestationDecision`, `compatibilityCheck`, and `computeRequestHash` ports read-only. The ports reuse A1 `Customer.id` (only canonical identity), A3 binding (only binding authority), A4 policy (only policy authority), A7 `VIRTUAL_ACCOUNT` v1 (only product authority), B1 catalog (only commercial-decision authority), `CustomerPreference` (only delivery intent), and `CustomerConsent` (only activation intent) through read-only consumer boundaries.

## 7. Compatibility and bounded scope

The B2 customer activation-readiness attestation marks the bounded first activation cohort `b2.activation.cohort.inbound-funding` v1 as the only cohort for the first B2 cohort. The attestation is bounded to that cohort's `NGN`/`CUSTOMER_FUNDS`/`NG` inbound-funding virtual-account context. The attestation does not expose a public API, a credential, a sandbox, a webhook, a marketing consent beyond `B2_ACTIVATION`, a merchant/agent cohort, a second B1 scope, a second partner beyond `NIBSS_NIP`, a second currency, a second accounting unit, or a second region. Each additional cohort, product, scope, region, currency, or partner requires a separate reviewed capability and a separate B2 ADR and must not be smuggled into the first cohort via the public API catalog or the activation workflow.

## 8. Verification

- [x] The contract is frozen as `B2-CUSTOMER-ACTIVATION-READINESS` v1 with explicit `B2CustomerActivationReadinessRequestV1`, `B2CustomerActivationReadinessDecisionV1`, `B2CustomerActivationReadinessRuleTraceStepV1`, `B2CustomerActivationReadinessFailureV1`, `B2CustomerActivationReadinessReplaySafeResultV1`, `B2CustomerActivationReadinessCompatibilityResultV1`, `B2CustomerActivationReadinessConsumerPortsV1`, `B2CustomerActivationReadinessPersistenceRecordV1` types.
- [x] The cohort `b2.activation.cohort.inbound-funding` v1, B1 scope `commercial.virtual-account.inbound-funding` v1, `VIRTUAL_ACCOUNT` v1, `NIBSS_NIP`, `NGN`/`CUSTOMER_FUNDS`/`NG` are frozen.
- [x] The attestation verifies KYC, A3 binding, A4 eligibility/currentness, A7 compatibility, B1 tier/entitlement, and `CustomerConsent` (`B2_ACTIVATION`) with nine `PASS`/`FAIL` rule steps and derives `verificationState`, `activationEligibility`, `activationReady`, and `outcome` deterministically.
- [x] The attestation is replay-safe under the shared `IdempotencyService` (`86400s`, `decisionReplayHash` excludes `attestationReference`/`createdAt`, same-key/same-hash replays, same-key/different-hash conflicts).
- [x] The contract exposes only read-only consumer ports to later B2 tasks (B2T05) and reuses A1/A3/A4/A7/B1/`CustomerPreference`/`CustomerConsent` through read-only boundaries; it never activates a customer, never creates a public API, never creates a credential, never dispatches a notification, never mutates an A1–A7/B1 authority, never posts a ledger entry, and never performs commercial execution.
- [x] The persistence `b2_customer_activation_readiness` with unique `attestationReference,attestationVersion` and indexes on `customer_id`, `cohort`, `requestHash`, `decisionHash`, `idempotencyScope+key`, and `correlationId` is the only B2 customer activation-readiness persistence surface.
- [x] No raw credentials, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, or unnecessary customer data are stored in broad records, logs, traces, events, or notification payloads.
- [x] No ADR beyond ADR-0074 is authored by this task; B2T02 ADRs ADR-0072/ADR-0073 remain the first B2 ADRs and are not renumbered.

### Evidence limitations

- B2T03 is a read-only attestation. It does not call a live onboarding partner, query live KYC evidence, inspect live bank data, or certify NIBSS.
- B2T03 does not create a public API, a credential, a webhook, a sandbox, or an activation workflow; those remain B2T05/B2T08/B2T09.
- B2T03 does not activate a customer, merchant, or agent; B2T05 owns the workflow that consumes the attestation.
