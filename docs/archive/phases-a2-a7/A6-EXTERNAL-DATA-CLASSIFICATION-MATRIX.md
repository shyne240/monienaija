# A6T10 — External Data Classification Matrix

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T10 — External-Rail Data Minimization, Consent, and Disclosure Controls
- **Status:** Implemented
- **Contract:** `ExternalDataMinimizationContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Application, database, API, callback, partner, settlement, reconciliation, and financial-runtime changes in this task:** Field-level data classification, consent validation, retention classification, legal hold support, secret classification, and disclosure projections; no source mutation, no provider communication, no settlement, no reconciliation mutations

## 1. Handling levels

MonieNaija engineering handling levels (per `ADR-0024`):

| Level             | Meaning                                                                                              | Minimum controls                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PUBLIC`          | Approved content with no customer, credential, transaction, or security detail                       | Publication approval and content review                                                                  |
| `INTERNAL`        | Non-public technical, operational, or aggregate information with low standalone sensitivity          | Staff/service access, no public API exposure by default                                                  |
| `CONFIDENTIAL`    | Information that enables operational inference or linkability when combined                          | Least privilege, approved logging, minimized event payloads, no public sharing                           |
| `RESTRICTED`      | Direct or indirect customer, identity, beneficiary, funding, financial, or security information      | Explicit purpose/role, encryption, masked views, controlled exports, access audit                        |
| `HIGHLY_RESTRICTED` | Credentials, identity evidence, callback secrets, signing keys, raw risk notes                       | Dedicated owner, strongest access controls, no plaintext or external disclosure by default, hold support |

## 2. Audience matrix

| Audience         | Maximum level |
| ---------------- | -------------- |
| `SUPPORT`        | `CONFIDENTIAL`  |
| `OPERATIONS`     | `CONFIDENTIAL`  |
| `RECONCILIATION` | `CONFIDENTIAL`  |
| `FINANCE`        | `RESTRICTED`    |
| `COMPLIANCE`     | `RESTRICTED`    |
| `LEGAL`          | `RESTRICTED`    |
| `SECURITY`       | `HIGHLY_RESTRICTED` |
| `A6_TEN_INTERNAL` | `CONFIDENTIAL`  |

## 3. Selected-capability field-level matrix

### 3.1 External operation identity (A6T05)

| Field                                            | Source domain | Level               | Audiences                        | Notes                                                              |
| ------------------------------------------------ | ------------- | ------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `externalOperationId`                             | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Durable identity, not linkable to Customer without internal join.   |
| `externalOperationReference`                      | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Deterministic support reference, no customer linkage.               |
| `operationVersion`                                 | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Identity version marker.                                            |
| `partnerKey`                                      | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Selected partner identifier (e.g., `NIBSS_NIP`).                    |
| `capabilityKey`                                   | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Selected capability identifier.                                    |
| `operationType`                                   | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Selected operation type.                                            |
| `resourceType`/`resourceId`                       | A6T05         | `CONFIDENTIAL`      | All except `PUBLIC`              | Internal resource pointer.                                         |
| `internalCommandId`                               | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Internal command identity.                                          |
| `customerId`                                      | Customer      | `RESTRICTED`        | All except `PUBLIC`              | Canonical internal customer identity.                              |
| `walletAccountId`                                 | Wallet        | `RESTRICTED`        | All except `PUBLIC`              | Internal financial-wallet facade.                                  |
| `ledgerAccountId`                                 | Ledger        | `RESTRICTED`        | All except `PUBLIC`              | Internal financial account.                                        |
| `targetMappingReference`                          | A6T04         | `INTERNAL`          | All except `PUBLIC`              | Deterministic mapping hash; not a customer identity.                |
| `amountMinor`                                     | A5/A6         | `CONFIDENTIAL`      | All except `PUBLIC`              | Settlement amount; not a secret.                                   |
| `currency`                                        | A5/A6         | `INTERNAL`          | All except `PUBLIC`              | Settlement currency.                                                |
| `accountingUnit`                                  | A5/A6         | `INTERNAL`          | All except `PUBLIC`              | Settlement accounting unit.                                        |
| `internalIdempotencyScope`/`internalIdempotencyKey` | Operations    | `CONFIDENTIAL`      | All except `PUBLIC`              | Internal duplicate collision identity.                             |
| `providerIdempotencyScope`/`providerIdempotencyKey` | A6T05/Partner | `CONFIDENTIAL`      | All except `PUBLIC`              | Partner duplicate collision identity.                             |
| `requestHash`                                     | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Deterministic request hash, not a credential.                      |
| `requestId`/`correlationId`/`traceId`/`causationId` | Operations    | `INTERNAL`          | All except `PUBLIC`              | Correlation chain.                                                |
| `lifecycleState`                                  | A6T07         | `INTERNAL`          | All except `PUBLIC`              | Lifecycle state, not linkable to Customer.                          |
| `attemptCount`/`maxAttempts`                       | A6T07         | `INTERNAL`          | All except `PUBLIC`              | Bounded retry markers.                                            |
| `providerStatus`                                  | A6T07         | `CONFIDENTIAL`      | All except `PUBLIC`              | Partner-supplied status; not a credential.                         |
| `failureCode`/`failureMessage`                    | A6T07         | `CONFIDENTIAL`      | All except `PUBLIC`              | Failure context, no raw secrets.                                   |
| `recoveryReference`                               | A6T07         | `INTERNAL`          | All except `PUBLIC`              | Deterministic recovery reference.                                 |

### 3.2 External operation reference (A6T05)

| Field                                            | Source domain | Level               | Audiences                        | Notes                                                              |
| ------------------------------------------------ | ------------- | ------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `id`                                              | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Reference row id.                                                  |
| `externalOperationId`                             | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Parent operation id.                                              |
| `referenceType`                                   | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Reference type enum.                                              |
| `referenceValue`                                  | Partner       | `CONFIDENTIAL`      | All except `PUBLIC`              | Partner opaque reference.                                         |
| `referenceValueHash`                              | A6T05         | `INTERNAL`          | All except `PUBLIC`              | One-way hash of `referenceValue`.                                  |
| `namespace`                                       | Partner       | `INTERNAL`          | All except `PUBLIC`              | Partner namespace.                                                |
| `source`                                          | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Reference source enum.                                            |
| `observedAt`                                      | A6T05         | `INTERNAL`          | All except `PUBLIC`              | Evidence timestamp.                                               |

### 3.3 External callback receipt (A6T06)

| Field                                            | Source domain | Level                | Audiences                        | Notes                                                              |
| ------------------------------------------------ | ------------- | -------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `id`                                              | A6T06         | `INTERNAL`           | All except `PUBLIC`              | Receipt id.                                                       |
| `externalOperationId`                             | A6T06         | `INTERNAL`           | All except `PUBLIC`              | Linked operation id.                                             |
| `callbackEventId`                                 | Partner       | `CONFIDENTIAL`       | All except `PUBLIC`              | Partner opaque event id.                                         |
| `payloadHash`                                     | A6T06         | `INTERNAL`           | All except `PUBLIC`              | One-way hash of authenticated payload.                            |
| `signatureHash`                                   | A6T06         | `INTERNAL`           | All except `PUBLIC`              | One-way hash of HMAC/signature; never raw signature.               |
| `providerReferenceType`/`providerReferenceValueHash` | A6T06    | `INTERNAL`           | All except `PUBLIC`              | Reference type and one-way value hash.                            |
| `providerStatus`                                  | A6T06         | `CONFIDENTIAL`       | All except `PUBLIC`              | Provider-supplied status.                                        |
| `providerOccurredAt`/`receivedAt`                 | A6T06         | `INTERNAL`           | All except `PUBLIC`              | Timestamps.                                                       |
| `status`/`rejectionCode`                          | A6T06         | `INTERNAL`           | All except `PUBLIC`              | Authenticity outcome.                                            |
| `correlationId`                                  | A6T06         | `INTERNAL`           | All except `PUBLIC`              | Correlation id.                                                  |

The A6T10 contract further asserts that **no callback secret**, **raw signature**, **raw payload**, **provider authorization header**, **customer PIN/OTP**, or **device fingerprint** is stored in `external_callback_receipts`. These are `HIGHLY_RESTRICTED` and are referenced only through opaque credential references.

### 3.4 External settlement (A6T08)

| Field                                            | Source domain | Level               | Audiences                        | Notes                                                              |
| ------------------------------------------------ | ------------- | ------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `id`                                              | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Settlement row id.                                                |
| `externalOperationId`                             | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Parent operation id.                                              |
| `externalOperationReference`                      | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Deterministic support reference.                                  |
| `partnerKey`/`capabilityKey`/`operationType`      | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Selected partner/capability.                                      |
| `customerId`/`walletAccountId`                    | A6T08         | `RESTRICTED`        | All except `PUBLIC`              | Internal identity chain.                                          |
| `customerLedgerAccountId`                        | A6T08         | `RESTRICTED`        | All except `PUBLIC`              | Internal financial account.                                       |
| `settlementAssetLedgerAccountId`                 | A6T08         | `RESTRICTED`        | All except `PUBLIC`              | Settlement asset account.                                        |
| `decision`                                        | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Settlement decision.                                             |
| `status`                                          | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Settlement status.                                               |
| `amountMinor`                                     | A6T08         | `CONFIDENTIAL`      | All except `PUBLIC`              | Settlement amount.                                               |
| `currency`/`accountingUnit`                      | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Settlement currency/unit.                                        |
| `lifecycleState`                                  | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Settlement lifecycle state.                                      |
| `journalId`                                       | A6T08         | `RESTRICTED`        | All except `PUBLIC`              | Posted internal financial journal.                                |
| `reversalJournalId`                               | A6T08         | `RESTRICTED`        | All except `PUBLIC`              | Compensating journal.                                            |
| `evidenceType`/`evidenceValueHash`/`evidenceHash` | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Evidence metadata; never raw provider payloads.                    |
| `evidenceValue`                                   | A6T08         | `CONFIDENTIAL`      | All except `PUBLIC`              | Provider opaque reference.                                       |
| `evidenceNamespace`/`evidenceSource`              | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Evidence namespace and source.                                    |
| `idempotencyScope`/`idempotencyKey`               | A6T08         | `CONFIDENTIAL`      | All except `PUBLIC`              | Settlement duplicate collision identity.                          |
| `requestHash`                                     | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Deterministic request hash.                                      |
| `correlationId`/`requestId`                      | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Correlation chain.                                              |
| `ownerPrincipal`                                  | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Owner principal.                                                 |
| `postedAt`/`reversalPostedAt`                     | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Posting timestamps.                                              |

### 3.5 External suspense entry (A6T08)

| Field                                            | Source domain | Level               | Audiences                        | Notes                                                              |
| ------------------------------------------------ | ------------- | ------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `id`                                              | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Suspense row id.                                                  |
| `externalOperationId`                             | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Parent operation id.                                              |
| `customerId`                                      | A6T08         | `RESTRICTED`        | All except `PUBLIC`              | Customer identity chain.                                          |
| `amountMinor`                                     | A6T08         | `CONFIDENTIAL`      | All except `PUBLIC`              | Suspense amount.                                                  |
| `currency`/`accountingUnit`                      | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Currency/unit.                                                   |
| `reason`                                          | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Typed suspense reason.                                            |
| `status`                                          | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Suspense status.                                                  |
| `owner`                                           | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Suspense owner (e.g., `finance-ledger-suspense`).                  |
| `ownerPrincipal`                                  | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Owner principal.                                                  |
| `evidenceHash`                                    | A6T08         | `INTERNAL`          | All except `PUBLIC`              | One-way evidence hash.                                            |
| `lifecycleState`                                  | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Operation lifecycle at suspension.                                |
| `rejectionCode`                                   | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Typed rejection code.                                            |
| `correlationId`/`requestId`                      | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Correlation chain.                                              |
| `reversalJournalId`                               | A6T08         | `RESTRICTED`        | All except `PUBLIC`              | Compensating journal id (nullable).                               |
| `settlementId`                                    | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Linked settlement id (nullable).                                   |
| `clearedAt`                                       | A6T08         | `INTERNAL`          | All except `PUBLIC`              | Suspense clearing timestamp.                                     |

### 3.6 Audit, outbox, idempotency

| Field                                            | Source domain | Level               | Audiences                        | Notes                                                              |
| ------------------------------------------------ | ------------- | ------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `auditEvents[].previousValues`/`newValues`       | Operations    | `CONFIDENTIAL`      | All except `PUBLIC`              | Minimized; redacted by `redactRecord`; no raw secrets.             |
| `outboxEvents[].payload`                          | Operations    | `CONFIDENTIAL`      | All except `PUBLIC`              | Settlement correlation only; redacted.                            |
| `idempotencyHints[].requestHash`                  | Operations    | `INTERNAL`          | All except `PUBLIC`              | Request hash, no customer identity.                                |
| `idempotencyHints[].match`                        | Operations    | `INTERNAL`          | All except `PUBLIC`              | MATCH/MISMATCH/IN_PROGRESS/EXPIRED/MISSING enum.                   |

### 3.7 A6T10 internal records

| Field                                            | Source domain | Level               | Audiences                        | Notes                                                              |
| ------------------------------------------------ | ------------- | ------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `dataClassificationEntries[].fieldName`            | A6T10         | `INTERNAL`          | All except `PUBLIC`              | Classification field name.                                        |
| `dataClassificationEntries[].level`               | A6T10         | `INTERNAL`          | All except `PUBLIC`              | Classification level.                                            |
| `dataClassificationEntries[].sourceDomain`         | A6T10         | `INTERNAL`          | All except `PUBLIC`              | Source domain of the classified field.                             |
| `dataClassificationEntries[].owner`                | A6T10         | `INTERNAL`          | All except `PUBLIC`              | Classification owner.                                             |
| `consentAssertions[*]`                            | A6T10         | `RESTRICTED`        | All except `PUBLIC`              | Consent evidence; revocation is recorded.                         |
| `retentionClassifications[*]`                      | A6T10         | `INTERNAL`          | All except `PUBLIC`              | Retention schedule metadata.                                      |
| `legalHoldRecords[*]`                             | A6T10         | `RESTRICTED`        | All except `PUBLIC`              | Hold scope, owner, authority, reason, timestamps.                 |
| `secretClassifications[*]`                        | A6T10         | `HIGHLY_RESTRICTED` | `SECURITY` only                 | Secret metadata only; never raw secrets.                          |
| `disclosureViews[*]`                              | A6T10         | ≤ audience maximum  | All audiences                    | Minimum-necessary projection per audience.                         |
| `supportTraces[*]`                                | A6T10         | ≤ audience maximum  | `SUPPORT`, `OPERATIONS`         | Read-only support trace.                                          |

## 4. Secret inventory (HIGHLY RESTRICTED, never stored)

The following secret categories are `HIGHLY_RESTRICTED` and are referenced only through opaque credential handles:

- `PARTNER_CLIENT_AUTHENTICATION`
- `PARTNER_REQUEST_SIGNING_KEY`
- `CALLBACK_SECRET`
- `CALLBACK_SIGNATURE`
- `PRIVATE_KEY`
- `CUSTOMER_PIN`
- `CUSTOMER_OTP`
- `DEVICE_FINGERPRINT_RAW`
- `RISK_NARRATIVE_RAW`
- `COMPLIANCE_CASE_RAW`

A6T10 asserts that:

- No secret category value is stored in any A6 table, audit event, outbox event, idempotency record, or support trace.
- Secrets are referenced through opaque credential references (`PARTNER_CREDENTIAL_LOADER`, `PARTNER_REQUEST_SIGNER`, `PARTNER_CALLBACK_SECRET_SOURCE`).
- Any disclosure projection that includes a secret category is rejected and recorded as `SECRET_DISCLOSED` audit fact with `severity: ERROR`.

## 5. Partner sharing matrix (selected capability)

| Field                            | Shared with partner by default? | Justification                                                                                                  |
| -------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `externalOperationReference`      | Yes (REQUEST)                    | Necessary for partner request/response correlation; not a customer identity.                                  |
| `targetMappingReference`          | Yes (mapped)                     | One-way mapping hash; not reversible by partner.                                                              |
| `amountMinor`                     | Yes                             | Necessary for partner settlement amount.                                                                       |
| `currency`                        | Yes                             | `NGN` only.                                                                                                    |
| `accountingUnit`                  | Yes                             | `CUSTOMER_FUNDS` only.                                                                                        |
| `requestId`/`correlationId`       | Yes                             | Necessary for partner/provider support correlation.                                                            |
| `providerIdempotencyKey`          | Yes (REQUEST)                    | Necessary for partner duplicate collision.                                                                     |
| `customerId`                      | No                              | Customer identity is internal; partner uses `targetMappingReference` or partner-side opaque identifiers.     |
| `walletAccountId`                | No                              | Internal financial wallet facade.                                                                              |
| `ledgerAccountId`                | No                              | Internal financial account.                                                                                    |
| `journalId`                       | No                              | Posted internal financial journal.                                                                             |
| `callbackSecret`/`callbackSignature` | No                          | Authentication material; never shared with provider request body.                                             |
| `secretClassifications[*]`        | No                              | Internal secret metadata only.                                                                                |

## 6. Disclosure restrictions

| Audience         | Max level | Masked fields                                                                |
| ---------------- | -------- | ---------------------------------------------------------------------------- |
| `SUPPORT`        | `CONFIDENTIAL`  | `RESTRICTED` masked to `customer:***`; `HIGHLY_RESTRICTED` masked.        |
| `OPERATIONS`     | `CONFIDENTIAL`  | `RESTRICTED` masked to `customer:***`; `HIGHLY_RESTRICTED` masked.        |
| `RECONCILIATION` | `CONFIDENTIAL`  | `RESTRICTED` masked to `customer:***`; `HIGHLY_RESTRICTED` masked.        |
| `FINANCE`        | `RESTRICTED`    | `HIGHLY_RESTRICTED` masked.                                                 |
| `COMPLIANCE`     | `RESTRICTED`    | `HIGHLY_RESTRICTED` masked.                                                 |
| `LEGAL`          | `RESTRICTED`    | `HIGHLY_RESTRICTED` masked.                                                 |
| `SECURITY`       | `HIGHLY_RESTRICTED` | No masking for security audience.                                     |

## 7. Out of scope

- Legal approval itself, customer portal/mobile disclosure screens, notification delivery, marketing consent, general data-platform redesign, and A7 preference/notification infrastructure.
- A6T11 release gate and A7 handoff.
- Real provider, real bank participant, real credential, real API key, or live data exchange.
