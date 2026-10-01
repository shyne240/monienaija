# A2 and A6 Privacy Inputs

- **Task:** A1T12 — Draft ADR-0024 Data Classification and Privacy
- **Status:** Future-phase entry input; not an access-control or partner implementation
- **Scope:** A2 Runtime Identity & Access and A6 External Partners & Settlement privacy decisions
- **Application code, API, entity, migration, and configuration changes:** None
- **Decision record:** [`ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md)
- **Matrix:** [`DATA-HANDLING-DECISION-MATRIX.md`](DATA-HANDLING-DECISION-MATRIX.md)

## 1. Purpose

A1 defines the data owners and handling boundaries. A2 and A6 must convert those decisions into enforceable access and external-processing contracts before protected routes or external providers are enabled.

This document records entry questions and required evidence. It does not add authentication, authorization, data-subject APIs, provider adapters, callbacks, settlement, consent management, deletion jobs, or configuration.

## 2. A2 Runtime Identity & Access privacy inputs

### 2.1 Principal and role boundary

A2 must define:

- Customer, operator, support, compliance, risk, finance, security, service, and privileged-administrator principal types.
- Canonical principal ID and relationship to Customer UUID without making a customer ID a credential.
- Role, scope, tenant/organization, approval, session, token, and revocation context.
- Need-to-know access for identity/KYC, risk, compliance, credential, device, financial, audit, and retention data.
- Segregation of duties for access administration, investigation, financial operations, retention execution, and hold release.
- Access review, recertification, emergency access, expiry, and audit requirements.

A2 must not copy password hashes, reset/recovery hashes, device fingerprints, or customer profile data into an unrelated identity store without an approved owner and retention rule.

### 2.2 Field-level access and response minimization

| Data area                            | A2 access input                                     | Minimum response rule                                                                               |
| ------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Customer identity/profile            | Customer or approved operations role with purpose   | Return only fields required by the view; mask contact/document identifiers where possible           |
| KYC/identity documents               | Dedicated Compliance/Risk role and case scope       | Metadata/reference by default; raw document contents require explicit purpose and logging           |
| Eligibility/restrictions/limits      | Risk/Product/approved command role                  | Distinguish source state from policy decision; do not expose investigative reasons broadly          |
| Risk assessments/factors             | Risk/Compliance/A4 role                             | Reasoned/minimized output; factor narratives are not generic customer or financial API data         |
| Compliance cases/comments/evidence   | Case-scoped Compliance/Legal/Security role          | No broad search/export; preserve chain of custody and access events                                 |
| Credentials/recovery/MFA/device      | Authentication/Security service only                | No hashes, tokens, codes, secrets, or fingerprint values in views, errors, logs, or support exports |
| Wallet/ledger/financial records      | Finance/financial operations/approved customer view | Ledger-derived, minimum necessary amount/status/reference; no unrestricted ledger tables            |
| Audit/outbox/idempotency/correlation | Operations/Security/incident role by purpose        | Safe identifiers and minimal payload; access itself is audited                                      |
| Retention/legal holds                | Operations/Compliance/Legal/authorized owner        | Hold scope and status only to non-owners; release authority is restricted                           |

### 2.3 Authentication and security-data rules

A2 must enforce or obtain approval for:

- Password and credential hash algorithms, versions, rotation, comparison, and rehashing without exposing hashes.
- Reset-token, recovery-code, MFA, and device-fingerprint lifecycle, expiry, revocation, and retention.
- No plaintext secret acceptance in logs, DTOs, audit values, event payloads, support tools, or error messages.
- Device identifiers restricted to the authentication/security purpose; no cross-domain tracking by default.
- Redaction of authorization headers, cookies, tokens, secret configuration, and sensitive request/response fields.
- Security event history, privileged-action audit, failed-access evidence, incident preservation, and hold behavior.
- Short-lived sessions/tokens, revocation, MFA for privileged access, and authorization checks before Restricted/Highly Restricted reads or exports.

### 2.4 Data-subject and internal request handling

A2 must define authenticated workflows for access, correction, export, restriction, and deletion/anonymization requests. Each request must:

1. Verify the principal and scope.
2. Resolve the canonical Customer UUID or approved record ID.
3. Enumerate source records and projections without trusting a user-supplied reference as authority.
4. Check legal, regulatory, financial, security, compliance, and active-hold exceptions.
5. Minimize the response/export and mask values not required by the purpose.
6. Record the decision, actor, scope, correlation ID, and owner.
7. Preserve immutable financial, required audit, held, or investigative records according to the approved schedule.

A2 must not promise universal deletion from a customer endpoint.

### 2.5 A2 entry evidence

- [ ] Principal and role model is approved.
- [ ] Field-level classification and access matrix is implemented or formally mapped to the approved policy.
- [ ] Credential, recovery, MFA, and device secret/hash handling is threat-modeled and tested.
- [ ] Logs, traces, audit values, and error envelopes are redacted.
- [ ] Privileged access, emergency access, recertification, and segregation of duties are defined.
- [ ] Data-subject request and legal-hold checks are defined.
- [ ] Internal routes are protected before being treated as production-public.

## 3. A6 External Partners & Settlement privacy inputs

### 3.1 Partner and processing approval

Before any bank, NIBSS, mobile-money, KYC, funding, notification, settlement, or other provider is connected, A6 must record:

- Provider, purpose, data owner, service role, processor/partner status, and accountable business owner.
- Legal, regulatory, contractual, consent/notice, data-processing, jurisdiction, and retention requirements.
- Field-level data map from internal authority to provider contract.
- Provider identifier namespace and reversible/repairable mapping to internal Customer/Wallet/Ledger/Payment IDs.
- Encryption, key ownership, authentication, signature validation, callback replay protection, timeouts, retries, and incident obligations.
- Provider deletion/correction/hold response, subcontractor, breach notification, audit, and data-return/destruction terms.
- Settlement, suspense, exception, and independent reconciliation ownership.

No provider is trusted merely because its identifier matches a local reference or callback payload.

### 3.2 Minimum necessary external fields

| Integration purpose             | Candidate minimum fields, subject to approval                                                                        | Must not be shared by default                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| KYC/identity verification       | Provider-mapped customer reference, required identity fields/document metadata, verification request ID              | Password/recovery/MFA data, device fingerprints, unrelated risk/compliance history, full customer record     |
| Funding instrument verification | Provider-mapped instrument reference, required account/mobile-money fields, customer mapping, request/correlation ID | Internal ledger IDs, credentials, unrelated beneficiaries, full KYC case contents                            |
| Bank/NIBSS/payment initiation   | Approved provider/customer/instrument reference, amount, currency, destination/account fields, payment/reference ID  | Passwords, hashes, risk reasoning, case comments, unrestricted identity history                              |
| Settlement/reconciliation       | Provider reference, payment reference, amount/currency/status, mapped internal journal/account evidence              | Full ledger tables, unrelated customer data, credentials, broad audit payloads                               |
| Callback/notification           | Provider callback ID, mapped resource/reference, event status/time, minimum template/route data                      | Raw secrets, full financial details, identity documents, risk/compliance content, internal operational trail |

The final field set must be purpose-specific. “Provider API accepts it” is not a sufficient sharing justification.

### 3.3 Callback and external identifier controls

A6 must validate:

- Provider authentication/signature and expected endpoint/channel.
- Schema, event type, provider reference, timestamp, replay/duplicate behavior, and correlation.
- Mapping to a known internal resource without treating the provider ID as canonical identity.
- Amount, currency, account, customer, and settlement consistency against internal authoritative records.
- Pending/ambiguous/error outcomes, retry boundaries, and reconciliation escalation.
- External payload retention, minimization, legal hold, and deletion/destruction requirements.

Provider callbacks and files are untrusted inputs. They must not write customer, credential, risk, compliance, wallet, or ledger source records without the approved adapter and command boundary.

### 3.4 A6 entry evidence

- [ ] Partner data map and lawful/contractual purpose are approved.
- [ ] Field-level classification and minimum necessary payload are approved by the data owner.
- [ ] Provider identifier mapping cannot replace internal identity or financial truth.
- [ ] Encryption, authentication, signature, replay, timeout, retry, and incident controls are tested.
- [ ] Provider retention, deletion, hold, subcontractor, and breach obligations are documented.
- [ ] Settlement, suspense, exception, and independent reconciliation owners are named.
- [ ] Customer/support disclosures and consent/notice requirements are approved.
- [ ] No external integration is introduced by this A1 document.

## 4. Cross-phase privacy dependencies

- **A1:** owns the classification, retention, legal-hold, identifier, and external-sharing decisions recorded here.
- **A2:** enforces principal access, privileged operations, secret/device handling, redaction, and data-subject request authorization.
- **A3:** must bind customer and financial IDs without copying unnecessary identity or balance data.
- **A4:** must use minimized evidence references and restrict risk/compliance reasoning to approved decision contracts.
- **A5:** must minimize command, audit, outbox, and financial payloads while preserving traceability.
- **A6:** must implement provider mapping, external processing, callback validation, settlement reconciliation, and partner retention.

## 5. Privacy review questions

- Which roles may see raw identity evidence, risk reasoning, compliance comments, credential metadata, device metadata, financial records, audit payloads, or legal-hold scope?
- Which fields are necessary for each A2 view and A6 provider operation, and which can be masked, tokenized, aggregated, or replaced by a reference?
- What data must remain immutable for financial, audit, security, compliance, dispute, or legal purposes?
- What retention schedule and hold process applies to every projection, log, event, callback, and provider copy?
- How are cross-border processing, subcontractors, data return/destruction, incidents, and customer/regulator requests handled?
- How does a support or customer request prove authority without using a customer reference, case number, or provider ID as a credential?

These questions require accountable legal, compliance, security, finance, product, and operations answers before the relevant A2/A6 gate.
