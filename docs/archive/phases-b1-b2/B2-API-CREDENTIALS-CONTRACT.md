# B2T08 — B2 API Consumer and Credentials Contract

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T08 — API Consumer Registry, API Credentials, API Keys, Quotas, and Rate Limiting (consumer & credentials)
- **Contract:** `B2ApiConsumerContractV1` (`B2-API-CONSUMER` v1) — consumer `B2ApiConsumerDecisionV1` / `B2ApiConsumerRequestV1` and credential `B2ApiCredentialDecisionV1` / `B2ApiCredentialRequestV1`
- **ADR:** ADR-0079 — B2 API Consumer Registry, Credentials, Quotas, and Rate Limiting
- **Status:** Accepted (B2T08 implementation)
- **Review snapshot:** `b2t08` (B2T08 implementation commit; B2T07 + B2T06 + B2T05 + B2T04 + B2T03 + B2T02 + B2T01 + B1 evidence committed)

This document defines the B2 API consumer registry and credential lifecycle contract.

## 1. Purpose and boundary

The B2 API consumer registry and credential lifecycle are the only B2-side consumer and credential authorities for the bounded first cohort `b2.activation.cohort.inbound-funding` v1. The consumer registry creates `b2-consumer-<uuid>` with `DRAFT -> ACTIVE -> SUSPENDED -> REVOKED` (`SUSPENDED -> ACTIVE` for reactivation); the credential lifecycle creates `b2-credential-<uuid>` with `ISSUED -> ROTATED -> REVOKED -> EXPIRED`. `clientId`/`keyId` is `mnj_live_` or `mnj_test_` + 24 alnum; the raw secret is returned once, hashed immediately to `argon2id$<salt>$sha256` `secretHash`, and never stored, logged, or replayed. Sandbox and production are separated by `keyId` prefix and `sandboxType`.

The authority is deterministic, replay-safe via `b2.api-consumer.idempotency.v1` (`86400s`), and exposes only read-only consumer ports to B2T10. It never duplicates the A2 authentication (`AuthenticationSession`/`PrivilegedActionApproval`) or authorization (`AuthorizationService`) vault, never posts a ledger entry, never performs a settlement, and never activates a merchant/agent.

## 2. Contract identity

- **Contract name:** `B2-API-CONSUMER`
- **Contract version:** `1`
- **Contract documents:** `docs/B2-API-CREDENTIALS-CONTRACT.md` and `docs/B2-QUOTA-RATE-LIMIT-CONTRACT.md`
- **Cohort key/version:** `b2.activation.cohort.inbound-funding` 1 (frozen; see `docs/B2-ACTIVATION-BASELINE.md` §4 and `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md` §4)
- **Idempotency scope:** `b2.api-consumer.idempotency.v1` with `86400s` retention (dedicated, replay window `86400s`, deterministic `requestHash`/`decisionHash`/`replayHash`)
- **Audit entity types:** `b2_api_consumer` and `b2_api_credential` with actor `b2-api-consumer`
- **Outbox event type:** `b2.api-consumer.decided.v1` (`INTERNAL`, `OPERATIONS_DEFAULT`)
- **Reference prefixes:** `b2-consumer-` and `b2-credential-`
- **Key prefixes:** `mnj_live_` and `mnj_test_` + 24 alnum

## 3. Consumer and credential vocabularies

- `consumerType`: `DEVELOPER` | `MERCHANT` | `AGENT` | `PARTNER` — the owner trace type. `DEVELOPER` owns via `ownerCustomerId`; `MERCHANT` via `ownerMerchantId`; `AGENT` via `ownerAgentId`.
- `consumerState`: `DRAFT` | `ACTIVE` | `SUSPENDED` | `REVOKED` — the durable consumer lifecycle. `DRAFT` is the initial state at creation; `ACTIVE` is the only state that permits credential issuance; `SUSPENDED` is reachable via `ACTIVE -> SUSPENDED`; `REVOKED` is terminal via `SUSPENDED -> REVOKED` or `ACTIVE -> REVOKED`. `SUSPENDED -> ACTIVE` is the only reactivation edge.
- `credentialKind`: `API_KEY` | `CLIENT_CREDENTIALS` — the credential kind. `API_KEY` yields `keyId` `mnj_live_`/`mnj_test_` and no `clientId`; `CLIENT_CREDENTIALS` yields `clientId` equal to `keyId` and a `secretHash`.
- `credentialState`: `ISSUED` | `ROTATED` | `REVOKED` | `EXPIRED` — the credential lifecycle. `ISSUED` is the initial state; `ROTATED` is `ISSUED`/`ROTATED -> ROTATED` with a new `keyId`/`secretHash`/`rawSecret` once and `rotationNextKeyId` pointing to the new `keyId` with the old `secretHash` valid for `300s` grace; `REVOKED` is immediate; `EXPIRED` is time-based beyond `expiryAt`.
- `sandboxType`: `SANDBOX` | `PRODUCTION` — the credential partition. `SANDBOX` yields `mnj_test_` `keyId`; `PRODUCTION` yields `mnj_live_` `keyId`; a `SANDBOX` credential never grants `PRODUCTION` quota/rate-limit.

## 4. Request, decision, and persistence

### 4.1 Consumer request

`B2ApiConsumerRequestV1` carries `displayName`, `consumerType`, `ownerCustomerId`/`ownerMerchantId`/`ownerAgentId` trace (one non-null according to `consumerType`), `audience`/`scopes` (lexically sorted, subset of the cohort's `b2:activation:read|write` `b2:webhooks:manage` `b2:consents:manage` `b2:support:read`), `cohortKey` `b2.activation.cohort.inbound-funding` 1, `idempotencyKey` uuid, and `requestContext`/`causationId`.

### 4.2 Consumer decision

`B2ApiConsumerDecisionV1` carries the derived `consumerReference` (`b2-consumer-<uuid>`), `consumerVersion` 1, `consumerId` uuid, `displayName`/`consumerType`/owner traces, `audience`/`scopes`, `state`/`outcome` (`DRAFT`/`ACTIVE`/`SUSPENDED`/`REVOKED`), `requestHash` (`sha256(stableJson(displayName, consumerType, ownerIds, audience, scopes, cohortKey, cohortVersion, idempotencyKey))` excluding `consumerReference`/`createdAt`), `decisionHash`, `decisionReplayHash`, `idempotencyScope`/`idempotencyKey`, `correlationId`/`causationId`, `createdAt`/`updatedAt`, and `contractName`/`contractVersion`.

### 4.3 Credential request

`B2ApiCredentialRequestV1` carries `consumerId` uuid, `kind` `API_KEY`/`CLIENT_CREDENTIALS`, `scopes` (subset of the consumer's `scopes`), `sandboxType`, `expirySeconds`, `cohortKey` `b2.activation.cohort.inbound-funding` 1, `idempotencyKey` uuid, and `requestContext`/`causationId`.

### 4.4 Credential decision

`B2ApiCredentialDecisionV1` carries the derived `credentialReference` (`b2-credential-<uuid>`), `credentialId` uuid, `consumerId`, `kind`, `keyId` (`mnj_live_`/`mnj_test_` + 24 alnum), `clientId` (equal to `keyId` for `CLIENT_CREDENTIALS`, otherwise null), `secretHash` (`argon2id$<salt>$sha256`), `rawSecret` transient once on `ISSUED`/`ROTATED` (never in the persisted `record` JSONB after hash), `scopes`, `sandboxType`, `state`/`outcome`, `expiryAt` (`now + expirySeconds`), `rotationNextKeyId` (new `keyId` on `ROTATED`), `requestHash`/`decisionHash`/`decisionReplayHash`, `idempotencyScope`/`idempotencyKey`, `correlationId`/`causationId`, `createdAt`/`updatedAt`.

### 4.5 Persistence

The consumer is persisted in `b2_api_consumer` and the credential in `b2_api_credential` (migration `1785753600043`) each with unique `consumerReference,consumerVersion` / `credentialReference,credentialVersion` and indexes on `consumerId`, `keyId`, `state`, `idempotencyScope+key`, `correlationId`. No table contains a `secret` column — only `secret_hash` (length 200, `argon2id$` format). The `record` JSONB stores the decision without the raw `rawSecret` beyond the transient generation return.

## 5. Consumer and credential rules

1. `displayName` non-empty and `consumerType` must be `DEVELOPER`/`MERCHANT`/`AGENT`/`PARTNER`; otherwise `B2_API_CONSUMER_INVALID_COMMAND`.
2. `cohortKey` must be `b2.activation.cohort.inbound-funding` and `cohortVersion` 1; otherwise `B2_API_CONSUMER_INCOMPATIBLE`.
3. `consumerId`/`idempotencyKey` must be uuid; otherwise the same failure.
4. Owner trace must match `consumerType` (`DEVELOPER` requires `ownerCustomerId`, `MERCHANT` requires `ownerMerchantId`, etc.); otherwise `B2_API_CONSUMER_INVALID_COMMAND`.
5. `kind` must be `API_KEY` or `CLIENT_CREDENTIALS`; `sandboxType` must be `SANDBOX` or `PRODUCTION`; otherwise the same failure.
6. `scopes` must be a non-empty subset of the consumer's `scopes` for credential issuance; otherwise `B2_API_CONSUMER_INCOMPATIBLE`.
7. `expirySeconds` must be positive and `expiryAt` is `now + expirySeconds`; a credential beyond `expiryAt` is `EXPIRED` without a second write.

A failing write-check is `REJECTED` with the write-check code and never creates a `DRAFT`/`ISSUED` row.

## 6. Idempotency, replay, state machine, rotation, revocation

### 6.1 Idempotency

The consumer/credential authority uses the dedicated `b2.api-consumer.idempotency.v1` scope via the shared `IdempotencyService` (only idempotency authority) with `86400s` retention. It never logs `rawSecret`.

### 6.2 Replay safety

`replaySafeGenerateConsumerDecision`/`replaySafeGenerateCredentialDecision` are replay-safe per scope: same `idempotencyKey`+same `requestHash` replays the original `consumerReference`/`credentialReference` with `replayed:true` and includes `rawSecret` only on the original generation response (replayed credential decision never re-exposes `rawSecret` beyond the first generation's transient return; the stored `record` contains `secretHash` only). Same key+different hash is `409` `B2_API_CONSUMER_REPLAY_CONFLICT` with `conflict:true`. The replay payload excludes `consumerReference`/`credentialReference`/`createdAt`.

### 6.3 Consumer state machine

`transitionConsumerState(current, ACTIVE|SUSPENDED|REVOKED)` allows only `DRAFT -> ACTIVE`, `ACTIVE -> SUSPENDED`, `SUSPENDED -> REVOKED` or `ACTIVE -> REVOKED`, and `SUSPENDED -> ACTIVE` for reactivation. Any other edge throws `B2_API_CONSUMER_INVALID_STATE_TRANSITION`. `REVOKED` is terminal and never grants quota or rate-limit.

### 6.4 Credential rotation and revocation

`rotateCredentialDecision` (`ISSUED`/`ROTATED -> ROTATED`) generates a new `keyId` (`mnj_live_`/`mnj_test_` + 24 alnum) and new `rawSecret` once with `secretHash` `argon2id$` and `rotationNextKeyId` pointing to the new `keyId`; the old `secretHash` remains valid for `300s` grace. `revokeCredentialDecision` (`ISSUED`/`ROTATED -> REVOKED`) sets `REVOKED` immediately and strips `rawSecret`. Rotation and revocation are audit-recorded via `AuditService` and replay-safe via `IdempotencyService`.

### 6.5 Read-only consumer ports

The contract exposes `B2ApiConsumerConsumerPortsV1` (`contractName` `B2-API-CONSUMER`, `idempotencyScope` `b2.api-consumer.idempotency.v1`, `cohortKey` `b2.activation.cohort.inbound-funding` 1) and `generateConsumerDecision`, `generateCredentialDecision`, `rotateCredentialDecision`, `revokeCredentialDecision`, `transitionConsumerState` read-only to B2T10. The ports reuse `Customer.id`/`Merchant.id`/`Agent.id` owner traces without creating a second Customer authority and without mutating `CustomerPreference`, `A1` identity, or `A2` authorization.

## 7. Verification

- [x] The contract is frozen as `B2-API-CONSUMER` v1 with explicit `B2ApiConsumerRequestV1`/`DecisionV1`, `B2ApiCredentialRequestV1`/`DecisionV1` (with `rawSecret` transient once, `secretHash` persisted), `B2ApiConsumerState` `DRAFT`/`ACTIVE`/`SUSPENDED`/`REVOKED` and `B2ApiCredentialState` `ISSUED`/`ROTATED`/`REVOKED`/`EXPIRED`.
- [x] Consumer `b2-consumer-<uuid>` and credential `b2-credential-<uuid>` with `mnj_live_`/`mnj_test_` + 24 alnum `keyId`/`clientId`, `secretHash` `argon2id$` never raw, sandbox/production separation via `keyId` prefix and `sandboxType`, and rotation grace `300s` via `rotationNextKeyId`.
- [x] The authority is replay-safe per dedicated `b2.api-consumer.idempotency.v1` `86400s` (`decisionReplayHash` excludes `consumerReference`/`createdAt`, same-key/same-hash replays, same-key/different-hash `409` `B2_API_CONSUMER_REPLAY_CONFLICT`).
- [x] The consumer state machine `DRAFT -> ACTIVE -> SUSPENDED -> REVOKED` (`SUSPENDED -> ACTIVE` reactivation) and credential `ISSUED -> ROTATED -> REVOKED -> EXPIRED` are the only B2 consumer/credential lifecycles; no second consumer/credential vault.
- [x] The persistence `b2_api_consumer`/`b2_api_credential` with unique references, indexes on `consumerId`/`keyId`/`state`/`idempotencyScope+key` and no `secret` column (only `secret_hash`) are the only persistence surfaces.
- [x] No ADR beyond ADR-0079 is authored by this contract.

### Evidence limitations

- B2T08 does not implement a `JWT` (B2T10), a webhook delivery (B2T09), a quota/rate-limit enforcement middleware (this is the quota/rate-limit policy store; the token-bucket check is `B2-QUOTA-RATE-LIMIT-CONTRACT.md`), or a financial effect.
- B2T08 does not call a live KYC/settlement/bank API.
