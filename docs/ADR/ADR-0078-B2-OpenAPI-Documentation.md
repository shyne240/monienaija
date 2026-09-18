# ADR-0078 — B2 OpenAPI Specification and Public API Documentation

- **ADR ID:** ADR-0078
- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T07 — OpenAPI Specification and Public API Documentation
- **Status:** Accepted (B2T07 implementation — documentation only)
- **Review snapshot:** `b2t07` (B2T07 implementation commit; B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)
- **Scope:** Canonical OpenAPI 3.1 specification `docs/api/B2-OPENAPI-v1.yaml` as the single source of truth for the ten B2 public routes, frozen request/response schemas, JWT bearer security with audience/scopes, error models, rate limits, quotas, idempotency headers, version negotiation, examples, tags, components, and security schemes for `b2.activation.cohort.inbound-funding` v1
- **Authoritative boundary:** `B2ApiDocumentationContractV1` per `docs/B2-API-DOCUMENTATION-CONTRACT.md`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, webhook, credential, secret, ledger, commercial, public-channel, and B2 activation changes beyond the B2T07 scope:** None (B2T07 never creates a controller, a route, or a credential)

This ADR records the OpenAPI as the frozen documentation contract without a runtime route.

## 1. Context

B2T02 froze `B2-PUBLIC-API-CATALOG` v1 with eight public routes plus `GET /v1/health` and `GET /v1/support/activations/{activationReference}` — each with `v1` + `Accept`, `aud`/`scope`, `idempotencyScope` (`b2.*.*:create` `86400s`), `quotaGroup`/`quotaCost`, `rateLimitTier`/`cost`, `B2-Api-Version`, and `B2Error`. B2T07 must publish that catalog as a deterministically generated OpenAPI 3.1 YAML whose `paths` object is bijective with the B2T02 table and whose `components` freeze the request/response schemas, security, idempotency, quota/rate-limit, version negotiation, error models, examples, tags, and security schemes.

## 2. Decision

### 2.1 Single source of truth

The B2T07 freeze is `docs/api/B2-OPENAPI-v1.yaml` (`openapi: 3.1.0`, `info.version: 1.0.0`, `servers` `https://api.monienaija.com/v1` production + `https://sandbox-api.monienaija.com/v1` sandbox) as the only source of truth. The seven `tags` are `commercial-activations`, `commercial-catalog`, `authentication`, `webhooks`, `consents`, `health`, `support`; the single `components/securitySchemes` is `bearerAuth` `type: http` `scheme: bearer` `bearerFormat: JWT`; the `paths` object contains exactly the ten `operationId` values `b2.post-commercial-activations` … `b2.get-support-read`.

### 2.2 Exact match with the B2T02 catalog

Each `paths` entry carries the B2T02 row's `operationId`, `method`, `pathTemplate`, `b2ApiVersion` `v1`, `audiences` (`public:commercial:activation:b2:inbound-funding:write` for `POST /commercial/activations`, etc.), `scopes` (`b2:activation:write` etc.), `idempotencyScope` (`b2:commercial:activations:create` etc. or `null` for `GET`), `quotaGroup` (`commercial.write:daily:500` etc. or `null` for `POST /auth/token` + `GET /health`), `rateLimitTier` (`b2:global` 100 rps … `b2:webhooks:manage` 5 rps), and `security` (`bearerAuth: []` on eight routes, `security: []` on `POST /auth/token` + `GET /health`). The operation description documents `Accept: application/vnd.monienaija.v1+json` negotiation and `B2-Api-Version: v1`.

### 2.3 Schemas, security, idempotency, quota, errors, versioning

The `components` freezes sixteen `schemas` (`B2ActivationCreateRequest` with `kind` `CUSTOMER`|`MERCHANT`|`AGENT`, `readinessOutcome` must `ATTESTED_READY`, `B2TokenRequest` with `clientId` `mnj_live_` `24` alnum, `B2WebhookRegistrationRequest` with `https://` allowlist + `HMAC_SHA256` + `secret` hash-only, `B2ConsentCreateRequest` with `MARKETING_COMMERCIAL_OFFER` channel rule), the eight shared `responses` (`BadRequest` `400` `B2_API_MALFORMED` through `WrongVersion` `406`), the four header sets `B2ApiVersion`/`X-RateLimit-*`/`X-Quota-*`/`Retry-After`, and the four `parameters` (`XRequestId`, `XCorrelationId`, `AcceptHeader`, `IdempotencyKey` uuid `required: true` where `idempotencyScope` is present). `tags` covers the seven tags, `securitySchemes` covers the single `bearerAuth`, and every `2xx` response carries `B2-Api-Version: v1`.

## 3. Consequences

- `docs/api/B2-OPENAPI-v1.yaml` is the only public API documentation; `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md` §5 remains the `additionalProperties: false` invariant source, `docs/B2-API-DOCUMENTATION-CONTRACT.md` documents the freeze.
- No `additionalProperties: false` violation, no `operationId`/`pathTemplate`/`method`/`aud`/`scope`/`idempotencyScope`/`quotaGroup`/`rateLimitTier` drift, and no raw `clientSecret`/webhook `secret` in a response is possible without failing the B2T07 OpenAPI lint fixture.
- No NestJS controller, runtime route, middleware, authentication implementation, or API key generation is introduced; `docs/api/B2-OPENAPI-v1.yaml` is the deterministic artifact from the B2T02 catalog at v1.

## 4. Alternatives considered

- **OpenAPI 3.0 + auto-generated controllers:** Rejected — would conflate the documentation SSOT with a runtime route implementation and collapse the B2T07 non-goal.
- **Swagger 2.0 `host`/`basePath` without `/v1` prefix:** Rejected — would lose the `v1` + `Accept` version negotiation contract required by `B2-PUBLIC-API-CATALOG-CONTRACT.md` §5.
- **Separate YAML per tag:** Rejected — would fragment the single source of truth and lose the bijective `paths` ↔ B2T02 table invariant.
