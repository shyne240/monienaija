# ADR-0076 — B2 Activation Workflow

- **ADR ID:** ADR-0076
- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T05 — Customer, Merchant, and Agent Activation Workflow Engine
- **Status:** Accepted (B2T05 implementation)
- **Review snapshot:** `b2t05` (B2T05 implementation commit; B2T03 + B2T04 + B2T02 + B2T01 + B1 evidence committed; B1 phase result is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`); B2 cohort `b2.activation.cohort.inbound-funding` v1 frozen)
- **Scope:** B2 activation workflow engine for the bounded first cohort `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`; deterministic, replay-safe activation decisions that consume B2T03 customer readiness and B2T04 merchant/agent readiness only when their outcome is `ATTESTED_READY`; state machine `PENDING -> ACTIVE -> SUSPENDED -> REVOKED` with a dedicated idempotency scope; read-only consumer ports
- **Authoritative boundary:** `B2ActivationWorkflowContractV1` per `docs/B2-COMMERCIAL-ACTIVATION-CONTRACT.md`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, webhook, credential, secret, ledger, commercial, public-channel, and B2 activation changes beyond the B2T05 scope:** None (B2T05 never creates a public API, never dispatches a notification, never posts a ledger entry, never executes a settlement)

This ADR records the activation workflow engine without recalculating readiness and without mutating any A1–A7/B1 authority.

## 1. Context

B2T01 selected the `b2.activation.cohort.inbound-funding` v1 cohort; B2T02 froze `B2-PUBLIC-API-CATALOG` v1; B2T03 and B2T04 implemented customer and merchant/agent readiness attestations (`ATTESTED_READY` is the only eligible outcome, replay-safe, `86400s` window, per-kind scopes). B2T05 must be the single activation authority that creates `b2-activation-<uuid>` records, transitions `PENDING -> ACTIVE -> SUSPENDED -> REVOKED`, and exposes read-only ports to B2T06/B2T08/B2T10 without ever recomputing KYC, A3 binding, A4 policy, A7 compatibility, B1 tier/entitlement, or `CustomerConsent`.

## 2. Decision

### 2.1 Engine

B2T05 freezes `B2-ACTIVATION-WORKFLOW` v1 with a dedicated `b2.activation-workflow.idempotency.v1` scope (`86400s`), reference prefix `b2-activation-`, audit entity `b2_activation`, and outbox `b2.activation.decided.v1`. The request is `B2ActivationWorkflowRequestV1` (`kind` `CUSTOMER`/`MERCHANT`/`AGENT`, `principalId`, `cohortKey` `b2.activation.cohort.inbound-funding` 1, `b1ScopeKey` `commercial.virtual-account.inbound-funding` 1, `NGN`/`CUSTOMER_FUNDS`/`NG`, `readinessOutcome` `ATTESTED_READY`, `readinessReference`, `idempotencyKey`). Any `readinessOutcome` other than `ATTESTED_READY` is `B2_ACTIVATION_WORKFLOW_READINESS_NOT_READY` before rule evaluation.

### 2.2 Determinism and replay

`requestHash` is `sha256(stableJson(kind, principalId, cohortKey, cohortVersion, b1ScopeKey, b1ScopeVersion, currency, accountingUnit, region, readinessOutcome, readinessReference, idempotencyKey))` and excludes `activationReference`/`createdAt`. `decisionHash`/`decisionReplayHash` follow the B2T03/B2T04 pattern keyed on `b2.activation-workflow.idempotency.v1`; same key+same hash within window replays the original `activationReference` with `replayed:true`; same key+different hash is `409` `B2_ACTIVATION_WORKFLOW_REPLAY_CONFLICT` with `conflict:true`.

### 2.3 State machine

The machine allows only `PENDING` (initial state after successful `ATTESTED_READY` creation) `-> ACTIVE -> SUSPENDED -> REVOKED`, with no backward transitions, and with `REJECTED` reserved for the `READINESS_NOT_READY` write-check failure. Transitions are `transitionState(current, targetState)` with `B2_ACTIVATION_WORKFLOW_INVALID_STATE_TRANSITION` on illegal edges, `decisionHash` recomputed per transition, and `updatedAt` advanced without ledger mutation.

### 2.4 Read-only surface and persistence

The engine exposes `getConsumerPorts()`, `compatibilityCheck`, `computeRequestHash`, `generateActivationDecision`, `transitionState`, and `replaySafeGenerateActivationDecision` read-only to B2T05's consumers (B2T06/B2T08/B2T10/B2T11/B2T12). Persistence is `b2_activation` (migration `1785753600041`) with unique `activationReference,activationVersion` and indexes on `principalId`, `kind`, `cohort`, `state`, `requestHash`, `idempotencyScope+key`, `correlationId`. It reuses `Customer.id` (canonical), `Merchant.id`/`Agent.id` (distinct cohort identities with beneficial-owner traces), `CustomerPreference`, `CustomerConsent` (only where required by the attestation), and the shared `IdempotencyService`/`AuditService`/`OutboxService`/`MetricsService`.

## 3. Consequences

- B2T06/B2T08/B2T10/B2T11/B2T12 have exactly one read-only activation source with a single idempotency scope.
- `ATTESTED_READY` is never recomputed inside the workflow; the attestation `readinessReference` is the provenance field on every `b2_activation` row.
- No public API, credential, webhook, ledger entry, or settlement is created; `PENDING` activations remain in-flight until an explicit privileged `transitionState` call.
- The state machine is idempotent per transition and fixture-testable.

## 4. Alternatives considered

- **Activation with inline readiness recomputation:** Rejected — would duplicate B2T03/B2T04 rule traces per request, collapse the readiness boundary, and violate `NEVER recalculate readiness`.
- **Single table with external lifecycle service reuse (A5/A7):** Rejected — would conflate the B2 cohort activation lifecycle with the A5 internal financial pilot and A7 product lifecycle.
- **Direct `ACTIVE` on create (no `PENDING`):** Rejected — would eliminate the `PENDING -> ACTIVE` approval gate that B2T06/B2T08 rely on for consent/quota/rate-limit checks.
