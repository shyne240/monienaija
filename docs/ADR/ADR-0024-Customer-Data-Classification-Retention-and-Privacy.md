# ADR-0024: Customer Data Classification, Retention, and Privacy

- **Status:** Proposed for A1 architecture review
- **Date:** 2026-08-05
- **Decision owners:** Security, Privacy/Legal, Compliance, Risk, Customer Engineering, Operations, Finance, Product, and Architecture
- **Scope:** Customer Foundation data, financial/control data, retention, legal holds, access, and future external processing
- **Task:** A1T12 — Draft ADR-0024 Data Classification and Privacy
- **Implementation status:** Decision input only; no privacy service, deletion job, API, migration, external integration, or runtime configuration is implemented

## Context

The Customer Foundation stores identity, profile, KYC, onboarding, eligibility, risk, compliance, beneficiary, funding-instrument, preference, authentication, recovery, device, and operational metadata. The financial core stores wallet, ledger, journal, payment, and reconciliation records. Operations stores audit, idempotency, outbox, metrics, diagnostics, and readiness evidence.

These categories have different sensitivity, owners, lifecycles, retention obligations, and sharing boundaries. A password hash is not plaintext, but it remains sensitive. A customer reference is not a secret, but it can link records. An audit or outbox payload may be immutable while still requiring minimization and a controlled retention schedule. A legal hold may require preserving records that ordinary retention would otherwise remove.

A1T07 defines the detailed identifier, classification, retention, legal-hold, minimization, and external-sharing controls. This ADR formalizes the decision boundary and provides the privacy inputs required by A2 access and A6 external processing. It does not substitute for legal, regulatory, contractual, or payment-scheme advice.

## Decision

### 1. Handling levels

MonieNaija uses the following engineering handling levels, with stricter legal, regulatory, contractual, or payment obligations taking precedence:

| Level             | Meaning                                                                                              | Minimum controls                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Public            | Approved content with no customer, credential, transaction, or security detail                       | Publication approval and content review                                                                  |
| Internal          | Non-public technical, operational, or aggregate information with low standalone sensitivity          | Staff/service access, no public API exposure by default                                                  |
| Confidential      | Information that enables operational inference or linkability when combined                          | Least privilege, approved logging, minimized event payloads, no public sharing                           |
| Restricted        | Direct or indirect customer, identity, beneficiary, funding, financial, or security information      | Explicit purpose/role, encryption, masked views, controlled exports, access audit                        |
| Highly Restricted | Credentials, identity evidence, investigative content, risk reasoning, or financial-control evidence | Dedicated owner, strongest access controls, no plaintext or external disclosure by default, hold support |

The source-domain owner remains accountable for classifying new fields and for ensuring projections, logs, events, exports, and external adapters do not downgrade the source classification.

### 2. Data ownership and classification

| Category                                                               | Authority / steward                                                   | Default level                                | Handling boundary                                                                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Customer identity and profile                                          | `customer`; Compliance/Risk for KYC use                               | Restricted                                   | Canonical Customer UUID; minimize contacts, addresses, and identity fields; no duplicate financial identity records |
| Identity documents and KYC evidence                                    | `customer`; Compliance/Risk                                           | Highly Restricted                            | Approved personnel and purpose only; no raw document contents in generic logs/events/APIs                           |
| Onboarding, eligibility, restrictions, limits, enrollment, permissions | `customer-onboarding` / `customer-eligibility`                        | Restricted                                   | Source evidence and configuration; A4 decisions are derived and versioned                                           |
| Risk assessments and factors                                           | `customer-risk-profile`; Risk/Compliance                              | Highly Restricted                            | Preserve assessment history and reason context; expose minimized references to A4                                   |
| Compliance cases and evidence                                          | `customer-compliance`; Compliance/Legal                               | Highly Restricted                            | Segregated investigative access and chain of custody; case creation is not screening output                         |
| Credentials, reset/recovery hashes, and MFA identifiers                | `customer-authentication`; Security                                   | Highly Restricted                            | Hash-only metadata; no plaintext password, token, code, secret, or challenge                                        |
| Device metadata and fingerprint hashes                                 | `customer-authentication`; Security                                   | Highly Restricted                            | Purpose-specific, hash-only comparison; no cross-domain tracking or partner disclosure by default                   |
| Beneficiaries and funding instruments                                  | `customer-beneficiary` / `customer-funding-instrument`; Payments Risk | Restricted to Highly Restricted              | Registration metadata is not provider ownership or settlement proof                                                 |
| Preferences                                                            | `customer-preference`; Product/Compliance for consent                 | Confidential/Restricted                      | Store customer intent and history; delivery/provider state is separate                                              |
| Wallet, ledger, payment, and financial transaction data                | `wallet`/`ledger` and respective financial domains; Finance           | Highly Restricted                            | Ledger owns value and immutable postings; no customer metadata balance copy                                         |
| Audit, outbox, idempotency, correlation, metrics, and diagnostics      | `operations` / Production                                             | Confidential to Highly Restricted by payload | Minimal, access-controlled, redacted, and retained under separate operational schedules                             |
| Reconciliation and governance evidence                                 | Reconciliation / Product Governance / Maturity                        | Confidential to Highly Restricted            | Read-only control and release evidence; never source-record repair                                                  |

The full field-level matrix is [`DATA-HANDLING-DECISION-MATRIX.md`](../DATA-HANDLING-DECISION-MATRIX.md).

### 3. Minimization and secure handling

- Collect and persist only the fields required for the declared purpose.
- Keep canonical source fields in the owning domain; projections carry the minimum reference, version, timestamp, reason, or aggregate needed by their consumer.
- Encrypt Restricted and Highly Restricted data in transit and at rest using approved key-management controls.
- Apply least privilege, separation of duties, access recertification, and access logging at the A2 boundary.
- Redact credentials, secrets, raw identity documents, raw device fingerprints, unnecessary hashes, and sensitive free text from logs, metrics, audits, and event payloads.
- Treat a hash as sensitive and potentially linkable. Hashing does not make a value public or permit uncontrolled equality searches.
- Use purpose-specific identifiers; do not use one stable device, provider, customer, or correlation value as a cross-domain tracking key without an approved purpose.
- Treat all external payloads, callbacks, files, and partner data as untrusted and validate them before correlation or state change.

### 4. Retention and legal holds

Every dataset must have an accountable retention owner and an approved schedule identifying purpose, start event, cutoff, minimization/deletion method, access reviewer, and exceptions. A **schedule required** entry is not a permission to retain indefinitely; it is an unresolved review item that blocks ungoverned deletion or external processing.

The current operational defaults are recorded separately and remain configurable:

- Operational metrics: 30 days by default.
- Audit events: 365 days by default.
- Idempotency records: 1 day by default.
- Published/failed outbox events: 30 days by default.
- Pending outbox events: never removed by ordinary retention cleanup.

These defaults do not replace financial, security, compliance, legal, contractual, or payment-scheme schedules. Audit retention is distinct from active-record retention: deleting an audit event does not delete its source record, and retaining an active source record does not justify retaining every copied payload.

A legal, regulatory, investigation, security, fraud, dispute, or financial-control hold overrides ordinary cleanup. A hold must identify:

- Hold owner and authority/reason.
- Scope, such as Customer UUID, case number, record UUID, payment reference, provider reference, or correlation ID.
- Start/review/release dates.
- Affected source, audit, event, idempotency, provider, and projection records.
- Release authority and post-release retention review.

Holds expand through approved correlation and ownership mappings. Hold release is explicit and auditable. No routine soft-delete or maintenance operation may bypass a hold.

### 5. External processing and sharing

External sharing requires a later approved Architecture phase, an accountable data owner, documented purpose and minimum fields, recipient/contract approval, security controls, retention/deletion terms, incident handling, and reconciliation behavior.

- A2 must authorize who can access or export Restricted/Highly Restricted data.
- A6 must approve external provider mappings, consent/legal basis questions, field-level disclosure, provider retention, callback validation, and cross-border/contractual controls where applicable.
- Internal UUIDs, ledger IDs, idempotency keys, correlation trails, credential hashes, recovery material, device fingerprints, raw identity documents, risk reasoning, compliance comments, and unrestricted audit payloads are not shared by default.
- Provider references cannot replace internal IDs; external adapters must preserve a mapped internal identity and source authority.
- A customer-facing view may disclose only the authenticated customer’s minimum necessary masked information after A2.

The detailed A2/A6 questions and entry controls are in [`A2-A6-PRIVACY-INPUTS.md`](../A2-A6-PRIVACY-INPUTS.md).

### 6. Data-subject and privacy review boundary

A future data-subject request must be authenticated and authorized at A2, located using canonical identifiers, checked against legal/financial/security obligations and active holds, and recorded with its decision and scope. This ADR does not implement export, correction, restriction, anonymization, or erasure endpoints.

Customer, ledger, audit, compliance, security, and held records may have different treatment. No generic customer endpoint may promise deletion of immutable financial truth, required audit evidence, investigation records, security evidence, or held data without the responsible owner’s approved process.

## Alternatives considered

### Treat all customer data as one classification and retention schedule

Rejected. Identity, credentials, risk, compliance, financial, operational, and preference data have different purposes, owners, access needs, and legal/control obligations.

### Treat hashes as anonymous or safe to share

Rejected. Hashes can be linkable, comparable, brute-forced for low-entropy inputs, or used to track a device/person. They remain sensitive and purpose-bound.

### Delete audit records with active records using one generic cleanup

Rejected. Audit evidence has a separate retention owner and may need to outlive or be shorter than the active source record. Pending outbox and held evidence require additional protection.

### Share complete customer records with external providers

Rejected. A6 must use minimum necessary provider-specific fields, mapped identifiers, contract controls, callback validation, and settlement/reconciliation evidence.

### Implement privacy operations in A1

Rejected. A1 defines ownership and decision inputs. Runtime access, customer requests, deletion workflows, partner processing, and enforcement belong to approved later phases and governance processes.

## Consequences

### Positive

- Sensitive categories have explicit owners and handling levels.
- Plaintext secrets are prohibited and hash/device handling is explicit.
- Active records, audit evidence, operational records, financial truth, and legal holds are not conflated.
- A2 and A6 have concrete privacy entry conditions before access or external providers are enabled.
- External sharing is minimized and cannot silently replace internal identity or financial authority.

### Trade-offs

- Legal, regulatory, contractual, and product owners must approve dataset-specific schedules and external-processing purposes.
- Field-level classification must be maintained as schemas, events, logs, and integrations evolve.
- Holds and immutable financial/control records can delay deletion and increase storage/operational cost.
- A2 access controls and A6 provider contracts are prerequisites for enforcing these decisions.

## Dependencies

- **ADR-0003:** minimal, owned, correlated, versioned event facts.
- **ADR-0008/0009/0010:** operational audit, retention maintenance, readiness, and production controls.
- **ADR-0012 through ADR-0019:** Customer Foundation source categories and ownership.
- **A1T07:** identifier, privacy, retention, legal-hold, minimization, and external-sharing controls.
- **A2:** authentication, authorization, privileged access, secrets, logs, and data-subject request boundary.
- **A6:** provider adapters, consent/legal review, external data minimization, callbacks, retention, and reconciliation.

## Open legal and compliance review questions

1. Which regulatory, contractual, tax, payment-scheme, and financial-record schedules apply to each dataset and jurisdiction?
2. What lawful purpose, notice, consent, or other basis applies to each external processing use case?
3. Which identity/KYC, risk, compliance, security, audit, and financial records are exempt from ordinary erasure or require restricted access?
4. What retention and review period applies to expired credentials, reset tokens, recovery codes, device identifiers, and security events?
5. How are customer, provider, and operational data handled across jurisdictions or processors?
6. What fields may be disclosed to each provider, partner, support role, customer view, analytics system, and notification channel?
7. How are legal holds issued, expanded across correlated records, reviewed, released, and audited?
8. How are data-subject requests handled when records are immutable, disputed, reconciled, under investigation, or held?
9. What incident notification, breach evidence, access review, and processor-subcontractor obligations apply?

## Verification

A1T12 verification for this ADR requires:

- Field-classification checklist against the data-handling matrix.
- Retention-owner and legal-hold review against A1T07 and the existing operational retention policy.
- Plaintext-secret and sensitive-hash prohibition check.
- Audit-retention versus active-record-retention consistency check.
- A2/A6 privacy-input and external-sharing review.
- Explicit legal/compliance question ownership before A1 approval.
