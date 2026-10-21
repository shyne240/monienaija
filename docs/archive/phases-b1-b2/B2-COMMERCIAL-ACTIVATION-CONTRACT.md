# B2T05 — B2 Activation Workflow Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T05 — Customer, Merchant, and Agent Activation Workflow Engine
- **Contract:** `B2ActivationWorkflowContractV1` (`B2-ACTIVATION-WORKFLOW` v1) — activations `B2ActivationWorkflowDecisionV1` / `B2ActivationWorkflowRequestV1` / `B2ActivationWorkflowReplaySafeResultV1` / `B2ActivationWorkflowCompatibilityResultV1` / `B2ActivationWorkflowConsumerPortsV1`
- **ADR:** ADR-0076 — B2 Activation Workflow
- **Status:** Accepted (B2T05 implementation)
- **Review snapshot:** `b2t05` (B2T05 implementation commit; B2T03 + B2T04 + B2T02 + B2T01 + B1 evidence committed; B1 phase result is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`); B2 cohort `b2.activation.cohort.inbound-funding` v1 frozen)

This document defines the B2 activation workflow engine contract that creates deterministic activation decisions by consuming B2T03/B2T04 attestations only when their outcome is `ATTESTED_READY`.

## 1. Purpose and boundary

The B2 activation workflow is the only B2-side activation authority for the bounded first cohort `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`. It verifies that the supplied customer/merchant/agent readiness attestation was consumed through the B2T03/B2T04 consumer ports and that its outcome is `ATTESTED_READY`; it never recalculates KYC, A3 binding, A4 policy eligibility/currentness, A7 product compatibility, B1 tier/entitlement, or `CustomerConsent`.

The workflow is deterministic, replay-safe via a dedicated `b2.activation-workflow.idempotency.v1` scope (`86400s`), and preserves the state machine `PENDING -> ACTIVE -> SUSPENDED -> REVOKED` with no backward transitions. It never creates a public API, never creates a credential, never dispatches a notification, never posts a ledger entry, never executes a settlement, and never mutates an A1–A7/B1 authority.

## 2. Contract identity

- **Contract name:** `B2-ACTIVATION-WORKFLOW`
- **Contract version:** `1`
- **Contract document:** `docs/B2-COMMERCIAL-ACTIVATION-CONTRACT.md`
- **Cohort key/version:** `b2.activation.cohort.inbound-funding` 1 (frozen; see `docs/B2-ACTIVATION-BASELINE.md` §4 and `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md` §4)
- **B1 scope:** `commercial.virtual-account.inbound-funding` 1 (frozen; see `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`)
- **A7 product:** `VIRTUAL_ACCOUNT` 1, **A6 partner:** `NIBSS_NIP`, **Currency/Accounting/Region:** `NGN`/`CUSTOMER_FUNDS`/`NG`
- **Idempotency scope:** `b2.activation-workflow.idempotency.v1` with `86400s` retention
- **Audit entity type / actor:** `b2_activation` / `b2-activation-workflow`
- **Outbox event type:** `b2.activation.decided.v1` (`INTERNAL`, `OPERATIONS_DEFAULT` retention)
- **Reference prefix:** `b2-activation-`

## 3. Workflow states and vocabularies

- `state`: `PENDING` | `ACTIVE` | `SUSPENDED` | `REVOKED` — the durable activation lifecycle state. `PENDING` is the deterministic initial state after successful `ATTESTED_READY` verification; `ACTIVE` is reachable only via `PENDING -> ACTIVE`; `SUSPENDED` is reachable only via `ACTIVE -> SUSPENDED`; `REVOKED` is reachable only via `SUSPENDED -> REVOKED`. Any other transition is `B2_ACTIVATION_WORKFLOW_INVALID_STATE_TRANSITION` and never auto-repairs.
- `outcome`: `PENDING` | `ACTIVATED` | `SUSPENDED` | `REVOKED` | `REJECTED` — the contract outcome mirroring the state (`PENDING`→`PENDING`, `ACTIVE`→`ACTIVATED`, etc.). `REJECTED` is emitted only for the write-check failures before state entry; otherwise a failing readiness yields `ATTESTED_NOT_READY` in the upstream attestation, which the workflow rejects as `B2_ACTIVATION_WORKFLOW_READINESS_NOT_READY`.
- `kind`: `CUSTOMER` | `MERCHANT` | `AGENT` — the principal cohort kind, matching the readiness `kind` (`CUSTOMER`↔`CUSTOMER`, `MERCHANT`↔`MERCHANT`, `AGENT`↔`AGENT`) via `readinessKind` compatibility.

The rule-kind vocabulary is `READINESS_CONSUMPTION`, `COHORT_COMPATIBILITY`, `B1_SCOPE_COMPATIBILITY`, `ACTIVATION_STATE_MACHINE`; each step carries `PASS`/`FAIL`/`SKIP`/`NOT_APPLICABLE` and a `B2ActivationWorkflowFailureCode` where `FAIL`.

## 4. Request, decision, and persistence

### 4.1 Activation request

`B2ActivationWorkflowRequestV1` carries the cohort identity (`b2.activation.cohort.inbound-funding` 1, `commercial.virtual-account.inbound-funding` 1, `VIRTUAL_ACCOUNT` 1, `NGN`/`CUSTOMER_FUNDS`/`NG`), the principal identity (`kind` `CUSTOMER`/`MERCHANT`/`AGENT`, `principalId` uuid, `beneficialOwnerCustomerId` where the principal is a merchant/agent), the **readiness consumption** (`readinessReference` string, `readinessOutcome` must be `ATTESTED_READY`, `readinessKind` must match `kind`), the `idempotencyKey` uuid, and the `requestContext`/`causationId`.

The request **never** carries KYC, A3 binding, A4 eligibility, A7 compatibility, B1 tier/entitlement, or `CustomerConsent` states directly; those are encapsulated in the readiness attestation with `readinessReference`. The workflow verifies the reference non-empty and the outcome `ATTESTED_READY` and never re-derives those states.

### 4.2 Activation decision

`B2ActivationWorkflowDecisionV1` carries the derived `activationReference` (`b2-activation-<uuid>`), `activationVersion` 1, `kind`/`principalId`/`beneficialOwnerCustomerId`, the cohort/B1 echo, `state`/`outcome` (`PENDING`/`PENDING` on create), `readinessReference`/`readinessOutcome`, `ruleTrace` of four steps, `requestHash` (`sha256(stableJson(kind, principalId, cohortKey, cohortVersion, b1ScopeKey, b1ScopeVersion, currency, accountingUnit, region, readinessOutcome, readinessReference, idempotencyKey))` excluding `activationReference`/`createdAt`), `decisionHash`, `decisionReplayHash` (excluding `activationReference`/`createdAt`), `idempotencyScope`/`idempotencyKey`, `correlationId`/`causationId`, `createdAt`/`updatedAt`, and `contractName`/`contractVersion`.

### 4.3 Persistence

The activation is persisted in `b2_activation` (migration `1785753600041`) with unique `activationReference,activationVersion` and indexes on `principalId`, `kind`, `cohort`, `state`, `requestHash`, `idempotencyScope+key`, `correlationId`. The `record` column stores the full decision JSONB. The table is the only B2 activation workflow persistence surface. Transitions update the row `state`/`outcome`/`decisionHash`/`decisionReplayHash`/`updatedAt` without ledger mutation.

## 5. Activation rules

The activation workflow evaluates compatibility before rule trace:

1. `COHORT_COMPATIBILITY` — `cohortKey` must be `b2.activation.cohort.inbound-funding` and `cohortVersion` 1; otherwise `B2_ACTIVATION_WORKFLOW_INCOMPATIBLE`.
2. `B1_SCOPE_COMPATIBILITY` — `b1ScopeKey` `commercial.virtual-account.inbound-funding` 1 and `NGN`/`CUSTOMER_FUNDS`/`NG` must match the frozen cohort; otherwise the same failure.
3. `READINESS_CONSUMPTION` — `readinessOutcome` must be `ATTESTED_READY` and `readinessReference` non-empty; `readinessKind` must match `kind` (`CUSTOMER`↔`CUSTOMER`, etc.); otherwise `B2_ACTIVATION_WORKFLOW_READINESS_NOT_READY` or `B2_ACTIVATION_WORKFLOW_INCOMPATIBLE`.
4. `ACTIVATION_STATE_MACHINE` — creation always yields `PENDING`/`PENDING` with `PASS`; later `transitionState` enforces `PENDING -> ACTIVE -> SUSPENDED -> REVOKED`.

A failing write-check before state entry is `REJECTED` with the write-check failure code and never creates a `PENDING` row; a failing readiness is never auto-repaired and never inferred from `Customer.id`/`CustomerPreference`.

## 6. Idempotency, replay, and state machine

### 6.1 Idempotency

The activation workflow uses the shared `IdempotencyService` (only idempotency authority) in the dedicated `b2.activation-workflow.idempotency.v1` scope with `86400s` retention. The workflow never stores `clientSecret`, webhook `secret`, PAN, account secret, PIN, OTP, callback signature, or private key.

### 6.2 Replay safety

`replaySafeGenerateActivationDecision(request, existingByKey)` is replay-safe: same `idempotencyKey` + same cohort + same `b1ScopeKey` + same `requestHash` within the window replays the original `activationReference` with `replayed:true`; same key + same cohort + different `requestHash` is `409` `B2_ACTIVATION_WORKFLOW_REPLAY_CONFLICT` with `conflict:true`. The replay payload excludes `activationReference`/`createdAt`. No second `b2_activation` row is inserted on replay.

### 6.3 State machine

`transitionState(current, targetState)` allows only:

- `PENDING -> ACTIVE`
- `ACTIVE -> SUSPENDED`
- `SUSPENDED -> REVOKED`

Any other edge (including `PENDING -> SUSPENDED`, `PENDING -> REVOKED` direct, `ACTIVE -> REVOKED` direct without `SUSPENDED`, or backward edges) throws `B2_ACTIVATION_WORKFLOW_INVALID_STATE_TRANSITION`. The transition recomputes `decisionHash`/`decisionReplayHash` and advances `updatedAt` without posting a ledger entry or dispatching a notification. The transition is read-only with respect to A1–A7/B1 sources.

### 6.4 Read-only consumer ports

The contract exposes `B2ActivationWorkflowConsumerPortsV1` (`contractName` `B2-ACTIVATION-WORKFLOW`, `idempotencyScope` `b2.activation-workflow.idempotency.v1`, `cohortKey` `b2.activation.cohort.inbound-funding` 1) and `generateActivationDecision`, `replaySafeGenerateActivationDecision`, `transitionState`, `compatibilityCheck`, `computeRequestHash` ports read-only to B2T06/B2T08/B2T10/B2T11/B2T12. The ports reuse `Customer.id`/`Merchant.id`/`Agent.id` distinct identities with `beneficialOwnerCustomerId` traces through the readiness attestations, `CustomerPreference` (only delivery intent), `CustomerConsent` (only where required by the attestation), A3 binding (only binding), A4 policy (only policy), and B1 catalog (only commercial) via read-only boundaries re-established from the consumed attestations.

## 7. Compatibility and bounded scope

The workflow is bounded to the first activation cohort `b2.activation.cohort.inbound-funding` v1 for the first B1 scope. It does not expose a public API, a credential, a sandbox, a webhook, a second B1 scope, a second partner beyond `NIBSS_NIP`, a second currency, a second accounting unit, a second region beyond `NG`, a second webhook event, or a second public surface. Each additional cohort, product, scope, region, currency, or partner requires a separate reviewed capability and a separate B2 ADR. At B2T03/B2T04 the customer/merchant/agent readiness was `ATTESTED_READY` only through privileged approval of the attestation evidence; B2T05 never recalculates that evidence and never calls a live KYC/settlement/bank API.

## 8. Verification

- [x] The contract is frozen as `B2-ACTIVATION-WORKFLOW` v1 with explicit `B2ActivationWorkflowRequestV1` (`ATTESTED_READY`-gated), `B2ActivationWorkflowDecisionV1` (`PENDING`/`ACTIVE`/`SUSPENDED`/`REVOKED`), `B2ActivationWorkflowRuleTraceStepV1`, `B2ActivationWorkflowFailureV1`, `B2ActivationWorkflowReplaySafeResultV1`, `B2ActivationWorkflowCompatibilityResultV1`, `B2ActivationWorkflowConsumerPortsV1` types.
- [x] The workflow consumes B2T03 customer readiness and B2T04 merchant/agent readiness only when their outcome is `ATTESTED_READY` via the `readinessReference`/`readinessOutcome`/`readinessKind` write-check; otherwise `B2_ACTIVATION_WORKFLOW_READINESS_NOT_READY` and never a recalculation.
- [x] The workflow is deterministic (`requestHash` stableJson excluding `activationReference`/`createdAt`) and replay-safe per dedicated scope (`86400s`, `decisionReplayHash` excludes `activationReference`/`createdAt`, same-key/same-hash replays, same-key/different-hash conflicts).
- [x] The state machine supports `PENDING -> ACTIVE -> SUSPENDED -> REVOKED` with dedicated `transitionState` that enforces allowed edges and throws `INVALID_STATE_TRANSITION` otherwise, without ledger mutation.
- [x] The contract exposes only read-only consumer ports to later B2 tasks (B2T06/B2T08/B2T10/B2T11/B2T12) and reuses `Customer.id`/`Merchant.id`/`Agent.id`, `CustomerPreference`/`CustomerConsent`, A3/A4/B1 boundaries read-only; it never creates a public API, never creates a credential, never dispatches a notification, never posts a ledger entry, and never mutates an A1–A7/B1 authority.
- [x] The persistence `b2_activation` with unique `activationReference,activationVersion` and indexes on `principalId`, `kind`, `cohort`, `state`, `requestHash`, `idempotencyScope+key`, `correlationId` is the only B2 activation workflow persistence surface.
- [x] No raw `clientSecret`, webhook `secret`, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, or unnecessary customer data are stored in broad records, logs, traces, events, or notification payloads.
- [x] No ADR beyond ADR-0076 is authored by this task.

### Evidence limitations

- B2T05 is an activation workflow. It does not create a public API, a credential, a webhook, a sandbox, or a ledger entry; those remain B2T07/B2T08/B2T09/A5.
- B2T05 does not call a live KYC/settlement/bank API; its `readinessReference` is the provenance field on every `b2_activation` row.
- B2T05 does not dispatch a notification; the activation's `PENDING`→`ACTIVE` transition is the only state that may later enqueue an A7T06-compatible delivery intent via `OutboxService` (not by B2T05), and `CustomerPreference.notifications` remains the only delivery intent.
