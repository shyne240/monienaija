# B2T09 — B2 Webhook Authority Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T09 — Webhook Registration, Delivery, Verification, Retry, and Dead Letter Authority
- **Contract:** `B2WebhookContractV1` (`B2-WEBHOOK-AUTHORITY` v1) — registrations `B2WebhookRegistrationDecisionV1` / `B2WebhookRegistrationRequestV1` and deliveries `B2WebhookDeliveryDecisionV1` / `B2WebhookDeliveryRequestV1` plus `B2WebhookReplaySafeResultV1` and `B2WebhookConsumerPortsV1`
- **ADR:** ADR-0080 — B2 Webhook Authority
- **Status:** Accepted (B2T09 implementation)
- **Review snapshot:** `b2t09` (B2T09 implementation commit; B2T08 + B2T07 + B2T06 + B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)

This document defines the B2 webhook authority contract that registers deterministic webhook endpoints via challenge-response and delivers HMAC-signed events with bounded retry and dead-letter.

## 1. Purpose and boundary

The B2 webhook authority is the only B2-side webhook authority for the bounded first cohort `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1. It registers `b2-webhook-registration-<uuid>` (`PENDING_VERIFICATION` -> `VERIFIED` via `X-Monienaija-Challenge` echo of `challengeNonce`) for `consumerId` `b2-consumer-<uuid>` with `url` `https://` allowlisted (`example.com`, `hooks.monienaija.com`, `webhook.site`), `events` `b2.activation.succeeded`/`suspended`/`b2.webhook.test`/`b1.commercial.invoice.created`, and `HMAC_SHA256` `secretHash`. It delivers `b2-webhook-delivery-<uuid>` (`ENQUEUED` -> `DELIVERED` / `ENQUEUED` -> `FAILED_RETRYABLE` (bounded `1s`/`10s`/`60s`/`300s`/`900s` exponential backoff) -> `DEAD_LETTER` after 5) with `X-Monienaija-Signature: sha256=<hmacSha256(secret, payloadHash.timestamp.deliveryId)>`, `X-Monienaija-Timestamp` (300s freshness), and `X-Monienaija-Delivery-Id` (replay protection via `b2.webhook.idempotency.v1`).

The authority is deterministic, replay-safe via `b2.webhook.idempotency.v1` (`86400s`), and exposes only read-only consumer ports to later B2 tasks. It never implements JWT authentication (B2T10), public authentication middleware, activation workflow logic, financial effects, notifications, partner communication, or ledger mutations.

## 2. Contract identity

- **Contract name:** `B2-WEBHOOK-AUTHORITY`
- **Contract version:** `1`
- **Contract document:** `docs/B2-WEBHOOK-CONTRACT.md`
- **Cohort key/version:** `b2.activation.cohort.inbound-funding` 1 (frozen; see `docs/B2-ACTIVATION-BASELINE.md` §4 and `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md` §4)
- **Idempotency scope:** `b2.webhook.idempotency.v1` with `86400s` retention (dedicated, deterministic `requestHash`/`decisionHash`/`replayHash`)
- **Audit entity types:** `b2_webhook_registration` and `b2_webhook_delivery` with actor `b2-webhook`
- **Outbox event types:** `b2.webhook.registration.decided.v1` and `b2.webhook.delivery.decided.v1` (`INTERNAL`, `OPERATIONS_DEFAULT`)
- **Reference prefixes:** `b2-webhook-registration-` and `b2-webhook-delivery-`
- **HMAC:** `HMAC_SHA256`, headers `X-Monienaija-Signature`, `X-Monienaija-Timestamp`, `X-Monienaija-Delivery-Id`, `X-Monienaija-Challenge`
- **Freshness:** `300s` via `X-Monienaija-Timestamp`; **Delivery attempts:** `1..5` with backoff `1s`/`10s`/`60s`/`300s`/`900s`; **Dead-letter:** `DEAD_LETTER` after 5

## 3. Webhook registration and delivery vocabularies

- `registrationState`: `PENDING_VERIFICATION` | `VERIFIED` | `SUSPENDED` | `REVOKED` — the registration lifecycle. `PENDING_VERIFICATION` is the initial state at creation with `challengeNonce` (`16 bytes hex`); `VERIFIED` is reached only via `verifyRegistrationChallenge(decision, providedChallenge)` where `providedChallenge === challengeNonce` via `X-Monienaija-Challenge` echo.
- `deliveryState`: `ENQUEUED` | `DELIVERED` | `FAILED_RETRYABLE` | `FAILED_PERMANENT` | `DEAD_LETTER` — the delivery lifecycle. `ENQUEUED` is the initial state; `DELIVERED` is `200` echo of `Delivery-Id`; `FAILED_RETRYABLE` is a transient failure with `nextAttemptAt` per backoff; `DEAD_LETTER` is terminal after 5.
- `eventType`: `b2.activation.succeeded` | `b2.activation.suspended` | `b2.webhook.test` | `b1.commercial.invoice.created` — the deliverable events for the cohort. `b2.webhook.test` is the challenge ping; the other three are minimized B2 activation/B1 invoice events.
- `hmacAlgorithm`: `HMAC_SHA256` — the only HMAC at v1.

## 4. Request, decision, and persistence

### 4.1 Registration request

`B2WebhookRegistrationRequestV1` carries `consumerId` uuid, `url` `https://` allowlisted, `events` non-empty subset of `B2_WEBHOOK_EVENT_TYPES`, `secret` raw `HMAC_SHA256` secret (returned never), `hmacAlgorithm` `HMAC_SHA256`, `cohortKey` `b2.activation.cohort.inbound-funding` 1, `idempotencyKey` uuid, and `requestContext`/`causationId`.

### 4.2 Registration decision

`B2WebhookRegistrationDecisionV1` carries the derived `registrationReference` (`b2-webhook-registration-<uuid>`), `registrationVersion` 1, `registrationId` uuid, `consumerId`, `url`, `events`, `hmacAlgorithm`, `secretHash` (`argon2id$<salt>$sha256`), `challengeNonce` (`16 bytes hex`), `state` `PENDING_VERIFICATION`, `requestHash` (`sha256(stableJson(consumerId, url, events, hmacAlgorithm, cohortKey, cohortVersion, idempotencyKey))` excluding `registrationReference`/`createdAt`), `decisionHash`/`decisionReplayHash`, `idempotencyScope`/`idempotencyKey`, `correlationId`/`causationId`, `createdAt`/`updatedAt`, and `contractName`/`contractVersion`.

### 4.3 Registration verification

`verifyRegistrationChallenge(decision, providedChallenge)` is `verified:true` with `state: VERIFIED` and recomputed `decisionHash`/`decisionReplayHash` only when `providedChallenge === challengeNonce` (the `X-Monienaija-Challenge` echo); otherwise `verified:false` with `B2_WEBHOOK_CHALLENGE_FAILED` and `state` stays `PENDING_VERIFICATION`.

### 4.4 Delivery request

`B2WebhookDeliveryRequestV1` carries `registrationId` uuid, `event` `b2.activation.*` etc., `payload` `Record<string, unknown>` (minimized per audience), `cohortKey` 1, `idempotencyKey` uuid, and `requestContext`/`causationId`. `registrationId` must reference a `VERIFIED` registration; otherwise `B2_WEBHOOK_NOT_VERIFIED`.

### 4.5 Delivery decision

`B2WebhookDeliveryDecisionV1` carries the derived `deliveryReference` (`b2-webhook-delivery-<uuid>`), `deliveryVersion` 1, `deliveryId` uuid, `registrationId`, `consumerId` (from registration), `event`, `url` (from registration), `payloadHash` (`sha256(stableJson(payload))`), `signature` (`sha256=<hmacSha256(secret, payloadHash.timestamp.deliveryId)>`), `timestamp` (`floor(now/1000)`), `deliveryIdHeader` (`deliveryId`), `attempt` `1` and `maxAttempts` `5`, `state` `ENQUEUED`, `nextAttemptAt` `null` (set on `FAILED_RETRYABLE`), `requestHash`/`decisionHash`/`decisionReplayHash`, `idempotencyScope`/`idempotencyKey`, `correlationId`/`causationId`, `createdAt`/`updatedAt`.

### 4.6 Persistence

The registration is persisted in `b2_webhook_registration` and the delivery in `b2_webhook_delivery` (migration `1785753600044`) each with unique `registrationReference,registrationVersion` / `deliveryReference,deliveryVersion` and indexes on `consumerId`, `state`, `requestHash`, `idempotencyScope+key`, `deliveryId`, `correlationId`. No table contains a raw `secret` — only `secret_hash` and `challenge_nonce`. The `record` JSONB stores the full decision without the raw `secret`.

## 5. Webhook verification and delivery rules

1. `consumerId` must be uuid and must reference an `ACTIVE` `b2_api_consumer`; `url` must be `https://` and host must be in `B2_WEBHOOK_ALLOWLIST_HOSTS` (`example.com`, `hooks.monienaija.com`, `webhook.site`); otherwise `B2_WEBHOOK_URL_NOT_ALLOWED`.
2. `events` must be non-empty subset of `B2_WEBHOOK_EVENT_TYPES`; otherwise `B2_WEBHOOK_INVALID_COMMAND`.
3. `hmacAlgorithm` must be `HMAC_SHA256`; otherwise the same failure.
4. `cohortKey` must be `b2.activation.cohort.inbound-funding` 1; otherwise `B2_WEBHOOK_INCOMPATIBLE`.
5. `idempotencyKey` must be uuid; otherwise `B2_WEBHOOK_INVALID_COMMAND`.
6. `secret` is hashed immediately to `secretHash` (`argon2id$<salt>$sha256`) and never stored or logged; the `record` JSONB contains `secretHash` and `challengeNonce` only.
7. The registration transitions `PENDING_VERIFICATION -> VERIFIED` only via the challenge echo; `SUSPENDED`/`REVOKED` are terminal without auto-repair.
8. The delivery transitions `ENQUEUED -> DELIVERED` on `200` echo of `Delivery-Id`, or `ENQUEUED -> FAILED_RETRYABLE` with `nextAttemptAt` `+1s` for attempt 1, `+10s` for 2, `+60s` for 3, `+300s` for 4, `+900s` for 5, then `DEAD_LETTER` when `attempt >= 5`; no unbounded retry.

A failing write-check is `REJECTED` with the write-check code and never creates a `PENDING_VERIFICATION`/`ENQUEUED` row.

## 6. HMAC signing, replay protection, and freshness

### 6.1 HMAC-SHA256 signing

`signature` is `sha256=<hex(hmacSha256(secret, payloadHash.timestamp.deliveryId))>` where `payloadHash` is `sha256(stableJson(payload))`, `timestamp` is `floor(now/1000)`, and `deliveryId` is the `X-Monienaija-Delivery-Id`. The consumer verifies with the once-returned `secret` plus the same `payload`/`timestamp`/`deliveryId` without the raw `secret` appearing in logs, traces, or the `record` JSONB.

### 6.2 Replay protection and Delivery-Id uniqueness

`Delivery-Id` is the `deliveryId` uuid and is unique per `b2.webhook.idempotency.v1`. `checkDeliveryIdUnique(deliveryId, seenSet)` is `verified:true` only when `deliveryId` has not been seen in the `b2.webhook.idempotency.v1` window; a replayed `Delivery-Id` outside the consumer's TTL is `B2_WEBHOOK_DELIVERY_ID_DUPLICATE` and never re-executes the delivery.

### 6.3 Timestamp freshness

`checkTimestampFreshness(timestamp, nowSeconds)` is `verified:true` only when `|nowSeconds - timestamp| <= 300`; otherwise `B2_WEBHOOK_TIMESTAMP_STALE`. `verifyHmacSignature(secret, payload, timestamp, deliveryId, signature)` recomputes `payloadHash.timestamp.deliveryId` and compares `sha256=`; a mismatched `signature` is `B2_WEBHOOK_SIGNATURE_INVALID`.

## 7. Idempotency, replay, and read-only consumer ports

The webhook authority uses the dedicated `b2.webhook.idempotency.v1` scope (`86400s`) via the shared `IdempotencyService` (only idempotency authority). Both `replaySafeGenerateRegistrationDecision` and `replaySafeGenerateDeliveryDecision` are replay-safe: same `idempotencyKey`+same cohort+same hash replays the original `registrationReference`/`deliveryReference` with `replayed:true`; same key+different hash is `409` `B2_WEBHOOK_REPLAY_CONFLICT` with `conflict:true`. The replay payload excludes `registrationReference`/`deliveryReference`/`createdAt`. The contract exposes `B2WebhookConsumerPortsV1` (`contractName` `B2-WEBHOOK-AUTHORITY`, `idempotencyScope` `b2.webhook.idempotency.v1`, `cohortKey` `b2.activation.cohort.inbound-funding` 1) and `generateRegistrationDecision`, `verifyRegistrationChallenge`, `generateDeliveryDecision`, `verifyHmacSignature`, `checkTimestampFreshness`, `checkDeliveryIdUnique`, `getNextAttemptAt`, `transitionDeliveryState` read-only to later B2 tasks. The ports reuse `Customer.id`/`B2ApiConsumer` owner traces without creating a second Customer authority and without mutating `CustomerPreference`, `A1` identity, or `A2` authorization.

## 8. Verification

- [x] The contract is frozen as `B2-WEBHOOK-AUTHORITY` v1 with explicit `B2WebhookRegistrationRequestV1` (`PENDING_VERIFICATION` challenge `b2.webhook.test` + `https` allowlist) and `B2WebhookDeliveryRequestV1` (`ENQUEUED` with `X-Monienaija-*` headers) types.
- [x] The registration is verified via `X-Monienaija-Challenge` echo of `challengeNonce` (`PENDING_VERIFICATION -> VERIFIED` only on match; otherwise `B2_WEBHOOK_CHALLENGE_FAILED`).
- [x] The registration allowlist is `https://` plus `example.com`/`hooks.monienaija.com`/`webhook.site`; any other host is `B2_WEBHOOK_URL_NOT_ALLOWED`.
- [x] The delivery signing is `HMAC_SHA256` (`sha256=<hmacSha256(secret, payloadHash.timestamp.deliveryId)>`) with `X-Monienaija-Signature`, `X-Monienaija-Timestamp`, `X-Monienaija-Delivery-Id`; verification is `verifyHmacSignature` with the once-returned `secret`.
- [x] The delivery lifecycle is `ENQUEUED -> DELIVERED` / `ENQUEUED -> FAILED_RETRYABLE` (`1s`/`10s`/`60s`/`300s`/`900s` exponential backoff via `getNextAttemptAt`) -> `DEAD_LETTER` after 5, with `nextAttemptAt` deterministic.
- [x] The event lifecycle is `b2.activation.succeeded`/`suspended`/`b2.webhook.test`/`b1.commercial.invoice.created` (the contract enumerates the cohort's webhook events; the delivery `event` is a subset of that enumeration).
- [x] The delivery state machine is `ENQUEUED -> DELIVERED` / `ENQUEUED -> FAILED_RETRYABLE -> DEAD_LETTER` (plus `FAILED_PERMANENT` reserved, not emitted at v1).
- [x] Replay protection is `Delivery-Id` uniqueness via `b2.webhook.idempotency.v1` (`checkDeliveryIdUnique`) and `replaySafeGenerateDeliveryDecision` (`replayed:true` on same hash).
- [x] Timestamp freshness is `300s` via `checkTimestampFreshness` (`X-Monienaija-Timestamp` within `300s`).
- [x] `Delivery-Id` uniqueness is `deliveryId` uuid per `b2.webhook.idempotency.v1` and `X-Monienaija-Delivery-Id` header.
- [x] The authority is the only B2 webhook authority; it never duplicates the A2 authentication vault, never posts a ledger entry, and never performs a settlement.
- [x] The persistence `b2_webhook_registration`/`b2_webhook_delivery` with `secret_hash` (never raw) and `challenge_nonce` and indexes on `deliveryId`/`idempotencyScope+key` are the only B2 webhook persistence surfaces.
- [x] No ADR beyond ADR-0080 is authored by this task; B2T02 ADRs ADR-0072/ADR-0073, B2T03 ADR-0074, B2T04 ADR-0075, B2T05 ADR-0076, B2T06 ADR-0077, B2T07 ADR-0078, B2T08 ADR-0079 remain and are not renumbered.

### Evidence limitations

- B2T09 is a webhook authority. It does not create a JWT (B2T10), a public authentication middleware, an activation workflow logic, a financial effect, a notification, a partner communication, or a ledger mutation; those remain B2T10/B2T05/A5.
- B2T09 does not call a live corporate registry, a live bank settlement, or a live webhook endpoint beyond the deterministic `challengeNonce` generation and `X-Monienaija-*` header signing.
