# A6T04 — External Funding-Instrument and Target Mapping Contract

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T04 — External Funding-Instrument Use and Internal Account Mapping
- **Status:** Implemented read/validation contract; no provider communication or financial execution
- **Contract:** `ExternalFundingTargetMappingCommandV1` / `ExternalFundingTargetMappingResultV1`
- **Capability:** `external.wallet.withdrawal.settlement`
- **Action:** `create`
- **Selected partner planning key:** `NIBSS_NIP`
- **Currency:** `NGN`
- **Application, database, API, migration, controller, route, scheduler, provider, callback, settlement, and financial-runtime changes:** None

This document defines the A6T04 consumer boundary for a verified customer-owned external bank-account target. It does not create a funding-instrument, beneficiary, consent, external-operation, mapping, provider, settlement, or financial authority.

## 1. Boundary and sequence

The A6T04 mapping boundary is:

```text
A2 exact customer/target-use authorization
  -> A4 external-capability policy assertion validation
  -> A3 explicit internal account-binding validation
  -> authoritative CustomerBeneficiary or CustomerFundingInstrument read
  -> authoritative active/NIP-supported Bank read
  -> target-type/status/verification/version checks
  -> purpose-bound consent assertion validation
  -> deterministic opaque target mapping handle
  -> optional Operations audit fact
```

The mapping result is safe input for a later A6 external-operation/adapter boundary. It is not a provider request, a settlement decision, a Ledger journal, or a customer-visible financial result.

The A6T04 service MUST read source records through their owning services:

```text
AuthorizationService
CustomerFinancialAccountBindingService.validateActiveBinding
CustomerBeneficiaryService.getBeneficiary
CustomerFundingInstrumentService.getInstrument
BankService.list
PartnerConnectionService.getProfile
AuditService through Operations
```

It MUST NOT query source tables directly, infer an account from a reference, repair source records, or copy raw external target data into broad logs/events.

## 2. Command contract

The logical command is equivalent to:

```text
ExternalFundingTargetMappingCommandV1 {
  principal: A2 AuthorizationPrincipal
  requestContext: {
    requestId
    correlationId
    traceId
  }

  customerId: canonical Customer.id UUID

  internalAccount: {
    customerWalletId: CustomerWallet.id UUID
    bindingId: CustomerFinancialAccountBinding.id UUID
    bindingVersion: positive integer
    walletAccountId: WalletAccount.id UUID
    ledgerAccountId: LedgerAccount.id UUID
  }

  money: {
    amountMinor: canonical positive minor-unit digit string
    currency: "NGN"
    accountingUnit: "CUSTOMER_FUNDS"
  }

  target: {
    source: "CUSTOMER_BENEFICIARY" | "FUNDING_INSTRUMENT"
    beneficiaryId?: UUID
    fundingInstrumentId?: UUID
    version: positive integer
    institutionCode: explicit bank-directory code
    targetCurrency?: uppercase currency code
  }

  consent: ExternalFundingTargetConsentAssertionV1
  policy: ExternalFundingTargetPolicyAssertionV1
}
```

### 2.1 Exactly one target source

The command MUST satisfy exactly one of these forms:

```text
source = CUSTOMER_BENEFICIARY
beneficiaryId is present
fundingInstrumentId is absent

or

source = FUNDING_INSTRUMENT
fundingInstrumentId is present
beneficiaryId is absent
```

The following are invalid:

- both source IDs present;
- neither source ID present;
- source value not registered by this capability;
- a source ID that is not a UUID;
- a source version that is not a positive integer; or
- a target source that is not explicitly scoped to the command's `customerId`.

This prevents a caller from presenting two potentially different external accounts or allowing the A6 boundary to guess which source is authoritative.

## 3. Authoritative source contracts

### 3.1 Customer beneficiary source

A `CUSTOMER_BENEFICIARY` target is accepted only when the authoritative `CustomerBeneficiaryService.getBeneficiary(customerId, beneficiaryId)` result has:

```text
type: BANK_ACCOUNT
status: ACTIVE
verified: true
customerId: command.customerId
version: command.target.version
```

If `destinationInstitution` is present, it must match the selected active bank directory record by bank code, bank name, or short name after safe normalization. A destination identifier is not returned as a raw provider payload by the mapping result.

### 3.2 Funding-instrument source

A `FUNDING_INSTRUMENT` target is accepted only when the authoritative `CustomerFundingInstrumentService.getInstrument(customerId, instrumentId)` result has:

```text
type: BANK_ACCOUNT
status: VERIFIED
verificationState: VERIFIED
customerId: command.customerId
version: command.target.version
```

`MOBILE_MONEY`, `CASH_AGENT`, `INTERNAL_SETTLEMENT`, `PENDING`, `SUSPENDED`, `INACTIVE`, `REJECTED`, `UNVERIFIED`, and stale versions are non-executable for this selected A6 capability.

The existing funding-instrument source stores a safe reference and verification metadata, not a provider credential. A6T04 uses that source reference only to derive a deterministic opaque mapping handle.

### 3.3 Bank-directory source

The command's `institutionCode` is normalized to uppercase and must match an active bank-directory record returned by:

```text
BankService.list(undefined, BankStatus.ACTIVE)
```

The matching bank must satisfy:

```text
status: ACTIVE
nipSupported: true
bankCode: institutionCode
```

A local bank row is directory evidence only. It is not provider connectivity, account ownership, participant certification, or external settlement finality.

## 4. A2 authorization contract

A6T04 uses the A2 authorization action:

```text
resourceType: external-funding-target
action: wallet:withdrawal:external-target:use
```

For a customer principal, the policy requires:

```text
allowedPrincipalTypes: CUSTOMER
customerAccess: SELF
resource.customerId = command.customerId
```

For an internal service/operator/privileged principal, the policy requires:

```text
allowedPrincipalTypes: SERVICE | OPERATOR | PRIVILEGED
requiredScopes: [wallet:withdrawal:external-target:use]
customerAccess: ASSIGNED
```

A2 authorization is evaluated against the canonical customer and explicit target ID. Beneficiary verification, funding-instrument verification, consent, A4 policy, bank-directory support, and provider configuration do not replace A2 authorization.

An authorization denial or inability to persist A2's own authorization evidence fails closed.

## 5. A4 policy assertion contract

A6T04 consumes an A4 result assertion without invoking a second policy evaluator:

```text
ExternalFundingTargetPolicyAssertionV1 {
  customerId: canonical Customer.id UUID
  capability: external.wallet.withdrawal.settlement
  action: create
  decision: ALLOW | ALLOW_WITH_LIMITS
  decisionReference: safe bounded reference
  policyVersion: safe bounded version
  currency: NGN
  expiresAt: RFC3339 UTC timestamp
  reviewAt?: RFC3339 UTC timestamp | null
  maxAmountMinor?: positive minor-unit digit string | null
}
```

Validation rules:

- `customerId`, capability, action, and currency must match the mapping command.
- Only `ALLOW` and `ALLOW_WITH_LIMITS` are executable.
- `expiresAt` must be in the future.
- If `reviewAt` is present, it must be in the future.
- `ALLOW_WITH_LIMITS` must supply `maxAmountMinor` greater than or equal to the requested amount.
- Decision references and policy versions are safe references, not source payloads.
- A6T04 does not recalculate A4 precedence or mutate A4/source records.

## 6. A3 internal account contract

The command carries an explicit internal account tuple:

```text
customerId
customerWalletId
bindingId
bindingVersion
walletAccountId
ledgerAccountId
currency: NGN
accountingUnit: CUSTOMER_FUNDS
```

A6T04 calls the A3 read-only assertion:

```text
CustomerFinancialAccountBindingService.validateActiveBinding({
  customerId,
  customerWalletId,
  bindingId,
  walletAccountId,
  ledgerAccountId,
  expectedCurrency: NGN,
  expectedAccountingUnit: CUSTOMER_FUNDS,
  expectedBindingVersion: bindingVersion,
})
```

A3 remains responsible for:

- canonical customer and CustomerWallet equality;
- binding state and version;
- Customer/CustomerWallet lifecycle and ownership;
- WalletAccount status/currency/Ledger relationship;
- LedgerAccount active customer-funds dimensions; and
- unresolved account-control evidence.

A6T04 does not select, create, repair, reassign, activate, suspend, or close an internal account.

## 7. Consent assertion contract

The current repository has no A6 consent/mandate persistence authority. A6T04 therefore validates a versioned boundary assertion:

```text
ExternalFundingTargetConsentAssertionV1 {
  reference: safe bounded reference
  customerId: canonical Customer.id UUID
  targetSource: CUSTOMER_BENEFICIARY | FUNDING_INSTRUMENT
  targetId: source UUID
  purpose: OUTBOUND_BANK_SETTLEMENT
  grantedBy: safe bounded actor reference
  grantedAt: RFC3339 UTC timestamp
  expiresAt: RFC3339 UTC timestamp
  version: positive integer
}
```

The assertion is accepted only when:

- `customerId` equals the mapping command customer;
- `targetSource` and `targetId` equal the resolved source;
- `purpose` is exactly `OUTBOUND_BANK_SETTLEMENT`;
- the reference and actor are bounded safe values;
- `version >= 1`;
- `grantedAt` is not in the future; and
- `expiresAt` is later than both `grantedAt` and the current time.

Consent is distinct from:

```text
A2 authorization
A4 policy eligibility
A3 account ownership
funding-instrument verification
beneficiary verification
provider authentication
financial execution approval
```

A6T10 remains responsible for the authoritative consent/mandate, data-sharing, retention, legal-hold, disclosure, and revocation decision. A6T04 does not persist or mutate consent.

## 8. Supported currency and account-type rules

The selected A6T01 boundary is intentionally narrow:

```text
currency: NGN only
accountingUnit: CUSTOMER_FUNDS only
targetType: BANK_ACCOUNT only
partnerKey: NIBSS_NIP only
operationType: OUTBOUND_BANK_SETTLEMENT only
```

The boundary rejects:

- USD, GBP, EUR, or any non-NGN currency;
- missing, implicit, mixed, or converted currency;
- any accounting unit other than `CUSTOMER_FUNDS`;
- `MOBILE_MONEY`, `CASH_AGENT`, `INTERNAL_SETTLEMENT`, or `INTERNAL_CUSTOMER` target types;
- inactive or non-NIP-supported banks; and
- unsupported partner, capability, operation, or environment configuration.

No FX, rounding, fee, commission, tax, pricing, or second financial effect is represented.

## 9. Deterministic mapping result

### 9.1 Result shape

```text
ExternalFundingTargetMappingResultV1 {
  mappingVersion: 1
  mappingReference: SHA-256 hex

  partner: {
    partnerKey: NIBSS_NIP
    capabilityKey: external.wallet.withdrawal.settlement
    operationType: OUTBOUND_BANK_SETTLEMENT
  }

  customerId

  internalAccount: {
    customerWalletId
    bindingId
    bindingVersion
    walletAccountId
    ledgerAccountId
    currency
    accountingUnit
  }

  target: {
    source: CUSTOMER_BENEFICIARY | FUNDING_INSTRUMENT
    sourceId
    sourceVersion
    targetType: BANK_ACCOUNT
    institutionCode
    targetReferenceHash
    consentReference
    consentVersion
    externalTarget: ExternalTargetReferenceV1
  }

  money: {
    amountMinor
    currency
    accountingUnit
  }

  policy: decisionReference + policyVersion + expiry
  authorization: principal type + ID + evaluation time
  requestContext: requestId + correlationId + traceId
}
```

### 9.2 Opaque target handle

The mapping service derives:

```text
mappingReference = SHA-256(
  "a6-external-target-mapping-v1" +
  customerId + targetSource + targetId + targetVersion +
  institutionCode + sourceReferenceHash + currency + accountingUnit +
  policyDecisionReference + policyVersion + consentReference + consentVersion
)

targetReference = "a6-target:" + mappingReference
```

The mapping handle is deterministic for the same normalized target, customer, version, bank, policy, consent, and currency context. It is opaque and safe to carry to the later A6 adapter boundary. It is not a provider reference, provider credential, LedgerAccount ID, journal ID, balance, or settlement result.

The raw destination identifier and funding-instrument reference are not returned as broad mapping output. `targetReferenceHash` supports correlation and duplicate/conflict detection without exposing the raw source value.

### 9.3 Duplicate and conflict posture

- One command cannot map two target sources.
- A stale source version is rejected rather than silently remapped.
- A changed target, bank, currency, policy, consent, or internal account tuple produces a different mapping reference and must not reuse a prior operation identity.
- A same-source/same-version mapping produces the same deterministic handle.
- Durable external-operation/provider idempotency and historical mapping persistence remain A6T05 work; A6T04 does not create a local mapping store.
- Existing source owners' uniqueness constraints remain authoritative for duplicate beneficiary destinations and funding-instrument references.

## 10. Operations audit contract

A successful mapping may be recorded through:

```text
ExternalFundingTargetMappingService.resolveAndAudit(manager, command)
```

The shared Operations audit event is:

```text
entityType: A6_EXTERNAL_TARGET_MAPPING
action: MAPPED | REJECTED
entityId: canonical customerId
actor: A2 principal ID
correlationId: request context correlationId
requestId: request context requestId
newValues:
  mappingReference
  customerId
  customerWalletId
  bindingId
  walletAccountId
  ledgerAccountId
  targetSource + targetSourceId + targetVersion
  targetReferenceHash
  institutionCode
  currency + accountingUnit
  consentReference + consentVersion
  policyDecisionReference + policyVersion
  partnerKey + capabilityKey
```

Audit output excludes raw destination identifiers, raw funding values, credentials, signing material, provider payloads, mutable balances, journal lines, and unrestricted risk/compliance data. If the mapping audit cannot be recorded, the operation fails closed with `OPERATIONS_EVIDENCE_UNAVAILABLE`.

## 11. Failure vocabulary

| Code                              | Meaning                                                                                             | Financial posture                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `COMMAND_INVALID`                 | Required identity, version, context, target source, or shape is invalid.                            | No provider or financial effect.            |
| `AUTHORIZATION_REQUIRED`          | A2 denied or could not establish exact customer/target authorization.                               | No external admission.                      |
| `POLICY_NOT_EXECUTABLE`           | A4 assertion is missing, mismatched, expired, review-due, denied, suspended, or limit-incompatible. | No external admission.                      |
| `ACCOUNTING_UNIT_MISMATCH`        | Accounting unit is not `CUSTOMER_FUNDS`.                                                            | No external admission.                      |
| `CURRENCY_UNSUPPORTED`            | Currency is not NGN or target currency differs.                                                     | No external admission.                      |
| `ACCOUNT_BINDING_NOT_ACTIVE`      | A3 explicit internal account binding is missing, stale, inactive, or incompatible.                  | No account selection or external admission. |
| `TARGET_NOT_FOUND`                | Authoritative beneficiary/funding-instrument read cannot resolve the customer-scoped source.        | No external admission.                      |
| `TARGET_TYPE_UNSUPPORTED`         | Target source is not an allowed bank-account type.                                                  | No external admission.                      |
| `TARGET_NOT_VERIFIED`             | Funding instrument or beneficiary is not verified.                                                  | No external admission.                      |
| `TARGET_NOT_ACTIVE`               | Beneficiary or source record is not active/usable.                                                  | No external admission.                      |
| `TARGET_VERSION_STALE`            | Source version does not match the command assertion.                                                | No remapping or external admission.         |
| `TARGET_OWNERSHIP_MISMATCH`       | Source does not belong to the canonical customer.                                                   | No external admission.                      |
| `BANK_NOT_FOUND`                  | Active authoritative bank directory has no matching code.                                           | No external admission.                      |
| `BANK_NOT_SUPPORTED`              | Bank is not marked active/NIP-supported.                                                            | No external admission.                      |
| `BANK_NOT_ACTIVE`                 | Bank directory status is not active.                                                                | No external admission.                      |
| `CONSENT_INVALID`                 | Consent is missing, mismatched, expired, future-dated, or wrong-purpose.                            | No external admission.                      |
| `TARGET_MAPPING_AMBIGUOUS`        | Multiple or insufficient target sources/identifiers were supplied.                                  | No external admission.                      |
| `TARGET_MAPPING_CONFLICT`         | Source institution, target, or version conflicts with the explicit mapping.                         | No remapping or external admission.         |
| `TARGET_SOURCE_UNAVAILABLE`       | Authoritative source could not be read.                                                             | Fail closed; no optimistic target use.      |
| `PARTNER_CAPABILITY_UNAVAILABLE`  | Selected A6 partner/capability is disabled or misconfigured.                                        | No external admission.                      |
| `OPERATIONS_EVIDENCE_UNAVAILABLE` | Required mapping audit could not be recorded.                                                       | No untraceable external admission.          |

## 12. Ownership and prohibited responsibilities

A6T04 owns only the consumer boundary and deterministic mapping handle. It may:

- normalize the command's safe IDs, currency, amount, bank code, versions, and context;
- request A2 authorization;
- consume A4 policy assertions;
- call A3 read-only binding validation;
- call funding-instrument, beneficiary, bank, and partner-profile read services;
- validate supported source type/status/verification/version/consent; and
- return a safe mapping result and Operations audit fact.

A6T04 must not:

- create or update a funding instrument, beneficiary, bank, consent, binding, wallet, LedgerAccount, transfer, withdrawal, deposit, operation, mapping row, or provider record;
- call a bank, NIBSS, provider, HTTP client, SDK, callback, status query, or statement reader;
- authenticate a provider or sign a provider request;
- post settlement, suspense, journal, line, or balance changes;
- evaluate A4 precedence or create an A4 policy;
- use a customer reference, alias, provider ID, destination name, bank name, or currency as canonical identity;
- store raw target values or credentials in audit/outbox/log/support output; or
- create a local duplicate/idempotency/reconciliation authority.

## 13. Handoff to later A6 tasks

- **A6T05:** binds the deterministic mapping handle to a durable external-operation, provider idempotency, provider-reference, and request-hash record.
- **A6T06:** validates provider callbacks and maps authenticated external events to the same target/operation without changing the source target.
- **A6T07:** retains the mapping across retries/timeouts/unknown outcomes and never selects a new target after ambiguity.
- **A6T08:** uses the explicit internal LedgerAccount and verified external outcome for settlement/suspense decisions.
- **A6T09:** independently reconciles target/source/operation/provider/settlement/journal evidence.
- **A6T10:** establishes authoritative consent/mandate, partner data-sharing, retention, legal-hold, and disclosure behavior.
- **A6T11:** includes target ownership, mapping, audit, and no-source-mutation evidence in the selected-flow release trace.

## 14. Verification record

- [x] Command and result shapes are versioned and provider-neutral.
- [x] Exactly one verified target source is required.
- [x] Customer beneficiary and funding-instrument ownership/status/version are read through authoritative services.
- [x] Bank status and NIP support are read through the authoritative BankService directory.
- [x] A2 authorization and A4 policy assertions remain separate from target verification and consent.
- [x] A3 validates the explicit internal CustomerWallet/binding/WalletAccount/LedgerAccount chain read-only.
- [x] NGN, `CUSTOMER_FUNDS`, and `BANK_ACCOUNT` constraints are explicit.
- [x] Consent is purpose-bound, customer-bound, target-bound, versioned, and time-bound.
- [x] Deterministic opaque target/mapping references prevent implicit target substitution and support duplicate/conflict detection.
- [x] Operations audit records safe mapping evidence without raw target values or secrets.
- [x] No provider communication, callback, settlement, financial execution, entity, migration, controller, route, or scheduler is introduced.
- [ ] A6T05 durable external-operation/idempotency mapping remains intentionally incomplete.
