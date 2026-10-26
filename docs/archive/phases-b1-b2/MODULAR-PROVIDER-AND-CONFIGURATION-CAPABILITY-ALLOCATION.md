# Modular Provider and Governed Configuration Capability Allocation

- **Artifact type:** Architecture and future-allocation input only
- **Status:** DOCUMENTED / RUNTIME NOT AUTHORIZED
- **Roadmap authority:** `B2R01 — Authoritative Platform Roadmap and B2 Finance Reconciliation`
- **Implementation task:** NOT ALLOCATED
- **Runtime owner split:** B8 Configuration Platform, B9 Identity & Access Administration, C1 Infrastructure & Provider Integrations, C5 Secrets & Key Management, and the applicable domain authority
- **Historical tasks changed:** None

This document records the required modular provider/configuration capability against the existing authoritative roadmap. It does not create a roadmap, task number, ADR, provider integration, configuration table, administrative API, frontend, secret store, identity, role assignment, approval, or production state.

The authoritative sequence and all historical implementation identities remain unchanged.

## 1. Problem statement

The platform must support multiple provider implementations for a service category without coupling business logic to one provider. Provider-specific configuration must be discoverable and validated, while active selection, values, secrets, health, and runtime resolution remain distinct concerns.

The initial intended provider catalog is:

| Service category | Intended initial provider definitions         |
| ---------------- | --------------------------------------------- |
| `AUTHENTICATION` | `GOOGLE`, `MICROSOFT`, `OKTA`, `GENERIC_OIDC` |
| `EMAIL`          | `GOOGLE`, `MICROSOFT`, `SMTP`                 |
| `AI`             | `GOOGLE_GEMINI`, `OPENAI`, `ANTHROPIC`        |

These entries are intended future provider definitions, not claims that integrations are implemented or certified. A definition may be exposed as supported only when its adapter/runtime implementation and compatibility evidence exist.

The same model must later be extensible to SMS, storage, notification, document, KYC, fraud, bank, payment, and other external-service categories. Extension does not transfer the source authority of any domain to the configuration platform.

## 2. Authoritative ownership

### 2.1 B8 Configuration Platform

B8 owns the broad governed configuration plane:

- provider-definition metadata made available to administration;
- provider-specific non-secret configuration schemas;
- configuration instance lifecycle and versioning;
- active provider selection and cardinality policy;
- validation orchestration and status projection;
- effective dating, activation/deactivation, concurrency, rollback, and distribution;
- audit integration for configuration changes;
- organization/product presentation settings that Architecture confirms are configuration rather than canonical legal or domain master data.

B8 does not own provider transport code, secret material, authentication decisions, role assignments, commercial decisions, customer limits, Finance controls, payment semantics, or domain health semantics.

### 2.2 B9 Identity & Access Administration

B9 owns permanent:

- role and entitlement definitions;
- role-to-capability composition;
- principal role assignment and revocation;
- access reviews;
- privileged-access governance;
- administration of who may view, validate, change, or activate provider configuration.

A2 remains runtime authentication, assurance, authorization, session, and privileged-approval authority. Domain platforms continue to define domain actions and segregation requirements. B9 must not replace those authorities.

The bounded A2T11 roles remain interim and unchanged:

```text
FINANCE_ADMIN
FINANCE_PREPARER
FINANCE_CONTROLLER
FINANCE_AUDITOR
```

They are not the permanent role vocabulary and must not be generalized inside A2T11.

### 2.3 C1 Infrastructure & Provider Integrations

C1 owns reusable provider-integration foundations distinct from A6 business-partner authority, including the future common adapter registration/resolution mechanics and shared technical integration facilities approved by its plan.

The applicable domain still owns its provider-facing semantic contract:

- A2 owns workforce authentication acceptance and assurance semantics;
- A6 owns external financial partner operations, callbacks, and settlement boundaries;
- notification owners own channel/delivery semantics;
- a future approved AI consumer owns AI request, safety, data-use, and result semantics;
- other domains retain their corresponding business authority.

C1 must not become a generic business-decision authority.

### 2.4 C5 Secrets & Key Management

C5 owns protected secret/key storage, access, rotation, revocation, and lifecycle. Provider configuration records may contain opaque secret references and safe metadata only. B8 must never persist plaintext client secrets, API keys, private keys, passwords, callback secrets, refresh tokens, or equivalent credentials in ordinary configuration records.

Until C5 is implemented, existing deployment environment/approved external secret mechanisms and opaque-reference patterns remain the only available bounded mechanisms. This document does not introduce a secret manager.

### 2.5 Domain authorities

| Concern                                                          | Authority                             |
| ---------------------------------------------------------------- | ------------------------------------- |
| Runtime authentication and assurance                             | A2                                    |
| Permanent workforce role/entitlement administration              | B9                                    |
| Broad configuration lifecycle/distribution                       | B8                                    |
| Reusable provider-integration infrastructure                     | C1                                    |
| Secret/key lifecycle                                             | C5                                    |
| External financial partner operations and settlement boundary    | A6                                    |
| Commercial plans, tiers, pricing, fees, and commercial decisions | B1                                    |
| Eligibility, restriction, and limit policy decisions             | A4                                    |
| Product-specific policy and capability requirements              | A7 with A4                            |
| Finance controls and segregation semantics                       | B2F06                                 |
| Audit persistence                                                | Existing Operations `AuditService`    |
| Frontend settings experience                                     | Frontend phase after backend maturity |

## 3. Existing reusable repository foundations

The repository contains bounded patterns that future allocated work should consume rather than duplicate.

### 3.1 Environment configuration and fail-closed validation

- `src/config/environment.ts` provides centralized startup validation.
- `ConfigModule` provides environment injection.
- `src/authorization/workforce-configuration.ts` demonstrates strict structured JSON validation and cross-field checks.
- `src/production/production-configuration.service.ts` demonstrates a safe configuration projection that excludes secrets.

These are deployment/bootstrap mechanisms, not a B8 governed configuration platform. They do not provide durable versioning, active selection, administration, effective dating, distribution, or audit of changes.

### 3.2 Provider-neutral A2T11 OIDC validation

A2T11 already accepts normalized OIDC trust configuration:

- issuer;
- JWKS URI;
- audience/client ID;
- internal audience;
- assertion/session constraints.

`A2WorkforceOidcService` does not branch on Google, Microsoft, Okta, or another provider name. Future provider configuration should resolve an active authentication definition into this normalized A2 trust contract rather than add provider-name conditionals to A2 authorization or business logic.

A2T11 currently supports one configured OIDC trust source. It does not implement provider discovery, browser authorization-code exchange, provider-specific claim transformation, multiple configured provider records, B8 selection, or a provider administration API. Those omissions must not be silently filled under A2T11.

### 3.3 A6 adapter and connection patterns

The A6 implementation provides reusable design evidence:

- `PartnerCapabilityRegistry` separates registered capability metadata from connection configuration;
- adapter request/result/error contracts isolate provider-specific transport from domain logic;
- `PartnerConnectionService` validates readiness and fails closed;
- credential and signing material are represented by opaque references;
- safe status views expose presence/status rather than secret values;
- provider environment, API version, adapter version, timeout, and failure classification are distinct;
- shared audit, correlation, idempotency, and circuit-breaker primitives are consumed.

These artifacts remain A6-owned and NIBSS-capability-bounded. They may inform a future C1/B8 design, but must not be renamed, moved, or generalized by reopening A6T01–A6T11.

### 3.4 Shared operational primitives

Existing Operations services provide canonical audit, idempotency, outbox, metrics, diagnostics, and request/correlation context. A future provider configuration plane must consume these rather than create parallel authorities.

### 3.5 Notification boundary

A7T06 established provider-independent notification dispatch/outbox semantics and explicitly excluded live email, SMS, push, and web providers. Future email provider adapters can consume the approved dispatch boundary; they must not replace customer notification preferences or create a second dispatch authority.

### 3.6 Commercial tier and limit foundations

The repository contains B1 commercial customer-tier/catalog concepts and A4/customer-eligibility/limit evaluation concepts. They are not one generic Class-of-Service platform.

A future Class of Service design must preserve:

- B1 ownership of commercial tier/plan semantics;
- A4 ownership of eligibility/restriction/limit policy decisions;
- A7 ownership of product-specific requirements;
- B8 ownership only of governed configuration lifecycle/distribution where applicable.

Security rate limits, API quotas, Finance materiality, and commercial/customer transaction limits remain separate concepts.

## 4. Missing capabilities and future owner

| Missing capability                         | Future owner                                                      | Supporting/consumer owners                             | Runtime authorized now?   |
| ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| Provider-definition catalog                | B8 and C1 boundary requires allocation                            | Applicable domain                                      | No                        |
| Provider-specific field/schema metadata    | B8                                                                | C1 adapter and domain validators                       | No                        |
| Durable provider configuration instances   | B8                                                                | Operations audit; C5 references                        | No                        |
| Exclusive/multi-provider category policy   | B8                                                                | Architecture and domain owner                          | No                        |
| Active provider selection                  | B8                                                                | Runtime resolver/C1                                    | No                        |
| Generic runtime provider registry/resolver | C1                                                                | B8 configuration distributor; domain adapters          | No                        |
| Provider adapter implementations           | C1 plus applicable domain                                         | A2/A6/notification/future AI consumer                  | No general task allocated |
| Secret resolution and rotation             | C5                                                                | C1/B8/domain consumers                                 | No                        |
| Administrative provider APIs               | B8                                                                | A2 authorization; B9 entitlements                      | No                        |
| Permanent role/permission administration   | B9                                                                | A2 enforcement; domain action owners                   | No                        |
| Organization and branding configuration    | B8 scope candidate; exact master-data ownership requires decision | C4 for managed logo/document assets; Frontend consumer | No                        |
| Service-provider settings UI               | Frontend                                                          | B8 backend; B9/A2 access                               | No                        |
| Provider connectivity/health execution     | C1 and provider adapter                                           | Domain semantic readiness; C2 telemetry later          | No                        |
| AI provider runtime                        | C1 plus a separately approved AI consumer/domain contract         | B8/C5/C2                                               | No                        |
| Live email provider runtime                | C1/channel adapter consuming A7T06                                | B8/C5/C2                                               | No                        |
| Configurable Class of Service              | B1/A4/A7 semantics; B8 lifecycle/distribution                     | B9/A2 administration and enforcement                   | No broad task allocated   |

## 5. Required future configuration model

The following is a capability contract for future allocation, not a database or API schema.

### 5.1 Service category definition

A category requires:

- stable category key;
- display metadata;
- owning domain;
- selection cardinality: `SINGLE` or `MULTIPLE`;
- configuration scope, such as platform/environment and any future tenant scope explicitly approved by Architecture;
- required capabilities;
- activation and health policy references.

`AUTHENTICATION`, `EMAIL`, and `AI` are initially `SINGLE`: at most one effective active provider in the same configuration scope. The model must permit an explicitly declared `MULTIPLE` category later without weakening `SINGLE` uniqueness.

No category may infer multi-provider behavior merely because multiple configuration records exist.

### 5.2 Provider definition

A provider definition requires:

- stable provider key;
- category key;
- display name and description;
- implementation/adapter key and version;
- enabled/disabled availability metadata;
- provider-specific field/schema definition and schema version;
- secret-reference field declarations;
- capability metadata;
- validator/health-check capability metadata;
- safe documentation metadata;
- deprecation/sunset status.

Provider definitions identify supported code capabilities. Administrators do not create arbitrary executable provider types or upload code through configuration.

### 5.3 Configuration field definition

Each provider owns its relevant field set. A field descriptor must distinguish at least:

- key, label, description, data type, required state, and safe validation constraints;
- secret value versus opaque secret reference;
- mutable versus activation-locked fields;
- safe display/redaction behavior;
- environment restrictions;
- whether changing the field requires validation, reactivation, session invalidation, or another domain action.

The future B8 task must select a versioned schema representation. This document does not choose JSON Schema, Zod serialization, or another format.

### 5.4 Provider configuration instance

A configuration instance requires:

- stable configuration reference and version;
- category/provider/implementation/schema versions;
- configuration scope and environment;
- non-secret values only;
- opaque secret references only;
- lifecycle state;
- effective window;
- validation status and safe errors;
- health status reference;
- actor, approval, audit, correlation, and change references;
- optimistic concurrency/version evidence;
- supersession/rollback lineage.

Suggested lifecycle vocabulary requires a future ADR; no vocabulary is authorized by this document. Draft concepts include `DRAFT`, `VALIDATED`, `ACTIVE`, `INACTIVE`, `INVALID`, `DEGRADED`, and `RETIRED`, but these must not become persisted identifiers until allocated and approved.

### 5.5 Active selection

For `SINGLE` categories, durable controls must guarantee no overlapping effective active selections for the same category/scope. This requires database-level protection or an equally strong serialized invariant, not only an application pre-check.

Activation must:

1. resolve an implemented provider definition and compatible schema version;
2. validate non-secret configuration;
3. verify required secret references without exposing secret values;
4. execute the approved bounded readiness check;
5. satisfy A2/B9 authorization and applicable maker/checker policy;
6. atomically supersede or reject conflicting selection according to an approved transition rule;
7. audit the decision and distribute the new effective version;
8. fail closed when current configuration is invalid, ambiguous, unavailable, stale beyond policy, or unsupported by the deployed adapter version.

### 5.6 Runtime resolution

Business/domain code must depend on a category-specific interface, not provider keys. The future resolver maps the effective selection to a registered implementation at a composition boundary.

Provider-name branching is allowed only inside the provider registration/composition boundary or provider adapter itself. It is prohibited throughout business logic.

Resolution must distinguish:

- not configured;
- configured but inactive;
- active but invalid;
- active but adapter unavailable/incompatible;
- active and healthy;
- active but degraded under an explicitly approved policy.

No automatic fallback to another provider is permitted unless the category owner explicitly defines and approves failover semantics. “Exactly one active” must not be bypassed by hidden fallback.

## 6. Authentication-provider relationship to A2T11

A future authentication provider configuration resolves to an A2-owned normalized trust input. Provider-specific setup may include authorization/discovery endpoints, tenant/domain restrictions, client-secret references, redirect URIs, claim compatibility, or login-flow metadata, but A2 continues to decide whether an assertion establishes accepted identity and assurance.

The future initial authentication provider definitions require separate compatibility evidence:

- `GOOGLE`: OIDC issuer/JWKS/client configuration and proof that required `auth_time`/`amr` assurance is supplied;
- `MICROSOFT`: tenant/authority and claim/assurance compatibility evidence;
- `OKTA`: organization/authorization-server and claim/assurance compatibility evidence;
- `GENERIC_OIDC`: explicit issuer/JWKS/audience/client and required-claim compatibility evidence.

A provider cannot be marked runtime-supported only because its fields can be stored. Its ID tokens must satisfy the accepted A2T11 contract or a later A2 decision must explicitly version that contract. B8 configuration must not normalize untrusted claims into MFA evidence.

A2T11 remains environment-configured and single-source until future B8/C1 work is allocated. No Google-specific branch or provider record is added to A2T11 by this document.

## 7. Email and AI boundaries

### 7.1 Email

Future email adapters must implement an approved channel-delivery interface and consume A7T06 dispatch evidence/preferences. Provider-specific configuration may include OAuth/client references, tenant/domain, SMTP host/port/security mode, sender identity, timeout, and provider-specific capability metadata.

B8 selects/configures; C5 protects credentials; C1 provides integration infrastructure; notification/channel owners retain template, recipient, consent/preference, delivery, retry, and disclosure semantics.

### 7.2 AI

No authoritative AI business/platform owner or runtime task is currently allocated. Before implementing Gemini, OpenAI, or Anthropic adapters, Architecture must identify:

- the consuming domain and approved use cases;
- data classification and prohibited inputs;
- model/output authority and human-review requirements;
- retention, residency, training-use, safety, evaluation, and incident controls;
- cost/quota ownership;
- observability and fallback behavior.

B8 may eventually configure provider/model selection, C1 may host adapter foundations, C5 may resolve credentials, and C2 may provide telemetry. None becomes authority for AI-generated business or financial decisions by implication.

## 8. Organization configuration boundary

Company name, product name, platform name, domain, support contact, branding, and logo references must not be introduced as permanent source constants merely for a deployment.

Before runtime implementation, Architecture must separate:

- canonical legal-entity/master data;
- product/catalog identity owned by B1/A7 where applicable;
- deployable presentation/branding settings governed through B8;
- managed logo/document assets owned by C4;
- frontend presentation consumption.

B8 may govern versioned distribution of approved organization settings, but this document does not assign canonical legal-entity authority to B8.

## 9. Administrative and approval model

The future backend flow is:

```text
B9-authorized administrator
  -> B8 provider/category/configuration API
  -> provider-specific schema/value validation
  -> C5 secret-reference verification
  -> C1/domain adapter readiness validation
  -> A2 privileged approval enforcement where policy requires
  -> B8 atomic activation and audit/distribution
  -> domain runtime resolution
```

B8 owns configuration-change state. A2 owns authentication, authorization, assurance, and privileged approval enforcement. B9 owns permanent entitlements. The applicable domain owns whether a change is material and what approval capabilities are required. Operations owns canonical audit persistence.

No frontend is authorized now. A future settings UI must derive fields from the selected provider definition and must never retrieve secret values after submission.

## 10. Decisions required before runtime implementation

Explicit Architecture decisions are required for:

1. formal B8 implementation-plan/task allocation without changing roadmap order;
2. formal B9, C1, and C5 integration allocations when their gates are reached;
3. the B8/C1 boundary for provider-definition registration and runtime resolution;
4. configuration scope and tenancy model;
5. schema representation, compatibility, migration, and search/index policy;
6. lifecycle, activation, effective dating, rollback, and optimistic-concurrency rules;
7. `SINGLE` versus `MULTIPLE` category invariants and transition semantics;
8. secret-reference format, external deployment bridge, and later C5 cutover;
9. readiness versus continuous health ownership and safe status/error vocabulary;
10. cache/distribution consistency, stale-configuration policy, outage behavior, and failover rules;
11. administrative actions, capabilities, maker/checker rules, and B9 handoff;
12. organization/legal/product/branding ownership split;
13. AI consuming authority and safety/data-governance contract;
14. provider certification and support/deprecation lifecycle;
15. audit classification, retention, access, and legal-hold requirements.

No task or ADR number is assigned by this document.

## 11. Work legitimately permitted now

The current authorized bounded runtime remains:

- use A2T11's provider-agnostic OIDC trust configuration for one approved OIDC source;
- supply deployment values through the existing environment/approved secret mechanism;
- retain A2T11's strict validation and fail-closed behavior;
- use existing opaque credential-reference patterns where already authorized by a domain task;
- perform architecture research and planning ahead of future platform gates, as the authoritative roadmap permits.

The following broad runtime work is not contained by any existing unstarted task:

- a generic provider/configuration database;
- provider administration controllers;
- a cross-category runtime registry/resolver;
- Google/Microsoft/Okta authentication-flow adapters;
- live email adapters;
- AI adapters;
- organization settings runtime;
- permanent roles/permissions;
- generic Class of Service runtime;
- settings frontend.

Reopening A2T11, A6T02/A6T03, A7T06, B1 tasks, historical B2 tasks, or completed Finance tasks to absorb this work would violate their bounded authority and historical completion.

## 12. Next legitimate allocation

The next allocation for the broad configuration plane must be an Architecture-approved B8 implementation plan/task sequence at B8's authoritative roadmap gate. That future allocation should consume this document as input and coordinate explicit handoffs to B9, C1, C5, applicable domain owners, Operations, C2, C4, and Frontend.

Until that allocation exists, this document is the maximum legitimate cross-category deliverable: it records requirements and ownership without creating premature runtime authority.

This does not alter the current B2 Finance sequence or authorize B2F07 runtime. It creates no dependency that allows B8, B9, C1, C5, or Frontend to bypass the authoritative platform order.
