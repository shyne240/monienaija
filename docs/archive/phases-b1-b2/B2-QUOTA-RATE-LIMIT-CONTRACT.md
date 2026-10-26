# B2T08 — B2 Quota and Rate-Limit Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T08 — API Consumer Registry, API Credentials, API Keys, Quotas, and Rate Limiting (quota & rate-limit)
- **Contract:** `B2QuotaRateLimitContractV1` (`B2-API-CONSUMER` v1 — quota `B2ApiQuotaDecisionV1` / rate-limit `B2ApiRateLimitDecisionV1`)
- **ADR:** ADR-0079 — B2 API Consumer Registry, Credentials, Quotas, and Rate Limiting
- **Status:** Accepted (B2T08 implementation)
- **Review snapshot:** `b2t08` (B2T08 implementation commit; B2T07 + B2T06 + B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)

This document defines the B2 quota policies and token-bucket rate limiting.

## 1. Purpose and boundary

The B2 quota policies and token-bucket rate limiting are the only B2-side quota and rate-limit authorities for the bounded first cohort `b2.activation.cohort.inbound-funding` v1. Quotas are per-consumer `UTC_CALENDAR_DAY` budgets; rate limiting is per-consumer `TOKEN_BUCKET` buckets. The authority never duplicates the A2 rate-limiting primitive, never posts a ledger entry, never performs a settlement, and never activates a merchant/agent.

## 2. Contract identity

- **Contract name:** `B2-API-CONSUMER` (shared with `docs/B2-API-CREDENTIALS-CONTRACT.md`)
- **Contract version:** `1`
- **Contract documents:** `docs/B2-API-CREDENTIALS-CONTRACT.md` and `docs/B2-QUOTA-RATE-LIMIT-CONTRACT.md`
- **Cohort key/version:** `b2.activation.cohort.inbound-funding` 1 (frozen)
- **Idempotency scope:** `b2.api-consumer.idempotency.v1` with `86400s` retention (dedicated)
- **Outbox event type:** `b2.api-consumer.decided.v1` (`INTERNAL`, `OPERATIONS_DEFAULT`)

## 3. Quota policies

### 3.1 Quota groups and limits

The three quota groups are `commercial.read` `5000`, `commercial.write` `500`, `webhooks.manage` `100` per `UTC_CALENDAR_DAY`. Each consumer has a `B2ApiQuota` row per group (unique `consumerId,quotaGroup`). The row stores `limit`, `remaining`, `window` `UTC_CALENDAR_DAY`, and `state` `ALLOCATED`/`EXCEEDED`.

### 3.2 Quota windows and state

The window resets at `00:00 UTC` daily; at reset `remaining` becomes `limit` and `state` becomes `ALLOCATED` without manual repair. A consumer whose group has `state` `EXCEEDED` is `429` `B2_API_CONSUMER_QUOTA_EXCEEDED` with `X-Quota-Remaining: 0` and `X-Quota-Reset: <next 00:00Z>` (never bypasses A2 authorization). `EXCEEDED` → `ALLOCATED` on the next calendar day is the only `EXCEEDED` exit.

### 3.3 Persistence

The quota is persisted in `b2_api_quota` (migration `1785753600043`) with unique `consumerId,quotaGroup` and `CHECK` `quota_group IN ('commercial.read','commercial.write','webhooks.manage')`, `limit IN (5000,500,100)`, `window = 'UTC_CALENDAR_DAY'`. `ALLOCATED`/`EXCEEDED` is the only quota lifecycle.

## 4. Rate-limit policies

### 4.1 Buckets and configs

The five buckets are `global`, `commercial.read`, `commercial.write`, `commercial.activations:write`, `webhooks:delivery` with `TOKEN_BUCKET` strategy and configs:

| `bucket` | `capacity` | `refillPerSecond` | `burst` |
| --- | --- | --- | --- |
| `global` | 100 | 2 | 100 |
| `commercial.read` | 50 | 0.83 | 50 |
| `commercial.write` | 20 | 0.33 | 20 |
| `commercial.activations:write` | 10 | 0.16 | 20 |
| `webhooks:delivery` | 5 | 0.08 | 5 |

Each consumer has a `B2RateLimitBucket` row per bucket (unique `consumerId,bucket`, `capacity`/`remaining`/`refillPerSecond`/`strategy` `TOKEN_BUCKET`/`state` `ALLOWED`/`THROTTLED`/`retryAfterSeconds`).

### 4.2 Token bucket and state

`consumeRateLimitToken(bucket, tokens)` is `ALLOWED` (`remaining >= tokens`, then `remaining -= tokens`, `retryAfterSeconds` null) or `THROTTLED` (`remaining < tokens`, then `remaining = 0`, `retryAfterSeconds = ceil((tokens - remainingBefore)/refillPerSecond)`). The token count is deterministically refilled per `refillPerSecond` up to `capacity` (`burst`). A `THROTTLED` bucket is `429` `B2_API_CONSUMER_RATE_LIMITED` with `Retry-After` + `X-RateLimit-Limit`/`X-RateLimit-Remaining`/`X-RateLimit-Reset` (never bypasses A2 authorization or `EXCEEDED` quota).

### 4.3 Persistence

The bucket is persisted in `b2_rate_limit_bucket` (migration `1785753600043`) with unique `consumerId,bucket` and `CHECK` `bucket IN (...)`, `strategy = 'TOKEN_BUCKET'`, `state IN ('ALLOWED','THROTTLED')`. `last_refill_at` advances on refill.

## 5. Idempotency, replay, and read-only consumer ports

Both quota and rate-limit decisions are recorded with the dedicated `b2.api-consumer.idempotency.v1` scope (same scope as consumer/credential). A quota allotment `createQuotaDecision` and a rate-limit bucket `createRateLimitBucket` are idempotent per `consumerId,quotaGroup|bucket` and replay-safe (`86400s`, `decisionReplayHash` excludes `consumerId`/`createdAt`). The contract exposes `B2ApiConsumerConsumerPortsV1` (`contractName` `B2-API-CONSUMER`, `idempotencyScope` `b2.api-consumer.idempotency.v1`, `cohortKey` `b2.activation.cohort.inbound-funding` 1) and `createQuotaDecision`/`checkQuota`/`createRateLimitBucket`/`consumeRateLimitToken` read-only to B2T10. The ports reuse `Customer.id`/`Merchant.id`/`Agent.id` owner traces without creating a second Customer authority.

## 6. Verification

- [x] The contract is frozen as `B2-API-CONSUMER` v1 with `B2ApiQuotaDecisionV1` (`commercial.read` 5000 / `commercial.write` 500 / `webhooks.manage` 100 per `UTC_CALENDAR_DAY`, `ALLOCATED`/`EXCEEDED`) and `B2ApiRateLimitDecisionV1` (`global` 100/2 burst 100 etc., `TOKEN_BUCKET`, `ALLOWED`/`THROTTLED`, `retryAfterSeconds`).
- [x] The quota lifecycle is `ALLOCATED -> EXCEEDED` per `UTC_CALENDAR_DAY` with `00:00Z` reset to `ALLOCATED`; the rate-limit lifecycle is `ALLOWED -> THROTTLED` per token bucket with `Retry-After`.
- [x] The persistence `b2_api_quota` (unique `consumerId,quotaGroup`) and `b2_rate_limit_bucket` (unique `consumerId,bucket`) with `CHECK`s are the only B2 quota/rate-limit persistence surfaces.
- [x] The authority is replay-safe per dedicated `b2.api-consumer.idempotency.v1` `86400s` and deterministic (`requestHash` excludes `consumerId`/`createdAt` where applicable).
- [x] The authority is the only B2 quota and rate-limit authority; it never duplicates the A2 rate-limiting primitive, never posts a ledger entry, and never grants `ALLOCATED`/`ALLOWED` to a `REVOKED` consumer or `REVOKED`/`EXPIRED` credential.
- [x] No ADR beyond ADR-0079 is authored by this contract.

### Evidence limitations

- B2T08 quota/rate-limit policy is a policy store; the token-bucket check middleware (B2T10) and the `429` `Retry-After` + `X-RateLimit-*`/`X-Quota-*` headers are `docs/api/B2-OPENAPI-v1.yaml` documentation at `v1` (the store never serves a public API directly).
