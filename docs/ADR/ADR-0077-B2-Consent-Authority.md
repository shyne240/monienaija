# ADR-0077 — B2 Consent Authority

- **ADR ID:** ADR-0077
- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T06 — Customer Consent, Marketing Consent, and Commercial Consent Authority
- **Status:** Accepted (B2T06 implementation)
- **Review snapshot:** `b2t06` (B2T06 implementation commit; B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed; B1 cohort `b2.activation.cohort.inbound-funding` v1 frozen)
- **Scope:** B2 consent authority for the bounded first cohort `b2.activation.cohort.inbound-funding` v1; Customer Consent, Marketing Consent, and Commercial Consent for purposes `B2_ACTIVATION`, `B2_COMMERCIAL`, `B2_SELF_SERVICE`, `MARKETING_COMMERCIAL_OFFER`; lifecycle `PENDING -> GRANTED -> REVOKED -> EXPIRED`; deterministic replay-safe consent decisions with dedicated `b2.consent.idempotency.v1` scope, deterministic hashes, and `86400s` window; read-only consumer ports
- **Authoritative boundary:** `B2ConsentContractV1` per `docs/B2-CONSENT-CONTRACT.md`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, webhook, credential, secret, ledger, commercial, public-channel, and B2 activation changes beyond the B2T06 scope:** None (B2T06 never modifies `CustomerPreference`, `A1`, or `A2`)

This ADR records the consent authority without a second Customer table, a second identity, or a notification dispatch.

## 1. Context

B2T01 selected the `b2.activation.cohort.inbound-funding` v1 cohort; B2T02 froze `B2-PUBLIC-API-CATALOG` v1 with `v1` + `Accept` negotiation; B2T03/B2T04 implemented customer/merchant/agent readiness (`ATTESTED_READY` only when `VERIFIED`+`ELIGIBLE`+`CONSENT`); B2T05 implemented the activation workflow that consumes those attestations via `ATTESTED_READY` only. B2T06 must provide the explicit `B2_ACTIVATION`/`B2_COMMERCIAL`/`B2_SELF_SERVICE`/`MARKETING_COMMERCIAL_OFFER` consent records that later tasks (B2T05 pending-consent resolution, B2T09 webhook delivery) consume read-only.

## 2. Decision

### 2.1 Single authority, four purposes, one lifecycle

B2T06 freezes `B2-CONSENT-AUTHORITY` v1 as the only B2 consent authority. It supports four purposes `B2_ACTIVATION`, `B2_COMMERCIAL`, `B2_SELF_SERVICE`, `MARKETING_COMMERCIAL_OFFER` (`MARKETING_COMMERCIAL_OFFER` requires a channel `email`/`sms`/`push`/`inApp`; the other three purposes forbid a channel). The lifecycle is `PENDING -> GRANTED -> REVOKED -> EXPIRED` with no backward edges and with `REJECTED` reserved for write-check failures.

### 2.2 Determinism and replay

Request hash is `sha256(stableJson(subjectCustomerId, purpose, channel, cohortKey, cohortVersion, requestedState, idempotencyKey))` and excludes `consentReference`/`createdAt`. Decision hashes include `requestHash`+`purpose`+`state`+`cohort`. The dedicated `b2.consent.idempotency.v1` scope with `86400s` window is the only consent idempotency scope; same key+same hash replays the original `consentReference` with `replayed:true`; same key+different hash is `409` `B2_CONSENT_REPLAY_CONFLICT` with `conflict:true`.

### 2.3 Persistence and read-only surface

Persistence is `b2_consent` (migration `1785753600042`) with unique `consentReference,consentVersion` and indexes on `subjectCustomerId`, `purpose`, `state`, `cohort`, `requestHash`, `idempotencyScope+key`, `correlationId`. The table is the only B2 consent persistence surface. The authority exposes `getConsumerPorts()` and `generateConsentDecision`/`transitionState`/`replaySafeGenerateConsentDecision` read-only to later B2 tasks, reusing `Customer.id` (canonical) and `CustomerPreference` (only delivery intent) via read-only boundaries, never modifying `CustomerPreference`, `A1` identity, or `A2` authorization.

## 3. Consequences

- B2T05/B2T09/B2T10 have exactly one read-only consent source for each purpose.
- No second `Customer` table is created; the `subjectCustomerId` is the `Customer.id` trace.
- No `CustomerPreference` mutation, notification dispatch, product activation, or partner communication is performed; `PENDING` consents remain pending until an explicit `transitionState` call.

## 4. Alternatives considered

- **Four separate tables per purpose:** Rejected — multiplied migration/approval surface and cross-purpose idempotency collisions.
- **Storing consent as CustomerPreference:** Rejected — would conflate `CustomerPreference` delivery intent with B2 activation/marketing intent and collapse the B2 consent boundary.
- **Direct `GRANTED` on create without `PENDING`:** Rejected — would eliminate the `PENDING -> GRANTED` approval gate that B2T06 uses for `CustomerConsent`/`MarketingConsent` double-opt-in.
