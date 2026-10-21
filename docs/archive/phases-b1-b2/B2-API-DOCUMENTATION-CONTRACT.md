# B2T07 — OpenAPI Specification and Public API Documentation Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T07 — OpenAPI Specification and Public API Documentation
- **Contract:** `B2ApiDocumentationContractV1` (`B2-API-DOCUMENTATION` v1) — OpenAPI `docs/api/B2-OPENAPI-v1.yaml` (OpenAPI 3.1) as the single source of truth
- **ADR:** ADR-0078 — B2 OpenAPI Specification and Public API Documentation
- **Status:** Accepted (B2T07 implementation — documentation only)
- **Review snapshot:** `b2t07` (B2T07 implementation commit; B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)

This document defines the B2 OpenAPI 3.1 specification as the canonical public API documentation that exactly matches the route catalog frozen in `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md`.

## 1. Purpose and boundary

The OpenAPI specification `docs/api/B2-OPENAPI-v1.yaml` is the single source of truth for every B2 public route. No runtime controller, NestJS route implementation, authentication implementation, webhook implementation, API key generation, or business logic is introduced by B2T07. The specification freezes request/response schemas, authentication documentation, idempotency documentation, quota and rate-limit documentation, version negotiation, and examples for the ten operations defined in B2T02.

The ten operations are the exact set from `B2-PUBLIC-API-CATALOG` v1 (eight public routes plus two health/support reads); any path not in the OpenAPI is `404` `B2_API_NOT_FOUND` and is an unapproved capability.

## 2. Contract identity

- **Contract name:** `B2-API-DOCUMENTATION`
- **Contract version:** `1`
- **Contract document:** `docs/B2-API-DOCUMENTATION-CONTRACT.md`
- **OpenAPI file:** `docs/api/B2-OPENAPI-v1.yaml` (OpenAPI 3.1, deterministic generation from the B2T02 catalog)
- **OpenAPI version:** `3.1.0`
- **Info version:** `1.0.0`
- **API version:** `v1` (`/v1` prefix + `Accept: application/vnd.monienaija.v1+json` + `B2-Api-Version` response header)

## 3. Route catalog — exact match

The OpenAPI `paths` object contains exactly the ten operations from the B2T02 route catalog `§5`:

| `operationId` | Method | `path` | Description |
| --- | --- | --- | --- |
| `b2.post-commercial-activations` | `POST` | `/v1/commercial/activations` | `b2-activation-workflow` idempotent create (`b2:commercial:activations:create`) |
| `b2.get-commercial-activations-id` | `GET` | `/v1/commercial/activations/{activationReference}` | Audience-scoped read |
| `b2.get-commercial-catalog` | `GET` | `/v1/commercial/catalog` | Minimized B1 catalog read |
| `b2.get-commercial-plans-planKey` | `GET` | `/v1/commercial/plans/{planKey}` | Minimized plan read |
| `b2.get-commercial-tiers-tierKey` | `GET` | `/v1/commercial/tiers/{tierKey}` | Minimized tier read |
| `b2.post-auth-token` | `POST` | `/v1/auth/token` | `client_credentials` exchange for an A2-scoped JWT (15m) |
| `b2.post-webhooks-registrations` | `POST` | `/v1/webhooks/registrations` | HTTPS allowlisted, `HMAC_SHA256` challenge `PENDING_VERIFICATION` |
| `b2.post-consents` | `POST` | `/v1/consents` | Explicit `GRANTED` intent for four purposes |
| `b2.get-health` | `GET` | `/v1/health` | Platform health (no B2 audience) |
| `b2.get-support-read` | `GET` | `/v1/support/activations/{activationReference}` | Minimized support trace (legal-hold aware) |

A path, method, `operationId`, or `pathTemplate` that appears in the OpenAPI but not in the B2T02 table is a contract violation; a path, method, `operationId`, or `pathTemplate` that appears in the B2T02 table but not in the OpenAPI is a contract violation. The two enumerations are bijective at `v1`.

## 4. Frozen request/response schemas

Each operation's `requestBody` and `responses['200'|'201']` reference a `components/schemas` component frozen at v1 with `additionalProperties: false`:

- `B2ActivationCreateRequest` (`kind` `CUSTOMER`|`MERCHANT`|`AGENT`, `principalId` uuid, `cohortKey` `b2.activation.cohort.inbound-funding`, `readinessOutcome` must `ATTESTED_READY` via B2T03/B2T04, never recalculated) — `201` `B2ActivationCreateResponse` (`activationReference` `b2-activation-<uuid>`, `state` `PENDING`, dedicated scope `b2.activation-workflow.idempotency.v1`).
- `B2TokenRequest` (`clientId` `mnj_live_`/`mnj_test_` 24 alnum, `clientSecret` raw hash-only, `scope` subset of credential's scopes) — `200` `B2TokenResponse` (`accessToken` `exp` 900s, `scope`, `consumerId`).
- `B2WebhookRegistrationRequest` (`url` `https://` allowlisted, `events` `b2.activation.succeeded`/`suspended`/`b2.webhook.test`, `secret` `whsec_` raw `HMAC_SHA256`) — `201` `B2WebhookRegistrationResponse` (`PENDING_VERIFICATION`, `secretHashPrefix` 8 chars only).
- `B2ConsentCreateRequest` (`subjectCustomerId` uuid, `purpose` `B2_ACTIVATION`|`B2_COMMERCIAL`|`B2_SELF_SERVICE`|`MARKETING_COMMERCIAL_OFFER` with channel rule for `MARKETING_COMMERCIAL_OFFER`) — `201` `B2ConsentCreateResponse` (`GRANTED`, `b2.consent.idempotency.v1`).
- `GET` catalog/plan/tier responses (`B2CatalogResponse`/`B2PlanResponse`/`B2TierResponse`) are minimized B1 data (`cohortKey` `b2.activation.cohort.inbound-funding`, `b1ScopeKey` `commercial.virtual-account.inbound-funding`, `b2ApiVersion` `v1`).
- `B2HealthResponse` (`status` `ok`, `version` `1.0.0`, `cohortKey`) and `B2SupportActivationResponse` (`PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED` minimized).

No schema contains a raw `clientSecret`/webhook `secret` in its response; `secret` is request-only, hashed immediately to `secretHash`.

## 5. Frozen authentication documentation

The OpenAPI `components/securitySchemes` defines `bearerAuth` (`type: http`, `scheme: bearer`, `bearerFormat: JWT`) and documents `aud` (`public:commercial:activation:b2:inbound-funding:read|write`, `public:webhooks:b2:manage`, `public:consents:b2:manage`, `public:support:b2:read`, `public:auth:token:exchange`) and `scope` (`b2:activation:read|write`, `b2:webhooks:manage`, `b2:consents:manage`, `b2:support:read`, `b2:auth:token:exchange`) per operation in `security`. `POST /v1/auth/token` is the only operation with `security: []` (anonymous `client_credentials`); `GET /v1/health` is also `security: []`. `POST /v1/commercial/activations` documents audience `public:commercial:activation:b2:inbound-funding:write` and scope `b2:activation:write`; the four catalog reads document `public:commercial:activation:b2:inbound-funding:read` + `b2:activation:read`, etc. Wrong `aud`/`scope` is `401`/`403` per `B2Error`.

## 6. Frozen idempotency documentation

The OpenAPI `components/parameters/IdempotencyKey` (`Idempotency-Key` `uuid`, `required: true`) is listed on every operation whose B2T02 entry carries an `idempotencyScope` ( `POST /v1/commercial/activations` `b2:commercial:activations:create`, `POST /v1/auth/token` `b2:auth:token:exchange`, `POST /v1/webhooks/registrations` `b2:webhooks:registrations:create`, `POST /v1/consents` `b2:consents:create`). `GET` operations carry no `Idempotency-Key` and have `idempotencyScope: null`. The description documents `86400s` window, `sha256(stableJson(..., idempotencyKey))` excluding `activationReference`/`createdAt`, `409` `B2_API_IDEMPOTENCY_CONFLICT` on same key+different body hash, and `422` `B2_API_IDEMPOTENCY_REQUIRED` when required but absent.

## 7. Rate limits and quotas — frozen headers

Every `2xx` operation response documents `B2-Api-Version: v1` plus `X-RateLimit-Limit`/`X-RateLimit-Remaining`/`X-RateLimit-Reset` and, where `quotaGroup` is present, `X-Quota-Limit`/`X-Quota-Remaining`/`X-Quota-Reset`. `429` `TooManyRequests` documents `Retry-After` plus the same four headers. The tier `b2:global` 100 rps / `b2:commercial:read` 50 rps / `b2:commercial:activations:write` 10 rps burst 20 / `b2:webhooks:manage` 5 rps and quota groups `commercial.read:daily:5000` (cost 1) / `commercial.write:daily:500` (cost 1) / `webhooks.manage:daily:100` (cost 1) are documented per operation in `description` and mirrored in the rate-limit/quota header examples.

## 8. Error models

The OpenAPI `components/schemas/B2Error` and `components/responses` (`BadRequest` `400` `B2_API_MALFORMED`, `Unauthorized` `401` `B2_API_UNAUTHORIZED`, `Forbidden` `403` `B2_API_FORBIDDEN`/`B2_API_FORBIDDEN_CONSENT`/`B2_API_FORBIDDEN_COHORT`, `NotFound` `404` `B2_API_NOT_FOUND` (not `403` leak for audience-scoped `GET`s), `ConflictIdempotency` `409` `B2_API_IDEMPOTENCY_CONFLICT`, `UnprocessableIdempotencyRequired` `422` `B2_API_IDEMPOTENCY_REQUIRED`, `TooManyRequests` `429` `B2_API_RATE_LIMITED`/`B2_API_QUOTA_EXCEEDED`, `WrongVersion` `406` `B2_API_WRONG_VERSION`) are referenced by every operation. Each error response carries `B2-Api-Version: v1` and `b2ApiVersion: v1` plus `code`/`message`/`field`/`retryAfter` per `B2Error`.

## 9. Version negotiation

The OpenAPI `components/parameters/AcceptHeader` (`Accept: application/vnd.monienaija.v1+json | application/json`, `required: false`, `default: application/vnd.monienaija.v1+json`) and the description document `v1` (`/v1` prefix) `->` negotiates to `v1`; absent negotiates to `v1`; unknown `v2` is `406` `B2_API_WRONG_VERSION`; `410` `B2_API_DEPRECATED` uses `Deprecation: true` + `Sunset: <HTTP-date>` after a 90-day sunset for a future version. No operation is `DEPRECATED`/`SUNSET` at v1. Every `2xx` operation response documents `B2-Api-Version: v1`.

## 10. Tags, components, and security schemes

The OpenAPI `tags` list is `commercial-activations`, `commercial-catalog`, `authentication`, `webhooks`, `consents`, `health`, `support` — each tag appears on at least one operation and no operation carries a tag not in the list. `components/securitySchemes: { bearerAuth }` is the only security scheme at `v1`; `bearerAuth` `type: http` `scheme: bearer` `bearerFormat: JWT` with `aud` as the B2 audience and `scope` as the `b2:*` scope set (lexically sorted, subset of the credential's granted scopes). `components/parameters` defines `XRequestId`, `XCorrelationId`, `AcceptHeader`, `IdempotencyKey`, `ActivationReference`, `PlanKey`, `TierKey`; `components/headers` defines `B2ApiVersion`, `XRateLimitLimit`, `XRateLimitRemaining`, `XRateLimitReset`, `XQuotaLimit`, `XQuotaRemaining`, `XQuotaReset`; `components/responses` defines eight shared responses and `components/schemas` defines sixteen schemas plus `B2Error`.

## 11. Examples and schemas

Each `requestBody` carries an `examples` map with a `customerReady`/`b2-activation`/`webhook`/`token` example that is a valid instance of its `schema` with `ATTESTED_READY` where readiness is exposed and with `https://` where a webhook `url` is exposed. `components/schemas` defines each request schema with `required` array and `additionalProperties: false`, each response schema with `required` array, and `B2Error` with `b2ApiVersion: v1` and `code` enum of 15 `B2_API_*` values. The `mock` `example` is never `b2.activation.cohort.other` and never a non-allowlisted host.

## 12. Verification

- [x] The OpenAPI specification is the single source of truth — every public route at v1 appears in `paths` and every `paths` entry appears in the B2T02 catalog table §5 (ten operations, eight public routes plus two health/support reads).
- [x] Request/response schemas are frozen as sixteen `components/schemas` with `additionalProperties: false` where applicable, `required` arrays, `pattern`/`format`/`enum` constraints, and `b2ApiVersion: v1` on every success response.
- [x] Authentication documentation is frozen as `bearerAuth` `JWT` with `aud` `public:*` and `scope` `b2:*` per operation, `POST /v1/auth/token` anonymous, `GET /v1/health` anonymous, and `401`/`403` on wrong `aud`/`scope`.
- [x] Idempotency documentation is frozen as `Idempotency-Key` uuid per route's `idempotencyScope` (`b2.*.*:create` `86400s`, `409` on same key+different hash, `422` when required but absent) with `stableJson(..., idempotencyKey)` excluding `activationReference`/`createdAt`.
- [x] Quota and rate-limit documentation is frozen as `X-RateLimit-*`/`X-Quota-*` (`Retry-After` on `429`) plus per-operation tier `b2:global` 100rps / `b2:commercial:read` 50rps / `b2:commercial:activations:write` 10rps burst 20 / `b2:webhooks:manage` 5rps and groups `commercial.read:5000`/`commercial.write:500`/`webhooks.manage:100` cost 1.
- [x] Version negotiation `v1` (`/v1` + `Accept` `application/vnd.monienaija.v1+json`) with `B2-Api-Version: v1` on every response, `Deprecation: true` + `Sunset` when deprecated (none at v1), `406` on `Accept: v2` at `v1`, `410` after `Sunset`.
- [x] No runtime controller, NestJS route implementation, authentication implementation, webhook implementation, API key generation, or business logic is introduced by B2T07.
- [x] `tags` covers the seven tags (`commercial-activations`, `commercial-catalog`, `authentication`, `webhooks`, `consents`, `health`, `support`), `components/securitySchemes` covers the single `bearerAuth`, and the OpenAPI is `3.1.0` with `info.version: 1.0.0`.

### Evidence limitations

- B2T07 is OpenAPI and documentation only. It does not create a NestJS controller, a runtime route, a middleware, a `clientSecret`/`webhook` `secret` generator, or an authentication or consent or activation business rule.
- B2T07 does not call a live partner, a live KYC, a live settlement, or a live bank API.
- B2T07 does not dispatch a webhook, rotate a credential, or post a ledger entry; those remain B2T08/B2T09/A5.
