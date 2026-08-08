# ADR-0047: External Partner Adapter Boundary

- **Status:** Proposed A6 implementation decision; A6T02 contract design only, no external integration
- **Date:** 2026-08-08
- **Scope:** Provider-neutral adapter isolation, normalized partner request/result contracts, external references, correlation, error normalization, versioning, and interface-level timeout/retry classification
- **Task:** A6T02 — External Partner Adapter Boundary and Provider Contract
- **Selected A6 planning capability:** NGN customer-wallet settlement to a Nigerian bank account through the selected NIBSS/NIP planning rail
- **Implementation status:** Documentation and contract artifacts added; no adapter, provider client, callback, persistence, route, credential, scheduler, settlement, or financial behavior added

## Context

A6T01 established the first bounded A6 planning capability:

```text
external.wallet.withdrawal.settlement
internal customer-funds wallet -> external Nigerian bank account
NGN
selected planning rail: NIBSS/NIP through an isolated adapter
```

The current repository has local bank-directory metadata, customer-owned beneficiary and funding-instrument metadata, internal Withdrawal/Deposit/Transfer lifecycles, Ledger settlement-account lookup, A2 authorization, A3 account binding, A4 policy, A5 internal command/recovery, Operations, Outbox, and independent Reconciliation. It has no external provider adapter, provider client, callback processor, provider reference mapping, or external-operation record.

A6 must not allow provider-specific transport or response semantics to leak into Customer, Wallet, Ledger, A2, A3, A4, A5, Operations, or Reconciliation. A provider acknowledgement, external reference, callback, statement, or outbox fact is not financial truth. The adapter must be a translation and isolation boundary, not a financial command authority.

## Decision

### 1. One explicit adapter boundary

A6 introduces one provider-neutral adapter port for the selected capability. The port is an internal contract, not a route and not a provider SDK surface:

```text
A6 command owner
  -> PartnerAdapterPort.execute(request: ExternalPartnerRequestV1)
  <- ExternalPartnerResultV1 or normalized ExternalPartnerErrorV1
```

The adapter port:

- accepts provider-neutral, normalized request data and safe internal correlation references;
- maps the normalized request to the selected partner's transport/protocol in a later task;
- returns a provider-neutral normalized result, reference set, evidence metadata, and error classification;
- exposes partner capability/version support through an explicit contract;
- does not receive Customer, WalletAccount, LedgerAccount, Transfer, Withdrawal, A2, A3, A4, or Operations entity instances;
- does not write a database, Ledger journal, balance, audit row, idempotency record, outbox row, policy record, binding, funding-instrument record, or reconciliation record; and
- does not decide whether an external response is settled financial value.

The adapter boundary is the only A6T02-approved place where later partner-specific request/response mapping may be attached. A6T03 owns connection, credential, signing, environment, and transport implementation. A6T05-A6T09 own external-operation persistence, callback, lifecycle, settlement, reconciliation, and recovery behavior.

### 2. Provider-neutral contract version

The contract is named:

```text
ExternalPartnerAdapterContractV1
```

The request and result envelopes carry:

```text
contractName: "A6-EXTERNAL-PARTNER-ADAPTER"
contractVersion: 1
```

The adapter contract version is distinct from:

- the partner API/protocol version;
- the adapter implementation version;
- the external-operation lifecycle version;
- the provider idempotency scope/key;
- the internal command or financial lifecycle version; and
- the provider's own transaction/reference version.

A partner API version is mapped inside the adapter boundary and is not silently exposed as the A6 contract version. A later adapter may support more than one partner API version only when each mapping is explicit and its normalized semantics remain equivalent.

### 3. Normalized request and result boundary

A6T02 defines the shape and invariants of the normalized request/result. It does not implement a TypeScript class, DTO, HTTP client, persistence record, callback controller, or provider integration.

The request contains:

- the selected partner and capability registry keys;
- one internal operation/resource reference and safe internal correlation context;
- explicit `amountMinor`, `currency`, and `accountingUnit`;
- a provider-safe, normalized external target reference;
- a distinct provider idempotency reference supplied by the later A6 operation boundary;
- a canonical request hash reference;
- a safe transport-profile reference for later A6T03 configuration; and
- a deadline/timeout classification that does not imply success or failure.

The result contains:

- contract and adapter capability/version metadata;
- normalized provider outcome, not a Ledger or customer outcome;
- provider reference values in an explicit partner namespace;
- provider echo fields and evidence hashes where safe and available;
- internal/provider correlation references;
- normalized error and retry classification where applicable; and
- an explicit financial posture such as `NOT_ESTABLISHED`, `PENDING_EXTERNAL_EVIDENCE`, or `EXTERNAL_ACCEPTED_NOT_SETTLED`.

A result of `ACCEPTED` means only that the provider accepted or acknowledged the request according to the adapter contract. It does not mean that the external bank account was credited, that settlement is final, or that Ledger may post.

### 4. Identity, reference, and correlation rules

The following identities remain distinct:

```text
Customer.id
WalletAccount.id
LedgerAccount.id
internal command ID
Withdrawal/Deposit/Transfer ID
A6 external-operation ID
internal idempotency scope/key/request hash
provider idempotency key
partner/provider request reference
partner/provider operation reference
partner/provider transaction/reference ID
callback event ID
statement/report row reference
settlement ID
Ledger journal ID
Operations audit event ID
Operations outbox event ID
Reconciliation discrepancy ID
```

The adapter may carry safe references to these values for correlation, but it must not use one owner's identifier as another owner's authority. Provider references are always scoped by partner, reference type, and operation context.

### 5. Provider-neutral capability boundary

The adapter may own:

- provider-specific protocol and field mapping;
- partner capability/version discovery or configured capability selection;
- provider request/response schema translation;
- provider transport error normalization;
- provider reference extraction and namespace preservation;
- provider acknowledgement/status semantics as normalized evidence; and
- interface-level retry/timeout classification.

The adapter must not own:

- A2 authentication, authorization, session, MFA, route protection, or privileged approval;
- A3 account binding, customer/account ownership, binding repair, or internal account selection;
- A4 eligibility, risk, restriction, compliance, limit, or policy precedence;
- A5 command admission, pilot cohort, internal transfer/withdrawal lifecycle, or financial idempotency authority;
- Wallet balances, Ledger accounts, journals, lines, posted value, settlement, suspense, reversal, or correction;
- Operations audit, idempotency, outbox, metrics, diagnostics, readiness, or request-context persistence;
- callback authenticity processing or callback lifecycle mutation;
- external reconciliation, statement ownership, discrepancy repair, or support authorization; or
- customer notifications, public API behavior, product activation, or provider marketplace routing.

### 6. Normalized error and outcome classification

A provider-specific error must be normalized into the A6 vocabulary without losing the partner namespace, raw-provider reference, safe provider code, or evidence hash required for controlled support and reconciliation. Raw provider payloads are not part of the generic result by default.

The interface-level classification is:

```text
PRE_SEND_REJECTED
SENT_EXPLICITLY_REJECTED
SENT_ACCEPTED_NOT_SETTLED
SENT_OUTCOME_UNKNOWN
TRANSIENT_BEFORE_SEND
TRANSIENT_AFTER_SEND_UNKNOWN
PERMANENT_CONFIGURATION_FAILURE
SECURITY_OR_AUTHENTICITY_FAILURE
CONTRACT_OR_SCHEMA_FAILURE
CAPABILITY_UNSUPPORTED
RATE_LIMITED
MANUAL_REVIEW_REQUIRED
```

The normalized result/error must also carry a directive:

```text
DO_NOT_RETRY
RETRY_SAME_OPERATION
VERIFY_THEN_DECIDE
WAIT_FOR_EXTERNAL_EVIDENCE
ROUTE_TO_MANUAL_REVIEW
OPEN_PARTNER_CIRCUIT
```

These directives are classifications only. A6T02 does not execute retries, status queries, circuit breakers, or manual recovery.

### 7. Timeout and retry boundary

The adapter contract distinguishes:

- timeout before any provider request could be sent;
- timeout while awaiting a provider response after a request may have been sent;
- provider response received but final external settlement not established; and
- adapter/transport failure where send status cannot be established.

The required interface posture is:

| Interface condition                                             | Normalized posture                                                                  | Later action boundary                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Validation/configuration failure before send                    | `PRE_SEND_REJECTED` or `PERMANENT_CONFIGURATION_FAILURE`                            | No retry; caller records safe failure or blocks admission.                       |
| Known transient failure before send                             | `TRANSIENT_BEFORE_SEND` + `RETRY_SAME_OPERATION` only if no send occurred           | A6T07 bounded retry using the same logical operation.                            |
| Request may have been sent but no response is known             | `SENT_OUTCOME_UNKNOWN` or `TRANSIENT_AFTER_SEND_UNKNOWN` + `VERIFY_THEN_DECIDE`     | A6T07 status/callback/report/reconciliation verification; never a new identity.  |
| Explicit provider rejection with no accepted effect             | `SENT_EXPLICITLY_REJECTED`                                                          | Caller may record a verified non-success if the provider contract guarantees it. |
| Provider accepted request but finality is not known             | `SENT_ACCEPTED_NOT_SETTLED` + `WAIT_FOR_EXTERNAL_EVIDENCE`                          | External lifecycle/callback/status/report boundary; no Ledger settlement yet.    |
| Rate limit or provider circuit unavailable                      | `RATE_LIMITED` or `TRANSIENT_BEFORE_SEND` + `OPEN_PARTNER_CIRCUIT`                  | A6T07 controls admission/retry; adapter does not loop.                           |
| Invalid signature/authentication or malformed provider response | `SECURITY_OR_AUTHENTICITY_FAILURE` or `CONTRACT_OR_SCHEMA_FAILURE` + `DO_NOT_RETRY` | Security/adapter owner investigation; no financial mutation.                     |

The adapter must never convert timeout, transport failure, or missing response into `COMPLETED`, `SETTLED`, or `FAILED_WITH_NO_EFFECT` without the required evidence. A retry directive never authorizes a new provider idempotency key or a new financial target.

### 8. Version and compatibility rules

- A request with an unsupported `contractVersion` is rejected before provider translation.
- Additive optional fields may be introduced only in a minor-compatible contract revision and must not change the meaning of existing fields.
- Required-field, enum-semantic, identity, amount, currency, accounting-unit, error-posture, or financial-posture changes require a new major contract version.
- A partner API version change must be mapped and contract-tested inside the adapter; it cannot silently change normalized result meaning.
- Unknown required response fields, unknown critical outcome values, missing provider references, and incompatible currency/amount echoes are `CONTRACT_OR_SCHEMA_FAILURE` or `MANUAL_REVIEW_REQUIRED`, not optimistic success.
- Historical normalized request/result evidence remains attributable to the exact contract version and adapter version that produced it.
- Provider reference values are not normalized across partners into one global namespace. The pair `(partnerKey, referenceType, value)` remains the minimum provider-reference identity.
- A caller must not use a new contract version to reinterpret an existing pending, unknown, rejected, or accepted provider outcome.

### 9. Isolation and dependency rule

The adapter port must depend only on:

- provider-neutral A6 contract types;
- safe money and identifier primitives;
- a partner capability registry/port;
- a transport-profile reference, not secret material; and
- safe request/correlation context.

It must not import or instantiate:

```text
Customer entity/service
CustomerWallet entity/service
WalletAccount entity/service
LedgerAccount, LedgerService, journal, or line types
AuthorizationService or A2 principal decision objects
A3 binding services or repair services
A4 policy evaluator, evidence snapshot, or source writer
Transfer, Deposit, Withdrawal, or A5 lifecycle entities/services
AuditEvent, IdempotencyRecord, OutboxEvent, or reconciliation entities
```

The command owner may carry safe opaque IDs/references in the normalized request, but the adapter cannot use them to select accounts, authorize actions, mutate source records, or post financial value.

## Alternatives considered

### Let financial services call provider SDKs directly

Rejected. This would couple provider transport and external reference semantics to Wallet, Ledger, Transfer, Withdrawal, or Deposit modules and would make provider failures capable of bypassing A2, A3, A4, Operations, and Reconciliation boundaries.

### Treat a provider response as a settlement command

Rejected. A provider response is external evidence. Settlement requires a later A6 lifecycle/reconciliation decision and a Ledger-owned posting boundary.

### Use provider transaction IDs as internal operation IDs

Rejected. Provider IDs are partner-scoped and may be missing, duplicated across namespaces, delayed, or untrusted. Internal operation identity remains owned by the A6 command/lifecycle boundary.

### Put provider idempotency in the adapter only

Rejected. The adapter can carry/normalize provider idempotency values, but the durable logical-operation and internal idempotency owner remains the later A6 operation boundary using Operations. Provider and internal scopes must remain distinct.

### Allow generic adapters to select any product or rail

Rejected. A6T01 selected one bounded capability. Adapter support is explicit by `partnerKey`, `capabilityKey`, `operationType`, currency, and contract version. A second capability requires a separate reviewed boundary.

### Retry every timeout

Rejected. A timeout after a request may have been sent is an unknown external outcome. The interface returns a verification posture; A6T07 owns bounded recovery and never retries blindly.

## Consequences

### Positive

- Partner-specific transport and schemas remain outside canonical financial and customer modules.
- Provider references, internal identities, and financial truth remain distinct.
- A6 can normalize different provider errors without pretending they have the same settlement semantics.
- Timeout and retry posture is explicit before any external call is implemented.
- Future callback, settlement, and reconciliation tasks receive one stable provider-neutral boundary.
- The selected NIBSS/NIP capability remains bounded and cannot silently become a multi-provider platform.

### Trade-offs and future review items

- A6T03 must decide the selected transport, credential, signing, endpoint, environment, and partner-configuration mechanism.
- A6T05 must define the durable external-operation record, provider idempotency, reference uniqueness, and request-hash persistence.
- A6T06 must define callback authenticity, replay, receipt, and inbound processing behavior.
- A6T07 must implement the lifecycle, status verification, retry, circuit-breaker, and unknown-outcome recovery decisions.
- A6T08/A6T09 must define when a normalized provider result is sufficient evidence for settlement and how external discrepancies are reconciled.
- A6T10 must finalize field-level data sharing, consent/mandate, retention, and secret controls.

## Explicitly out of scope

This ADR and A6T02 do not:

- call NIBSS, a bank, or any external provider;
- add an HTTP client, SDK, adapter implementation, callback controller, webhook route, status poller, statement reader, scheduler, broker, or worker;
- create an external-operation, callback, settlement, suspense, provider-reference, or partner-credential entity/table;
- persist idempotency, audit, outbox, provider response, or reconciliation records;
- authenticate provider callbacks or sign requests;
- create or modify Customer, CustomerWallet, funding-instrument, beneficiary, A3 binding, policy, WalletAccount, LedgerAccount, Transfer, Deposit, Withdrawal, journal, line, balance, audit, outbox, or reconciliation data;
- decide or post settlement, clear suspense, reverse financial history, or issue a customer result;
- expose a public, customer, partner, callback, support, or internal route; or
- implement A6T03 or any later A6, A7, or A8 task.

## Implementation evidence

- [`docs/A6-PARTNER-ADAPTER-CONTRACT.md`](../A6-PARTNER-ADAPTER-CONTRACT.md)
- [`docs/A6-EXTERNAL-PARTNER-BASELINE.md`](../A6-EXTERNAL-PARTNER-BASELINE.md)
- [`docs/A6-IMPLEMENTATION-PLAN.md`](../A6-IMPLEMENTATION-PLAN.md)
- [`docs/A5-A6-HANDOFF-PACKAGE.md`](../A5-A6-HANDOFF-PACKAGE.md)
- [`docs/A5-COMMAND-CORRELATION-INPUTS.md`](../A5-COMMAND-CORRELATION-INPUTS.md)
- [`docs/A2-A6-PRIVACY-INPUTS.md`](../A2-A6-PRIVACY-INPUTS.md)

## A6T02 verification record

- [x] One isolated provider-neutral adapter boundary is defined.
- [x] Normalized request, result, reference, correlation, trace, and evidence models are defined without runtime classes or persistence.
- [x] Provider-specific IDs remain partner-scoped and distinct from internal canonical IDs.
- [x] Provider error vocabulary and normalization rules are defined.
- [x] Interface-level timeout, retry, provider-acceptance, rejection, and unknown-outcome classifications are defined.
- [x] Contract/version compatibility rules are explicit.
- [x] Adapter responsibilities and prohibited responsibilities are explicit.
- [x] Wallet, Ledger, A2, A3, A4, A5, Operations, Outbox, and Reconciliation remain outside the adapter authority.
- [x] No external provider, credential, callback, persistence, controller, route, API, scheduler, settlement, or financial behavior is introduced.
- [ ] A6T03 bank/NIBSS connection and credential implementation remains intentionally incomplete.
