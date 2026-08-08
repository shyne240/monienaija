# ADR-0048 — NIBSS and Bank Integration Isolation

- **ADR ID:** ADR-0048
- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T03 — Bank/NIBSS Integration Isolation and Credential Boundary
- **Status:** Implemented (partner-specific transport, live credential, mTLS, key-rotation, and partner-onboarding work remain intentionally out of scope)
- **Date:** 2026-08-08
- **Scope:** Environment-isolated partner connection profile, reference-only credential and signing boundary, capability compatibility assertion, request-signing preparation, connection-audit boundary, and `PartnerConnectionService` ownership of the selected `NIBSS_NIP` / `external.wallet.withdrawal.settlement` boundary
- **Authoritative boundary:** `PartnerConnectionService` (NestJS provider in `src/partner/`)
- **Selected partner:** `NIBSS_NIP` (planning rail only)
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Adapter contract version:** `A6-EXTERNAL-PARTNER-ADAPTER` v1 (per ADR-0047)
- **Application, database, API, callback, provider, settlement, and public-channel changes in this task:** Provider-neutral connection profile, environment-isolated credential-reference loader, request-signing preparation, capability compatibility assertion, and connection-audit boundary; no partner SDK, no HTTP client, no live provider call, no callback controller, no settlement or financial execution

This ADR records the implementation that already exists in the repository. It is a documentation completion artifact; it introduces no new runtime behavior, architectural change, requirement, API, entity, service, controller, route, migration, configuration, or implementation work. The behavior described here is exactly the behavior committed in A6T03 and validated by the existing A6T03 tests.

## 1. Context

A6T01 selected the first bounded A6 planning capability:

```text
external.wallet.withdrawal.settlement
internal customer-funds wallet -> external Nigerian bank account
NGN
selected planning rail: NIBSS/NIP through an isolated adapter
```

A6T02 (ADR-0047) established a provider-neutral adapter boundary, normalized request/result envelopes, and an interface-level retry/timeout posture. A6T02 explicitly did not implement connection, credential, signing, environment, or transport behavior; A6T03 was reserved to own those boundaries.

The repository did not previously have a partner connection profile, partner credential loader, partner request signer, partner capability registry, partner connection audit boundary, or partner circuit-breaker primitive. Existing internal modules (Customer, Wallet, Ledger, A2, A3, A4, A5, Operations, Outbox, Reconciliation) have no partner SDK, no provider HTTP client, and no partner credential material in their source or tests.

A6T03 must implement the connection boundary that A6T02 left for it, without leaking partner-specific transport, credential material, or signing semantics into canonical domain modules. The selected partner is a planning rail; the connection boundary must support both `sandbox` and `production` partner environments but must fail closed when the process is not production but the partner environment is selected as `production`, and must fail closed when an enabled profile is missing a credential or signing reference.

A6T03 must also leave a clear extension point for A6T05, A6T06, A6T07, and A6T11 without coupling them to a specific transport, signing library, credential store, or wire protocol. A6T03 documents the connection, credential, signing, capability, and audit boundaries that already exist; partner-specific wire protocols, mTLS, key rotation, and live provider onboarding remain explicitly out of scope.

## 2. Problem statement

The repository needed a single, isolated partner connection boundary that:

- exposes one profile object describing the selected partner, capability, operation, environment, API version, adapter version, endpoint, signing algorithm, and timeouts;
- references credentials and signing keys through an approved reference model rather than embedding secret material in source, tests, profile objects, or audit records;
- separates `sandbox` and `production` partner environments so a process in `development`, `test`, or `staging` cannot silently use a production partner environment;
- refuses to admit an enabled transport when the selected environment lacks a credential or signing reference;
- asserts partner/capability/operation/currency compatibility through a single registry before any provider transport is attempted;
- prepares a normalized request-signing input that includes contract, partner, environment, algorithm, payload hash, request ID, correlation ID, and timestamp without producing the signature itself;
- records safe connection lifecycle facts through the existing Operations audit contract;
- remains disabled by default and requires an explicit `A6_PARTNER_ENABLED` configuration to be ready for transport;
- does not depend on a partner SDK, an HTTP client, a credential store, a key-management library, or a specific transport protocol; and
- does not mutate Customer, CustomerWallet, funding instruments, A3 bindings, A4 policy, Wallet, Ledger, A5, Operations, Outbox, or Reconciliation source records.

The A6T03 implementation answers each of these with a single NestJS service, a single registry, a single credential loader, a single signing service, a single audit boundary, and one NestJS module registration that wires them together. The runtime remains partner-disabled by default and contains no live partner call, no live credential, and no partner SDK.

## 3. Decision

### 3.1 One partner connection service owns the boundary

A6T03 introduces `PartnerConnectionService` as the single owner of the A6 connection profile, environment selection, capability compatibility check, credential-reference loading, signing preparation, and ready-for-transport assertion. The service implements a `PartnerConnectionBoundary` interface that exposes four operations:

```text
PartnerConnectionService.getProfile(): PartnerConnectionProfile
PartnerConnectionService.getStatus(): PartnerConnectionStatusView
PartnerConnectionService.assertReadyForTransport(): PartnerConnectionContext
PartnerConnectionService.prepareSigning(...): PartnerSigningPreparation
```

`PartnerConnectionService` does not call a partner, does not open a socket, does not read or write a domain table, does not post a Ledger journal, and does not depend on a partner SDK. Its dependencies are `ConfigService`, `PartnerCapabilityRegistry`, `PartnerCredentialLoader` (injected by the `PARTNER_CREDENTIAL_LOADER` symbol), and `PartnerRequestSigner` (injected by the `PARTNER_REQUEST_SIGNER` symbol). All four dependencies are configuration, registry, and signing-preparation inputs only.

### 3.2 One partner capability registry

`PartnerCapabilityRegistry` holds one frozen registration for the A6T01-selected capability:

```text
partnerKey:           NIBSS_NIP
capabilityKey:        external.wallet.withdrawal.settlement
operationType:        OUTBOUND_BANK_SETTLEMENT
supportedCurrencies:  ['NGN']
supportedTargetTypes: ['BANK_ACCOUNT']
environments:         ['sandbox', 'production']
adapterVersion:       a6-adapter-<A6 adapter contract version>
partnerApiVersion:    v1
```

The registry exposes `list()`, `getRegistration(partnerKey, capabilityKey, operationType)`, and `assertCompatible(partnerKey, capabilityKey, operationType, currency)`. A request that does not match the registered partner, capability, operation, or currency is rejected before any configuration is loaded. A second capability requires a new registration, a new ADR, and a new review; A6T03 does not register a second capability.

### 3.3 Environment-isolated profile

`PartnerConnectionService.getProfile()` reads the connection configuration from `ConfigService` and assembles a `PartnerConnectionProfile` with explicit environment, partner, capability, operation, API version, adapter version, signing algorithm, and timeouts. The endpoint is resolved from a per-environment configuration key:

```text
environment == 'sandbox'    -> A6_PARTNER_SANDBOX_BASE_URL
environment == 'production' -> A6_PARTNER_PRODUCTION_BASE_URL
```

A profile whose `A6_PARTNER_ENABLED` is `false` (the default) returns a fully populated profile with `enabled: false`, `baseUrl: null`, `credentialReference: null`, and `signingKeyReference: null`. The status view reports `DISABLED` and `assertReadyForTransport()` raises `PARTNER_DISABLED`. No transport, credential, or signing state is materialized for a disabled profile.

A profile whose environment is `production` and whose `NODE_ENV` is not `production` raises `PartnerConfigurationException` with code `PRODUCTION_CONFIGURATION_FORBIDDEN`. The status view reports `PRODUCTION_CONFIGURATION_FORBIDDEN`. This rule is enforced in the service in addition to the environment-schema refinement, so a configuration that reaches the service without being validated still fails closed.

A profile whose selected environment lacks a base URL raises `NOT_CONFIGURED`. A profile whose selected environment lacks a credential or signing reference (see §3.4) raises `CREDENTIAL_REFERENCE_MISSING` or `SIGNING_REFERENCE_MISSING`. A profile whose selected partner, capability, operation, or currency is not registered raises `CAPABILITY_MISMATCH`. Each of these errors is mapped to a distinct `PartnerConnectionStatus` so the status view exposes the precise failure without exposing secret material or partner internals.

### 3.4 Reference-only credential model

A6T03 does not store, transmit, log, or audit any partner secret material. Credentials and signing keys are referenced through opaque, environment-scoped configuration strings. The reference model is the same for every partner environment and is independent of any specific credential store, key-management system, or secret backend.

```text
A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE      -> PartnerCredentialReference(partnerKey, 'sandbox', 'CLIENT_AUTHENTICATION', reference)
A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE   -> PartnerCredentialReference(partnerKey, 'production', 'CLIENT_AUTHENTICATION', reference)
A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE     -> PartnerCredentialReference(partnerKey, 'sandbox', 'REQUEST_SIGNING', reference)
A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE  -> PartnerCredentialReference(partnerKey, 'production', 'REQUEST_SIGNING', reference)
```

`EnvironmentPartnerCredentialLoader` is the only implementation registered under the `PARTNER_CREDENTIAL_LOADER` symbol. It selects the per-environment reference value from `ConfigService` and returns a `PartnerCredentialReference` object. The reference object contains only the partner key, the environment, the kind (`CLIENT_AUTHENTICATION` or `REQUEST_SIGNING`), and the opaque reference string; it does not contain the resolved secret.

`PartnerConnectionProfile` carries `credentialReference` and `signingKeyReference` as `PartnerCredentialReference` objects (or `null` when the profile is disabled). The `PartnerConnectionStatusView` reports only whether each reference is configured; it does not include the reference value, the resolved secret, or any identifier that could be replayed against the credential store. The profile object is the only place where reference values are present in memory, and the reference is never written to a domain record, an audit `newValues` object, a test assertion, or a log statement.

A missing per-environment credential or signing reference raises `PartnerConfigurationException` with code `CREDENTIAL_REFERENCE_MISSING` or `SIGNING_REFERENCE_MISSING`. The error message identifies the reference kind but not the environment configuration key or any reference value.

### 3.5 Request-signing preparation boundary

`PartnerRequestSigningService` is the only implementation registered under the `PARTNER_REQUEST_SIGNER` symbol. It receives a `PartnerSigningInput` (partner, environment, algorithm, key reference, canonical payload hash, request ID, correlation ID, timestamp) and returns a `PartnerSigningPreparation` with a normalized input and a deterministic `signingInputHash`. The service does not produce a signature, does not call a partner, and does not depend on a key-management library.

The service enforces the following invariants before producing the preparation:

- `partnerKey` must equal `NIBSS_NIP`;
- `canonicalPayloadHash` must match the 64-character hexadecimal SHA-256 shape (`/^[a-f0-9]{64}$/i`) and is normalized to lowercase;
- `keyReference.partnerKey` must equal the input `partnerKey`;
- `keyReference.kind` must equal `REQUEST_SIGNING`;
- `keyReference.environment` must be `sandbox` or `production`;
- `requestId` and `correlationId` must be non-empty and are trimmed;
- `timestamp` is normalized to an ISO-8601 string.

The signing input string is the deterministic, pipe-separated concatenation of `EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME`, partner key, environment, algorithm, normalized payload hash, request ID, correlation ID, and normalized timestamp. The `signingInputHash` is `SHA-256(signingInput)`. The preparation object does not contain the resolved signing key, a signature, or a credential value.

`PartnerConnectionService.prepareSigning(canonicalPayloadHash, requestId, correlationId, timestamp)` calls `assertReadyForTransport()` first and then forwards the assertion context, the algorithm, and the key reference to the signer. The transport assertion guarantees that a signing preparation is produced only for a profile that is `enabled: true` and that has both `credentialReference` and `signingKeyReference` populated.

### 3.6 Connection audit boundary

`PartnerConnectionAuditService` records connection lifecycle facts through the existing `AuditService` with a single fixed entity identifier:

```text
entityType: A6_PARTNER_CONNECTION
entityId:   00000000-0000-4000-8000-000000000047
actor:      a6-partner-boundary
```

The audit event carries safe configuration metadata only:

```text
action:         PARTNER_CONFIGURATION_VALIDATED | PARTNER_CONFIGURATION_REJECTED | PARTNER_CAPABILITY_REGISTERED
partnerKey
capabilityKey
operationType
environment
status
adapterVersion
apiVersion
correlationId   (optional)
requestId       (optional)
failureCode     (optional, only when the action is a rejection)
```

The audit service never records the resolved secret, the reference value, the endpoint URL, the signing input, the request payload, or any PII. The audit boundary is the only A6T03 surface that writes to Operations; the connection service, the credential loader, and the signing service are read-only with respect to Operations.

### 3.7 Configuration validation

The connection configuration is validated by the A6 environment schema in `src/config/environment.ts` and again by `PartnerConnectionService.getProfile()`. The environment schema enforces:

- `A6_PARTNER_ENVIRONMENT` is `sandbox` or `production` and defaults to `sandbox`;
- `A6_PARTNER_KEY` is the literal `NIBSS_NIP`;
- `A6_PARTNER_CAPABILITY` is the literal `external.wallet.withdrawal.settlement`;
- `A6_PARTNER_OPERATION_TYPE` is the literal `OUTBOUND_BANK_SETTLEMENT`;
- `A6_PARTNER_SIGNING_ALGORITHM` is `HMAC_SHA256` or `RSA_SHA256` and defaults to `HMAC_SHA256`;
- `A6_PARTNER_REQUEST_TIMEOUT_MS` is in `[100, 120_000]` and defaults to `10_000`;
- `A6_PARTNER_CONNECT_TIMEOUT_MS` is in `[50, 30_000]` and defaults to `3_000`;
- sandbox and production base URLs (when both are set) are different strings;
- a `production` environment requires `NODE_ENV=production`; and
- an enabled profile in the selected environment requires a non-empty base URL, credential reference, signing key reference, and callback secret.

`PartnerConnectionService.getProfile()` re-enforces the production-environment/NODE_ENV rule, the capability compatibility rule, the per-environment endpoint rule, and the per-environment credential/signing-reference rule so that any service that bypasses the schema refinement still fails closed.

### 3.8 Failure model

`PartnerConnectionException` is the typed failure vocabulary for the connection boundary. Every failure is mapped to a distinct `PartnerConnectionStatus` so the status view exposes the precise cause without exposing partner internals:

```text
PRODUCTION_CONFIGURATION_FORBIDDEN  -> selected environment is 'production' but NODE_ENV is not 'production'
CAPABILITY_MISMATCH                  -> partner, capability, operation, or currency is not registered
CREDENTIAL_REFERENCE_MISSING         -> selected environment has no client-authentication reference
SIGNING_REFERENCE_MISSING            -> selected environment has no request-signing reference
NOT_CONFIGURED                       -> selected environment has no base URL
PARTNER_DISABLED                     -> A6_PARTNER_ENABLED is false
```

`PartnerConnectionService.getStatus()` wraps `getProfile()` in a try/catch and reports a safe status view even when the profile cannot be assembled. The status view includes `baseUrlConfigured`, `credentialReferenceConfigured`, and `signingReferenceConfigured` booleans; it never includes the resolved values.

### 3.9 Capability registration

The `PartnerCapabilityRegistry` exposes `assertCompatible(partnerKey, capabilityKey, operationType, currency)`. `PartnerConnectionService.getProfile()` calls this method on every profile assembly so a configuration that is otherwise valid but selects an unregistered partner, capability, operation, or currency is rejected with `CAPABILITY_MISMATCH`. The registry is the only source of truth for the A6T01-selected capability, and `PartnerConnectionService` is the only A6T03 surface that consults it.

### 3.10 NestJS module wiring

`PartnerModule` registers the connection boundary, capability registry, credential loader, request signer, connection audit service, and circuit-breaker service as Nest providers and exports them. The module imports `AuthorizationModule`, `BankModule`, `CustomerBeneficiaryModule`, `CustomerFundingInstrumentModule`, `LedgerModule`, `OperationsModule`, `PaymentModule`, and `WalletModule` so the connection boundary can be consumed by later A6 tasks without taking on domain authority. The A6T03 contribution is the connection boundary itself; the consumer modules are imported unchanged and remain owned by their existing phases.

## 4. Rationale

### 4.1 Why a single service owns the boundary

A single service makes the connection boundary explicit, testable, and replaceable. A6T02 (ADR-0047) defines the adapter contract; A6T03 implements the connection boundary as a single, NestJS-managed provider. Splitting the boundary across multiple services would create multiple places that read partner configuration, multiple places that load credential references, and multiple places that can produce a signing preparation, all of which would have to be kept in sync. One service makes the boundary auditable through a single `getStatus()` call and a single `assertReadyForTransport()` guard.

### 4.2 Why credential references are opaque

A6T03 must not own a credential store, a key-management system, a partner SDK, or a specific secret backend. Reference-only credentials keep the connection boundary portable across secret-management solutions and keep secret material out of the partner module, the connection profile, the audit service, the test suite, and the A6T11 evidence package. A reference string such as `secret://partner/sandbox/client` is sufficient for `getProfile()` to assert that a credential exists; resolving the reference to an actual secret is a later, separately reviewed concern that A6T03 does not take on.

### 4.3 Why environment separation is enforced twice

The environment schema in `src/config/environment.ts` already enforces `production requires NODE_ENV=production` and distinct sandbox/production base URLs, but `PartnerConnectionService.getProfile()` re-enforces the same rules so a service that receives a partially-validated configuration still fails closed. The two-layer enforcement is a defense-in-depth pattern: the schema refuses an invalid configuration at startup, and the service refuses a configuration that somehow reaches it through an unvalidated path.

### 4.4 Why the capability registry is a registry rather than a switch

A switch statement in the connection service would couple the boundary to a specific partner/capability/operation set. A registry allows later capabilities to be added with a single new frozen registration, a single new ADR, and a single new review. A6T03 ships with exactly one registration; the registry is the extension point for later A6 capabilities.

### 4.5 Why the signing service prepares but does not sign

`PartnerRequestSigningService.prepare()` returns a deterministic `signingInputHash` and a normalized input. The actual signature is a later concern that depends on the selected signing algorithm (`HMAC_SHA256` or `RSA_SHA256`) and on the resolved signing key. Keeping the signing service at the preparation boundary allows the connection boundary to verify the signing context (partner, environment, algorithm, key reference, payload hash, request ID, correlation ID, timestamp) without taking on a dependency on a key-management library or a partner-specific signing implementation. A6T03 does not produce a signature and does not commit any signing material.

### 4.6 Why the connection service is disabled by default

`A6_PARTNER_ENABLED` defaults to `false`. A disabled profile returns a populated profile with `enabled: false`, `baseUrl: null`, `credentialReference: null`, and `signingKeyReference: null`. The status view reports `DISABLED`, and `assertReadyForTransport()` raises `PARTNER_DISABLED`. This guarantees that a misconfigured deployment that enables the partner capability without supplying the required references fails closed at the first `assertReadyForTransport()` call rather than silently using a default reference, an empty reference, or a partner environment that was not selected.

### 4.7 Why the connection boundary does not write domain data

The connection service is read-only with respect to every domain module. It does not write to Customer, CustomerWallet, funding instruments, beneficiaries, A3 bindings, A4 policy, Wallet, Ledger, A5, Operations, Outbox, or Reconciliation. The only persistence touchpoint is the connection audit boundary, which writes safe configuration metadata to the existing `AuditService`. This keeps the connection boundary from becoming a side-effect authority in any domain module and keeps A6T03 from coupling to A6T05, A6T08, A6T09, or any later A6 task.

## 5. Consequences

### 5.1 Positive

- Partner configuration, credentials, signing, capability, and audit boundaries are owned by a single service, a single registry, a single loader, a single signer, a single audit service, and a single NestJS module.
- The connection boundary fails closed on every misconfiguration: wrong partner, wrong capability, wrong operation, wrong currency, wrong environment, missing endpoint, missing credential reference, missing signing reference, and `production` outside `NODE_ENV=production`.
- The connection boundary is reference-only; no resolved secret, signing key, signature, request payload, or PII is present in the profile, the audit event, the test assertions, or the status view.
- The connection boundary is provider-neutral: it depends only on `ConfigService`, `PartnerCapabilityRegistry`, `PartnerCredentialLoader`, `PartnerRequestSigner`, and the existing `AuditService` contract.
- The connection boundary is disabled by default and supports a safe per-environment separation between `sandbox` and `production` partner environments.
- The capability registry exposes a single, frozen, A6T01-aligned registration and is the only A6T03 surface that knows about the selected partner, capability, operation, currency, and target type.
- A6T05 (ADR-0049), A6T06, A6T07, and A6T11 can consume the connection boundary through `PartnerConnectionService` without taking on configuration, credential, signing, or audit responsibility.

### 5.2 Trade-offs and later-task ownership

- A6T05 owns the durable external-operation record, provider idempotency, request hashing, and replay detection; A6T03 provides the connection boundary and signing preparation but does not own durable operation state.
- A6T06 owns callback authenticity, replay protection, callback reference validation, and idempotent callback processing; A6T03 does not own any inbound surface.
- A6T07 owns the external operation lifecycle, bounded retry, status verification, circuit-breaker admission, and unknown-outcome recovery; A6T03 contributes the `PartnerCircuitBreakerService` primitive but does not own lifecycle or recovery decisions.
- A6T08 owns settlement, suspense, and compensating entries; A6T03 does not own any Ledger authority.
- A6T09 owns independent external reconciliation; A6T03 does not own any reconciliation surface.
- A6T10 owns data minimization, consent, classification, retention, legal hold, and disclosure; A6T03 does not own any data-classification surface.
- A6T11 owns the A6 release gate and A7 handoff; A6T03 contributes the connection boundary to the integration matrix and the route-exposure/rollback evidence but does not claim partner certification or production activation.

## 6. Architecture overview

```text
src/partner/partner-connection.service.ts        PartnerConnectionService
  -> getProfile()                                 PartnerConnectionProfile
  -> getStatus()                                  PartnerConnectionStatusView
  -> assertReadyForTransport()                    PartnerConnectionContext
  -> prepareSigning(...)                          PartnerSigningPreparation
        |
        +-- ConfigService                        (A6_PARTNER_* configuration)
        +-- PartnerCapabilityRegistry            (assertCompatible)
        +-- EnvironmentPartnerCredentialLoader    (loadReferences; PARTNER_CREDENTIAL_LOADER)
        +-- PartnerRequestSigningService          (prepare; PARTNER_REQUEST_SIGNER)

src/partner/partner-capability.registry.ts        PartnerCapabilityRegistry
  -> NIBSS_NIP_WITHDRAWAL_SETTLEMENT_CAPABILITY  (frozen registration)

src/partner/partner-credentials.service.ts        EnvironmentPartnerCredentialLoader
  -> PARTNER_CREDENTIAL_LOADER symbol            (per-environment reference resolution)

src/partner/partner-request-signing.service.ts    PartnerRequestSigningService
  -> PARTNER_REQUEST_SIGNER symbol                (preparation; SHA-256 signingInputHash)

src/partner/partner-connection-audit.service.ts   PartnerConnectionAuditService
  -> AuditService.record(manager, event)          (safe configuration metadata only)

src/partner/partner.module.ts                     PartnerModule
  -> registers and exports the A6T03 boundary
  -> imports AuthorizationModule, BankModule, CustomerBeneficiaryModule,
            CustomerFundingInstrumentModule, LedgerModule, OperationsModule,
            PaymentModule, WalletModule
```

## 7. Partner isolation boundary

A6T03 establishes one explicit isolation boundary between the A6T02 adapter contract and the A6T05/A6T06/A6T07 external-operation boundary. The boundary is `PartnerConnectionService`. No other A6T03 surface reads partner configuration, loads credential references, produces a signing preparation, asserts transport readiness, or audits a connection event. No domain module (Customer, CustomerWallet, funding instruments, beneficiaries, A3 bindings, A4 policy, Wallet, Ledger, A5, Operations, Outbox, Reconciliation) imports `PartnerConnectionService` or depends on the partner capability registry, the partner credential loader, the partner request signer, or the partner connection audit service. The boundary is consumed only through the NestJS module graph and only by later A6 tasks that own a corresponding authority (operation, callback, lifecycle, settlement, reconciliation, data minimization).

## 8. Bank/NIBSS transport isolation

`PartnerConnectionService` is the only A6T03 surface that knows about the selected `NIBSS_NIP` partner and the `external.wallet.withdrawal.settlement` capability. No HTTP client, no partner SDK, no socket, no transport adapter, and no wire protocol is introduced by A6T03. The connection profile carries the partner API version, the adapter version, the per-environment base URL, the per-environment timeout configuration, and the signing algorithm; the actual transport is a later A6 concern. A6T03 commits the isolation boundary, the configuration model, the capability registry, the credential loader, the signing preparation, and the audit boundary; it does not commit any partner transport, any HTTP client, or any provider-specific request/response mapping.

## 9. Environment separation (sandbox vs production)

The connection configuration is split across four configuration keys:

```text
A6_PARTNER_SANDBOX_BASE_URL              -> per-environment endpoint
A6_PARTNER_PRODUCTION_BASE_URL           -> per-environment endpoint
A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE  -> per-environment client-authentication reference
A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE -> per-environment client-authentication reference
A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE -> per-environment request-signing reference
A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE -> per-environment request-signing reference
```

A profile whose selected environment is `sandbox` reads the `A6_PARTNER_SANDBOX_*` keys; a profile whose selected environment is `production` reads the `A6_PARTNER_PRODUCTION_*` keys. The two sets of configuration keys are independent, the resolved references are environment-scoped, and a production profile can never be assembled from sandbox configuration. The environment schema enforces that the two base URLs, when both are set, are distinct strings; the connection service re-enforces the rule on every `getProfile()` call.

A production partner environment is admitted only when `NODE_ENV` is `production`. A process in `development`, `test`, or `staging` cannot select a production partner environment; the configuration is rejected at startup and the connection service re-enforces the rule on every profile assembly. This guarantees that a non-production deployment cannot silently use production partner configuration.

## 10. Credential-reference model

A6T03 does not store, transmit, log, audit, or test any resolved partner secret. The credential model is a reference-only model:

```text
A6_PARTNER_<ENV>_CREDENTIAL_REFERENCE    -> opaque reference string for client authentication
A6_PARTNER_<ENV>_SIGNING_KEY_REFERENCE   -> opaque reference string for request signing
```

`EnvironmentPartnerCredentialLoader.loadReferences(profile)` selects the per-environment reference value and returns a `PartnerCredentialReference` object with the partner key, the environment, the kind (`CLIENT_AUTHENTICATION` or `REQUEST_SIGNING`), and the opaque reference string. The reference object is the only A6T03 surface that knows about the reference; the connection profile carries the reference object, the connection status view reports only whether the reference is configured, and the connection audit service records only that the reference exists (not the value). The signing service receives the key reference as part of the signing input and uses only the partner key, environment, and kind; it never sees or uses the resolved signing key.

## 11. Signing boundary

`PartnerRequestSigningService.prepare(input)` enforces the following invariants:

```text
partnerKey                    must equal NIBSS_NIP
canonicalPayloadHash          must match /^[a-f0-9]{64}$/i; normalized to lowercase
keyReference.partnerKey       must equal input.partnerKey
keyReference.kind             must equal REQUEST_SIGNING
keyReference.environment      must be 'sandbox' or 'production'
requestId                     must be non-empty; trimmed
correlationId                 must be non-empty; trimmed
timestamp                     normalized to ISO-8601
```

The signing input string is the deterministic, pipe-separated concatenation of:

```text
EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME
partnerKey
environment
algorithm
canonicalPayloadHash (lowercase)
requestId (trimmed)
correlationId (trimmed)
timestamp (ISO-8601)
```

The `signingInputHash` is `SHA-256(signingInput)`. The signing service does not produce a signature and does not depend on a key-management library. The signing algorithm is `HMAC_SHA256` by default and may be configured as `RSA_SHA256`; the algorithm is a property of the connection profile and is part of the signing input.

## 12. Configuration validation

The connection configuration is validated in two layers:

1. The A6 environment schema in `src/config/environment.ts` validates the A6 configuration at startup. The schema rejects invalid partner keys, invalid capabilities, invalid operation types, invalid signing algorithms, invalid timeout ranges, equal sandbox and production base URLs, a `production` partner environment without `NODE_ENV=production`, and an enabled profile whose selected environment lacks a base URL, credential reference, signing key reference, or callback secret.
2. `PartnerConnectionService.getProfile()` re-validates the production/NODE_ENV rule, the per-environment endpoint rule, the per-environment credential/signing-reference rule, and the partner/capability/operation/currency compatibility rule on every profile assembly. Any failure is mapped to a distinct `PartnerConnectionStatus` and raised as a typed `PartnerConfigurationException`.

The two-layer validation guarantees that a service that bypasses the schema refinement (for example, a service that constructs an `Environment` object directly) still fails closed at the connection boundary.

## 13. Failure model

The connection boundary uses one typed exception (`PartnerConfigurationException`) and a fixed vocabulary of `PartnerConnectionStatus` values:

```text
PRODUCTION_CONFIGURATION_FORBIDDEN  production partner environment outside a production process
CAPABILITY_MISMATCH                  partner, capability, operation, or currency is not registered
CREDENTIAL_REFERENCE_MISSING         selected environment has no client-authentication reference
SIGNING_REFERENCE_MISSING            selected environment has no request-signing reference
NOT_CONFIGURED                       selected environment has no base URL
PARTNER_DISABLED                     A6_PARTNER_ENABLED is false
DISABLED                             status view for a disabled profile
READY_FOR_TRANSPORT                  status view for a fully-configured enabled profile
```

`getStatus()` never throws; it wraps `getProfile()` in a try/catch and returns a safe status view for every failure. The status view reports booleans (`baseUrlConfigured`, `credentialReferenceConfigured`, `signingReferenceConfigured`) and never includes the resolved values.

`assertReadyForTransport()` throws on `PARTNER_DISABLED`, `CREDENTIAL_REFERENCE_MISSING`, and `SIGNING_REFERENCE_MISSING`. The exception messages identify the failure kind without exposing the environment configuration key, the reference value, or any partner internals.

`prepareSigning(...)` calls `assertReadyForTransport()` first and then forwards the assertion context, the algorithm, and the key reference to the signer. A signing preparation is produced only for a profile that is `enabled: true` and that has both references populated.

## 14. Security assumptions

- Partner configuration is delivered through the standard NestJS `ConfigService` and is therefore subject to the same deployment, secret, and configuration controls as every other A6 configuration value. A6T03 does not invent a new configuration surface.
- Credential and signing-key references are opaque strings; the connection boundary does not assume, validate, or depend on a specific reference format, credential store, key-management system, or secret backend. A reference that resolves to an empty string, to a placeholder, or to a known invalid value is treated as a missing reference.
- The signing service produces a deterministic `signingInputHash` and a normalized input; the actual signature is a later concern. A6T03 does not commit any signing key, any signature, any partner SDK, any key-management library, or any partner-specific signing implementation.
- The audit service writes only safe configuration metadata. The resolved reference value, the endpoint URL, the signing input, the request payload, and any PII are not present in audit events.
- The connection boundary is disabled by default. An enabled profile requires the selected environment to have a non-empty base URL, credential reference, signing key reference, and callback secret; a missing reference fails closed at the first `assertReadyForTransport()` call.
- The capability registry holds a single frozen registration. A second capability requires a new registration, a new ADR, and a new review; A6T03 does not register a second capability.

## 15. Capability registration

```text
NIBSS_NIP_WITHDRAWAL_SETTLEMENT_CAPABILITY
  partnerKey:           NIBSS_NIP
  capabilityKey:        external.wallet.withdrawal.settlement
  operationType:        OUTBOUND_BANK_SETTLEMENT
  supportedCurrencies:  ['NGN']
  supportedTargetTypes: ['BANK_ACCOUNT']
  environments:         ['sandbox', 'production']
  adapterVersion:       a6-adapter-<A6 adapter contract version>
  partnerApiVersion:    v1
```

The registration is a frozen object. `PartnerCapabilityRegistry.list()` returns exactly this registration. `assertCompatible(partnerKey, capabilityKey, operationType, currency)` returns the registration when the inputs match and the currency is in `supportedCurrencies`; otherwise it raises `ConflictException`. `PartnerConnectionService` catches the conflict, wraps it in a `PartnerConfigurationException` with code `CAPABILITY_MISMATCH`, and maps the failure to the `CAPABILITY_MISMATCH` status.

## 16. Ownership boundaries

| Concern                                              | Owner                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Partner connection profile, status, and readiness    | A6T03 `PartnerConnectionService` (this ADR)                            |
| Partner capability registration and compatibility    | A6T03 `PartnerCapabilityRegistry` (this ADR)                          |
| Per-environment credential-reference loading         | A6T03 `EnvironmentPartnerCredentialLoader` (this ADR)                |
| Request-signing preparation and signing-input hash   | A6T03 `PartnerRequestSigningService` (this ADR)                       |
| Connection audit boundary (safe configuration facts) | A6T03 `PartnerConnectionAuditService` (this ADR)                      |
| A6 partner NestJS module wiring                      | A6T03 `PartnerModule` (this ADR)                                      |
| Adapter contract, normalized request/result envelopes| A6T02 (ADR-0047)                                                       |
| External-operation identity, references, idempotency| A6T05 (ADR-0049)                                                       |
| Callback authenticity, replay, and ingestion         | A6T06 (ADR-0049)                                                       |
| External lifecycle, retry, circuit breaker, unknown  | A6T07 (ADR-0047 + ADR-0049)                                            |
| Settlement, suspense, compensating entries           | A6T08 (ADR-0050)                                                       |
| Independent external reconciliation                  | A6T09 (ADR-0053)                                                       |
| Data minimization, consent, classification, retention| A6T10 (ADR-0052)                                                       |
| A2 protected routes, audiences, privileged actions   | A2 (cross-phase; unchanged)                                           |
| Customer/wallet ownership, balances, journals        | Customer, Wallet, A3, A5, Ledger (cross-phase; unchanged)             |
| Operations audit, idempotency, outbox, metrics       | Operations (cross-phase; unchanged)                                   |
| A6 phase release gate and A7 handoff                 | A6T11 (cross-task; unchanged)                                          |

The connection boundary does not own, mutate, or depend on any cross-phase authority. The cross-phase authorities do not import, instantiate, or depend on the connection boundary directly; they consume the boundary through the NestJS module graph in later A6 tasks.

## 17. Explicit non-goals

A6T03 and this ADR do not:

- call NIBSS, a bank, or any partner;
- introduce a partner SDK, an HTTP client, a socket, a transport adapter, a webhook route, a status poller, a statement reader, a scheduler, a broker, or a worker;
- introduce a callback controller, a public route, a partner route, a customer route, a support route, or a control surface;
- resolve a credential reference to a secret, store a credential, rotate a credential, or read from a credential store, a key-management system, or a partner SDK;
- produce a signature, store a signing key, rotate a signing key, or depend on a key-management library or a partner-specific signing implementation;
- introduce mTLS, certificate handling, JWT handling, OAuth handling, or any partner-specific authentication;
- add a new database table, entity, migration, audit entity, idempotency record, outbox event, callback receipt, or reconciliation row;
- register a second partner, a second capability, a second operation type, a second currency, or a second target type;
- introduce a customer wallet, a settlement ledger, a journal authority, a suspense authority, a callback authority, or a reconciliation authority;
- mutate Customer, CustomerWallet, funding instruments, beneficiaries, A3 bindings, A4 policy, Wallet, Ledger, A5, Operations, Outbox, or Reconciliation source records;
- expose a public, customer, partner, callback, support, or internal route;
- implement A6T04, A6T05, A6T06, A6T07, A6T08, A6T09, A6T10, A6T11, A7, or A8 work; or
- claim partner certification, production activation, live credential, live signing, live settlement, or any operational approval.

## 18. Relationship to ADR-0047

ADR-0047 (External Partner Adapter Boundary) defines the provider-neutral adapter contract, the normalized request/result envelopes, the provider-neutral error vocabulary, the interface-level retry/timeout posture, the contract version rules, and the isolation/dependency rules. ADR-0048 implements the connection boundary that ADR-0047 left for A6T03:

- ADR-0047 says "the adapter must not own credential or signing material"; ADR-0048 enforces this with a reference-only credential loader and a preparation-only signing service.
- ADR-0047 says "the adapter must depend on a transport-profile reference, not secret material"; ADR-0048 implements `PartnerConnectionProfile` as that transport-profile reference.
- ADR-0047 says "the adapter must not write a database, Ledger journal, balance, audit row, idempotency record, outbox row, policy record, binding, funding-instrument record, or reconciliation record"; ADR-0048 implements the connection boundary as read-only with respect to every domain module and writes only safe configuration metadata to the existing `AuditService`.
- ADR-0047 says "a partner API version is mapped inside the adapter boundary and is not silently exposed as the A6 contract version"; ADR-0048 carries the `partnerApiVersion` and the `adapterVersion` as separate profile fields and the connection service never conflates them.
- ADR-0047 says "a wrong partner, wrong environment, missing credential, invalid signature, incompatible version, or unavailable endpoint fails closed"; ADR-0048 implements the failure model that produces this behavior (see §13).

A6T03 does not redefine, weaken, or extend the adapter contract. A6T03 implements the connection boundary that consumes the adapter contract.

## 19. Relationship to ADR-0049

ADR-0049 (External Operation Identity, Reference, and Idempotency) is the A6T05 decision record. A6T03 and ADR-0048 contribute the connection boundary to A6T05 and A6T06, but do not own the durable operation identity, the provider idempotency, the request hashing, the replay detection, the reference persistence, or the callback processing that A6T05 and A6T06 own:

- A6T05 owns the external-operation entity, the external-operation reference entity, the canonical request hash, the internal/provider idempotency separation, and the provider-reference uniqueness rules. A6T03 provides `PartnerConnectionService.assertReadyForTransport()` so A6T05 can verify that a connection context exists before it admits a new external operation, but A6T03 does not own the operation record.
- A6T06 owns callback authenticity, replay protection, callback reference validation, and idempotent callback processing. A6T03 provides the connection boundary so the callback controller can verify that a partner, capability, operation, and environment combination is configured, but A6T03 does not own the callback route, the callback authentication, the callback receipt entity, or the callback lifecycle.
- A6T07 owns the external operation lifecycle, the bounded retry policy, the circuit-breaker admission, the status verification, and the unknown-outcome recovery. A6T03 contributes `PartnerCircuitBreakerService` as a primitive, but the lifecycle service, the status verifier, and the recovery decision are owned by A6T07.
- A6T11 owns the A6 release gate and the A7 handoff. A6T03 contributes the connection boundary to the integration matrix and the route-exposure/rollback evidence, but A6T11 owns the disposition and the release-gate decision.

A6T03 does not redefine, weaken, or extend the A6T05/A6T06/A6T07 boundaries. A6T03 implements the connection boundary that those tasks consume.

## 20. Future extension constraints

Future A6, A7, or A8 work that touches the connection boundary must preserve the following constraints:

- The connection boundary remains a single NestJS service (`PartnerConnectionService`) and a single NestJS module (`PartnerModule`). A new connection concern (a new environment, a new partner, a new capability, a new signing algorithm, a new transport, a new credential store) is added by extending the service, the registry, the loader, the signer, or the audit service, not by introducing a parallel boundary.
- A new partner, a new capability, a new operation type, a new currency, or a new target type is added by registering a new frozen object in `PartnerCapabilityRegistry`, by adding the corresponding configuration keys, by adding the corresponding references, and by authoring a new ADR. The existing registration is never silently extended.
- A new signing algorithm is added by extending the `PartnerSigningAlgorithm` union, by extending the signing service, and by updating the environment schema. The default algorithm remains `HMAC_SHA256` until a separate review approves a change.
- A new transport (HTTP client, mTLS, partner SDK, key-management library) is added by extending the connection service, by adding a new transport-profile reference, and by authoring a new ADR. The current connection service does not import a transport library and must not import one without a separate review.
- A new audit action is added by extending the `PartnerConnectionAuditEvent` action union and by updating the audit service. The existing actions (`PARTNER_CONFIGURATION_VALIDATED`, `PARTNER_CONFIGURATION_REJECTED`, `PARTNER_CAPABILITY_REGISTERED`) remain the baseline.
- The reference-only credential model is preserved. A6T03 does not introduce a resolved-secret model, a credential store, a key-management system, or a partner SDK; later work may introduce one only with a separate review and a separate ADR.
- The connection boundary remains disabled by default. A6T03 does not introduce a default-enabled configuration, a default production environment, or a default credential reference.
- The connection boundary remains provider-neutral. A6T03 does not introduce a partner-specific transport, a partner-specific signing implementation, or a partner-specific error mapping; later work may introduce one only with a separate review and a separate ADR.
- The connection boundary does not become a domain authority. A6T03 does not mutate Customer, CustomerWallet, funding instruments, beneficiaries, A3 bindings, A4 policy, Wallet, Ledger, A5, Operations, Outbox, or Reconciliation source records. A later task that needs to consume the connection boundary must do so through the NestJS module graph and must not import the connection boundary into a domain module.

## 21. Implementation evidence

- [`src/partner/partner-connection.service.ts`](../../src/partner/partner-connection.service.ts) — `PartnerConnectionService` (profile, status, ready-for-transport, signing preparation)
- [`src/partner/partner-connection.types.ts`](../../src/partner/partner-connection.types.ts) — connection, credential, status, audit, and signing types
- [`src/partner/partner-adapter.types.ts`](../../src/partner/partner-adapter.types.ts) — `NIBSS_NIP_PARTNER_KEY`, capability/operation constants, `PartnerCapabilityRegistration`
- [`src/partner/partner-capability.registry.ts`](../../src/partner/partner-capability.registry.ts) — `PartnerCapabilityRegistry` and frozen `NIBSS_NIP_WITHDRAWAL_SETTLEMENT_CAPABILITY`
- [`src/partner/partner-credentials.service.ts`](../../src/partner/partner-credentials.service.ts) — `EnvironmentPartnerCredentialLoader`, `PARTNER_CREDENTIAL_LOADER` symbol, `PartnerConfigurationException`
- [`src/partner/partner-request-signing.service.ts`](../../src/partner/partner-request-signing.service.ts) — `PartnerRequestSigningService`, `PARTNER_REQUEST_SIGNER` symbol
- [`src/partner/partner-connection-audit.service.ts`](../../src/partner/partner-connection-audit.service.ts) — `PartnerConnectionAuditService` (A6 partner connection audit boundary)
- [`src/partner/partner-circuit-breaker.service.ts`](../../src/partner/partner-circuit-breaker.service.ts) — `PartnerCircuitBreakerService` primitive (owned by A6T07; wired by A6T03)
- [`src/partner/partner.module.ts`](../../src/partner/partner.module.ts) — `PartnerModule` (provider/exporter registration)
- [`src/config/environment.ts`](../../src/config/environment.ts) — A6 partner configuration validation (A6_PARTNER_* keys, per-environment separation, production/NODE_ENV rule)
- [`test/partner-connection.service.spec.ts`](../../test/partner-connection.service.spec.ts) — partner-connection service tests (9 tests)
- [`docs/A6-EXTERNAL-PARTNER-BASELINE.md`](../A6-EXTERNAL-PARTNER-BASELINE.md) — A6T01 baseline and capability selection
- [`docs/A6-PARTNER-ADAPTER-CONTRACT.md`](../A6-PARTNER-ADAPTER-CONTRACT.md) — A6T02 adapter contract
- [`docs/A6-IMPLEMENTATION-PLAN.md`](../A6-IMPLEMENTATION-PLAN.md) — A6 plan; A6T03 task definition and ADR-0048 reservation
- [`docs/A6-ADR-REVIEW-STATUS.md`](../A6-ADR-REVIEW-STATUS.md) — A6T11 ADR review register (records ADR-0048 as the A6T03 follow-on ADR)

## 22. A6T03 verification record

- [x] One isolated partner connection service owns the connection profile, status, ready-for-transport, and signing preparation boundary.
- [x] One partner capability registry holds exactly one frozen registration for the A6T01-selected capability.
- [x] Per-environment base URL, credential reference, and signing key reference are resolved from distinct configuration keys.
- [x] Production partner environment requires `NODE_ENV=production`; the rule is enforced at the schema and again at the connection service.
- [x] Sandbox and production base URLs (when both are set) are required to be distinct; the rule is enforced at the schema.
- [x] Credential and signing references are opaque reference strings; no resolved secret is stored, transmitted, logged, audited, or tested.
- [x] A missing per-environment credential or signing reference raises a typed `PartnerConfigurationException` and fails closed.
- [x] The request signing service prepares a normalized signing input and a deterministic `signingInputHash`; it does not produce a signature and does not depend on a key-management library.
- [x] The connection audit service records only safe configuration metadata (partner, capability, operation, environment, status, adapter version, API version, optional failure code).
- [x] The connection service is read-only with respect to Customer, CustomerWallet, funding instruments, beneficiaries, A3 bindings, A4 policy, Wallet, Ledger, A5, Operations, Outbox, and Reconciliation.
- [x] The partner connection boundary is disabled by default; an enabled profile requires a non-empty per-environment base URL, credential reference, signing key reference, and callback secret.
- [x] The connection boundary is provider-neutral: it does not import a partner SDK, an HTTP client, a socket, a transport adapter, a credential store, or a key-management library.
- [x] `PartnerConnectionService` is exported by `PartnerModule` and is the only A6T03 surface exposed to later A6 tasks.
- [ ] Live partner certification, live credential, live signing, live transport, live callback, live settlement, and production activation remain intentionally out of scope and are claimed by no artifact in this ADR.
