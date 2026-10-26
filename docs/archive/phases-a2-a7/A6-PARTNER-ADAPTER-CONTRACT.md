# A6T02 — External Partner Adapter Contract

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T02 — External Partner Adapter Boundary and Provider Contract
- **Status:** Documentation and provider-neutral contract design; no runtime adapter implemented
- **Contract:** `ExternalPartnerAdapterContractV1`
- **Selected planning capability:** `external.wallet.withdrawal.settlement`
- **Selected planning rail:** `NIBSS_NIP` for one NGN outbound bank-account settlement flow
- **Application, database, API, migration, controller, route, scheduler, provider, credential, callback, settlement, and financial-runtime changes:** None

This document defines the stable provider-neutral adapter boundary for the selected A6 capability. It is a contract design artifact, not a TypeScript class, DTO, HTTP client, SDK wrapper, provider configuration, callback route, persistence model, or financial command.

## 1. Contract boundary

### 1.1 Purpose

The A6 adapter is an anti-corruption and isolation boundary between the internal command/lifecycle owners and one external partner capability:

```text
A2-protected internal command owner
  -> A4 policy result and A3 account/target evidence
  -> A6 external-operation boundary
  -> PartnerAdapterPort
  -> selected partner/rail transport
  <- provider-neutral normalized result/evidence/error
```

The adapter translates provider-specific transport and schema into a provider-neutral result. It does not decide whether a provider result is an internal financial outcome.

### 1.2 Normative language

- **MUST** means a required contract invariant.
- **MUST NOT** means a prohibited state, dependency, or interpretation.
- **SHOULD** means the default behavior unless a later approved partner contract documents a safer alternative.
- **MAY** means an optional field or capability that cannot weaken an invariant.
- **Later A6 task** means work assigned to A6T03-A6T11 and not implemented here.

### 1.3 Adapter port shape

The logical port is equivalent to:

```text
PartnerAdapterPort
  getCapabilities(request: CapabilityQueryV1)
    -> AdapterCapabilityResultV1

  execute(request: ExternalPartnerRequestV1)
    -> ExternalPartnerResultV1
```

The port is provider-neutral. A later runtime implementation may use an HTTP client, SDK, mTLS channel, message transport, or another approved mechanism, but that choice belongs to A6T03 and must remain behind this port.

The adapter port MUST NOT accept or return domain entity instances. It uses only versioned contract values, safe opaque references, normalized money, target references, correlation context, capability keys, and normalized evidence/error models.

### 1.4 Selected capability registry keys

The A6T01 planning selection is represented by these registry values:

```text
partnerKey:     NIBSS_NIP
capabilityKey:  external.wallet.withdrawal.settlement
operationType:  OUTBOUND_BANK_SETTLEMENT
currency:       NGN
accountingUnit: CUSTOMER_FUNDS
```

These are planning and contract identifiers. They are not evidence that a NIBSS endpoint, bank participant, credential, API version, or live provider connection exists.

## 2. Capability contract

### 2.1 Capability query

The adapter capability query is provider-neutral:

```text
CapabilityQueryV1 {
  contractName: "A6-EXTERNAL-PARTNER-ADAPTER"
  contractVersion: 1
  partnerKey: "NIBSS_NIP"
  capabilityKey: "external.wallet.withdrawal.settlement"
  operationType: "OUTBOUND_BANK_SETTLEMENT"
  currency: "NGN"
  accountingUnit: "CUSTOMER_FUNDS"
  requestedAt: RFC3339 UTC timestamp
  correlation: CorrelationContextV1
}
```

The adapter capability result is:

```text
AdapterCapabilityResultV1 {
  contractName: "A6-EXTERNAL-PARTNER-ADAPTER"
  contractVersion: 1
  partnerKey: string
  capabilityKey: string
  operationType: string
  supported: boolean
  adapterVersion: string
  partnerApiVersion: string | null
  supportedCurrencies: uppercase currency codes
  supportedTargetTypes: ["BANK_ACCOUNT"]
  supports: {
    submit: boolean
    statusQuery: boolean
    callback: boolean
    statementOrReport: boolean
  }
  availability: CONFIGURED | NOT_CONFIGURED | UNAVAILABLE | UNKNOWN
  safeReasonCode: string | null
  observedAt: RFC3339 UTC timestamp
  correlation: CorrelationContextV1
}
```

`supports.callback` and `supports.statementOrReport` describe an interface capability only. They do not implement callback ingestion or report reconciliation in A6T02.

### 2.2 Capability rules

- A capability MUST be explicitly registered by `partnerKey`, `capabilityKey`, `operationType`, currency, target type, and contract version.
- Unsupported capability, currency, target type, or operation type MUST return a deterministic non-success capability result.
- A generic adapter MUST NOT silently route an unsupported capability to another partner, rail, currency, or operation type.
- The provider API version MUST remain adapter-owned. It MUST NOT replace `contractVersion`.
- Capability discovery MUST NOT authorize a command, select an internal account, approve a funding instrument, or post settlement.
- Capability availability MUST NOT be treated as provider health, settlement finality, or production approval.

## 3. Normalized external request contract

### 3.1 Request envelope

The logical normalized request is equivalent to:

```text
ExternalPartnerRequestV1 {
  contractName: "A6-EXTERNAL-PARTNER-ADAPTER"
  contractVersion: 1

  partnerKey: "NIBSS_NIP"
  capabilityKey: "external.wallet.withdrawal.settlement"
  operationType: "OUTBOUND_BANK_SETTLEMENT"
  capabilityVersion: string

  internalResource: {
    resourceType: "WITHDRAWAL"
    resourceId: UUID
    internalCommandId: UUID | null
    externalOperationId: UUID | null
  }

  internalContext: {
    customerId: canonical Customer.id UUID
    walletAccountId: explicit WalletAccount.id UUID
    ledgerAccountId: explicit LedgerAccount.id UUID
    bindingId: explicit A3 binding UUID | null
    policyDecisionReference: safe A4 reference | null
    authorizationContextReference: safe A2 reference | null
  }

  money: {
    amountMinor: canonical decimal digit string
    currency: uppercase three-letter code
    accountingUnit: "CUSTOMER_FUNDS"
  }

  target: ExternalTargetReferenceV1

  idempotency: {
    internalScope: bounded Operations/A6 scope
    internalKey: opaque bounded key
    providerScope: partner-scoped provider idempotency scope | null
    providerKey: opaque provider key | null
    requestHash: lowercase SHA-256 hex
  }

  correlation: CorrelationContextV1
  transport: {
    profileReference: safe A6T03 configuration reference
    deadlineAt: RFC3339 UTC timestamp | null
  }

  requestedAt: RFC3339 UTC timestamp
}
```

The `internalContext` values are safe references for internal correlation and validation. They MUST NOT be copied wholesale into provider payloads, logs, outbox facts, or support output. A later A6 task determines the minimum provider-facing projection.

`externalOperationId`, provider idempotency, and durable request-hash ownership are included as contract references because later A6T05 must bind them. A6T02 does not create or persist them.

### 3.2 Money invariants

- `amountMinor` MUST be a positive base-10 integer string.
- Floating-point, exponent, signed, fractional, zero, negative, and locale-formatted values MUST be rejected.
- `currency` MUST be explicit and uppercase.
- The selected A6T01 capability accepts only `NGN` until a later capability decision changes the boundary.
- `accountingUnit` MUST be `CUSTOMER_FUNDS` for the selected planning flow.
- The adapter MUST NOT perform FX, conversion, rounding, fee, commission, tax, or hidden second-effect calculations.
- The adapter MUST treat an echoed amount/currency/accounting-unit mismatch as a normalized contract or provider-evidence failure, never as a value to correct implicitly.

### 3.3 External target reference

The provider-neutral target shape is:

```text
ExternalTargetReferenceV1 {
  targetType: "BANK_ACCOUNT"
  institutionCode: normalized bank/institution code
  targetReference: approved tokenized or provider-safe target reference
  targetReferenceType: CUSTOMER_BENEFICIARY | FUNDING_INSTRUMENT | APPROVED_EXTERNAL_TARGET
  targetVersion: positive integer | null
  targetCurrency: uppercase currency code | null
  verificationReference: safe verification reference | null
}
```

Rules:

- `targetReference` is an opaque, bounded reference to an A6T04-approved target. It is not automatically a raw bank-account credential and is not canonical customer identity.
- The adapter MUST NOT infer a target from `Customer.id`, WalletAccount, currency, bank directory search, display name, alias, or provider response.
- The adapter MUST NOT decide ownership, verification, consent, mandate, or target lifecycle. A6T04 and the source modules provide those preconditions.
- The adapter MUST NOT store or log raw account passwords, PINs, OTPs, CVVs, card secrets, callback secrets, signing keys, or unapproved raw funding data.
- Whether a selected partner requires a reversible token, encrypted target, or provider-safe account field belongs to A6T03/A6T04/A6T10. The generic contract does not prescribe a transport credential format.

### 3.4 Internal context separation

The request may carry safe references to the following internal authorities:

| Reference                       | Owner                | Adapter use                                          | Adapter must not do                                       |
| ------------------------------- | -------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `customerId`                    | Customer             | Correlation and evidence scope.                      | Authenticate, authorize, or change Customer.              |
| `walletAccountId`               | Wallet               | Correlation and expected internal account context.   | Select a different wallet or read/write balance.          |
| `ledgerAccountId`               | Ledger               | Correlation and settlement verification context.     | Post a journal or treat external outcome as Ledger truth. |
| `bindingId`                     | A3                   | Correlation to explicit internal ownership evidence. | Repair, reassign, or infer a binding.                     |
| `policyDecisionReference`       | A4                   | Correlation to the consumer's policy result.         | Evaluate policy or treat policy as authorization.         |
| `authorizationContextReference` | A2                   | Safe access-context reference.                       | Authenticate or issue authorization.                      |
| `internalResource.resourceId`   | A5/payment lifecycle | Correlate the selected Withdrawal/resource.          | Rewrite lifecycle or create a second resource.            |

## 4. Correlation and trace contract

### 4.1 Internal correlation context

```text
CorrelationContextV1 {
  requestId: bounded request-attempt identifier
  correlationId: bounded workflow/evidence-chain identifier
  traceId: bounded observability identifier | null
  causationId: parent command/event identifier | null
  commandId: logical internal command identifier | null
  resourceId: internal Withdrawal/Deposit/Transfer/resource UUID | null
  externalOperationId: A6 external-operation UUID | null
  requestedAt: RFC3339 UTC timestamp
}
```

The adapter MUST preserve values it receives and MUST NOT generate a new logical command or external-operation identity as a retry side effect. A transport attempt may have an adapter-local attempt marker, but it is observational and cannot replace `commandId`, `externalOperationId`, or `correlationId`.

### 4.2 Provider trace references

Provider trace values are represented separately:

```text
ProviderReferenceV1 {
  partnerKey: registered partner key
  referenceType:
    REQUEST
    OPERATION
    TRANSACTION
    SETTLEMENT
    CALLBACK
    STATEMENT_ROW
    PROVIDER_IDEMPOTENCY
  value: opaque bounded provider value
  namespace: partner/provider namespace
  observedAt: RFC3339 UTC timestamp
  source: ACKNOWLEDGEMENT | STATUS_QUERY | CALLBACK | STATEMENT | REPORT
}
```

Provider references MUST:

- retain their partner and reference-type namespace;
- be compared as opaque values after safe normalization only;
- remain distinct from internal Customer, Wallet, Ledger, command, lifecycle, audit, outbox, and reconciliation IDs;
- be correlated with the expected partner, capability, operation, amount, currency, target, and internal resource before a later lifecycle transition; and
- never be treated as proof of settlement without the later A6T08/A6T09 evidence boundary.

### 4.3 Trace and evidence references

The result may carry safe adapter evidence:

```text
AdapterEvidenceReferenceV1 {
  adapterVersion: bounded adapter version
  contractVersion: positive integer
  partnerApiVersion: bounded provider API version | null
  responseHash: lowercase SHA-256 hex | null
  providerPayloadReference: safe restricted reference | null
  observedAt: RFC3339 UTC timestamp
  source: ACKNOWLEDGEMENT | STATUS_QUERY | CALLBACK | STATEMENT | REPORT
}
```

`providerPayloadReference` is a reference to a restricted evidence store owned by a later task, not a requirement to create that store in A6T02. Raw provider payloads MUST NOT be returned in the generic contract by default.

## 5. Normalized provider result contract

### 5.1 Result envelope

```text
ExternalPartnerResultV1 {
  contractName: "A6-EXTERNAL-PARTNER-ADAPTER"
  contractVersion: 1

  adapter: {
    adapterKey: bounded registered key
    adapterVersion: bounded version
    partnerKey: registered partner key
    partnerApiVersion: string | null
    capabilityKey: registered capability key
    capabilityVersion: string
  }

  outcome:
    ACCEPTED
    REJECTED
    PENDING
    UNKNOWN
    NOT_SUPPORTED

  financialPosture:
    NOT_ESTABLISHED
    EXTERNAL_ACCEPTED_NOT_SETTLED
    EXTERNAL_REJECTED_NO_EFFECT_ESTABLISHED
    EXTERNAL_OUTCOME_UNKNOWN
    REQUIRES_RECONCILIATION

  providerReferences: ProviderReferenceV1[]
  echoed: {
    amountMinor: canonical decimal digit string | null
    currency: uppercase currency code | null
    targetReference: safe opaque reference | null
  }

  evidence: AdapterEvidenceReferenceV1 | null
  correlation: CorrelationContextV1
  retry: RetryClassificationV1
  error: ExternalPartnerErrorV1 | null
  observedAt: RFC3339 UTC timestamp
}
```

### 5.2 Result semantics

| Outcome         | Meaning                                                                                                | Financial posture                                            | Required later handling                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `ACCEPTED`      | The provider acknowledged or accepted the request for processing according to its contract.            | `EXTERNAL_ACCEPTED_NOT_SETTLED`                              | Await verified callback/status/report; do not post settlement solely from this result. |
| `REJECTED`      | The provider explicitly rejected the request and the contract establishes no accepted external effect. | `EXTERNAL_REJECTED_NO_EFFECT_ESTABLISHED`                    | Record controlled non-success if the rejection is safe and complete.                   |
| `PENDING`       | The provider reports processing or the result requires later evidence.                                 | `EXTERNAL_ACCEPTED_NOT_SETTLED` or `REQUIRES_RECONCILIATION` | Keep external operation pending; do not submit a new identity.                         |
| `UNKNOWN`       | Send/commit/response state cannot establish whether the provider accepted the request.                 | `EXTERNAL_OUTCOME_UNKNOWN`                                   | Verify through status/callback/report/reconciliation; no blind retry or settlement.    |
| `NOT_SUPPORTED` | The selected adapter/capability/version cannot perform the requested operation.                        | `NOT_ESTABLISHED`                                            | Fail closed before provider execution where possible.                                  |

A normalized result MUST NOT contain `COMPLETED`, `SETTLED`, `BALANCE_UPDATED`, or another internal financial success state. Those outcomes belong to later A6 lifecycle/settlement boundaries.

### 5.3 Echo validation

If a provider echoes amount, currency, target, operation, or customer-facing reference, the adapter MUST preserve the safe echo and identify mismatches. It MUST NOT silently normalize an echo into the request. An echo mismatch produces a normalized error or reconciliation-required posture.

## 6. Error vocabulary and normalization

### 6.1 Normalized error shape

```text
ExternalPartnerErrorV1 {
  code: ExternalPartnerErrorCode
  category: ErrorCategory
  safeMessage: bounded non-sensitive message
  providerCode: bounded safe provider code | null
  providerReference: ProviderReferenceV1 | null
  retryDirective: RetryDirective
  effectPosture: EffectPosture
  occurredAt: RFC3339 UTC timestamp
  correlation: CorrelationContextV1
}
```

The adapter MUST NOT copy raw provider exception text, stack traces, credentials, signatures, full response bodies, or sensitive target data into `safeMessage`.

### 6.2 Error codes

| Code                                    | Category           | Meaning                                                                                    | Effect posture                                                | Default directive                                        |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------- |
| `ADAPTER_CONTRACT_INVALID`              | Contract           | Request envelope, version, required field, or invariant is invalid.                        | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `DO_NOT_RETRY`                                           |
| `CAPABILITY_UNSUPPORTED`                | Capability         | Partner/adapter does not support the requested capability, target, currency, or version.   | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `DO_NOT_RETRY`                                           |
| `PARTNER_NOT_CONFIGURED`                | Configuration      | The selected partner/capability/profile is not configured.                                 | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `DO_NOT_RETRY`                                           |
| `PARTNER_UNAVAILABLE`                   | Transport          | Provider endpoint or adapter transport is unavailable before send status is known.         | `EXTERNAL_EFFECT_UNKNOWN`                                     | `VERIFY_THEN_DECIDE` or `RETRY_SAME_OPERATION`           |
| `TIMEOUT_BEFORE_SEND`                   | Transport          | Deadline elapsed before the adapter could send a request.                                  | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `RETRY_SAME_OPERATION` only under later A6T07 rules      |
| `TIMEOUT_AFTER_SEND_UNKNOWN`            | Transport          | Deadline elapsed after a request may have been sent.                                       | `EXTERNAL_EFFECT_UNKNOWN`                                     | `VERIFY_THEN_DECIDE`                                     |
| `PROVIDER_AUTHENTICATION_FAILED`        | Security           | Provider transport authentication failed.                                                  | `NO_EXTERNAL_EFFECT_ESTABLISHED` or `EXTERNAL_EFFECT_UNKNOWN` | `DO_NOT_RETRY`                                           |
| `PROVIDER_RESPONSE_AUTHENTICITY_FAILED` | Security           | Response authenticity could not be verified.                                               | `EXTERNAL_EFFECT_UNKNOWN`                                     | `DO_NOT_RETRY`                                           |
| `PROVIDER_RESPONSE_INVALID`             | Contract           | Provider response cannot be safely parsed or mapped.                                       | `EXTERNAL_EFFECT_UNKNOWN`                                     | `VERIFY_THEN_DECIDE`                                     |
| `PROVIDER_VERSION_UNSUPPORTED`          | Contract           | Provider API/protocol version is incompatible with the adapter mapping.                    | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `DO_NOT_RETRY`                                           |
| `PROVIDER_REJECTED`                     | Provider           | Provider explicitly rejected the operation.                                                | `NO_EXTERNAL_EFFECT_ESTABLISHED` only when guaranteed         | `DO_NOT_RETRY`                                           |
| `PROVIDER_PENDING`                      | Provider           | Provider accepted or is processing but has not reached finality.                           | `EXTERNAL_EFFECT_NOT_SETTLED`                                 | `WAIT_FOR_EXTERNAL_EVIDENCE`                             |
| `PROVIDER_DUPLICATE`                    | Provider           | Provider reports a duplicate or existing operation for the supplied idempotency/reference. | `EXTERNAL_EFFECT_UNKNOWN` or `EXTERNAL_EFFECT_NOT_SETTLED`    | `VERIFY_THEN_DECIDE`                                     |
| `RATE_LIMITED`                          | Provider/Transport | Provider rate limit prevents or delays the request.                                        | `NO_EXTERNAL_EFFECT_ESTABLISHED` or `EXTERNAL_EFFECT_UNKNOWN` | `RETRY_SAME_OPERATION` or `OPEN_PARTNER_CIRCUIT`         |
| `TARGET_INVALID`                        | Validation         | External target is invalid or incompatible with the selected capability.                   | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `DO_NOT_RETRY`                                           |
| `CURRENCY_UNSUPPORTED`                  | Validation         | Partner or target does not support the requested currency.                                 | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `DO_NOT_RETRY`                                           |
| `AMOUNT_UNSUPPORTED`                    | Validation         | Amount is outside the adapter/partner contract range.                                      | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `DO_NOT_RETRY`                                           |
| `REFERENCE_CONFLICT`                    | Correlation        | Provider reference does not match the expected partner/operation/context.                  | `EXTERNAL_EFFECT_UNKNOWN`                                     | `ROUTE_TO_MANUAL_REVIEW`                                 |
| `PARTNER_EVIDENCE_UNAVAILABLE`          | Evidence           | Required provider status/callback/report evidence cannot be obtained.                      | `EXTERNAL_EFFECT_UNKNOWN`                                     | `WAIT_FOR_EXTERNAL_EVIDENCE` or `ROUTE_TO_MANUAL_REVIEW` |
| `CIRCUIT_OPEN`                          | Availability       | Later partner-isolation logic has stopped new attempts.                                    | `NO_EXTERNAL_EFFECT_ESTABLISHED`                              | `OPEN_PARTNER_CIRCUIT`                                   |
| `ADAPTER_INTERNAL_FAILURE`              | Adapter            | The adapter cannot produce a trustworthy normalized result.                                | `EXTERNAL_EFFECT_UNKNOWN`                                     | `VERIFY_THEN_DECIDE`                                     |
| `MANUAL_REVIEW_REQUIRED`                | Recovery           | Automated classification cannot safely resolve the operation.                              | `EXTERNAL_EFFECT_UNKNOWN`                                     | `ROUTE_TO_MANUAL_REVIEW`                                 |

### 6.3 Error categories

```text
VALIDATION
CAPABILITY
CONFIGURATION
TRANSPORT
SECURITY
CONTRACT
PROVIDER
CORRELATION
EVIDENCE
RECOVERY
```

Provider-specific error codes MAY be preserved in `providerCode` when safe, but the normalized `code`, category, effect posture, and retry directive remain authoritative for internal consumers.

## 7. Timeout, retry, and error classification contract

### 7.1 Interface-level retry classification

```text
RetryClassificationV1 {
  retryable: boolean
  directive:
    DO_NOT_RETRY
    RETRY_SAME_OPERATION
    VERIFY_THEN_DECIDE
    WAIT_FOR_EXTERNAL_EVIDENCE
    ROUTE_TO_MANUAL_REVIEW
    OPEN_PARTNER_CIRCUIT
  sendState: NOT_ATTEMPTED | SENT | UNKNOWN
  retryAfterSeconds: positive integer | null
  reasonCode: ExternalPartnerErrorCode | null
}
```

This structure communicates a safe posture. It does not schedule, sleep, submit, query status, open a circuit, or mutate any record.

### 7.2 Required classification rules

| Condition                                                           | `sendState`         | Required normalized classification                                                 | New operation allowed?                                   |
| ------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Contract/target/currency validation failed before adapter transport | `NOT_ATTEMPTED`     | `ADAPTER_CONTRACT_INVALID`, `TARGET_INVALID`, or `CURRENCY_UNSUPPORTED`            | No; correct the same command through its owner.          |
| Configuration/capability unavailable before send                    | `NOT_ATTEMPTED`     | `PARTNER_NOT_CONFIGURED`, `CAPABILITY_UNSUPPORTED`, or `CIRCUIT_OPEN`              | No; wait for controlled configuration/release decision.  |
| Known transient failure before send                                 | `NOT_ATTEMPTED`     | `PARTNER_UNAVAILABLE` or `TIMEOUT_BEFORE_SEND`                                     | Only the same logical operation under later A6T07 rules. |
| Request may have been sent, no trustworthy response                 | `UNKNOWN`           | `TIMEOUT_AFTER_SEND_UNKNOWN`, `PARTNER_UNAVAILABLE`, or `ADAPTER_INTERNAL_FAILURE` | No; verify same operation first.                         |
| Provider explicitly accepted request                                | `SENT`              | `ACCEPTED`/`PROVIDER_PENDING`, not settlement success                              | No second submission; await external evidence.           |
| Provider explicitly rejected with guaranteed no-effect semantics    | `SENT`              | `PROVIDER_REJECTED`                                                                | No; record safe non-success.                             |
| Provider reference/correlation mismatch                             | `SENT` or `UNKNOWN` | `REFERENCE_CONFLICT`                                                               | No; manual review/reconciliation.                        |
| Provider response cannot be authenticated or parsed                 | `SENT` or `UNKNOWN` | Security/contract failure                                                          | No; preserve evidence and investigate.                   |

A new provider idempotency key or new external-operation identity MUST NOT be generated merely because a request timed out or returned an unknown result.

### 7.3 Deadline rules

- `deadlineAt` is an execution constraint, not a financial outcome.
- An expired deadline before send may produce `TIMEOUT_BEFORE_SEND`.
- An expired deadline after send or when send status is unknown MUST produce an unknown posture.
- The adapter MUST preserve the original correlation and operation references across a later verification attempt.
- A provider status query, callback, statement, or reconciliation check is a separate interface call/evidence path; A6T02 does not implement it.

## 8. Provider-neutral response mapping

The adapter maps provider-specific values to normalized values using a versioned mapping table owned by the adapter contract:

| Provider-specific concern          | Normalized A6 representation                                        | Mapping rule                                                              |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Provider operation/request ID      | `ProviderReferenceV1` with `referenceType = OPERATION` or `REQUEST` | Preserve partner namespace and value; never use as internal operation ID. |
| Provider transaction/settlement ID | `ProviderReferenceV1` with `TRANSACTION` or `SETTLEMENT`            | Accept only with expected operation/capability/context.                   |
| Provider callback ID               | `ProviderReferenceV1` with `CALLBACK`                               | Deduplication identity later belongs to A6T06.                            |
| Provider status                    | `outcome`, `financialPosture`, and safe error/result fields         | Unknown/unmapped critical status fails closed or becomes `UNKNOWN`.       |
| Provider amount/currency echo      | `echoed` values                                                     | Mismatch is explicit evidence failure, not silent conversion.             |
| Provider idempotency result        | `ProviderReferenceV1` plus later idempotency evidence               | Must remain distinct from internal Operations idempotency.                |
| Provider retry-after               | `retryAfterSeconds`                                                 | Bounded advisory metadata; later A6T07 owns retry policy.                 |
| Provider raw message               | Safe `providerCode`/`safeMessage` only                              | Raw message/body is not part of generic output by default.                |
| Provider callback/report row       | Evidence source marker                                              | Callback/report ingestion and reconciliation belong to later tasks.       |

## 9. Adapter ownership and prohibited dependencies

### 9.1 Adapter may read/carry

The adapter may receive:

- registered partner/capability/version keys;
- normalized amount, currency, and accounting unit;
- a provider-safe target reference;
- safe internal resource and operation references;
- A2/A3/A4 references as opaque correlation values;
- provider/internal idempotency references prepared by the later operation boundary;
- request/correlation/trace/causation context;
- a transport-profile reference; and
- a bounded deadline.

### 9.2 Adapter must not import or call

The adapter contract MUST remain independent of:

```text
Customer / CustomerService
CustomerWallet / CustomerWalletService
WalletAccount / WalletService
LedgerAccount / LedgerService / LedgerJournal / LedgerLine
AuthorizationService / A2 principal or authorization decision evaluator
A3 binding/read/repair services
A4 policy evaluator/evidence coordinator/source readers
Transfer / Deposit / Withdrawal entities or lifecycle services
AuditEvent / IdempotencyRecord / OutboxEvent repositories
ReconciliationService / diagnostics / readiness writers
```

A future implementation may receive ports or safe references supplied by the composition layer, but it must not use them to select accounts, authorize a request, calculate policy, mutate source data, post value, or repair a discrepancy.

### 9.3 Responsibility matrix

| Responsibility                             | Owner                          | Adapter behavior                                                         |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------ |
| Principal authentication/authorization     | A2                             | Receive safe context reference only; never authorize.                    |
| Capability policy/risk/limits/obligations  | A4                             | Receive safe policy reference only; never evaluate or mutate policy.     |
| Internal account ownership/binding         | A3                             | Receive explicit safe account/target assertions; never select or repair. |
| Internal withdrawal/command lifecycle      | A5/payment lifecycle           | Correlate resource IDs; never transition or complete the resource.       |
| External transport/protocol mapping        | A6 adapter                     | Own provider-neutral translation and normalized result/error.            |
| External operation persistence/idempotency | A6T05 + Operations             | Carry references; do not create local storage in the adapter.            |
| Callback authenticity and receipt          | A6T06 under A2                 | Return/consume contract values only; no callback processing in T02.      |
| Retry/circuit/unknown recovery             | A6T07 + Operations             | Classify posture; do not execute retry/recovery.                         |
| Settlement/suspense/journal                | A6T08 + Ledger/Finance         | Never post or clear financial value.                                     |
| Reconciliation/support                     | A6T09 + Reconciliation/Finance | Provide safe references; never repair or authorize.                      |
| Data minimization/consent/secrets          | A6T10 + A1/A2                  | Use only safe fields/references; no secrets in contract output.          |

## 10. Versioning and compatibility rules

### 10.1 Contract versions

- `contractVersion = 1` defines this request/result/error vocabulary.
- A patch revision may clarify documentation without changing field meaning.
- A minor revision may add optional fields or optional capability metadata only when existing consumers remain behaviorally compatible.
- A major revision is required for required fields, enum changes, identity semantics, money semantics, error posture, retry posture, or financial-posture changes.
- Every result identifies the contract version and adapter version that produced it.
- Historical evidence MUST remain interpretable under the version that produced it.

### 10.2 Partner API versions

- `partnerApiVersion` is adapter-owned metadata.
- A provider API version MUST be mapped to the normalized contract before consumers see it.
- A provider API upgrade that changes request meaning, response status, reference semantics, amount/currency behavior, authentication, or callback semantics requires a separately reviewed adapter mapping and compatibility tests.
- Unsupported provider versions return `PROVIDER_VERSION_UNSUPPORTED`; they do not fall back silently.

### 10.3 Unknown fields and enum values

- Unknown non-critical response fields MAY be ignored after safe schema validation.
- Unknown fields that affect identity, amount, currency, status, reference, authenticity, or financial posture MUST fail closed or enter `UNKNOWN`/manual review.
- New normalized enum values cannot be treated as an existing value by string similarity or default branching.
- Missing required references, mismatched contract names, invalid hashes, malformed timestamps, and invalid money values are contract failures.

## 11. Data safety and evidence minimization

- Generic request/result payloads MUST contain only minimum fields needed by the adapter boundary.
- Raw credentials, account passwords, PAN/CVV/PIN/OTP, private keys, callback signatures, access tokens, refresh tokens, raw risk/compliance notes, and unnecessary identity documents MUST NOT appear in the contract.
- Provider payloads, where later retained, require a restricted evidence reference and hash rather than copying raw content into broad audit/outbox/support records.
- `Customer.id`, WalletAccount, LedgerAccount, internal resource IDs, provider references, and correlation IDs are restricted operational/financial references, not general log fields.
- The adapter MUST preserve enough safe reference and hash data for later Operations, support, settlement, and reconciliation without becoming a source authority.
- Consent/mandate, funding-instrument verification, target ownership, and A2/A4 decisions are preconditions owned by later boundaries; the adapter does not infer them from provider fields.

## 12. Contract scenarios

### 12.1 Unsupported capability before send

```text
request: capabilityKey = external.wallet.withdrawal.settlement
adapter: capability not configured
result:
  outcome = NOT_SUPPORTED
  financialPosture = NOT_ESTABLISHED
  error.code = CAPABILITY_UNSUPPORTED
  retry.directive = DO_NOT_RETRY
  sendState = NOT_ATTEMPTED
```

No provider call, financial mutation, or new operation identity is implied.

### 12.2 Provider accepted request

```text
provider acknowledgement: accepted
result:
  outcome = ACCEPTED
  financialPosture = EXTERNAL_ACCEPTED_NOT_SETTLED
  providerReferences = [REQUEST/OPERATION reference]
  error = null
  retry.directive = WAIT_FOR_EXTERNAL_EVIDENCE
```

The result is not `SETTLED`, does not complete a Withdrawal, and does not permit a Ledger post by itself.

### 12.3 Timeout after possible send

```text
transport: deadline elapsed after send status became uncertain
result:
  outcome = UNKNOWN
  financialPosture = EXTERNAL_OUTCOME_UNKNOWN
  error.code = TIMEOUT_AFTER_SEND_UNKNOWN
  retry.directive = VERIFY_THEN_DECIDE
  sendState = UNKNOWN
```

The same logical external operation must be verified later. A new provider key, target, journal, or internal operation is not authorized by this result.

### 12.4 Explicit provider rejection

```text
provider response: rejected with contract-guaranteed no-effect code
result:
  outcome = REJECTED
  financialPosture = EXTERNAL_REJECTED_NO_EFFECT_ESTABLISHED
  error.code = PROVIDER_REJECTED
  retry.directive = DO_NOT_RETRY
```

If the provider contract cannot guarantee that no effect occurred, the adapter must use an unknown posture instead.

### 12.5 Invalid response authenticity or schema

```text
response: signature/schema/reference cannot be verified
result:
  outcome = UNKNOWN
  financialPosture = EXTERNAL_OUTCOME_UNKNOWN
  error.code = PROVIDER_RESPONSE_AUTHENTICITY_FAILED or PROVIDER_RESPONSE_INVALID
  retry.directive = DO_NOT_RETRY or ROUTE_TO_MANUAL_REVIEW
```

The adapter does not accept the response as provider truth and does not post or mutate financial state.

## 13. Handoff to later A6 tasks

This contract is consumed later as follows:

- **A6T03:** supplies transport profile, endpoint, credential/signing, environment, and partner configuration behind `transport.profileReference`; it must not change normalized semantics silently.
- **A6T04:** supplies the verified target/funding-instrument reference and ownership/consent preconditions; it must not pass raw credentials by default.
- **A6T05:** owns durable external-operation identity, provider idempotency, reference uniqueness, request-hash persistence, and internal Operations linkage.
- **A6T06:** owns callback authentication, replay protection, callback receipt, and inbound provider evidence handling.
- **A6T07:** owns lifecycle state, bounded retry, provider status verification, circuit breaking, timeout, and unknown-outcome recovery.
- **A6T08:** owns verified settlement, suspense, Ledger posting, exception ownership, and compensating-entry boundaries.
- **A6T09:** owns independent provider/internal reconciliation, statement/report evidence, discrepancy classification, and support trace.
- **A6T10:** owns data mapping, consent/mandate, secret handling, retention, legal hold, and partner disclosure controls.
- **A6T11:** owns selected-flow integration, certification, release, disable, rollback, and A7 handoff evidence.

No later task may weaken the provider-neutral identity, error, timeout, version, or authority boundaries defined here.

## 14. Verification record

- [x] `ExternalPartnerAdapterContractV1` is defined as a provider-neutral interface design.
- [x] Selected partner/capability/operation/currency keys are explicit without claiming a live provider connection.
- [x] Normalized request, result, capability, target, money, evidence, and correlation models are defined.
- [x] Canonical internal IDs and partner/provider references remain distinct and namespace-scoped.
- [x] Provider-neutral error vocabulary, safe messages, effect posture, and retry directives are defined.
- [x] Timeout before send, timeout after possible send, explicit rejection, acceptance-not-settled, pending, and unknown outcomes are distinct.
- [x] Contract, adapter, and partner API version compatibility rules are explicit.
- [x] Adapter responsibilities and prohibited dependencies are explicit.
- [x] Wallet, Ledger, A2, A3, A4, A5, Operations, Outbox, and Reconciliation remain outside adapter authority.
- [x] Data minimization and raw-secret exclusion rules are explicit.
- [x] No runtime adapter, provider client, callback, persistence, controller, route, API, scheduler, credential, settlement, or financial behavior is introduced.
- [ ] A6T03 connection, credential, signing, and environment implementation remains intentionally incomplete.
