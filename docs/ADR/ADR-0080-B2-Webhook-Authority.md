# ADR-0080 — B2 Webhook Authority

- **ADR ID:** ADR-0080
- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T09 — Webhook Registration, Delivery, Verification, Retry, and Dead Letter Authority
- **Status:** Accepted (B2T09 implementation)
- **Review snapshot:** `b2t09` (B2T09 implementation commit; B2T08 + B2T07 + B2T06 + B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)
- **Scope:** The only B2 webhook authority for cohort `b2.activation.cohort.inbound-funding` v1; deterministic, replay-safe webhook registration (`PENDING_VERIFICATION` -> `VERIFIED` via challenge-response, HTTPS-only allowlist `example.com`/`hooks.monienaija.com`/`webhook.site`), HMAC-SHA256 signing (`X-Monienaija-Signature: sha256=<hmac>`), delivery attempts (`1..5`, bounded retry `1s/10s/60s/300s/900s` exponential backoff, dead-letter `DEAD_LETTER` after 5), event lifecycle (`b2.activation.succeeded`/`suspended`/`b2.webhook.test`/`b1.commercial.invoice.created`), delivery state machine (`ENQUEUED -> DELIVERED` / `ENQUEUED -> FAILED_RETRYABLE -> DEAD_LETTER`), replay protection (`Delivery-Id` uniqueness via `b2.webhook.idempotency.v1`), timestamp freshness (`300s` via `X-Monienaija-Timestamp`), `Delivery-Id` uniqueness, dedicated `b2.webhook.idempotency.v1` `86400s` window and deterministic `requestHash`/`decisionHash`/`replayHash`, `Audit`/`Metrics`/`Idempotency`/`Outbox` via Operations only
- **Authoritative boundary:** `B2WebhookContractV1` per `docs/B2-WEBHOOK-CONTRACT.md`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, JWT, public authentication middleware, API consumer registry, activation workflow logic, financial effects, notifications, partner communication, and ledger mutations beyond the B2T09 scope:** None (B2T09 never implements JWT authentication, never activates products, never posts ledger entries)

This ADR records the deterministic webhook authority without a second consumer table, a second delivery scheduler, or a second HMAC vault.

## 1. Context

B2T01 selected `b2.activation.cohort.inbound-funding` v1; B2T02 froze `B2-PUBLIC-API-CATALOG` v1 with `POST /v1/webhooks/registrations` (`url` `https://` allowlisted, `events` `b2.activation.*`/`b2.webhook.test`, `secret` hash-only, `HMAC_SHA256`, `PENDING_VERIFICATION` challenge `X-Monienaija-Challenge` echo); B2T07 generated `docs/api/B2-OPENAPI-v1.yaml` as the SSOT; B2T08 implemented the `b2-api-consumer` registry (`b2-consumer-<uuid>`, `mnj_live_`/`mnj_test_` `secretHash`). B2T09 must provide the webhook registration and delivery authority that creates `b2-webhook-registration-<uuid>` and `b2-webhook-delivery-<uuid>` with `X-Monienaija-Signature` (`sha256=<hmac(payloadHash.timestamp.deliveryId)>`), `X-Monienaija-Timestamp` (300s), and `X-Monienaija-Delivery-Id` replay protection, with bounded retry (`1`/`10`/`60`/`300`/`900` seconds) and `DEAD_LETTER` after 5.

## 2. Decision

### 2.1 Registration authority

`B2WebhookRegistration` `PENDING_VERIFICATION -> VERIFIED -> SUSPENDED -> REVOKED` is the only registration lifecycle. `consumerId` must be a valid `B2ApiConsumer` (`ACTIVE`), `url` must be `https://` and host must be in `B2_WEBHOOK_ALLOWLIST_HOSTS` (`example.com`, `hooks.monienaija.com`, `webhook.site`), `events` must be a non-empty subset of `B2_WEBHOOK_EVENT_TYPES`, `hmacAlgorithm` must be `HMAC_SHA256`, and `cohortKey` must be `b2.activation.cohort.inbound-funding` 1. `secret` is returned never, hashed immediately to `argon2id$<salt>$sha256` `secretHash`, and `challengeNonce` (`16 bytes hex`) is generated for the `b2.webhook.test` ping. `VERIFIED` is reached only when `verifyRegistrationChallenge(decision, providedChallenge)` sees `providedChallenge === challengeNonce` via the `X-Monienaija-Challenge` echo.

### 2.2 Delivery authority and signing

`B2WebhookDelivery` `ENQUEUED -> DELIVERED` (`200` echo of `Delivery-Id`) or `ENQUEUED -> FAILED_RETRYABLE` (bounded) `-> DEAD_LETTER` after 5 is the only delivery lifecycle. `generateDeliveryDecision(registration, secretForSigning, payload)` requires a `VERIFIED` registration; it computes `payloadHash` `sha256(stableJson(payload))`, `timestamp` `floor(now/1000)`, `deliveryId` `uuid`, `signature` `sha256=<hmacSha256(secret, payloadHash.timestamp.deliveryId)>`, and `nextAttemptAt` `null` for `ENQUEUED`. `verifyHmacSignature(secret, payload, timestamp, deliveryId, signature)` recomputes `payloadHash.timestamp.deliveryId` and compares `sha256=`.

### 2.3 Retry, dead-letter, and freshness

`getNextAttemptAt(attempt)` returns `+1s` for attempt 1, `+10s` for 2, `+60s` for 3, `+300s` for 4, `+900s` for 5, else `null` → `DEAD_LETTER`. `transitionDeliveryState(current, FAILED_RETRYABLE)` increments `attempt`, sets `nextAttemptAt` per backoff, and returns `DEAD_LETTER` when `attempt >= 5`. `checkTimestampFreshness(timestamp, now)` is `verified` only when `|now - timestamp| <= 300`; `checkDeliveryIdUnique(deliveryId, seenSet)` is `verified` only when `deliveryId` has not been seen in `b2.webhook.idempotency.v1`.

### 2.4 Determinism and replay

`requestHash` for registration is `sha256(stableJson(consumerId, url, events, hmacAlgorithm, cohortKey, cohortVersion, idempotencyKey))` and for delivery is `sha256(stableJson(registrationId, event, payload, cohortKey, cohortVersion, idempotencyKey))`, both excluding `registrationReference`/`deliveryReference`/`createdAt`. `decisionHash`/`decisionReplayHash` follow the B2T03–08 pattern keyed on `b2.webhook.idempotency.v1` (`86400s`). Same `Idempotency-Key`+same hash replays with `replayed:true`; same key+different hash is `409` `B2_WEBHOOK_REPLAY_CONFLICT`.

### 2.5 Persistence and read-only surface

Two tables `b2_webhook_registration` and `b2_webhook_delivery` (migration `1785753600044`) are the only surfaces, each with unique `registrationReference,registrationVersion` / `deliveryReference,deliveryVersion` and indexes on `consumerId`/`state`/`requestHash`/`idempotencyScope+key`/`deliveryId`. No table contains a raw `secret` — only `secret_hash` and `challenge_nonce`. The module exposes `getConsumerPorts()` and deterministic `generateRegistrationDecision`/`verifyRegistrationChallenge`/`generateDeliveryDecision`/`verifyHmacSignature`/`checkTimestampFreshness`/`checkDeliveryIdUnique`/`getNextAttemptAt`/`transitionDeliveryState` read-only to later B2 tasks.

## 3. Consequences

- B2T10 has exactly one read-only webhook source; every `POST /v1/webhooks/registrations` can be verified by `X-Monienaija-Challenge` echo without a second verification service.
- Raw `secret` is returned never, hashed immediately to `secretHash`, and never appears in `record` JSONB, logs, or traces.
- Bounded retry (`1`/`10`/`60`/`300`/`900`) and `DEAD_LETTER` after 5 prevent unbounded delivery loops; `ENQUEUED` `nextAttemptAt` is deterministic per attempt.

## 4. Alternatives considered

- **Separate registration and delivery idempotency scopes:** Rejected — multiplied scopes with cross-operation collisions; the single `b2.webhook.idempotency.v1` with kind-distinct `requestHash` already isolates replay.
- **Storing raw secrets for HMAC verification:** Rejected — would create a second secret vault and log raw `secret` in `record` JSONB.
- **Infinite retry with no dead-letter:** Rejected — would create an unbounded webhook scheduler and collapse the B2T09 bounded-retry contract.
