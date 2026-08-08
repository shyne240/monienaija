# ADR-0052: External-Rail Data Minimization, Consent, Disclosure, and Secret Handling

- **ADR ID:** ADR-0052
- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T10 — External-Rail Data Minimization, Consent, and Disclosure Controls
- **Status:** Implemented
- **Date:** 2026-08-08
- **Decision owners:** A6 partner owner, Privacy/Legal, Security, Compliance, Risk, Finance, Operations, and Support owners
- **Authoritative boundary:** `ExternalDataMinimizationContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Application, database, API, callback, partner, settlement, reconciliation, and financial-runtime changes in this task:** External data classification, consent validation, retention classification, legal hold, secret handling, disclosure restrictions, support-trace minimization, and read-only contract evidence; no source mutation, no provider communication, no settlement, no reconciliation mutations

## 1. Decision

A6T10 introduces a single external-rail data minimization and consent boundary that:

1. Classifies every external-rail field, payload, log, trace, and event by handling level (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`, `HIGHLY_RESTRICTED`) and stores the matrix in `A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md`.
2. Validates consent/mandate evidence for the selected purpose, jurisdiction, and lifecycle state, distinct from A2 authorization and A4 policy eligibility.
3. Minimizes provider request, response, callback, outbox, audit, diagnostic, and support payloads to the approved fields; raw payloads are never persisted.
4. Manages retention classification, deletion, and legal hold with owner attribution; ordinary cleanup cannot delete held evidence.
5. Classifies secrets (credentials, certificates, signing keys, callback secrets, PIN/OTP, device fingerprints, raw risk notes) as `HIGHLY_RESTRICTED` and never stores them in general records, logs, or events.
6. Restricts disclosure to minimum-necessary fields per audience (Support, Operations, Reconciliation, Finance) via read-only projection views.
7. Records a `A6_EXTERNAL_DATA_CONTROL` audit event through the shared `AuditService` for every data-classification, consent, hold, and disclosure decision; audit values are redacted and minimized.
8. Fails closed: a data-sharing or consent failure never defaults to external transmission and never defaults to disclosed internal evidence.

## 2. Authoritative ownership

| Concept                                          | Owner                                                       |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Data classification matrix                        | A6T10 (`ExternalDataClassificationRegistry`)               |
| Consent validation                                | A6T10 (`ExternalConsentValidator`)                         |
| Retention classification                          | A6T10 (`ExternalRetentionClassifier`)                      |
| Legal hold support                                | A6T10 (`ExternalLegalHoldRegistry`)                         |
| Secret handling                                   | A6T10 (`ExternalSecretClassifier`)                          |
| Disclosure projections                            | A6T10 (`ExternalDisclosureProjector`)                       |
| Audit, idempotency, outbox                        | Operations                                                  |
| Provider credentials, signing, callback secrets   | A6T03 (`PartnerCredentialsService`, `PartnerRequestSigningService`, `PartnerCallbackAuthenticationService`) |
| Reconciliation evidence                            | A6T09 (`ExternalReconciliationService`)                    |
| Settlement authority                              | A6T08 (`ExternalSettlementService`)                        |
| External lifecycle                                | A6T07 (`ExternalOperationLifecycleService`)                |
| External operation identity                       | A6T05 (`ExternalOperationService`)                         |

## 3. Data classification levels

```text
PUBLIC            Approved content with no customer, credential, transaction, or security detail
INTERNAL          Non-public technical, operational, or aggregate information with low standalone sensitivity
CONFIDENTIAL      Information that enables operational inference or linkability when combined
RESTRICTED        Direct or indirect customer, identity, beneficiary, funding, financial, or security information
HIGHLY_RESTRICTED Credentials, identity evidence, callback secrets, signing keys, raw risk notes
```

## 4. Data classification matrix (selected capability)

| Field                                     | Source domain | Level                | Justification                                                                  |
| ----------------------------------------- | ------------- | -------------------- | ------------------------------------------------------------------------------ |
| `externalOperationId`                     | A6T05         | INTERNAL             | Internal identity, queryable, not linkable to Customer without internal join.   |
| `externalOperationReference`              | A6T05         | INTERNAL             | Derived internal reference, not a customer identity.                            |
| `customerId`                              | Customer      | RESTRICTED           | Canonical internal customer identity.                                          |
| `walletAccountId`                         | Wallet        | RESTRICTED           | Internal financial-wallet facade.                                              |
| `ledgerAccountId`                         | Ledger        | RESTRICTED           | Internal financial account.                                                    |
| `amountMinor`/`currency`/`accountingUnit` | A5/A6         | CONFIDENTIAL         | Necessary financial signal, not standalone secret.                             |
| `providerIdempotencyKey`                  | A6T05/Partner | CONFIDENTIAL         | Partner duplicate collision key, not a credential.                             |
| `providerReferenceValue`                  | Partner       | CONFIDENTIAL         | Partner opaque reference, but linkable to a partner-side identity.             |
| `providerReferenceValueHash`              | A6T05         | INTERNAL             | One-way hash of a partner reference value.                                     |
| `callbackSecret`, `callbackSignatureHash` | A6T06         | HIGHLY_RESTRICTED    | Authentication material; not stored in A6 records.                              |
| `callbackPayloadHash`                     | A6T06         | INTERNAL             | One-way hash of an authenticated callback payload.                            |
| `targetMappingReference`                  | A6T04         | INTERNAL             | One-way mapping hash between internal target and partner target.              |
| `journalId`                               | Ledger        | RESTRICTED           | Posted internal financial journal.                                             |
| `journalMetadata`                         | Ledger        | CONFIDENTIAL         | Settlement correlation metadata.                                              |
| `auditEvent.previousValues`/`newValues`    | Operations    | CONFIDENTIAL         | Minimized; redacted by `redactRecord`; no raw secrets or raw callbacks.        |
| `outboxEvent.payload`                     | Operations    | CONFIDENTIAL         | Settlement correlation only; redacted; no raw provider payloads.              |
| `supportTrace`                            | A6T09         | INTERNAL/CONFIDENTIAL | Minimum-necessary projection per audience.                                     |
| `partnerCredentials`                      | A6T03         | HIGHLY_RESTRICTED    | Reference only; secret material never in A6 records.                           |
| `partnerSigningKey`                       | A6T03         | HIGHLY_RESTRICTED    | Reference only.                                                                 |
| `consent.mandateReference`                | Consent       | RESTRICTED           | Mandate or consent reference distinct from authorization.                       |
| `consent.grantedAt`/`expiresAt`           | Consent       | CONFIDENTIAL         | Time-bounded, purpose-bound.                                                   |

## 5. Consent contract

```text
ConsentAssertionV1 {
  customerId: UUID
  source: "CUSTOMER_BENEFICIARY" | "CUSTOMER_FUNDING_INSTRUMENT" | "EXTERNAL_TARGET" | "DERIVED"
  targetId: UUID
  targetVersion: positive integer
  purpose: "OUTBOUND_BANK_SETTLEMENT"
  jurisdiction: ISO-3166 alpha-2
  mandateReference: opaque bounded string
  mandateVersion: positive integer
  grantedAt: RFC3339 UTC
  expiresAt: RFC3339 UTC
  grantedBy: opaque bounded principal
  revocable: boolean
  revokedAt: RFC3339 UTC | null
}
```

Validation rules (all are mandatory):

1. The consent purpose must match the A6T01-selected `external.wallet.withdrawal.settlement` purpose.
2. The consent target must be verified and current (`targetVersion > 0`).
3. The consent `grantedAt <= now < expiresAt`; the consent is not expired.
4. The consent is distinct from A2 authorization and A4 policy eligibility; it does not replace them.
5. The consent `grantedBy` is a non-empty opaque principal reference.
6. The consent is not revoked (`revokedAt IS NULL`).
7. The consent jurisdiction is in the approved partner set (default: `NG`).

A failed consent validation fails closed: the A6 boundary never sends to the partner, never settles, and never discloses; the calling layer enters a declared manual-review state.

## 6. Retention classification

| Dataset / class             | Default retention | Owner                          | Hold support | Notes                                                              |
| --------------------------- | ------------------ | ------------------------------ | ------------ | ------------------------------------------------------------------ |
| `external_operations`       | 365 days           | A6T05                          | Yes          | Held evidence is never deleted by ordinary cleanup.                  |
| `external_operation_references` | 365 days       | A6T05/Partner Owner            | Yes          | Partner reference values may be retained under legal hold.           |
| `external_callback_receipts` | 365 days          | A6T06/Security                 | Yes          | Held evidence is never deleted by ordinary cleanup.                  |
| `external_settlements`        | 365 days           | A6T08/Finance                  | Yes          | Held evidence is never deleted by ordinary cleanup.                  |
| `external_suspense_entries`   | 365 days           | A6T08/Finance                  | Yes          | Held evidence is never deleted by ordinary cleanup.                  |
| `audit_events` (A6-EXTERNAL) | 365 days           | Operations/Security            | Yes          | Inherits Operations retention; never deleted by ordinary cleanup.    |
| `outbox_events` (A6-EXTERNAL)| 30 days published  | Operations                     | Yes          | Pending events are never removed by ordinary cleanup.                 |
| `idempotency_records`         | 1 day             | Operations                     | Yes          | Operational idempotency window; never expanded by a hold.            |
| `data_classification`         | 365 days           | A6T10                          | Yes          | Classification matrix is retained; never deleted by ordinary cleanup. |
| `consent_assertions`         | 365 days           | A6T10/Privacy                  | Yes          | Consent evidence is retained; never deleted by ordinary cleanup.    |
| `legal_hold_records`         | N/A                | A6T10/Legal/Compliance        | N/A          | Hold is itself retained until explicit release.                      |
| `disclosure_views`           | 30 days            | A6T10/Support                 | Yes          | Disclosure projections are retained; never deleted by ordinary cleanup. |
| `secret_classifications`      | 365 days           | A6T10/Security                 | Yes          | Secret classification is retained; never deleted by ordinary cleanup. |
| `support_traces`              | 90 days            | A6T10/Support                 | Yes          | Read-only support trace; never deleted by ordinary cleanup.           |

Ordinary cleanup must not delete evidence under a `legal_hold_record`; the A6T10 contract asserts a `NO_AUTOMATIC_REPAIR` recovery state and a `MANUAL_REVIEW_REQUIRED` recovery for held evidence.

## 7. Legal hold contract

```text
LegalHoldRecordV1 {
  id: UUID
  scope: "EXTERNAL_OPERATION" | "EXTERNAL_REFERENCE" | "EXTERNAL_CALLBACK" | "EXTERNAL_SETTLEMENT" | "EXTERNAL_SUSPENSE" | "EXTERNAL_AUDIT" | "EXTERNAL_OUTBOX" | "EXTERNAL_IDEMPOTENCY" | "EXTERNAL_DATA_CLASSIFICATION" | "EXTERNAL_CONSENT" | "EXTERNAL_DISCLOSURE" | "EXTERNAL_SUPPORT_TRACE" | "EXTERNAL_SECRET"
  referenceId: UUID
  owner: opaque bounded owner
  authority: "LEGAL" | "REGULATORY" | "INVESTIGATION" | "SECURITY" | "FRAUD" | "DISPUTE" | "FINANCIAL_CONTROL"
  reason: opaque bounded string
  imposedAt: RFC3339 UTC
  imposedBy: opaque bounded principal
  releasedAt: RFC3339 UTC | null
  releasedBy: opaque bounded principal | null
  notes: opaque bounded string | null
}
```

A legal hold:

- Records the scope, referenceId, owner, authority, and reason.
- Is imposed and released by an approved `imposedBy`/`releasedBy` principal.
- Prevents ordinary cleanup from deleting the held evidence.
- Is itself retained until `releasedAt IS NOT NULL`.
- Records an audit event with `entityType: A6_EXTERNAL_DATA_CONTROL` and `action: HOLD_IMPOSED` or `HOLD_RELEASED`.

## 8. Secret handling

Secret classification recognises at least the following secret categories:

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

All secret categories are `HIGHLY_RESTRICTED` and the A6T10 contract asserts the following invariants:

1. Secret material is never stored in `external_operations`, `external_operation_references`, `external_callback_receipts`, `external_settlements`, `external_suspense_entries`, `audit_events`, `outbox_events`, `idempotency_records`, or `support_traces`.
2. Secret material is referenced through opaque credential references (`PARTNER_CREDENTIAL_LOADER`, `PARTNER_REQUEST_SIGNER`, `PARTNER_CALLBACK_SECRET_SOURCE`).
3. Secret material is never logged, traced, audited, or support-projected.
4. Provider payloads are received via the A6T03/PARTNER_CALLBACK_SECRET_SOURCE abstraction; raw headers, raw signatures, and raw bodies are redacted before audit/outbox/support projection.
5. Disclosing a secret in any A6 record or projection is a `SECRET_DISCLOSED` discrepancy that fails the boundary closed.

## 9. Disclosure contract

The A6T10 contract exposes read-only projection views that are minimum-necessary per audience:

```text
ExternalDataClassificationView   — Support, Operations, Reconciliation
ExternalConsentSummaryView      — Support, Operations
ExternalRetentionClassView      — Support, Operations, Reconciliation, Finance
ExternalLegalHoldView            — Compliance, Legal, Security
ExternalSecretClassificationView — Security, Operations
ExternalDisclosureProjectionView — Support, Operations, Reconciliation
ExternalSupportTraceView         — Support, Operations
```

A disclosure view MUST:

- Be a `READ_ONLY` projection; it never mutates any source record.
- Expose only fields whose `level` is at or below the audience's maximum level.
- Mask `HIGHLY_RESTRICTED` fields with `[HIGHLY_RESTRICTED]` placeholders.
- Record the disclosure event through the shared `AuditService` with `entityType: A6_EXTERNAL_DATA_CONTROL` and `action: DISCLOSED` (or `DISCLOSURE_REJECTED`).
- Reject disclosure for a `HIGHLY_RESTRICTED` field to any audience below the `Security` level.

## 10. Read-only and replay safety

The data minimization boundary is read-only with respect to all A6 source records:

- It never writes, updates, deletes, or truncates any row in `external_operations`, `external_operation_references`, `external_callback_receipts`, `external_settlements`, `external_suspense_entries`, `audit_events`, `outbox_events`, or `idempotency_records`.
- It can write only to the `external_data_classification`, `external_consent_assertions`, `external_legal_hold_records`, `external_disclosure_views`, and `external_secret_classifications` registries.
- It records audit events through the shared `AuditService`, which uses its own immutable `audit_events` table.
- It is replay-safe: identical inputs produce identical classification, consent, retention, hold, and disclosure outcomes, and identical audit facts (timestamps and request IDs aside).

## 11. Prohibited behavior

- A6T10 must not store raw PAN, CVV, PIN, OTP, secret keys, signing keys, callback secrets, device fingerprints, raw risk narratives, or raw compliance case content.
- A6T10 must not authorize, settle, or transmit to a partner based on an unclassified field.
- A6T10 must not bypass A2 authorization, A3 binding, A4 policy, A5 lifecycle, A6T07 lifecycle, A6T08 settlement, or A6T09 reconciliation.
- A6T10 must not delete or override a `legal_hold_record` from an unauthorized principal.
- A6T10 must not advertise a `PUBLIC` level for a customer-, credential-, or financial-touching field.
- A6T10 must not release a held record to a non-owner audience.

## 12. Acceptance evidence

- `docs/A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md` documents the full contract.
- `docs/A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md` enumerates the field-level classifications.
- `test/external-data-minimization.service.spec.ts` exercises the data classification, consent validation, retention classification, legal hold, secret handling, disclosure restrictions, replay consistency, audit evidence, and read-only behavior paths.
- The engine performs no write SQL or service method that mutates A6 source records.
- The engine integrates with the shared `Operations.auditService` for all data-control events; no local audit store is created.
- The engine is registered in the `PartnerModule` so it can be consumed by A6T03, A6T04, A6T05, A6T06, A6T07, A6T08, A6T09, and A6T11 without coupling to financial execution paths.
