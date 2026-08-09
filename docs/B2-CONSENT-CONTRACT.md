# B2T06 — B2 Consent Authority Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T06 — Customer Consent, Marketing Consent, and Commercial Consent Authority
- **Contract:** `B2ConsentContractV1` (`B2-CONSENT-AUTHORITY` v1) — `B2ConsentDecisionV1` / `B2ConsentRequestV1` / `B2ConsentReplaySafeResultV1` / `B2ConsentCompatibilityResultV1` / `B2ConsentConsumerPortsV1`
- **ADR:** ADR-0077 — B2 Consent Authority
- **Status:** Accepted (B2T06 implementation)
- **Review snapshot:** `b2t06` (B2T06 implementation commit; B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)

This document defines the B2 consent authority contract that implements Customer Consent, Marketing Consent, and Commercial Consent as deterministic replay-safe decisions.

## 1. Purpose and boundary

The B2 consent authority is the only B2-side consent authority for the bounded first cohort `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1. It supports four purposes `B2_ACTIVATION`, `B2_COMMERCIAL`, `B2_SELF_SERVICE`, `MARKETING_COMMERCIAL_OFFER` and the lifecycle `PENDING -> GRANTED -> REVOKED -> EXPIRED`. `MARKETING_COMMERCIAL_OFFER` requires a channel `email`/`sms`/`push`/`inApp`; the other three purposes forbid a channel.

The authority is deterministic and replay-safe via `b2.consent.idempotency.v1` (`86400s`), exposes only read-only consumer ports to later B2 tasks, and never creates another Customer authority, never modifies `CustomerPreference` (only delivery intent; `CustomerConsent`/`MarketingConsent` are separate activation/marketing intent authorities consumed alongside it), never modifies `A1` identity or `A2` authorization, never executes notifications, never activates products, and never communicates with external partners.

## 2. Contract identity

- **Contract name:** `B2-CONSENT-AUTHORITY`
- **Contract version:** `1`
- **Contract document:** `docs/B2-CONSENT-CONTRACT.md`
- **Cohort key/version:** `b2.activation.cohort.inbound-funding` 1 (frozen; see `docs/B2-ACTIVATION-BASELINE.md` §4 and `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md` §4)
- **Idempotency scope:** `b2.consent.idempotency.v1` with `86400s` retention
- **Audit entity type / actor:** `b2_consent` / `b2-consent`
- **Outbox event type:** `b2.consent.decided.v1` (`INTERNAL`, `OPERATIONS_DEFAULT` retention)
- **Reference prefix:** `b2-consent-`

## 3. Consent states and vocabularies

- `state`: `PENDING` | `GRANTED` | `REVOKED` | `EXPIRED` — the durable consent lifecycle state. `PENDING` is the initial state at creation; `GRANTED` is reachable only via `PENDING -> GRANTED`; `REVOKED` only via `GRANTED -> REVOKED`; `EXPIRED` only via `REVOKED -> EXPIRED` (logical expiry after revocation retention). Any other transition is `B2_CONSENT_INVALID_STATE_TRANSITION`.
- `outcome`: `PENDING` | `GRANTED` | `REVOKED` | `EXPIRED` | `REJECTED` — mirroring the state with `REJECTED` for write-check failures.
- `purpose`: `B2_ACTIVATION` | `B2_COMMERCIAL` | `B2_SELF_SERVICE` | `MARKETING_COMMERCIAL_OFFER` — the consent purpose. `B2_ACTIVATION` is the required purpose for `b2.activation.cohort.inbound-funding` v1 activation; `B2_COMMERCIAL` is the broad commercial intent; `B2_SELF_SERVICE` is the self-service intent; `MARKETING_COMMERCIAL_OFFER` is the marketing intent per channel.
- `channel`: `email` | `sms` | `push` | `inApp` | `null` — the marketing channel, required only for `MARKETING_COMMERCIAL_OFFER` and forbidden otherwise.

## 4. Request, decision, and persistence

### 4.1 Consent request

`B2ConsentRequestV1` carries the subject identity (`subjectCustomerId` uuid), the purpose (`B2_ACTIVATION` etc.), the channel (`email` etc. for `MARKETING_COMMERCIAL_OFFER`, otherwise `null`), the cohort identity (`b2.activation.cohort.inbound-funding` 1), the requested state (`PENDING`/`GRANTED`/`REVOKED`/`EXPIRED`), the `idempotencyKey` uuid, and the `requestContext`/`causationId`.

### 4.2 Consent decision

`B2ConsentDecisionV1` carries the derived `consentReference` (`b2-consent-<uuid>`), `consentVersion` 1, `subjectCustomerId`, `purpose`, `channel`, the cohort echo, `state`/`outcome`, `requestHash` (`sha256(stableJson(subjectCustomerId, purpose, channel, cohortKey, cohortVersion, requestedState, idempotencyKey))` excluding `consentReference`/`createdAt`), `decisionHash`, `decisionReplayHash`, `idempotencyScope`/`idempotencyKey`, `correlationId`/`causationId`, `createdAt`/`updatedAt`, and `contractName`/`contractVersion`.

### 4.3 Persistence

The consent is persisted in `b2_consent` (migration `1785753600042`) with unique `consentReference,consentVersion` and indexes on `subjectCustomerId`, `purpose`, `state`, `cohort`, `requestHash`, `idempotencyScope+key`, `correlationId`. The `record` column stores the full decision JSONB. The table is the only B2 consent persistence surface. Transitions update `state`/`outcome`/`decisionHash`/`decisionReplayHash`/`updatedAt` without `CustomerPreference` mutation.

## 5. Consent rules

The authority enforces compatibility before rule evaluation:

1. `subjectCustomerId` must be uuid; otherwise `B2_CONSENT_INVALID_COMMAND`.
2. `purpose` must be one of the four frozen purposes; otherwise `B2_CONSENT_INCOMPATIBLE`.
3. `channel` presence must match the purpose (`MARKETING_COMMERCIAL_OFFER` requires a channel, the other three forbid it); otherwise the same failure.
4. `cohortKey` must be `b2.activation.cohort.inbound-funding` and `cohortVersion` 1; otherwise `B2_CONSENT_INCOMPATIBLE`.
5. `idempotencyKey` must be uuid; otherwise `B2_CONSENT_INVALID_COMMAND`.

A failing write-check is `REJECTED` with the write-check code and never creates a `PENDING` row.

## 6. Idempotency, replay, and state machine

### 6.1 Idempotency

The consent authority uses the shared `IdempotencyService` (only idempotency authority) in the dedicated `b2.consent.idempotency.v1` scope with `86400s` retention. It never stores `clientSecret`, webhook `secret`, PAN, account secret, PIN, OTP, callback signature, or private key.

### 6.2 Replay safety

`replaySafeGenerateConsentDecision(request, existingByKey)` is replay-safe: same `idempotencyKey` + same cohort + same `requestHash` within the window replays the original `consentReference` with `replayed:true`; same key + same cohort + different `requestHash` is `409` `B2_CONSENT_REPLAY_CONFLICT` with `conflict:true`. The replay payload excludes `consentReference`/`createdAt`.

### 6.3 State machine

`transitionState(current, targetState)` allows only:

- `PENDING -> GRANTED`
- `GRANTED -> REVOKED`
- `REVOKED -> EXPIRED`

Any other edge (including `PENDING -> REVOKED` direct, `PENDING -> EXPIRED`, or backward edges) throws `B2_CONSENT_INVALID_STATE_TRANSITION`. The transition recomputes `decisionHash`/`decisionReplayHash` and advances `updatedAt` without `CustomerPreference` mutation or `A2` authorization.

### 6.4 Read-only consumer ports

The contract exposes `B2ConsentConsumerPortsV1` (`contractName` `B2-CONSENT-AUTHORITY`, `idempotencyScope` `b2.consent.idempotency.v1`, `cohortKey` `b2.activation.cohort.inbound-funding` 1) and `generateConsentDecision`, `replaySafeGenerateConsentDecision`, `transitionState`, `compatibilityCheck`, `computeRequestHash` ports read-only to B2T06's consumers (B2T05 pending-consent resolution, B2T09 webhook delivery, B2T10 consent-gated reads). The ports reuse `Customer.id` (canonical) and `CustomerPreference` (only delivery intent) via read-only boundaries, never modifying `CustomerPreference`, `A1` identity, or `A2` authorization.

## 7. Compatibility and bounded scope

The authority is bounded to the first activation cohort `b2.activation.cohort.inbound-funding` v1 for the first B1 scope. It does not expose a public API, a credential, a sandbox, a webhook, a second B1 scope, a second partner beyond `NIBSS_NIP`, a second currency, a second accounting unit, a second region beyond `NG`, a second webhook event, or a second public surface. Each additional purpose, product, scope, region, currency, or partner requires a separate reviewed capability and a separate B2 ADR.

## 8. Verification

- [x] The contract is frozen as `B2-CONSENT-AUTHORITY` v1 with explicit `B2ConsentRequestV1` (purposes `B2_ACTIVATION`/`B2_COMMERCIAL`/`B2_SELF_SERVICE`/`MARKETING_COMMERCIAL_OFFER` with channel rule), `B2ConsentDecisionV1` (`PENDING`/`GRANTED`/`REVOKED`/`EXPIRED`), `B2ConsentFailureV1`, `B2ConsentReplaySafeResultV1`, `B2ConsentCompatibilityResultV1`, `B2ConsentConsumerPortsV1` types.
- [x] The four purposes are supported; `MARKETING_COMMERCIAL_OFFER` requires `channel`, the other three forbid it.
- [x] The lifecycle `PENDING -> GRANTED -> REVOKED -> EXPIRED` is supported via `transitionState` with dedicated guard and `INVALID_STATE_TRANSITION` on illegal edges.
- [x] The consent is deterministic (`requestHash` stableJson excluding `consentReference`/`createdAt`) and replay-safe per dedicated scope (`86400s`, `decisionReplayHash` excludes `consentReference`/`createdAt`, same-key/same-hash replays, same-key/different-hash conflicts).
- [x] The authority creates the only B2 consent authority; it does not create another Customer authority, does not modify `CustomerPreference`, `A1` identity, or `A2` authorization, does not execute notifications, does not activate products, and does not communicate with external partners.
- [x] The persistence `b2_consent` with unique `consentReference,consentVersion` and indexes on `subjectCustomerId`, `purpose`, `state`, `cohort`, `requestHash`, `idempotencyScope+key`, `correlationId` is the only B2 consent persistence surface.
- [x] No ADR beyond ADR-0077 is authored by this task; B2T02 ADRs ADR-0072/ADR-0073, B2T03 ADR-0074, B2T04 ADR-0075, and B2T05 ADR-0076 remain and are not renumbered.

### Evidence limitations

- B2T06 is a consent authority. It does not create a public API, a credential, a webhook, a sandbox, or a ledger entry; those remain B2T07/B2T08/B2T09/A5.
- B2T06 does not dispatch a notification; the `PENDING -> GRANTED` transition remains pending until an explicit privileged call, and `CustomerPreference.notifications` remains the only delivery intent for `A7T06`.
