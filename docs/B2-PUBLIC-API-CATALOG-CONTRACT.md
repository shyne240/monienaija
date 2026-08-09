# B2T02 — Public API Catalog, Route Exposure Contract, and API Boundary

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T02 — Public API Catalog, Route Exposure Contract, and API Boundary
- **Status:** Documentation and contract design prepared for review; no B2 runtime public API, authentication, consumer, credential, sandbox, webhook, activation, or commercial implementation introduced
- **Contract:** `B2PublicApiCatalogContractV1` / `B2RouteExposureContractV1` / `B2ApiVersionContractV1` / `B2ConsumerBoundaryContractV1` / `B2WebhookRegistrationContractV1` / `B2WebhookVerificationContractV1` / `B2IdempotencyContractV1` / `B2RateLimitContractV1` / `B2QuotaContractV1` / `B2ApiErrorContractV1`
- **Catalog version:** `B2-PUBLIC-API-CATALOG` v1
- **Selected first activation cohort (frozen registration):** `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, credential, secret, webhook, sandbox, public surface, activation, commercial, and financial-runtime changes in this task:** None

This document is the stable B2 public API catalog and route-exposure contract that keeps public-surface behavior outside Customer, `CustomerPreference`, A2, A3, A4, A5, A6, A7, B1, Wallet, Ledger, and Operations authorities. It is a contract design artifact, not a TypeScript class, NestJS module, entity, migration, repository, service, controller, API, route, scheduler, webhook, sandbox, credential, or runtime activation.

## 1. Contract boundary

### 1.1 Purpose

The B2 public API catalog and route-exposure contract are an anti-corruption and isolation boundary between public consumers and the frozen B1 commercial platform:

```text
A2-authenticated public principal (apiConsumer + apiCredential aud/scope)
  -> B2 public API catalog (lookup activation cohort registration, route, version, audience, quota, consent)
  -> B2RouteExposureContractV1 (normalized public request / response / error / audit per route)
  -> A3 binding recheck + A4 policy currentness + B1 catalog/plan boundary (read-only)
  -> CustomerPreference / CustomerConsent / MarketingConsent (read-only intent)
  -> A6T10 / B1T10 data classification, retention, legal-hold, disclosure (read-only)
  -> Operations audit / idempotency / outbox / metrics / diagnostics (read-only consumers except idempotency reservation + audit write)
  <- public-neutral normalized result / error / rate-limit / quota / audit
```

The catalog translates public-surface vocabulary (activation reference, consumer reference, credential reference, webhook registration reference, webhook delivery reference, sandbox session reference, API version, quota bucket, rate-limit bucket) into cohort-neutral, consumer-neutral, and ledger-neutral values. It does not decide whether a public result is an A2 authorization, an A3 binding, an A4 policy decision, a B1 commercial decision, an A5 ledger record, an A7 product operation, or a `CustomerPreference` mutation.

### 1.2 Normative language

- **MUST** means a required contract invariant.
- **MUST NOT** means a prohibited state, dependency, or interpretation.
- **SHOULD** means the default behavior unless a later approved B2 contract documents a safer alternative.
- **MAY** means an optional field or later B2 extension point that cannot weaken an invariant.
- **Catalog version** means a frozen `B2-PUBLIC-API-CATALOG` v1 entry whose cohort identity, public routes, version negotiation, Idempotency-Key scope, quota cost, rate-limit tier, authentication, and audience are described by this contract.
- **Public route** means a method+path registered in the B2 catalog (e.g., `POST /v1/commercial/activations`). A public route is the only B2 surface that may be called from outside the trust boundary.
- **Later B2 task** means work assigned to B2T03–B2T12 and not implemented here. B2T02 defines the catalog and route-exposure contract only.

### 1.3 Catalog and boundary port shape

```text
B2PublicApiCatalogContractV1
  getCohortRegistration(cohortKey: B2CohortKeyV1) -> B2CohortRegistrationV1 | null
  listCohorts() -> readonly B2CohortRegistrationV1[]
  getRoute(method: HttpMethodV1, pathTemplate: B2RoutePathV1, version: B2ApiVersionV1) -> B2RouteRegistrationV1 | null
  listRoutes(version: B2ApiVersionV1) -> readonly B2RouteRegistrationV1[]
  assertCompatible(cohortKey: B2CohortKeyV1, version: B2ApiVersionV1) -> B2CohortRegistrationV1 // or throws B2_API_WRONG_VERSION
  getVersionPolicy() -> B2VersionPolicyV1
  getCompatibilityRules() -> readonly B2CompatibilityRuleV1[]
  getConsumerBoundary(consumerId: B2ConsumerIdV1) -> B2ConsumerBoundaryViewV1 | null

B2RouteExposureContractV1
  validateRequest(route: B2RouteRegistrationV1, request: B2PublicRequestV1) -> B2ValidationResultV1
  validateResponse(route: B2RouteRegistrationV1, response: B2PublicResponseV1) -> B2ValidationResultV1
  assertAudience(route: B2RouteRegistrationV1, principal: A2PrincipalViewV1) -> B2AudienceDecisionV1
  assertIdempotency(route: B2RouteRegistrationV1, idempotencyKey: B2IdempotencyKeyV1) -> B2IdempotencyDecisionV1
  assertRateLimit(route: B2RouteRegistrationV1, consumer: B2ConsumerIdV1) -> B2RateLimitDecisionV1 // token bucket
  assertQuota(route: B2RouteRegistrationV1, consumer: B2ConsumerIdV1) -> B2QuotaDecisionV1 // calendar window
```

Domain modules MUST consume the B2 public API catalog and route-exposure contract rather than reaching into `customer`, `customer-preference`, `wallet`, `ledger`, `partner`, `policy`, `product-governance`, `payment`, `transfer`, the B1 `policy/b1-*` engines, or the A7 product layer directly.

### 1.4 Catalog version and selection rule

```text
catalogName:    "B2-PUBLIC-API-CATALOG"
catalogVersion: 1
apiPrefix:      "/v1"
accept:         "application/vnd.monienaija.v1+json"
acceptFallback: "application/json" -> negotiates to v1
b2ApiVersionHeader: "B2-Api-Version: v1"
```

Every cohort registration, route registration, compatibility rule, version-deprecation rule, idempotency scope, quota cost, rate-limit tier, audience, and consumer contract in this document is part of `B2-PUBLIC-API-CATALOG` v1. A later catalog version (v2) MAY add optional fields, route metadata, new cohorts, or deprecation notices; it MUST NOT weaken v1 invariants, silently re-broaden v1 scopes, or silently expose a public route without an A2 audience.

### 1.5 Selected first activation cohort (frozen registration summary)

Established in `docs/B2-ACTIVATION-BASELINE.md` §4 and reasserted here:

```text
b2CohortKey:      b2.activation.cohort.inbound-funding
b2CohortVersion:  1
direction:        inbound funding (customer-facing activation of B1 commercial.virtual-account.inbound-funding v1)
b1ScopeKey:       commercial.virtual-account.inbound-funding
b1ScopeVersion:   1
a7ProductDep:     VIRTUAL_ACCOUNT v1
a6PartnerDep:     NIBSS_NIP (planning rail)
currency:         NGN
accountingUnit:   CUSTOMER_FUNDS
region:           NG
publicCap:        b2.activation (commerce-facing activation of B1 inbound-funding under VIRTUAL_ACCOUNT)
```

The frozen registration is documented in §4. It is the only `ACTIVE` entry in `B2-PUBLIC-API-CATALOG` v1.

## 2. Canonical B2 public identities

B2T02 freezes the following identity vocabulary. Each identity is distinct from every A1–A7, B1, merchant, agent, notification, and ledger identity.

```text
B2CohortKeyV1                 // e.g. "b2.activation.cohort.inbound-funding"
B2CohortVersionV1             // e.g. 1
B2RoutePathV1                 // e.g. "/v1/commercial/activations"
B2RouteMethodV1               // "GET" | "POST" | "DELETE" | "PATCH" (B2T02 freezes GET|POST only)
B2ApiVersionV1                // e.g. "v1" | "v2"
B2ConsumerIdV1                // uuid v4, ApiConsumerV1 id
B2CredentialIdV1              // uuid v4, ApiCredentialV1 id
B2WebhookRegistrationIdV1     // uuid v4
B2WebhookDeliveryIdV1         // uuid v4
B2SandboxSessionIdV1          // uuid v4 (defined for extension; not issued at T02)
B2ActivationReferenceV1       // uuid v4, B2 activation reference (B2T02 defines the type; B2T05 will issue)
B2IdempotencyKeyV1            // RFC-4122 uuid v4 supplied as Idempotency-Key header
B2IdempotencyScopeV1          // per-route scope, e.g. "b2:commercial:activations:create"
B2QuotaBucketV1               // e.g. "commercial.write:daily"
B2RateLimitBucketV1           // e.g. "b2:global" | "b2:commercial:activations:write"
B2ConsentPurposeV1            // "B2_ACTIVATION" | "B2_COMMERCIAL" | "MARKETING_COMMERCIAL_OFFER"
```

B2T02 MUST NOT use as a B2 identity: `Customer.id`, `Merchant.id`, `Agent.id` (those are cohort-owner traces, not B2 public-surface identities), internal command ID, A5/A6/A7/B1 commercial decision identifiers, A2 `AuthenticationSession` ID, A3 binding ID, A4 policy decision ID, A5 journal ID, A6 external-operation ID, provider idempotency key, callback event ID, A7 product operation ID, audit event ID, or `CustomerPreference` record ID.

## 3. Public API catalog registration

```text
B2CohortRegistrationV1
  cohortKey:               B2CohortKeyV1
  cohortVersion:           B2CohortVersionV1
  b1ScopeKey:              B1ScopeKeyV1              // frozen reference to B1 commercial scope
  b1ScopeVersion:          B1ScopeVersionV1
  a7ProductKey:            A7ProductKeyV1
  a6PartnerKey:            A6PartnerKeyV1
  currency:                CurrencyV1                // NGN only at v1
  accountingUnit:          AccountingUnitV1          // CUSTOMER_FUNDS only at v1
  region:                  RegionV1                  // NG only at v1
  direction:               B2DirectionV1             // "inbound"
  publicCapability:        B2PublicCapabilityV1      // "b2.activation"
  stateVocabulary:         readonly B2ActivationStateV1[] // PENDING_*|ACTIVE|SUSPENDED|REVOKED|EXPIRED|REJECTED
  routes:                  readonly B2RouteRegistrationV1[]
  audiences:               readonly B2AudienceV1[]
  idempotencyScopes:       readonly B2IdempotencyScopeV1[]
  quotaGroups:             readonly B2QuotaGroupV1[]
  rateLimitGroups:         readonly B2RateLimitGroupV1[]
  consentPurposes:         readonly B2ConsentPurposeV1[]
  prohibitedAdjacentCohorts: readonly B2CohortKeyV1[]
  compatibilityRules:      readonly B2CompatibilityRuleV1[]
  consumerContracts:       readonly B2ConsumerContractRefV1[]
  versionPolicy:           B2VersionPolicyV1
  replayPolicy:            B2ReplayPolicyV1
  effectiveFrom:           ISO-8601 | null
  effectiveTo:             ISO-8601 | null
  classificationLevel:     DataHandlingLevelV1 | null // INTERNAL default
  retentionDays:           number | null // 365 default

B2RouteRegistrationV1
  routeId:                 B2RouteIdV1               // e.g. "b2.post-commercial-activations"
  method:                  B2RouteMethodV1
  pathTemplate:            B2RoutePathV1
  b2ApiVersion:            B2ApiVersionV1            // v1
  audiences:               readonly B2AudienceV1[]   // required audiences for this route (AND within route; OR across routes is prohibited)
  scopes:                  readonly B2ScopeV1[]      // OAuth-style scopes mapped from audiences
  idempotencyScope:        B2IdempotencyScopeV1 | null // null for idempotent-safe GET/DELETE reads
  quotaCost:               B2QuotaCostV1             // integer cost deducted from the quota group per call (e.g. 1)
  quotaGroup:              B2QuotaGroupV1 | null
  rateLimitTier:           B2RateLimitTierV1         // e.g. "b2:commercial:activations:write" -> 10 rps burst 20
  rateLimitCost:           B2RateLimitCostV1         // tokens per call (e.g. 1)
  requestContentType:      B2ContentTypeV1           // "application/vnd.monienaija.v1+json"
  responseContentType:     B2ContentTypeV1
  requestSchemaRef:        B2JsonSchemaRefV1         // pointer into the OpenAPI schema for the route request body
  responseSchemaRef:       B2JsonSchemaRefV1
  consentPurpose:          B2ConsentPurposeV1 | null // required consent for the route's consumer (null for catalog reads)
  authKind:                B2AuthKindV1              // "BEARER_JWT" for all public routes at v1
  deprecation:             B2DeprecationV1 | null
  effectiveFrom:           ISO-8601 | null
  effectiveTo:             ISO-8601 | null
```

## 4. First activation cohort registration (frozen)

`b2.activation.cohort.inbound-funding` v1 is the only `ACTIVE` entry. No second cohort is admitted by B2T02; any second cohort requires a separate B2 cycle plus a separate B2 ADR.

```text
cohortKey:     "b2.activation.cohort.inbound-funding"
cohortVersion: 1
b1ScopeKey:    "commercial.virtual-account.inbound-funding"
b1ScopeVersion:1
a7ProductKey:  "VIRTUAL_ACCOUNT"
a6PartnerKey:  "NIBSS_NIP"
currency:      "NGN"
accountingUnit:"CUSTOMER_FUNDS"
region:        "NG"
direction:     "inbound"
publicCapability:"b2.activation"
stateVocabulary:["PENDING_VERIFICATION","PENDING_CONSENT","PENDING_APPROVAL","ACTIVE","SUSPENDED","REVOKED","EXPIRED","REJECTED"]
routes:        [ §5 routes 1..8 for v1 ]
audiences:     ["public:commercial:activation:b2:inbound-funding:read","public:commercial:activation:b2:inbound-funding:write","public:webhooks:b2:manage","public:consents:b2:manage"]
idempotencyScopes:["b2:commercial:activations:create","b2:webhooks:registrations:create","b2:consents:create","b2:auth:token:exchange"]
quotaGroups:   ["commercial.read:daily:5000","commercial.write:daily:500","webhooks.manage:daily:100"]
rateLimitGroups:["b2:global:100rps","b2:commercial:read:50rps","b2:commercial:activations:write:10rps","b2:webhooks:manage:5rps"]
consentPurposes:["B2_ACTIVATION","B2_COMMERCIAL","MARKETING_COMMERCIAL_OFFER"]
prohibitedAdjacentCohorts:["b2.activation.cohort.merchant","b2.activation.cohort.agent","b2.activation.cohort.cross-currency","b2.activation.cohort.cross-region"]
compatibilityRules: §15 rules 1..5
consumerContracts: §17 boundary rows 1..14
versionPolicy:     §14 policy
replayPolicy:      { windowSec: 86400, hashScope: "per-route idempotencyScope + Idempotency-Key + b2ApiVersion + cohortKey", hashExcludes: ["activationReference","sandboxSessionId","createdAt"] }
classificationLevel:"INTERNAL"
retentionDays:     365
```

The registration records the cohort as `ACTIVE` in the frozen catalog. B2T02 defines the registration; B2T05 will implement the runtime that consumes it.

## 5. Public route catalog — every public endpoint at v1

The B2 public API catalog v1 registers exactly eight public routes (plus two health/support read routes). Every route is A2 audience/scope-protected; no route is unauthenticated at v1. Path templates include the `/v1` prefix; the bare `/commercial/*` without `/v1` is `404`.

| # | `routeId` | Method | `pathTemplate` | Description | `b2ApiVersion` | `audiences` (MUST carry) | `scopes` | `idempotencyScope` | `quotaGroup` (`quotaCost`) | `rateLimitTier` (`cost`) | `consentPurpose` | `authKind` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `b2.post-commercial-activations` | `POST` | `/v1/commercial/activations` | Create an activation for the cohort `b2.activation.cohort.inbound-funding` v1 (idempotent create) | `v1` | `public:commercial:activation:b2:inbound-funding:write` | `b2:activation:write` | `b2:commercial:activations:create` | `commercial.write:daily:500` (1) | `b2:commercial:activations:write` 10 rps burst 20 (1) | `B2_ACTIVATION` | `BEARER_JWT` |
| 2 | `b2.get-commercial-activations-id` | `GET` | `/v1/commercial/activations/{activationReference}` | Read a single activation by its `activationReference` (audience-scoped) | `v1` | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | null (safe) | `commercial.read:daily:5000` (1) | `b2:commercial:read` 50 rps (1) | null | `BEARER_JWT` |
| 3 | `b2.get-commercial-catalog` | `GET` | `/v1/commercial/catalog` | Read the minimized B1 catalog for the caller's audience | `v1` | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | null | `commercial.read:daily:5000` (1) | `b2:commercial:read` 50 rps (1) | null | `BEARER_JWT` |
| 4 | `b2.get-commercial-plans-planKey` | `GET` | `/v1/commercial/plans/{planKey}` | Read a single plan `commercial.virtual-account.inbound-funding.*` (caller's audience) | `v1` | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | null | `commercial.read:daily:5000` (1) | `b2:commercial:read` 50 rps (1) | null | `BEARER_JWT` |
| 5 | `b2.get-commercial-tiers-tierKey` | `GET` | `/v1/commercial/tiers/{tierKey}` | Read a single tier for the caller's audience | `v1` | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | null | `commercial.read:daily:5000` (1) | `b2:commercial:read` 50 rps (1) | null | `BEARER_JWT` |
| 6 | `b2.post-auth-token` | `POST` | `/v1/auth/token` | Exchange `clientId` + `clientSecret` for an A2-scoped JWT (aud=sub scope-bound, exp 15m) | `v1` | (no caller audience; uses credential-bound anonymous scope `public:auth:token:exchange`) | `b2:auth:token:exchange` | `b2:auth:token:exchange` | (no quota) | `b2:global` 100 rps (1) | null | (anonymous `client_credentials`) |
| 7 | `b2.post-webhooks-registrations` | `POST` | `/v1/webhooks/registrations` | Register a webhook for `b2.activation.*` + `b2.webhook.test` (HTTPS-only, allowlisted, challenge-verified) | `v1` | `public:webhooks:b2:manage` | `b2:webhooks:manage` | `b2:webhooks:registrations:create` | `webhooks.manage:daily:100` (1) | `b2:webhooks:manage` 5 rps (1) | `B2_COMMERCIAL` | `BEARER_JWT` |
| 8 | `b2.post-consents` | `POST` | `/v1/consents` | Register explicit `CustomerConsent` or `MarketingConsent` (separate records; intent authorities) | `v1` | `public:consents:b2:manage` | `b2:consents:manage` | `b2:consents:create` | `commercial.write:daily:500` (1) | `b2:commercial:activations:write` 10 rps (1) | null | `BEARER_JWT` |
| H1 | `b2.get-health` | `GET` | `/v1/health` | Platform health/readiness (non-commercial, no `B2` commercial scope) | `v1` | (no B2 audience required; existing platform health) | — | null | (no quota) | `b2:global` 100 rps (1) | null | none |
| H2 | `b2.get-support-read` | `GET` | `/v1/support/activations/{activationReference}` | Support read of an activation trace (minimized, support audience, legal-hold aware) | `v1` | `public:support:b2:read` | `b2:support:read` | null | `commercial.read:daily:5000` (1) | `b2:commercial:read` 50 rps (1) | null | `BEARER_JWT` |

Notes:

- Route H1 is the existing platform `health` surfaced under `/v1/health` for consumer liveness; it does not expose any `Customer`/`Ledger`/`B1` commercial data.
- Route H2 is the support-trace read contract (classified `PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED` per A6T10).

Every other path not in the table is `404` `B2_API_NOT_FOUND`. A new cohort, a new `v2` path, a mobile/web/PWA native screen, a second B1 scope, a second partner, a second currency, or a bulk endpoint is not in the v1 catalog.

## 6. Request / response / error contracts

### 6.1 Normalized public request

```text
B2PublicRequestV1
  requestId:              uuid v4 (header X-Request-Id)
  correlationId:          uuid v4 (header X-Correlation-Id)
  causationId:            uuid v4 (header X-Causation-Id) | null
  b2ApiVersion:           "v1" // negotiated per §14
  cohortKey:              B2CohortKeyV1 | null // required for POST /commercial/activations, implicit for reads
  cohortVersion:          B2CohortVersionV1 | null
  idempotencyKey:         B2IdempotencyKeyV1 | null // Idempotency-Key header where idempotencyScope != null (§9)
  authorization:          "Bearer <A2-scoped-JWT>" (all public routes except H1 and POST /auth/token)
  contentType:            "application/vnd.monienaija.v1+json" | "application/json" (POST)
  accept:                 "application/vnd.monienaija.v1+json" | "application/json" (negotiated per §14)
  body:                   readonly Record<string, unknown> // schema per route §6.2 | null for GET
```

The request is validated per `B2RouteRegistrationV1.requestSchemaRef`. B2T02 defines the JSON Schema references; the JSON Schema files are governed by the OpenAPI `docs/api/B2-OPENAPI-v1.yaml` produced from this contract at B2T07. The request MUST NOT contain `Customer.id`-overlapping `clientSecret`, webhook `secret`, PAN, account secret, PIN, OTP, callback signature, or private key in any field other than the anonymous `POST /auth/token` (`clientSecret`) and `POST /webhooks/registrations` (`secret` / `hmacKey`).

### 6.2 Per-route request schemas (shapes at v1)

- **POST /commercial/activations** `B2ActivationCreateRequestV1`
  - `cohortKey: "b2.activation.cohort.inbound-funding"` (MUST be that value)
  - `cohortVersion: 1`
  - `b1PlanKey: "commercial.virtual-account.inbound-funding"` (frozen reference to B1; read-only consumer)
  - `consentPurpose: "B2_ACTIVATION"` (MUST be `B2_ACTIVATION` for this cohort; `B2_COMMERCIAL` / `MARKETING_COMMERCIAL_OFFER` not required at activation create and are validated per §8 consent boundary)
  - `customerReference: { customerId: uuid v4 | null, customerAlias: string | null }` at least one non-null; resolved read-only via A1/A2/A3.
  - `activationNote: string | null` (max 200 chars, optional; classified `INTERNAL`, never free-form `CustomerPreference`).
  - `Idempotency-Key: B2IdempotencyKeyV1` header REQUIRED (in scope `b2:commercial:activations:create`).

- **POST /auth/token** `B2TokenExchangeRequestV1`
  - `clientId: string` (prefix `mnj_live_` | `mnj_test_` + 24 alnum; classified `INTERNAL`)
  - `clientSecret: string` (raw secret, transmitted only here; never stored; classified `RESTRICTED`; max 200 chars; hashed as `secretHash` server-side)
  - `scope: string | null` (requested scope subset of the credential's scope set, e.g. `"b2:activation:read"`; null = all granted scopes for the credential)
  - `clientSecret` MUST NOT appear in any other B2 route body.

- **POST /webhooks/registrations** `B2WebhookRegistrationCreateRequestV1`
  - `url: string` (HTTPS only, host allowlisted, max 500 chars)
  - `events: readonly ("b2.activation.succeeded" | "b2.activation.suspended" | "b2.webhook.test")[]` (non-empty, subset of cohort's webhook events at §4)
  - `secret: string` (raw HMAC secret, transmitted only here; never stored; classified `RESTRICTED`; 32–64 chars base64; returned never after this call; hashed as `secretHash`)
  - `hmacAlgorithm: "HMAC_SHA256"` (only value at v1)
  - `Idempotency-Key: B2IdempotencyKeyV1` header REQUIRED.

- **POST /consents** `B2ConsentCreateRequestV1`
  - `subjectCustomerId: uuid v4`
  - `purpose: "B2_ACTIVATION" | "B2_SELF_SERVICE" | "B2_COMMERCIAL" | "MARKETING_COMMERCIAL_OFFER"`
  - `channel: "email" | "sms" | "push" | "inApp" | null` (required only for `MARKETING_COMMERCIAL_OFFER`)
  - `granted: boolean` (`true` = `GRANTED`, `false` is invalid at create; revocation is a separate `DELETE` not in v1)
  - `Idempotency-Key: B2IdempotencyKeyV1` header REQUIRED.

- **GET /commercial/catalog | plans/{planKey} | tiers/{tierKey}** — no body; query `?cohortKey=b2.activation.cohort.inbound-funding&cohortVersion=1` optional (defaults to frozen v1).

All routes MUST reject unknown additional properties (OpenAPI `additionalProperties: false`); extra fields are `400` `B2_API_MALFORMED`.

### 6.3 Normalized public response

```text
B2PublicResponseV1
  b2ApiVersion:        "v1"
  requestId:           uuid v4 (echoed X-Request-Id)
  correlationId:       uuid v4 (echoed X-Correlation-Id)
  cohortKey:           B2CohortKeyV1 | null // echoed where cohort-scoped
  cohortVersion:       B2CohortVersionV1 | null
  data:                readonly Record<string, unknown> | null // route-specific result | null for errors
  pagination:          B2PaginationV1 | null // only for future paginated list routes (not in v1)
  rateLimit:           B2RateLimitHeadersV1  // always present per §10
  quota:               B2QuotaHeadersV1 | null // present where quotaGroup != null per §11
  headers:             { "B2-Api-Version": "v1", "Deprecation"?: string, "Sunset"?: string } // per §14/§16
```

Per-route `data` shapes:

- `POST /commercial/activations` `201` `B2ActivationCreateResponseV1` — `activationReference: B2ActivationReferenceV1`, `cohortKey`, `cohortVersion`, `b1PlanKey`, `state: PENDING_VERIFICATION|PENDING_CONSENT|PENDING_APPROVAL|ACTIVE|REJECTED`, `consentRequired: B2ConsentPurposeV1[] | null`.
- `GET /commercial/activations/{ref}` `200` — same fields plus `createdAt: ISO-8601`, `updatedAt`, `consumerId: B2ConsumerIdV1 | null`.
- `GET /commercial/catalog` / `plans/{key}` / `tiers/{key}` `200` — minimized B1 catalog objects (`planKey`, `planVersion`, `tierKey`, `tierVersion`, `entitlement`, `featureFlag`, `effectiveFrom`/`effectiveTo`, `classificationLevel` = `PUBLIC`/`INTERNAL` minimized view) scoped to the caller's audience.
- `POST /auth/token` `200` — `accessToken: string` (A2-scoped JWT), `tokenType: "Bearer"`, `expiresIn: 900`, `scope: string`, `consumerId: B2ConsumerIdV1` (no `refreshToken` at v1).
- `POST /webhooks/registrations` `201` — `registrationId: B2WebhookRegistrationIdV1`, `consumerId`, `url`, `events`, `state: PENDING_VERIFICATION`, `secretHashPrefix: string` (first 8 chars of `secretHash`, never the raw `secret`), `createdAt`. The raw `secret` is never present in the response.
- `POST /consents` `201` — `consentId: uuid v4`, `subjectCustomerId`, `purpose`, `channel`, `state: GRANTED`.

### 6.4 Normalized public error

```text
B2ApiErrorV1
  b2ApiVersion:     "v1"
  requestId:        uuid v4
  correlationId:   uuid v4
  code:             B2ApiErrorCodeV1
  message:          string // safe, non-leaking, classified PUBLIC per A6T10
  details:          readonly B2FieldErrorV1[] | null // per-field malformed errors | null for global errors
  retryAfter:       number | null // seconds where B2ApiErrorCode is B2_RATE_LIMITED or B2_QUOTA_EXCEEDED
  rateLimit:        B2RateLimitHeadersV1 | null
  quota:            B2QuotaHeadersV1 | null
```

```text
B2ApiErrorCodeV1 =
  | B2_API_NOT_FOUND                // 404 path not in catalog
  | B2_API_WRONG_VERSION            // 400 Accept / b2ApiVersion negotiation failed
  | B2_API_DEPRECATED               // 410 deprecated version (Sunset passed)
  | B2_API_MALFORMED                // 400 additionalProperties / wrong type / wrong field
  | B2_API_UNAUTHORIZED             // 401 missing/invalid/expired Bearer or wrong clientSecret
  | B2_API_FORBIDDEN                // 403 wrong audience/scope for the route
  | B2_API_FORBIDDEN_CONSENT        // 403 B2_ACTIVATION or MARKETING purpose not GRANTED
  | B2_API_FORBIDDEN_COHORT         // 403 cohort not compatible (cohortKey/version mismatch)
  | B2_API_IDEMPOTENCY_CONFLICT     // 409 same Idempotency-Key with different payload in same scope
  | B2_API_IDEMPOTENCY_REQUIRED     // 422 route requires Idempotency-Key but none supplied
  | B2_API_RATE_LIMITED             // 429 token bucket empty
  | B2_API_QUOTA_EXCEEDED           // 429 calendar window exhausted
  | B2_API_UNAVAILABLE              // 503 catalog unavailable / upstream A1–A7/B1 unavailable (fail closed)
  | B2_API_PROHIBITED               // 403 prohibited adjacent cohort/channel/scope/partner/currency/region/webhook event
  | B2_API_CONFLICT                 // 409 state conflict (e.g. activation already ACTIVE and same payload replays as REJECTED)

B2FieldErrorV1 =
  { field: string // JSON Pointer e.g. "/customerReference/customerId"
  , code: "REQUIRED" | "MALFORMED" | "WRONG_VERSION" | "PROHIBITED" | "INCOMPATIBLE"
  , message: string }
```

Fail-closed mapping: `B2_API_WRONG_VERSION` and `B2_API_UNAVAILABLE` never fall back to another cohort or v1/v2 route; they return the error with the frozen v1 contract identity.

## 7. Authentication requirements

At v1 the only public authentication for B2 public routes (all except `POST /auth/token` itself and `GET /health`) is:

```text
Authorization: Bearer <A2-scoped-JWT>
  aud: "public:commercial:activation:b2:inbound-funding:read" | "write" | "public:webhooks:b2:manage" | "public:consents:b2:manage" | "public:support:b2:read"
  sub: B2ConsumerIdV1
  scope: string // space-separated B2ScopeV1 set derived from the credential's granted scopes, e.g. "b2:activation:write b2:activation:read"
  exp: number // 900s at issuance (A2 token service); short-lived
  jti: uuid v4
  iss: "monienaija-a2"
```

- `POST /auth/token` exchanges `clientId` + `clientSecret` for the JWT per §6.2; `clientSecret` is hashed as `secretHash` (`argon2id` or `bcrypt` with per-record salt) server-side and is never stored, logged, traced, or returned.
- `GET /health` is the only public route at v1 with `authKind: none` (platform liveness only).
- A raw `clientSecret`, raw webhook `secret`, PAN, account secret, PIN, OTP, callback signature, or private key MUST NOT appear in any B2 table/log/trace/event/webhook body/Audit record other than the transient `POST /auth/token` and `POST /webhooks/registrations` request bodies, which are redacted immediately after hashing.
- A revoked credential, an expired JWT (`exp` past), a JWT with wrong `aud`, or a credential for a suspended `ApiConsumer` MUST fail closed with `401`/`403` and MUST NOT fall back to another credential or anonymous cohort.

B2 does not implement a second session/token vault, a second credential vault, or a second privileged-action surface; it reuses A2 `AuthenticationSession` / `PrivilegedActionApproval` and `secretHash` verification.

## 8. Authorization audiences

Every public B2 route carries one AND-set of audiences that MUST be present in the JWT `aud` claim. A JWT whose `aud` set does not contain the route's required audiences is `403` `B2_API_FORBIDDEN`. Cross-audience `404` (not `403`) is used only for the B1-catalog read routes where leaking existence across audiences is prohibited per §10.2.

| Route group | `B2AudienceV1` | `B2ScopeV1` | Required for routes |
| --- | --- | --- | --- |
| Activations write | `public:commercial:activation:b2:inbound-funding:write` | `b2:activation:write` | `POST /commercial/activations` |
| Activations read | `public:commercial:activation:b2:inbound-funding:read` | `b2:activation:read` | `GET /commercial/activations/{ref}`, `GET /commercial/catalog`, `GET /commercial/plans/{key}`, `GET /commercial/tiers/{key}` |
| Webhooks manage | `public:webhooks:b2:manage` | `b2:webhooks:manage` | `POST /webhooks/registrations` (and future `DELETE /webhooks/registrations/{id}` beyond T02 but not in v1) |
| Consents manage | `public:consents:b2:manage` | `b2:consents:manage` | `POST /consents` |
| Support read | `public:support:b2:read` | `b2:support:read` | `GET /support/activations/{ref}` |
| Auth token exchange | `public:auth:token:exchange` (anonymous) | `b2:auth:token:exchange` | `POST /auth/token` scopes the credential exchange, not the caller's audience |

A credential's `scope` set MUST be a subset of its `ApiConsumer` `audience`'s scopes. A JWT's `scope` MUST be a subset of the credential's `scope` set and MUST be space-joined sorted lexically for deterministic hashing.

No public B2 route is `public` audience (unauthenticated) at v1; any future `public` audience requires a separate reviewed B2 capability and a separate B2 ADR.

## 9. Idempotency requirements

B2 reuses the shared Operations `IdempotencyService` (only idempotency authority per A5/A6/A7/B1). B2 does not introduce a second idempotency vault.

- **Header:** `Idempotency-Key: <B2IdempotencyKeyV1>` is REQUIRED on every route whose `idempotencyScope != null` (table §5); the header is REJECTED (`400` `B2_API_MALFORMED`) on routes where it is `null`.
- **Scope:** `B2IdempotencyScopeV1` per route (e.g., `b2:commercial:activations:create`). A key that repeats within the same scope is the *same* logical operation; a key that repeats across different scopes is a *different* logical operation and never collides.
- **Hash:** The idempotency payload hash is `sha256( stableJson({ b2ApiVersion, cohortKey, cohortVersion, routeId, bodyHash }) )` where `bodyHash` is `sha256( stableJson( body minus hashExcludes ) )`. `hashExcludes` for B2 at v1 is `["activationReference","sandboxSessionId","createdAt","requestId"]`; raw `clientSecret` or webhook `secret` is never part of any hash (it is hashed separately as `secretHash` and is not in the idempotency scope).
- **Window:** `86400s` per scope per key. After the window, a key is treated as unknown and never replays an old result; the service MUST NOT treat an expired key as a conflict.
- **Replay:** Same `Idempotency-Key` + same scope + same `b2ApiVersion` + same cohort + same body hash within the window returns the durable original response (`201` or `200` with the same `activationReference`/`registrationId`/`consentId`), never a second uncontrolled activation.
- **Conflict:** Same `Idempotency-Key` + same scope + same `b2ApiVersion` + same cohort but different body hash within the window is `409` `B2_API_IDEMPOTENCY_CONFLICT` and never mutates state.
- **Cross-cohort/version:** Different `b2ApiVersion`, different `cohortKey`, or different `cohortVersion` never matches an existing key; it is a different logical operation.
- **Logs/audit:** The `Idempotency-Key` value is classified `CONFIDENTIAL` and is never present in audit `details` beyond a SHA-256 prefix (`sha256:8`), and never in metrics labels.

B2T02 defines the port; B2T05–B2T09 will implement the `IdempotencyService` reservation, `REPLAYED`/`CONFLICTED`/`EXPIRED` states, and transactional commit ordering.

## 10. Rate-limit contracts

At v1 every public B2 route is governed by a single token-bucket tier per route group. B2 does not introduce a second metrics vault; it reuses Operations `MetricsService` for `b2_rate_limit_allowed_total` / `b2_rate_limit_throttled_total`.

```text
B2RateLimitTierV1 = "b2:global" | "b2:commercial:read" | "b2:commercial:activations:write" | "b2:webhooks:manage"
B2RateLimitCostV1 = 1 // tokens per call at v1
B2RateLimitDecisionV1 = { allowed: boolean, tokensRemaining: number, resetAt: ISO-8601 }
B2RateLimitHeadersV1 =
  { "X-RateLimit-Limit": number // capacity per window (e.g. 10)
  , "X-RateLimit-Remaining": number
  , "X-RateLimit-Reset": number // seconds until window reset
  , "Retry-After"?: number // present only on 429
  }
```

| `rateLimitTier` | Capacity | Refill rate | Burst | Algorithm | Scope |
| --- | --- | --- | --- | --- | --- |
| `b2:global` | 100 | 100 tokens / 60s | 100 | `TOKEN_BUCKET` | per `B2ConsumerId` across all B2 routes |
| `b2:commercial:read` | 50 | 50 / 60s | 50 | `TOKEN_BUCKET` | per `B2ConsumerId` + cohort `b2.activation.cohort.inbound-funding` |
| `b2:commercial:activations:write` | 10 | 10 / 60s | 20 | `TOKEN_BUCKET` | per `B2ConsumerId` + cohort |
| `b2:webhooks:manage` | 5 | 5 / 60s | 5 | `TOKEN_BUCKET` | per `B2ConsumerId` |

- Every public B2 response MUST include `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`.
- A bucket whose tokens are exhausted is `429` `B2_API_RATE_LIMITED` with `Retry-After` (seconds until `resetAt`) and never bypasses A2, A4, or consent.
- The rate-limit bucket is keyed per consumer-per-cohort-per-tier; global overrides any emptier bucket only via its own limit (never a cumulative bypass).
- Rate-limit state is not Ledger truth, not an activation effect, and never grants quota.

## 11. Quota contracts

At v1 every public B2 route that carries a `quotaGroup` is governed by a single calendar-day quota window (`00:00 UTC` reset) per consumer-per-cohort-per-group. B2 reuses Operations `MetricsService` for `b2_quota_exceeded_total`.

```text
B2QuotaGroupV1 = "commercial.read:daily:5000" | "commercial.write:daily:500" | "webhooks.manage:daily:100"
B2QuotaCostV1  = 1 // deducted from the group's daily budget per call at v1
B2QuotaDecisionV1 = { allocated: boolean, remaining: number, resetAt: ISO-8601 }
B2QuotaHeadersV1 =
  { "X-Quota-Limit": number
  , "X-Quota-Remaining": number
  , "X-Quota-Reset": string // ISO-8601 next 00:00Z
  }
```

| `quotaGroup` | Daily limit | Window | Deducted on | Reset |
| --- | --- | --- | --- | --- |
| `commercial.read:daily:5000` | 5000 | `00:00Z` calendar day | `5/row` reads (§5) | next `00:00Z` |
| `commercial.write:daily:500` | 500 | `00:00Z` | `POST /commercial/activations` + `POST /consents` (cost 1 each) | next `00:00Z` |
| `webhooks.manage:daily:100` | 100 | `00:00Z` | `POST /webhooks/registrations` (cost 1) | next `00:00Z` |

- Every public B2 response whose route has a `quotaGroup` MUST include `X-Quota-Limit` / `X-Quota-Remaining` / `X-Quota-Reset`.
- A consumer whose group is exhausted is `429` `B2_API_QUOTA_EXCEEDED` with `X-Quota-Remaining: 0` and the next `X-Quota-Reset`; the next-day window resets to `ALLOCATED` without manual repair.
- Quota is never a token bucket; rate-limit and quota are independent and both must be `allowed`/`allocated` for admission.
- Quota state is not Ledger truth and never grants rate-limit.

## 12. Webhook registration contract

Registered via `POST /v1/webhooks/registrations` for the frozen cohort `b2.activation.cohort.inbound-funding` v1 only. B2T02 defines the registration shape and verification challenge; B2T09 will implement the transactional delivery worker and dead-letter.

```text
B2WebhookRegistrationRequestV1 // §6.2 extended
  url:                 string // HTTPS only, host must be in the allowlist, max 500 chars
  events:              readonly ("b2.activation.succeeded" | "b2.activation.suspended" | "b2.webhook.test")[]
  secret:              string // raw HMAC secret, 32-64 chars base64, classified RESTRICTED, hash-only storage
  hmacAlgorithm:       "HMAC_SHA256" // only value at v1

B2WebhookRegistrationRecordV1
  registrationId:      B2WebhookRegistrationIdV1
  consumerId:          B2ConsumerIdV1
  cohortKey:           B2CohortKeyV1
  cohortVersion:       B2CohortVersionV1
  url:                 string
  hostAllowlisted:     boolean // MUST be true for VERIFIED
  events:              readonly B2WebhookEventV1[]
  state:               "PENDING_VERIFICATION" | "VERIFIED" | "SUSPENDED" | "REVOKED"
  secretHash:          string // argon2id(secret), never the raw secret
  hmacAlgorithm:       "HMAC_SHA256"
  challengeNonce:      string | null // issued for b2.webhook.test echo challenge while PENDING_VERIFICATION
  createdAt:           ISO-8601

B2WebhookEventV1 = "b2.activation.succeeded" | "b2.activation.suspended" | "b2.webhook.test"
```

- A registration with a non-`https` URL, an unknown host, a non-allowlisted host, an `events` entry not in the cohort's frozen event set, or a raw `secret` outside 32–64 chars is `400` `B2_API_MALFORMED` and never reaches `PENDING_VERIFICATION`.
- A registration reaches `VERIFIED` only after the `b2.webhook.test` challenge ping to the registered URL succeeds with `200` and echoes `X-Monienaija-Challenge` equal to `challengeNonce` (B2T02 defines the challenge field; B2T09 will implement the ping).
- Only `VERIFIED` registrations receive real `b2.activation.*` deliveries; `PENDING_VERIFICATION` receives only the `b2.webhook.test` challenge.
- Only `SUSPENDED`/`REVOKED` registrations suppress future deliveries without deleting history.

## 13. Webhook verification contract

Every B2T09 webhook delivery to a `VERIFIED` registration MUST carry and MUST be verifiable by the consumer without any raw secret appearing in logs/traces:

```text
B2WebhookDeliveryV1 (public envelope)
  deliveryId:          B2WebhookDeliveryIdV1
  registrationId:      B2WebhookRegistrationIdV1
  event:               B2WebhookEventV1
  cohortKey:           B2CohortKeyV1
  cohortVersion:       B2CohortVersionV1
  b2ApiVersion:        "v1"
  body:                readonly Record<string, unknown> // minimized per consumer audience (§12), never raw secret/PAN/PIN/OTP
  bodyHash:            string // sha256(stableJson(body))
  timestamp:           number // unix seconds at emission
  headers:
    "X-Monienaija-Signature": "sha256=" + hex(hmacSha256(secret, body + "." + timestamp + "." + deliveryId))
    "X-Monienaija-Timestamp": "<timestamp>"
    "X-Monienaija-Delivery-Id": "<deliveryId>"
    "Content-Type": "application/vnd.monienaija.v1+json"
```

- Consumer verification: `X-Monienaija-Signature` computed from the raw `secret` returned once at registration, the canonical `body`, the canonical `timestamp`, and the `deliveryId`; the consumer independently computes the same HMAC. A delivery with a stale `timestamp` (>300s from receiver clock), a reused `deliveryId` outside the consumer's idempotency window, or a mismatched `signature` MUST be treated as `REPLAYED`/`INVALID_SIGNATURE` and MUST NOT re-execute an activation.
- Replay of a past `deliveryId` outside the consumer's TTL or with a stale timestamp is `REPLAYED` and never re-executes an activation; replay beyond B2T09's retry window is `DEAD_LETTER` and requires manual review.
- Webhook delivery bodies carry only minimized data approved for the consumer's audience (A6T10 `PUBLIC`/`INTERNAL` filtered via B1T10/B2 classification); `CustomerPreference` / `MarketingConsent` honored for any webhook that would cause a notification-class message is the same rule as B2 activation (the delivery payload never carries raw `MarketingConsent` notes).
- The consumer's verification failure (`INVALID_SIGNATURE`/`REPLAYED`) is not retried with a different `deliveryId`; the same `deliveryId` is retried with bounded retry (5, exponential 1s/10s/60s/300s) until `VERIFIED` `200` echo of `deliveryId` or dead-letter (B2T09 will implement the retry).

B2T02 defines the port and header shapes; B2T09 will implement the `OutboxService` durable enqueue, retry worker, and dead-letter queue.

## 14. API versioning — OpenAPI-first contract

B2T02 is an OpenAPI-first API contract with `docs/api/B2-OPENAPI-v1.yaml` as the deterministically generated source of truth at B2T07. B2T02 defines the versioning rules that `docs/api/B2-OPENAPI-v1.yaml` will implement.

### 14.1 Version identity

```text
B2ApiVersionV1 = "v1" // only value at T02
B2VersionPolicyV1 =
  { latestStable: "v1"
  , deprecated:    [] // empty at T02
  , sunsetted:     [] // empty at T02
  , deprecationNoticeDays: 90 // future deprecation will give 90-day notice before Sunset
  }
B2VersionNegotiationV1 = "REQUESTED" | "NEGOTIATED" | "DEPRECATED" | "SUNSET"
```

### 14.2 Negotiation rules

- The versioned prefix `/v1` is the canonical version. A request to `/v1/commercial/activations` with `Accept: application/vnd.monienaija.v1+json` or `Accept: application/json` is `NEGOTIATED` to `v1`.
- `GET /commercial/catalog` with no `Accept` header negotiates to `v1` (latestStable) and responds with `B2-Api-Version: v1`.
- A request whose `Accept` asks for a version not in the catalog (e.g., `application/vnd.monienaija.v2+json` at T02) is `400` `B2_API_WRONG_VERSION` and never falls back to `v1`.
- A request to a bare path without `/v1` (e.g., `POST /commercial/activations` without prefix) is `404` `B2_API_NOT_FOUND`.
- A request to a `DEPRECATED` version's route with `Deprecation: true` is served with `Deprecation: true` + `Sunset: <date>` + `B2-Api-Version: <version>` (at T02 no route is DEPRECATED; this documents the future behavior).
- A request to a `SUNSET` version after its `Sunset` date is `410` `B2_API_DEPRECATED`.

Every public B2 response MUST include `B2-Api-Version: v1` at T02. A future `v2` MUST NOT be served as `v1` or vice versa.

### 14.3 OpenAPI-first determinism

The OpenAPI `docs/api/B2-OPENAPI-v1.yaml` (OpenAPI 3.1, deterministic generation at B2T07) is the only documented contract for B2 public routes at T02 and beyond:

- Every public route in §5 appears as an OpenAPI operation with the same `method`/`pathTemplate`/`audience`/`scope`/`idempotencyScope`/`quotaGroup`/`rateLimitTier`/`requestSchemaRef`/`responseSchemaRef`.
- Every OpenAPI operation appears in the B2 catalog list for the negotiated version.
- OpenAPI lint (`@readme/openapi` or equivalent) is `0` errors for `docs/api/B2-OPENAPI-v1.yaml` at T02 (at T02 the file is not yet generated; the catalog table §5 is the interim source of truth and OpenAPI `additionalProperties: false` is required from this contract).
- A change that adds a route, a query/body field, a header, or a webhook event without updating the OpenAPI and the catalog is a `B2_API_MALFORMED`-contract violation.

## 15. API compatibility rules

The first activation cohort `b2.activation.cohort.inbound-funding` v1 registers exactly five compatibility rules for the public API at T02. Any other compatibility claim requires a separate B2 cycle plus a separate B2 ADR.

- `B2_COMPAT_RULE_B1_SCOPE_FROZEN` — the cohort's `b1ScopeKey`/`b1ScopeVersion` MUST equal `commercial.virtual-account.inbound-funding` `1`; otherwise `B2_API_FORBIDDEN_COHORT`.
- `B2_COMPAT_RULE_CURRENCY_NGN` — the route's cohort currency (`NGN` only) MUST match `NGN`; otherwise `B2_API_FORBIDDEN_COHORT`.
- `B2_COMPAT_RULE_ACCOUNTING_UNIT_CUSTOMER_FUNDS` — the route's cohort accounting unit MUST equal `CUSTOMER_FUNDS`; otherwise `B2_API_FORBIDDEN_COHORT`.
- `B2_COMPAT_RULE_REGION_NG` — the route's cohort region MUST equal `NG`; otherwise `B2_API_FORBIDDEN_COHORT`.
- `B2_COMPAT_RULE_AUDIENCE_WRONG_IS_FORBIDDEN` — a route's required audiences MUST be a subset of the JWT `aud`; otherwise `B2_API_FORBIDDEN`.

Compatibility is evaluated read-only via the B2 catalog; B2T02 does not post to A3/A4/B1. A later B2 version (v2) MAY add optional-compatible fields but MUST NOT weaken any v1 compatibility rule.

## 16. API deprecation rules

At T02 no public B2 route is `DEPRECATED` or `SUNSET`. The deprecation contract is frozen at T02 and governs any future deprecation:

```text
B2DeprecationV1 = { deprecatedAt: ISO-8601 | null, sunsetAt: ISO-8601 | null, deprecated: boolean, successorVersion: B2ApiVersionV1 | null }
B2DeprecationPolicyV1 = { noticeDays: 90, headerDeprecation: "Deprecation: true", headerSunset: "Sunset: <HTTP-date>" }
```

- When a route becomes `DEPRECATED`, the catalog entry remains functional and every response carries `Deprecation: true` + `Sunset: <HTTP-date>` where `<HTTP-date>` is `deprecatedAt + 90d` and `successorVersion` is the next stable version.
- A request to a `DEPRECATED` route after `sunsetAt` is `410` `B2_API_DEPRECATED` and never falls back to the successor version.
- Deprecation of a cohort, a B1 scope, a consent purpose, or an audience is out of scope at T02 and requires a separate B2 ADR plus the B2 release gate.

## 17. API consumer boundaries

B2 consumers (`ApiConsumerV1`) are distinct from cohort activation owners. The B2 contract exposes `ApiConsumerV1` as the only public-consumer identity; B2T08 will own its runtime.

| Authority | Owner | B2 consumption boundary | B2 does not introduce |
| --- | --- | --- | --- |
| A2 authenticated principal / audience / scope / assurance / privileged-action | A2 owner | B2 is a read-only consumer of A2 for audience/scope verification and bearer-token issuance | B2 does not introduce a second authentication vault, a second audience/scope authority, or a second privileged-action surface |
| A3 binding / ownership | A3 owner | B2 `ApiConsumer` is not an A3 `Customer` and never becomes a binding; consumer-to-`Customer.id` is a beneficial-owner trace only | B2 does not introduce a second canonical identity across `Customer`/`Merchant`/`Agent`/`ApiConsumer` |
| `ApiConsumerV1` consumer registry | B2T08 owner | B2 public routes consume the `ApiConsumerV1` `ACTIVE` / `SUSPENDED` / `REVOKED` state read-only before any admission | B2 does not introduce a second consumer registry at T02 |
| `ApiCredentialV1` credential lifecycle | B2T08 owner | B2 public routes consume `ApiCredentialV1` `ISSUED`/`ROTATED`/`REVOKED`/`EXPIRED` state read-only; `secretHash` only, never raw secret | B2 does not introduce a second credential vault at T02 |
| `CustomerConsentV1` / `MarketingConsentV1` | B2T06 owner | B2 public routes consume consent `GRANTED`/`REVOKED`/`EXPIRED` read-only | B2 does not introduce a second consent vault at T02 |
| Consumer audience/scope | A2 + B2 catalog | The consumer's `audience` is the AND-set of B2T02 audiences for its enabled routes; its `scope` is the lexically sorted subset of its audience's scopes | A route's required audiences are not negotiable under the credential's scopes |

A consumer of `DEVELOPER` type with `audience: public:commercial:activation:b2:inbound-funding:write` is permitted to call `POST /commercial/activations` only where `scope` contains `b2:activation:write` and the JWT `aud` contains the required audience. A future `MERCHANT`/`AGENT` type requires B2T04 verification and is not permitted at T02 beyond the catalog entry.

## 18. Fail-closed behavior

The B2 public API catalog and route-exposure contract fail closed on every prohibited edge, second cohort, second B1 scope, second partner, second currency/region, second authority, or unapproved capability:

- A request with no `Authorization` (except `GET /health` and `POST /auth/token`) is `401` `B2_API_UNAUTHORIZED`.
- A request with a valid JWT but wrong audience/scope for the route is `403` `B2_API_FORBIDDEN`.
- A request with a valid consumer credential but suspended consumer is `403` `B2_API_FORBIDDEN`; with a revoked credential is `401` `B2_API_UNAUTHORIZED`.
- A request with an unknown `cohortKey`/`cohortVersion` or a cohort not in the frozen registration is `403` `B2_API_FORBIDDEN_COHORT`.
- A request with no `Idempotency-Key` where the route requires one is `422` `B2_API_IDEMPOTENCY_REQUIRED`.
- A request with a known `Idempotency-Key` + same scope but different body hash is `409` `B2_API_IDEMPOTENCY_CONFLICT` and never mutates state.
- A request whose token bucket is empty is `429` `B2_API_RATE_LIMITED` with `Retry-After`; whose calendar-day quota is exhausted is `429` `B2_API_QUOTA_EXCEEDED`.
- A request that requires `B2_ACTIVATION` consent but whose subject `CustomerConsent` is not `GRANTED` is `403` `B2_API_FORBIDDEN_CONSENT`.
- A request to a route whose `Sunset` has passed is `410` `B2_API_DEPRECATED`; whose `Accept` version is unknown is `400` `B2_API_WRONG_VERSION`.
- A request that would require a public route without an A2 audience/scope is never registered in the catalog and is `404` `B2_API_NOT_FOUND`.
- Any second cohort, second B1 scope, second partner beyond `NIBSS_NIP`, second currency beyond `NGN`, second accounting unit beyond `CUSTOMER_FUNDS`, second region beyond `NG`, second webhook event beyond `b2.activation.*`/`b2.webhook.test`, or public surface beyond the eight catalog routes is `404` or `403` (`PROHIBITED`) and is treated as an unapproved capability.

The B2 contract MUST NOT silently fall through to another cohort, route, version, or scope on failure.

## 19. Integration boundaries

The B2 catalog and route-exposure contract integrate read-only with:

- A1 canonical ownership/identifier/privacy/retention (cross-cutting; read-only) — §17.
- A2 authenticated principal/audience/scope/authorization/privileged-action/protected-ingress/security-event (read-only; favored by §7/§8).
- A3 binding/ownership/recheck (read-only; B2T02 defines the consumer contract, B2T02 never repairs).
- A4 policy capability/tier/entitlement/limit/obligation/currentness (read-only; B2 never duplicates A4).
- A5 ledger/account/state/posting/financial-invariants and Operations audit/idempotency/outbox/metrics/diagnostics (read-only except idempotency reservation + audit write via §9).
- A6 partner-adapter (`NIBSS_NIP`) / capability/version, callback authenticity/replay/freshness (pattern reused for §13), settlement/suspense, external reconciliation (A6T09) and external-rail data classification/minimization (A6T10) — read-only.
- A7 product catalog/boundary/customer-binding/command/notification/lifecycle/financial-effect/reconciliation/data-minimization (virtual-account v1) — read-only via A7 layer.
- B1 catalog/plan-boundary (frozen `commercial.virtual-account.inbound-funding` v1) and B1 reconstruction-class commercial data (fee/commission/billing/campaign/referral/revenue/tax/analytics + governance) — read-only minimized via A6T10.
- `CustomerPreference` (including `NotificationPreference`) — read-only delivery intent.
- Operations `AuditService` / `IdempotencyService` / `OutboxService` / `MetricsService` / `DiagnosticsService` — reuses shared services (only audit/idempotency reservation is read-write; all else read-only).

The B2 catalog MUST NOT integrate with a second pricing/billing/credential/webhook/consent/catalog/classification authority, a second partner marketplace, a second queue/broker, or any A8 topology.

## 20. Sandbox / fixture contract and tests at T02

B2T02 is deterministic and fixture-only. The snapshot `b2-fixture` contract is:

- Fixtures are deterministic snapshots of the frozen `b2.activation.cohort.inbound-funding` v1 registration (cohort key/version, eight public routes, four audience sets, four idempotency scopes, three quota groups, four rate-limit tiers, two webhook events + `b2.webhook.test`).
- Fixtures cover idempotency `REPLAYED` (same key + same hash → same `activationReference`), conflict `CONFLICTED` (same key + different hash → `409`), rate-limit `ALLOWED`→`THROTTLED`→`ALLOWED`, and quota `ALLOCATED`→`EXCEEDED`→`ALLOCATED` on window rollover without a live partner/product call.

The B2 public catalog and route-exposure contract are commercial-independent of any B2 activation, credential, webhook, consent, or sandbox runtime; the contract does not depend on a B2 service to prove the catalog.

## 21. Handoff to later B2 tasks

- B2T03 will define the B2 customer onboarding extension contract as the read-only attestation that B2T05 consumes.
- B2T04 will define the B2 merchant/agent onboarding contract with `Merchant.id`/`Agent.id` distinct and beneficial-owner trace.
- B2T05 will implement the B2 activation workflows and public commercial routes that consume the catalog `POST /commercial/activations` and `GET /commercial/catalog|plans|tiers`.
- B2T06 will define the `CustomerConsentV1`/`MarketingConsentV1` intent authorities whose `GRANTED` state gates activation per §6/§8.
- B2T07 will generate the deterministic `docs/api/B2-OPENAPI-v1.yaml` (OpenAPI 3.1) from this catalog and will implement documentation/versioning/sandbox/developer-onboarding.
- B2T08 will implement the `ApiConsumerV1`/`ApiCredentialV1`/`ApiQuotaV1`/`ApiRateLimitV1` runtimes whose states this catalog already enumerates.
- B2T09 will implement the `WebhookRegistrationV1`/`WebhookDeliveryV1` and verification worker whose port shapes this contract already freezes.
- B2T10 will integrate the public API authentication flow (`POST /auth/token` → A2-scoped JWT) that this contract already annotates on every route.
- B2T11 will implement the disable/rollback fixtures whose rate-limit/quota headers (§10/§11) already record.
- B2T12 will certify integration and will record the B2 release gate whose wrong-version/deprecation/quota/rate-limit/integration boundaries are already frozen here.

The B2 catalog is the entry point for B2T03–B2T12. B2T02 does not authorize B2T03–B2T12 to begin runtime work; each must still author its B2 ADR, pass its acceptance criteria, and be approved by the B2 release gate.

## 22. Verification record

- [x] The B2 public API catalog and route-exposure contract are defined as `B2PublicApiCatalogContractV1` / `B2RouteExposureContractV1` at `B2-PUBLIC-API-CATALOG` v1 with explicit `getCohortRegistration`, `listCohorts`, `getRoute`, `listRoutes`, `assertCompatible` ports.
- [x] The first activation cohort is frozen as `b2.activation.cohort.inbound-funding` v1 with explicit `cohortKey`, `cohortVersion`, `b1ScopeKey`, `b1ScopeVersion`, `a7ProductKey`, `a6PartnerKey`, `currency`, `accountingUnit`, `region`, `publicCapability`, `stateVocabulary`, `routes`, `audiences`, `idempotencyScopes`, `quotaGroups`, `rateLimitGroups`, `consentPurposes`, `prohibitedAdjacentCohorts`, `compatibilityRules`, `consumerContracts`, `versionPolicy`, `replayPolicy`, `classificationLevel`, `retentionDays`.
- [x] Every public endpoint at v1 is registered (eight public routes plus two health/support reads) with explicit method, pathTemplate, b2ApiVersion, audiences, scopes, idempotencyScope, quotaCost/group, rateLimitTier/cost, consentPurpose, and authKind.
- [x] API versioning is frozen as `v1` with `B2VersionPolicyV1`, negotiation rules (`406` on unknown Accept, `404` on bare path, `B2-Api-Version`/`Deprecation`/`Sunset` headers), and the 90-day successor policy; A later v2 MAY add fields but MUST NOT weaken v1 invariants.
- [x] Authentication is frozen as `BEARER_JWT` per §7 (hash-only `secretHash` storage, single-time raw-secret return, short-lived 900s JWT, wrong `aud` → fail closed).
- [x] Authorization audiences are frozen for every public route (five audience groups, six scopes, AND-semantics within a route).
- [x] Idempotency is frozen per-route (four scopes at v1, `86400s` window, stable `bodyHash` excluding `activationReference`/`createdAt`, `409` on conflict, replay on same key/same hash).
- [x] Rate-limit contracts are frozen (four token-bucket tiers `b2:global` 100rps, `b2:commercial:read` 50rps, `b2:commercial:activations:write` 10rps burst 20, `b2:webhooks:manage` 5rps, 429 with Retry-After + X-RateLimit headers).
- [x] Quota contracts are frozen (three `00:00Z` calendar-day groups `commercial.read:5000`/`commercial.write:500`/`webhooks.manage:100`, cost 1, 429 with X-Quota headers, next-day auto-reset).
- [x] Error contracts are frozen as `B2ApiErrorV1` + 15 `B2ApiErrorCodeV1` values + `B2FieldErrorV1` and HTTP mappings (401 unauthorized, 403 forbidden/consent/cohort/prohibited, 404 not found, 409 idempotency/conflict, 410 deprecated, 422 idempotency required, 429 rate/quota, 503 unavailable).
- [x] OpenAPI-first contract is frozen (deterministic OpenAPI 3.1 at B2T07 `docs/api/B2-OPENAPI-v1.yaml` is the only documented truth; every catalog route appears in the OpenAPI and every OpenAPI operation appears in the catalog).
- [x] Webhook registration is frozen as `B2WebhookRegistrationV1` (HTTPS allowlist, `b2.activation.*` + `b2.webhook.test`, `HMAC_SHA256`, hash-only `secretHash`, `PENDING_VERIFICATION` challenge `X-Monienaija-Challenge` echo).
- [x] Webhook verification is frozen as `B2WebhookDeliveryV1` headers `X-Monienaija-Signature` hex(HMAC-SHA256(secret, body.timestamp.deliveryId)) + `X-Monienaija-Timestamp` 300s freshness + `X-Monienaija-Delivery-Id` replay idempotency, bounded retry 5 exponential, dead-letter.
- [x] Compatibility rules are frozen as five cohort rules (B1 scope frozen, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`, audience `FORBIDDEN`).
- [x] Deprecation rules are frozen as `B2DeprecationV1` 90-day `Deprecation: true` + `Sunset` with `410` after sunset.
- [x] Consumer boundaries are frozen as distinct `B2ConsumerIdV1` / `B2CredentialIdV1` with beneficial-owner trace, audience/scope subset invariant, and hash-only credential storage.
- [x] Integration boundaries are recorded as eleven read-only consumer contracts (A1, A2, A3, A4, A5, A6, A7, B1, CustomerPreference/A6T10, Operations).
- [x] No application source, entity, migration, service, controller, API, route, scheduler, activation, onboarding, webhook delivery, authentication logic, or API key generation is created by B2T02.
- [x] B2T02 does not begin B2T03 or any later B2 task; B2T02 does not begin B3, cross-region/cross-currency, second scope/partner beyond `NIBSS_NIP`, or production ramp.

### Evidence limitations

- This contract design is documentation-only. B2T02 does not implement the B2 public API catalog runtime, route-exposure runtime, activation workflow, customer/merchant/agent onboarding, credential lifecycle, webhook delivery, sandbox, API versioning runtime, quota/rate-limit enforcement, OpenAPI generation, or release gate.
- This contract design does not call a partner, query live provider systems, inspect live customer/bank data, certify NIBSS, or verify settlement availability.
- The A6 partner is **not** connected or certified; A6 phase result is `NOT APPROVED / CONDITIONAL`. The first activation cohort depends on the A6 partner, which remains in this state.
- The A7 first product is `Prepared, not approved, not certified, not activated, not handed off to A8`. The first activation cohort depends on that A7 product.
- The B1 commercial platform is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`). The first activation cohort depends on that B1 commercial scope.
- B2T02 does not claim that A1/A2/A3/A4/A5/A6/A7/B1/Finance/Tax/Security/Privacy/Legal/Risk/Compliance/Operations/Reconciliation/Support/Product/Commercial/partner owners have approved the first activation cohort or any B2 surface.
- B2T02 does not authorize any B2 public route, credential issuance, webhook delivery, or activation.
- B2T03–B2T12 must still define, implement, test, and gate customer/merchant/agent onboarding, activation workflows, consent, docs/versioning/sandbox, credentials/quotas/rate limits, webhook delivery/verification, public authentication, disable/rollback, and release gate before any B2 public commercial operation is considered.
