# ADR-0079 — B2 API Consumer Registry, Credentials, Quotas, and Rate Limiting

- **ADR ID:** ADR-0079
- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T08 — API Consumer Registry, API Credentials, API Keys, Quotas, and Rate Limiting
- **Status:** Accepted (B2T08 implementation)
- **Review snapshot:** `b2t08` (B2T08 implementation commit; B2T07 + B2T06 + B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)
- **Scope:** The only B2 API consumer authority for cohort `b2.activation.cohort.inbound-funding` v1; deterministic, replay-safe API consumer registration (`DRAFT -> ACTIVE -> SUSPENDED -> REVOKED`), credential lifecycle (`ISSUED -> ROTATED -> REVOKED -> EXPIRED`) with one-time `clientId` (`mnj_live_`/`mnj_test_` + 24 alnum) and one-time raw secret returned once and hash-only stored (`argon2id$`/`sha256$` `secretHash`), sandbox/production separation, secret rotation with 300s grace, quota policies (`commercial.read` 5000 / `commercial.write` 500 / `webhooks.manage` 100 per UTC calendar day), token-bucket rate limiting (`global` 100/2 rps, `commercial.read` 50/0.83, `commercial.write` 20/0.33, `commercial.activations:write` 10/0.16 burst 20, `webhooks:delivery` 5/0.08), consumer state machine, dedicated `b2.api-consumer.idempotency.v1` scope with `86400s` window and deterministic `requestHash`/`decisionHash`/`replayHash`, `Audit`/`Metrics`/`Idempotency`/`Outbox` integration via Operations services only
- **Authoritative boundary:** `B2ApiConsumerContractV1` per `docs/B2-API-CREDENTIALS-CONTRACT.md` and `docs/B2-QUOTA-RATE-LIMIT-CONTRACT.md`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, webhook, ledger, commercial, public-channel, JWT, financial effect, activation execution, partner communication, and B2 activation changes beyond the B2T08 scope:** None (B2T08 never implements JWT, webhook delivery, activation execution, ledger mutation, or partner communication)

This ADR records the deterministic consumer, credential, quota, and rate-limit authority without a second authentication or authorization vault.

## 1. Context

B2T01 selected `b2.activation.cohort.inbound-funding` v1; B2T02 froze `B2-PUBLIC-API-CATALOG` v1 with eight public routes plus health/support, each with `b2ApiVersion` `v1`, `aud`/`scope`, `idempotencyScope`, `quotaGroup`, `rateLimitTier`; B2T07 generated `docs/api/B2-OPENAPI-v1.yaml` as the SSOT. B2T08 must be the only consumer, credential, quota, and rate-limit authority that creates `b2-consumer-<uuid>` and `b2-credential-<uuid>` with `mnj_live_`/`mnj_test_` keyIds, returns raw secrets once, stores only `secretHash`, supports rotation with 300s grace and revocation, enforces `UTC_CALENDAR_DAY` quotas and `TOKEN_BUCKET` rate limits, and exposes read-only ports to B2T10.

## 2. Decision

### 2.1 Consumer registry and state machine

`B2ApiConsumer` `DRAFT -> ACTIVE -> SUSPENDED -> REVOKED` (and `SUSPENDED -> ACTIVE` for reactivation) is the only consumer lifecycle. The consumer carries `displayName`, `consumerType` (`DEVELOPER`/`MERCHANT`/`AGENT`/`PARTNER`), `ownerCustomerId`/`ownerMerchantId`/`ownerAgentId` trace, `audience`/`scopes`, and `cohortKey` `b2.activation.cohort.inbound-funding` 1. `ACTIVE` is the only state that permits credential issuance, quota allotment, and rate-limit bucket creation.

### 2.2 Credential lifecycle

`B2ApiCredential` `ISSUED -> ROTATED -> REVOKED -> EXPIRED` is the only credential lifecycle. `kind` is `API_KEY` or `CLIENT_CREDENTIALS`, `keyId`/`clientId` is `mnj_live_` or `mnj_test_` + 24 alnum, `secretHash` is `argon2id$<salt>$<sha256>` (never raw), `sandboxType` is `SANDBOX` or `PRODUCTION`. Issuance via `generateCredentialDecision` returns `rawSecret` once in the transient `DecisionWithRawSecret` and persists only `secretHash`; rotation via `rotateCredentialDecision` generates a new `keyId`/`rawSecret`/`secretHash` and sets `rotationNextKeyId` with the old `secretHash` valid for `300s` grace; revocation via `revokeCredentialDecision` sets `REVOKED`; expiry is time-based beyond `expiryAt`.

### 2.3 Determinism and replay

`requestHash` is `sha256(stableJson(..., idempotencyKey))` excluding `consumerReference`/`credentialReference`/`createdAt`; `decisionHash`/`decisionReplayHash` follow the B2T03–T06 pattern keyed on `b2.api-consumer.idempotency.v1` (`86400s`). Same `Idempotency-Key`+same cohort+same hash replays the original `consumerReference`/`credentialReference` with `replayed:true`; same key+different hash is `409` `B2_API_CONSUMER_REPLAY_CONFLICT` with `conflict:true`.

### 2.4 Quota and rate limiting

Quota is per-consumer `ApiQuotaV1` (`commercial.read` `5000`, `commercial.write` `500`, `webhooks.manage` `100` per `UTC_CALENDAR_DAY`, states `ALLOCATED`/`EXCEEDED`, `X-Quota-*` headers, `429` with `X-Quota-Remaining: 0`). Rate limiting is per-consumer `RateLimitBucket` (`global` `100/2` `burst 100`, `commercial.read` `50/0.83`, `commercial.write` `20/0.33`, `commercial.activations:write` `10/0.16` burst 20, `webhooks:delivery` `5/0.08`, strategy `TOKEN_BUCKET`, states `ALLOWED`/`THROTTLED`, `429` with `Retry-After` + `X-RateLimit-*`). Both are the only B2 quota/rate-limit authorities and integrate with `MetricsService` and `IdempotencyService` via `b2.api-consumer.idempotency.v1`.

### 2.5 Persistence and read-only surface

Four tables (`b2_api_consumer`, `b2_api_credential`, `b2_api_quota`, `b2_rate_limit_bucket`) are the only persistence surfaces, each with `idempotencyScope` `b2.api-consumer.idempotency.v1` and `correlationId`. No table contains a raw `secret` column — only `secret_hash` (length 200). The module exposes `getConsumerPorts()` and `generateConsumerDecision`/`generateCredentialDecision`/`rotateCredentialDecision`/`revokeCredentialDecision`/`createQuotaDecision`/`checkQuota`/`createRateLimitBucket`/`consumeRateLimitToken` read-only to B2T10, reusing `Customer.id`/`Merchant.id`/`Agent.id` owner traces and the shared `IdempotencyService`/`AuditService`/`OutboxService`/`MetricsService`.

## 3. Consequences

- B2T10 has exactly one read-only consumer/credential/quota/rate-limit source; every public route in `docs/api/B2-OPENAPI-v1.yaml` can be gated by `ApiConsumer.ACTIVE` + `ApiCredential` not `REVOKED`/`EXPIRED` + `ALLOCATED` + `ALLOWED`.
- Raw secrets are returned once, hashed immediately to `secretHash` (`argon2id$<salt>$sha256`), and never persisted, logged, or replayed in the stored `record` JSONB.
- Sandbox and production credential separation is enforced by `keyId` prefix (`mnj_test_` vs `mnj_live_`) and `sandboxType`; rotation grace is `300s` and revocation is immediate with `REVOKED`.
- The consumer state machine is `DRAFT->ACTIVE->SUSPENDED->REVOKED` (+ `SUSPENDED->ACTIVE`); no consumer `REVOKED` grants quota or rate-limit.

## 4. Alternatives considered

- **Separate credential vault per kind (API_KEY vs CLIENT_CREDENTIALS):** Rejected — multiplied migrations and idempotency scopes with cross-kind collisions.
- **Storing raw secrets for rotation verification:** Rejected — would create a second secret vault and log raw secrets in the `record` JSONB.
- **Leaky quota as token bucket:** Rejected — would conflate the `UTC_CALENDAR_DAY` calendar window with the refill-based token bucket and lose the `EXCEEDED`→`ALLOCATED` daily reset invariant.
