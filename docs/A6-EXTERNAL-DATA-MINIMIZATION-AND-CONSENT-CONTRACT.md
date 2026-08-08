# A6T10 — External Data Minimization, Consent, and Disclosure Contract

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T10 — External-Rail Data Minimization, Consent, and Disclosure Controls
- **Status:** Implemented
- **Contract:** `ExternalDataMinimizationContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Application, database, API, callback, partner, settlement, reconciliation, and financial-runtime changes in this task:** Field-level data classification, consent validation, retention classification, legal hold, secret handling, disclosure projections, support-trace minimization, and read-only contract evidence; no source mutation, no provider communication, no settlement, no reconciliation mutations

## 1. Purpose

This contract defines the external-rail data minimization, consent, retention, legal hold, secret handling, and disclosure boundary for A6. It does not introduce authentication, authorization, provider, callback, settlement, reconciliation, or notification behavior. It is a classification and disclosure contract that supports all prior A6 contracts without changing their financial, lifecycle, or provider authority.

## 2. Contract boundary

```text
ExternalDataMinimizationService
  classifyField(field, level, sourceDomain, owner)
  classifyFields(entries)
  recordClassification(entries, auditContext)
  validateConsent(consent)
  recordConsent(consent, auditContext)
  revokeConsent(consent, auditContext)
  classifyRetention(dataset, level, owner, retentionDays, holdSupport)
  recordRetention(entries, auditContext)
  imposeLegalHold(hold, auditContext)
  releaseLegalHold(holdId, releasedBy, auditContext)
  classifySecret(secret)
  recordSecret(entries, auditContext)
  classifyDisclosure(field, level, audience)
  projectDisclosure(view, audience, auditContext)
  buildSupportTrace(externalOperationId, audience, auditContext)
  validatePartnerPayload(partnerKey, capabilityKey, payload, auditContext)
```

The service is the only authority for A6 data classification, consent validation, retention classification, legal hold, secret classification, and disclosure projection. It never mutates any A6 source record (external operation, reference, callback, settlement, suspense, audit, outbox, idempotency).

## 3. Inputs

```text
ExternalDataClassificationEntryV1 {
  fieldName: bounded string
  level: ExternalDataHandlingLevel
  sourceDomain: bounded string
  owner: bounded string
}

ExternalConsentAssertionV1 {
  customerId: UUID
  source: ExternalConsentSource
  targetId: UUID
  targetVersion: positive integer
  purpose: "OUTBOUND_BANK_SETTLEMENT"
  jurisdiction: ISO-3166 alpha-2
  mandateReference: opaque bounded string
  mandateVersion: positive integer
  grantedAt: RFC3339 UTC
  expiresAt: RFC3339 UTC
  grantedBy: opaque bounded string
  revocable: boolean
  revokedAt: RFC3339 UTC | null
}

ExternalRetentionEntryV1 {
  dataset: bounded string
  level: ExternalDataHandlingLevel
  owner: bounded string
  retentionDays: positive integer
  holdSupport: boolean
}

ExternalLegalHoldRecordV1 {
  scope: ExternalLegalHoldScope
  referenceId: UUID
  owner: bounded string
  authority: ExternalLegalHoldAuthority
  reason: bounded string
  imposedAt: RFC3339 UTC
  imposedBy: bounded string
  releasedAt: RFC3339 UTC | null
  releasedBy: bounded string | null
  notes: bounded string | null
}

ExternalSecretClassificationV1 {
  category: ExternalSecretCategory
  owner: bounded string
  reference: bounded string
  notes: bounded string | null
}

ExternalDisclosureViewV1 {
  externalOperationId: UUID
  audience: ExternalDisclosureAudience
  fields: { fieldName: value }
  generatedAt: RFC3339 UTC
}

ExternalSupportTraceV1 {
  externalOperationId: UUID
  audience: ExternalDisclosureAudience
  trace: { canonical IDs, no secrets, no raw payloads }
  generatedAt: RFC3339 UTC
}

ExternalPartnerPayloadV1 {
  partnerKey: "NIBSS_NIP"
  capabilityKey: "external.wallet.withdrawal.settlement"
  payload: { fieldName: value }
}
```

## 4. Outputs

```text
ExternalDataClassificationView   { fieldName, level, sourceDomain, owner, classificationId, recordedAt }
ExternalConsentView             { consentId, customerId, source, targetId, targetVersion, purpose, jurisdiction, status, expiresAt, revokedAt }
ExternalRetentionView            { dataset, level, owner, retentionDays, holdSupport, retentionId, recordedAt }
ExternalLegalHoldView            { holdId, scope, referenceId, owner, authority, reason, status, imposedAt, releasedAt }
ExternalSecretClassificationView { classificationId, category, owner, reference, recordedAt }
ExternalDisclosureProjectionView  { viewId, externalOperationId, audience, fields, generatedAt, maskedFields }
ExternalSupportTraceView          { traceId, externalOperationId, audience, trace, generatedAt, maskedFields }
ExternalPartnerPayloadValidation { valid, rejectedFields, missingFields, recommendedFields }
```

## 5. Discrepancy vocabulary

A6T10 introduces the following typed codes (returned by `ExternalDataMinimizationException`):

| Code                                       | Severity | Owner          | Description                                                                 |
| ------------------------------------------ | -------- | -------------- | --------------------------------------------------------------------------- |
| `CLASSIFICATION_NOT_REGISTERED`            | ERROR    | A6_TEN_INTERNAL | Field is not present in the classification matrix.                          |
| `CLASSIFICATION_LEVEL_INVALID`             | ERROR    | A6_TEN_INTERNAL | Classification level is not one of the approved levels.                     |
| `CONSENT_EXPIRED`                          | ERROR    | COMPLIANCE      | Consent `grantedAt <= now < expiresAt` check failed.                          |
| `CONSENT_REVOKED`                          | ERROR    | COMPLIANCE      | Consent `revokedAt IS NOT NULL`.                                              |
| `CONSENT_PURPOSE_MISMATCH`                  | ERROR    | A6_TEN_INTERNAL | Consent purpose does not match the A6T01-selected purpose.                  |
| `CONSENT_JURISDICTION_MISMATCH`            | ERROR    | COMPLIANCE      | Consent jurisdiction is not in the approved partner set.                     |
| `CONSENT_TARGET_STALE`                     | ERROR    | COMPLIANCE      | Consent `targetVersion` is not current.                                      |
| `CONSENT_GRANTOR_MISSING`                  | ERROR    | A6_TEN_INTERNAL | Consent `grantedBy` is empty.                                                |
| `RETENTION_HOLD_ACTIVE`                    | ERROR    | LEGAL           | Ordinary cleanup cannot delete held evidence.                               |
| `RETENTION_BELOW_FLOOR`                    | ERROR    | COMPLIANCE      | Retention days are below the approved floor.                                |
| `RETENTION_MISSING`                        | ERROR    | COMPLIANCE      | Dataset retention classification is missing.                                |
| `HOLD_ALREADY_RELEASED`                    | ERROR    | LEGAL           | Hold cannot be released twice.                                              |
| `HOLD_NOT_FOUND`                            | ERROR    | LEGAL           | Hold id is unknown.                                                          |
| `HOLD_AUTHORITY_MISSING`                    | ERROR    | LEGAL           | Hold authority is empty.                                                    |
| `HOLD_RELEASED_BY_MISSING`                  | ERROR    | LEGAL           | Released by is empty.                                                       |
| `SECRET_LEVEL_INVALID`                      | ERROR    | SECURITY        | Secret level is not `HIGHLY_RESTRICTED`.                                     |
| `SECRET_IN_RAW_PAYLOAD`                     | ERROR    | SECURITY        | A `HIGHLY_RESTRICTED` secret appears in a partner payload.                  |
| `SECRET_IN_SUPPORT_TRACE`                   | ERROR    | SECURITY        | A `HIGHLY_RESTRICTED` secret appears in a support trace projection.          |
| `DISCLOSURE_AUDIENCE_TOO_LOW`               | ERROR    | COMPLIANCE      | Audience level is below field level.                                        |
| `DISCLOSURE_FIELD_NOT_REGISTERED`           | ERROR    | A6_TEN_INTERNAL | Field is not in the classification matrix.                                   |
| `DISCLOSURE_REJECTED_HIGHLY_RESTRICTED`     | ERROR    | SECURITY        | Disclosure of `HIGHLY_RESTRICTED` field to non-SECURITY audience rejected.   |
| `DISCLOSURE_BEYOND_LEGAL_HOLD`              | ERROR    | LEGAL           | Disclosure of held evidence to a non-owner audience is rejected.            |
| `PARTNER_PAYLOAD_REJECTED`                  | ERROR    | A6_TEN_INTERNAL | Partner payload contains a field that is not in the partner sharing matrix. |
| `PARTNER_PAYLOAD_MISSING_FIELD`             | WARNING  | A6_TEN_INTERNAL | Partner payload is missing a field that is required by the partner.        |
| `CONSENT_REQUIRED`                          | WARNING  | COMPLIANCE      | Consent evidence is required for this partner sharing.                      |
| `DATA_CONTROL_AUDIT_FAILED`                 | ERROR    | OPERATIONS      | Audit recording failed; the boundary is closed.                             |

## 6. Authoritative ownership

| Concept                                          | Owner                                                       |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Data classification matrix                        | A6T10 (`ExternalDataClassificationRegistry`)               |
| Consent validation                                | A6T10 (`ExternalConsentValidator`)                         |
| Retention classification                          | A6T10 (`ExternalRetentionClassifier`)                      |
| Legal hold support                                | A6T10 (`ExternalLegalHoldRegistry`)                         |
| Secret handling                                   | A6T10 (`ExternalSecretClassifier`)                          |
| Disclosure projections                            | A6T10 (`ExternalDisclosureProjector`)                       |
| Audit, idempotency, outbox                        | Operations                                                  |
| Provider credentials, signing, callback secrets   | A6T03                                                       |
| Reconciliation evidence                            | A6T09                                                       |
| Settlement authority                              | A6T08                                                       |
| External lifecycle                                | A6T07                                                       |
| External operation identity                       | A6T05                                                       |

## 7. Read-only and replay safety

The data minimization boundary is read-only with respect to all A6 source records. It writes only to:

- `external_data_classification` (its own A6T10 registry)
- `external_consent_assertions`
- `external_legal_hold_records`
- `external_disclosure_views`
- `external_secret_classifications`
- `external_retention_classifications`
- `external_support_traces`
- `audit_events` (via the shared `AuditService`)

It does not write to `external_operations`, `external_operation_references`, `external_callback_receipts`, `external_settlements`, `external_suspense_entries`, `outbox_events`, or `idempotency_records`.

The service is replay-safe: identical inputs produce identical classification, consent, retention, hold, and disclosure outcomes (timestamps and request IDs aside).

## 8. Failure and disclosure rules

- A failed classification fails the data boundary closed; the field is treated as `HIGHLY_RESTRICTED` for disclosure.
- A failed consent validation fails closed; the partner sharing and disclosure are rejected.
- A failed retention classification fails closed; the default retention is `365` days and `holdSupport` is `true`.
- A legal hold prevents ordinary cleanup; the boundary records `HOLD_IMPOSED` and `HOLD_RELEASED` audit facts.
- A secret classification requires the level to be `HIGHLY_RESTRICTED`; otherwise the classification is rejected.
- A disclosure of a `HIGHLY_RESTRICTED` field to a non-`SECURITY` audience is rejected and recorded as `DISCLOSURE_REJECTED_HIGHLY_RESTRICTED`.
- A disclosure of held evidence to a non-owner audience is rejected and recorded as `DISCLOSURE_BEYOND_LEGAL_HOLD`.

## 9. Integration with Operations audit

Every data-control action records an `audit_event` row through the shared `AuditService` with:

```text
entityType: A6_EXTERNAL_DATA_CONTROL
entityId: classificationId | consentId | holdId | viewId | traceId | dataset
action: CLASSIFICATION_RECORDED | CONSENT_RECORDED | CONSENT_REVOKED |
       RETENTION_RECORDED | HOLD_IMPOSED | HOLD_RELEASED |
       SECRET_CLASSIFICATION_RECORDED | DISCLOSED | DISCLOSURE_REJECTED |
       SUPPORT_TRACE_BUILT | PARTNER_PAYLOAD_REJECTED
actor: a6-external-data-minimization
correlationId: optional caller-provided correlation id
requestId: optional caller-provided request id
newValues: { canonical IDs, level, scope, audience, secret=false, rawPayloads=false }
```

Audit `newValues` and `previousValues` are passed through the shared `redactRecord` to ensure no raw secrets, raw callback signatures, raw device fingerprints, raw risk narratives, or raw compliance case content are recorded.

## 10. Out of scope

- Legal approval itself, customer portal/mobile disclosure screens, notification delivery, marketing consent, general data-platform redesign, and A7 preference/notification infrastructure.
- A6T11 release gate and A7 handoff.
- Real provider, real bank participant, real credential, real API key, or live data exchange.
