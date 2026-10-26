# B2T10 — B2 Public API Authentication and B1 Capability Exposure Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T10 — Public API Authentication and B1 Commercial Capability Exposure
- **Contract:** `B2PublicApiAuthenticationContractV1` (`B2-PUBLIC-API-AUTHENTICATION` v1) — `B2PublicApiAuthenticationDecisionV1` / `B2PublicApiAuthenticationRequestV1` / `B2B1CatalogViewV1` / `B2B1PlanViewV1`
- **ADR:** ADR-0082 — B2 Public API Authentication and B1 Capability Exposure
- **Status:** Accepted (B2T10 implementation)
- **Review snapshot:** `b2t10` (B2T10 implementation commit; B2T09 + B2T08 + B2T07 + B2T06 + B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)

This document defines the B2 public API authentication integration that gates every public B2 route and exposes B1 as audience-scoped, minimized reads.

## 1. Purpose and boundary

The B2 public API authentication is the only B2-side public-surface authentication integration for the bounded first cohort `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1. Every public `GET /v1/commercial/catalog|plans|tiers`, `POST /v1/commercial/activations`, `POST /v1/auth/token`, `POST /v1/webhooks/registrations`, `POST /v1/consents`, `GET /v1/support/activations/{reference}`, and `GET /v1/health` is `A2` audience/scope/`exp` + `b2_api_consumer` `ACTIVE` + `b2_api_credential` `ISSUED`/`ROTATED` + `b2_consent` `GRANTED` + `B2Activation` `ACTIVE` + `b2_api_quota` `ALLOCATED` + `b2_rate_limit_bucket` `ALLOWED` + `A4` `ELIGIBLE` gated. `GET /v1/commercial/plans/{planKey}` outside the consumer's audience is `404` (`isLeakSafe404`, `auditWithoutLeak`); `GET` that would expose billing data for an unactivated/unconsented consumer is `403` with `REASON_CONSENT_REQUIRED`/`REASON_ACTIVATION_REQUIRED`. No `GET`/`POST` mutates `A3` bindings, `A4` policy, `B1` decisions, or `Ledger`; the contract reuses `A2` `AuthenticationSession`/`PrivilegedActionApproval` and never creates a second vault.

## 2. Contract identity

- **Contract name:** `B2-PUBLIC-API-AUTHENTICATION`
- **Contract version:** `1`
- **Contract document:** `docs/B2-PUBLIC-API-AUTHENTICATION-CONTRACT.md`
- **Cohort key/version:** `b2.activation.cohort.inbound-funding` 1 (frozen; see `docs/B2-ACTIVATION-BASELINE.md` §4)
- **B1 scope:** `commercial.virtual-account.inbound-funding` 1 (`VIRTUAL_ACCOUNT` 1, `NIBSS_NIP`, `NGN`/`CUSTOMER_FUNDS`/`NG`)
- **Idempotency scope:** `b2.public-api-authentication.idempotency.v1` with `86400s` retention (dedicated)
- **Audit entity type / actor:** `b2_public_api_authentication` / `b2-public-api-authentication`
- **Outbox event type:** `b2.public-api.authentication.decided.v1` (`INTERNAL`, `OPERATIONS_DEFAULT`)
- **Reference prefix:** `b2-public-api-auth-`
- **B1 plans:** `commercial.virtual-account.inbound-funding`, `commercial.virtual-account.inbound-funding.fee`
- **B1 tiers:** `tier.b2.inbound-funding.standard`, `tier.b2.inbound-funding.premium`

## 3. Public routes and audience/scope mapping

Every public B2 route in `docs/api/B2-OPENAPI-v1.yaml` (`openapi: 3.1.0`, `info.version: 1.0.0`) is `A2` audience/scope-protected unless explicitly `security: []`:

| Path template | Method | Expected `aud` | Expected `scope` | `idempotencyScope` present |
| --- | --- | --- | --- | --- |
| `/v1/commercial/activations` | `POST` | `public:commercial:activation:b2:inbound-funding:write` | `b2:activation:write` | `b2.public-api-authentication.idempotency.v1` |
| `/v1/commercial/activations/{activationReference}` | `GET` | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | same |
| `/v1/commercial/catalog` | `GET` | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | same |
| `/v1/commercial/plans/{planKey}` | `GET` | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | same |
| `/v1/commercial/tiers/{tierKey}` | `GET` | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | same |
| `/v1/webhooks/registrations` | `POST` | `public:webhooks:b2:manage` | `b2:webhooks:manage` | same |
| `/v1/consents` | `POST` | `public:consents:b2:manage` | `b2:consents:manage` | same |
| `/v1/support/activations/{activationReference}` | `GET` | `public:support:b2:read` | `b2:support:read` | same |
| `/v1/auth/token` | `POST` | — (anonymous `client_credentials`) | `b2:auth:token:exchange` | `b2.auth:token:exchange` (not this scope) |
| `/v1/health` | `GET` | — | — | none |

`POST /v1/auth/token` and `GET /v1/health` are `security: []` (no `bearerAuth`); all others require `bearerAuth: []` `JWT` (`aud` `public:*`, `scope` `b2:*`, `exp` 900s `15m`, `sub` `consumerId`, `iss` `monienaija-a2`). Wrong `aud` is `403` `B2_AUTH_WRONG_AUDIENCE`, wrong `scope` is `403` `B2_AUTH_WRONG_SCOPE`, `exp` past is `401` `B2_AUTH_EXPIRED`, missing `token` is `401` `B2_AUTH_UNAUTHORIZED`, all `fail closed` without touching `B1` or `A4`.

## 4. Authentication gate order

The gate order is the only B2 authentication gate and is `fail closed` at every step:

1. `cohortKey` must be `b2.activation.cohort.inbound-funding` 1, otherwise `B2_AUTH_INCOMPATIBLE` `403`.
2. `idempotencyKey` must be uuid, otherwise `400`.
3. `GET /v1/health` → `200` immediately (no `aud`/`scope`/`B1`/`A4` check).
4. `POST /v1/auth/token` → `200` (anonymous `clientId`/`clientSecret` → `aud` `public:*` `exp` 900s via `A2`).
5. Unauthenticated (`token` null) on any other path → `401` `B2_AUTH_UNAUTHORIZED`.
6. Wrong `aud` (`token.aud` ≠ `ROUTE_AUDIENCE[path]`) → `403` `B2_AUTH_WRONG_AUDIENCE`.
7. Expired (`token.exp < now`) → `401` `B2_AUTH_EXPIRED`.
8. Wrong `scope` (`token.scope` ∉ `ROUTE_SCOPE[path]` and `token.scope` split by space does not contain `expectedScope`) → `403` `B2_AUTH_WRONG_SCOPE`.
9. `consumerState` ≠ `ACTIVE` → `403` `B2_AUTH_CONSUMER_NOT_ACTIVE` (`SUSPENDED` `403`, `REVOKED` `403`).
10. `credentialState` `REVOKED`/`EXPIRED` → `401` `B2_AUTH_CREDENTIAL_REVOKED` (`ISSUED`/`ROTATED` are the only `ALLOWED` states).
11. `hasBillingData && consentState != GRANTED` → `403` `B2_AUTH_CONSENT_REQUIRED` (`consentState` `GRANTED` is `CustomerConsent` `B2_ACTIVATION` via `B2T06`).
12. `hasBillingData && activationState != ACTIVE` → `403` `B2_AUTH_ACTIVATION_REQUIRED` (`activationState` `ACTIVE` is `B2Activation` `ACTIVE` via `B2T05`).
13. `a4EligibilityState` ≠ `ELIGIBLE` → `403` `B2_AUTH_A4_NOT_ELIGIBLE` (A4 remains the only policy `ELIGIBLE` via `B2T03`/`B2T04` → `B2T05`).
14. `quotaState` `EXCEEDED` → `429` `B2_AUTH_QUOTA_EXCEEDED` (`X-Quota-Remaining: 0`).
15. `rateLimitState` `THROTTLED` → `429` `B2_AUTH_RATE_LIMITED` (`Retry-After` + `X-RateLimit-*`).
16. `GET /v1/commercial/plans/{planKey}` where `planKey` (`requestedPlanKey`) ∉ `ALLOWED_B1_PLANS` for the caller's `aud` → `404` `B2_AUTH_NOT_FOUND` with `isLeakSafe404:true` and `auditWithoutLeak:true` (the `requestedPlanKey` is not written to the `record` JSONB beyond `requestHash`).
17. Otherwise → `200` `AUTHENTICATED` with `isLeakSafe404:false`.

Every `401`/`403` on steps 5–9 is without touching `B1` or `A4`; the `404` leak-safe path is `auditWithoutLeak` (the `requestedPlanKey` existence is not leaked to `403`).

## 5. B1 capability exposure as public resources

`exposeB1Catalog(request)` and `exposeB1Plan(request, planKey)` read `B1` via the approved read-only `B1T02` catalog boundary (`commercial.virtual-account.inbound-funding` 1, `VIRTUAL_ACCOUNT` 1) and return a minimized view only on `AUTHENTICATED`:

- `B2B1CatalogViewV1`: `cohortKey` `b2.activation.cohort.inbound-funding`, `b1ScopeKey` `commercial.virtual-account.inbound-funding`, `plans` `[commercial.virtual-account.inbound-funding, commercial.virtual-account.inbound-funding.fee]`, `tiers` `[tier.b2.inbound-funding.standard, tier.b2.inbound-funding.premium]`, `minimal:true`.

- `B2B1PlanViewV1`: `planKey`, `b1ScopeKey` `commercial.virtual-account.inbound-funding`, `tier` `tier.b2.inbound-funding.standard`, `audience` `token.aud`.

Consumer-scoped visibility (`planKey` outside the consumer's `audience` `ALLOWED_B1_PLANS`) is `404` `B2_AUTH_NOT_FOUND` (not `403` leak) and the `404` is `auditWithoutLeak` (the plan existence is not written to `AuditService` beyond `requestHash`). No consumer infers `Customer.id` ownership, `A3` `WalletAccount`/`LedgerAccount`, or `CustomerPreference` across consumers; each view is `minimal:true` and `AUDIT` is via `OperationsModule`.

The contract does not create a second catalog; `B2` `GET /v1/commercial/catalog|plans|tiers` are `B1` minimized reads.

## 6. Idempotency, replay, and versioning

The `b2.public-api-authentication.idempotency.v1` scope is the only B2 public API authentication idempotency scope (`86400s`, `requestHash` `sha256(stableJson(method, pathTemplate, aud, scope, exp, sub, consumerState, credentialState, consentState, activationState, quotaState, rateLimitState, a4EligibilityState, cohortKey, requestedPlanKey, hasBillingData, idempotencyKey))` excluding `authReference`/`createdAt`). `decisionHash`/`decisionReplayHash` follow the `B2T03–09` pattern keyed on `b2.public-api-authentication.idempotency.v1`. Same `Idempotency-Key`+same hash replays the original `b2-public-api-auth-<uuid>` with `replayed:true`; same key+different hash is `409` `B2_AUTH_REPLAY_CONFLICT` (`conflict:true`). `b2ApiVersion` `v1` is the only `B2-PUBLIC-API-AUTHENTICATION` version at `b2t10`; a future `v2` must not weaken `v1` `AUDIENCE`/`SCOPE` invariants.

## 7. Verification

- [x] The contract is frozen as `B2-PUBLIC-API-AUTHENTICATION` v1 with `B2PublicApiAuthenticationRequestV1` (`method`/`pathTemplate`/`token`/`consumerState`/`credentialState`/`consentState`/`activationState`/`quotaState`/`rateLimitState`/`a4EligibilityState`/`hasBillingData`/`requestedPlanKey`), `B2PublicApiAuthenticationDecisionV1` (`OUTCOME` `AUTHENTICATED`/`UNAUTHORIZED`/`FORBIDDEN`/`WRONG_AUDIENCE`/`EXPIRED`/`WRONG_SCOPE`/`CONSUMER_NOT_ACTIVE`/`CREDENTIAL_REVOKED`/`CONSENT_REQUIRED`/`ACTIVATION_REQUIRED`/`QUOTA_EXCEEDED`/`RATE_LIMITED`/`NOT_FOUND`/`REJECTED`, `httpStatus` `401`/`403`/`404`/`429`/`200`, `isLeakSafe404`/`auditWithoutLeak`), and `B2B1CatalogViewV1`/`B2B1PlanViewV1`.
- [x] Every public B2 route in `docs/api/B2-OPENAPI-v1.yaml` is `A2` `aud`/`scope`/`exp` + `ACTIVE` + `ISSUED`/`ROTATED` + `GRANTED` + `ELIGIBLE` + `ALLOCATED` + `ALLOWED` gated in the frozen gate order, `fail closed` `401`/`403` without touching `B1`/`A4` on the early `401`/`403` paths, and `B1` `ALLOWED_B1_PLANS` enforcement is `404` leak-safe (`isLeakSafe404:true`) with `auditWithoutLeak`.
- [x] `POST /v1/auth/token` `ACTIVE` requires `ATTESTED_READY` via `B2T03`/`B2T04` + `A3` + `A4` + `B1` + `B2T06` + `B2T08`; no `POST /v1/commercial/activations` `ACTIVE` is reachable without `B2T05` `ACTIVE` and `B2T06` `GRANTED` and `B2T08` `ACTIVE`/`ISSUED`.
- [x] The `404` leak-safe path (`GET /v1/commercial/plans/{planKey}` where `planKey` ∉ `ALLOWED_B1_PLANS`) is `404` not `403` and the `requestedPlanKey` is not written to the audit `record` beyond `requestHash`; the billing-without-consent/activation path is `403` `B2_AUTH_CONSENT_REQUIRED`/`B2_AUTH_ACTIVATION_REQUIRED` (not `404`).
- [x] The contract reuses `A2` `AuthenticationSession`/`PrivilegedActionApproval` and never creates a second `session`/`token` vault; it consumes previous `B2` modules only through their published `getConsumerPorts()`/`compatibilityCheck`/`computeRequestHash` ports and never mutates `A3` bindings, `A4` policy, `B1` decisions, or `Ledger`.
- [x] The persistence `b2_public_api_authentication` with unique `authReference,authVersion` and indexes on `pathTemplate`/`outcome`/`cohort`/`requestHash`/`idempotencyScope+key`/`correlationId` is the only `B2` public API authentication surface; the `record` JSONB never stores a raw `clientSecret`/`secret`.
- [x] No ADR beyond ADR-0082 is authored by this task.

### Evidence limitations

- B2T10 is a public `API` authentication integration. It does not mint a `JWT`, rotate a `clientSecret`, create a webhook `secret`, or post a ledger entry; those remain `B2T08`/`B2T09`/`A5`.
- B2T10 does not call a live partner, a live `KYC`, a live settlement, or a live bank API; its `A4` `ELIGIBLE` and `A3` `VERIFIED` are the `a4EligibilityState`/`activationState` flags supplied via the `B2T03`/`B2T04` → `B2T05` → `B2T06` chain.

