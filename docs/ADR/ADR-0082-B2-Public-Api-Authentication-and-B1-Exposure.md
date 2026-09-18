# ADR-0082 — B2 Public API Authentication and B1 Capability Exposure

- **ADR ID:** ADR-0082
- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T10 — Public API Authentication and B1 Commercial Capability Exposure
- **Status:** Accepted (B2T10 implementation)
- **Review snapshot:** `b2t10` (B2T10 implementation commit; B2T09 + B2T08 + B2T07 + B2T06 + B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)
- **Scope:** The only B2 public API authentication integration for the bounded first cohort `b2.activation.cohort.inbound-funding` v1. Every public B2 route (`/v1/commercial/activations`, `/v1/commercial/activations/{reference}`, `/v1/commercial/catalog`, `/v1/commercial/plans/{planKey}`, `/v1/commercial/tiers/{tierKey}`, `/v1/auth/token`, `/v1/webhooks/registrations`, `/v1/consents`, `/v1/health`, `/v1/support/activations/{reference}`) is A2 audience/scope/exp + consumer `ACTIVE` + credential `ISSUED`/`ROTATED` + consent `GRANTED` + A4 `ELIGIBLE` + quota `ALLOCATED` + rate-limit `ALLOWED` gated. `GET /v1/commercial/plans/{planKey}` outside the consumer's audience is `404` (`isLeakSafe404`, `auditWithoutLeak`); `GET` that would expose billing data for an unactivated/unconsented consumer is `403` with `REASON_CONSENT_REQUIRED`/`REASON_ACTIVATION_REQUIRED`. B1 plan/tier and B2 activation are exposed as audience-scoped, minimized reads via read-only consumer boundaries without creating a second catalog. The contract reuses `A2` `AuthenticationSession`/`PrivilegedActionApproval` and never creates a second vault.
- **Authoritative boundary:** `B2PublicApiAuthenticationContractV1` per `docs/B2-PUBLIC-API-AUTHENTICATION-CONTRACT.md`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, webhook, credential, ledger, commercial, public-channel, JWT, financial effect, activation execution, partner communication, and B2 activation changes beyond the B2T10 scope:** None (B2T10 never creates a public API controller beyond the contract, never mints a JWT, never mutates A3/A4/B1/Ledger)

This ADR records the deterministic public API authentication integration without a second session/token vault.

## 1. Context

B2T01 selected `b2.activation.cohort.inbound-funding` v1; B2T02 froze `B2-PUBLIC-API-CATALOG` v1 with ten `operationId` values and seven `tags`; B2T07 generated `docs/api/B2-OPENAPI-v1.yaml` as the SSOT; B2T05 implemented `b2-activation-<uuid>` with `PENDING -> ACTIVE -> SUSPENDED -> REVOKED` gated by `ATTESTED_READY`; B2T08 implemented `b2-consumer-<uuid>` / `b2-credential-<uuid>` with `mnj_live_` `secretHash` and token-bucket/quota; B2T09 implemented webhook `PENDING_VERIFICATION -> VERIFIED`. B2T10 must be the only gate that combines `aud`/`scope`/`exp` + `ACTIVE` + `ISSUED` + `GRANTED` + `ELIGIBLE` + `ALLOCATED` + `ALLOWED` for every public route and that exposes `commercial.virtual-account.inbound-funding` `TIER`/`PLAN` and `b2-activation-*` as `404`-safe minimized reads.

## 2. Decision

### 2.1 Integration

B2T10 freezes `B2-PUBLIC-API-AUTHENTICATION` v1 with dedicated `b2.public-api-authentication.idempotency.v1` (`86400s`), reference `b2-public-api-auth-<uuid>`, audit `b2_public_api_authentication`, and outbox `b2.public-api.authentication.decided.v1`. The request is `B2PublicApiAuthenticationRequestV1` (`method`, `pathTemplate`, `token` `aud`/`scope`/`exp`/`sub`, `consumerState` `ACTIVE`, `credentialState` `ISSUED`/`ROTATED`, `consentState` `GRANTED`, `activationState` `ACTIVE`, `quotaState` `ALLOCATED`, `rateLimitState` `ALLOWED`, `a4EligibilityState` `ELIGIBLE`, `cohortKey` `b2.activation.cohort.inbound-funding` 1, `hasBillingData`, `requestedPlanKey`).

### 2.2 Gate order and leak-safety

The gate order is `401` unauthenticated (no `token`) → `403` wrong audience (`aud` ≠ `ROUTE_AUDIENCE[path]`) → `401` expired (`exp < now`) → `403` wrong scope (`scope` ∉ `ROUTE_SCOPE[path]`) → `403` `CONSUMER_NOT_ACTIVE` → `401` `CREDENTIAL_REVOKED` → `403` `CONSENT_REQUIRED` (when `hasBillingData && consent != GRANTED`) → `403` `ACTIVATION_REQUIRED` (when `hasBillingData && activation != ACTIVE`) → `403` `A4_NOT_ELIGIBLE` → `429` `QUOTA_EXCEEDED` → `429` `RATE_LIMITED` → `404` `NOT_FOUND` (`isLeakSafe404:true`, `auditWithoutLeak:true`) for `GET /v1/commercial/plans/{planKey}` where `planKey ∉ ALLOWED_B1_PLANS` for the caller's audience → `200` `AUTHENTICATED`. Every gate is `fail closed` without touching `B1` or `A4` on the early `401`/`403` paths; the `404` leak-safe path is audit-recorded without the `requestedPlanKey` in the `record` JSONB.

### 2.3 B1 exposure

`exposeB1Catalog(request)` and `exposeB1Plan(request, planKey)` read `B1` via the approved read-only `B1T02` catalog boundary (`commercial.virtual-account.inbound-funding` 1) and return a minimized `B2B1CatalogViewV1` (`plans` `commercial.virtual-account.inbound-funding` / `commercial.virtual-account.inbound-funding.fee`, `tiers` `tier.b2.inbound-funding.standard` / `premium`, `minimal:true`) only on `AUTHENTICATED`. Consumer-scoped visibility (`planKey` outside the consumer's `audience` → `404` not `403`) is enforced without leaking `Customer.id`/`A3`/`CustomerPreference`.

### 2.4 Determinism and replay

`requestHash` is `sha256(stableJson(method, pathTemplate, aud, scope, exp, sub, consumerState, credentialState, consentState, activationState, quotaState, rateLimitState, a4EligibilityState, cohortKey, requestedPlanKey, hasBillingData, idempotencyKey))` excluding `authReference`/`createdAt`; `decisionHash`/`decisionReplayHash` follow the `B2T03–09` pattern keyed on `b2.public-api-authentication.idempotency.v1`. Same `Idempotency-Key`+same hash replays with `replayed:true`; same key+different hash is `409` `B2_AUTH_REPLAY_CONFLICT`.

### 2.5 Persistence

`b2_public_api_authentication` (migration `1785753600045`) is the only persistence surface, with unique `authReference,authVersion` and indexes on `pathTemplate`/`outcome`/`cohort`/`requestHash`/`idempotencyScope+key`/`correlationId`. The `record` JSONB never stores a raw `clientSecret`/`secret`.

## 3. Consequences

- Every public B2 route in `docs/api/B2-OPENAPI-v1.yaml` is `401` on unauthenticated/`401` on expired, `403` on wrong audience/scope/`CONSUMER_NOT_ACTIVE`/`CREDENTIAL_REVOKED`/`CONSENT_REQUIRED`/`ACTIVATION_REQUIRED`/`A4_NOT_ELIGIBLE`, `429` on quota/rate-limit, `404` leak-safe on outside-audience plan, without touching `B1`/`A4` on the early paths, and without mutating `A3`/`A4`/`B1`/`Ledger`.
- No second `AuthenticationSession`/`PrivilegedActionApproval` vault, no second `B1` catalog, and no `Customer.id` inference across consumers.
- The integration is `REPEATABLE READ` read-only except the `IdempotencyService` reservation and `AuditService` write via `OperationsModule`.

## 4. Alternatives considered

- **Separate `401` vault per route:** Rejected — multiplied idempotency scopes with cross-route collisions; the single `b2.public-api-authentication.idempotency.v1` with path-distinct `requestHash` already isolates replay.
- **Returning `403` for outside-audience plans:** Rejected — would leak `planKey` existence across `public:commercial:...:read` audiences.
- **Storing raw `B1` billing data in the public `GET` response:** Rejected — would expose `b2-activation-*` billing without `GRANTED`/`ACTIVE`, violating the `403` `CONSENT_REQUIRED`/`ACTIVATION_REQUIRED` contract.
