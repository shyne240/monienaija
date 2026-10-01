# A6T06 — Partner Callback Ingress and Replay Contract

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T06 — Callback Authenticity, Replay Protection, and Inbound Boundary
- **Status:** Implemented authenticated receipt boundary; lifecycle, settlement, and reconciliation processing not implemented
- **Contract:** `A6PartnerCallbackContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Callback route:** `POST /api/v1/internal/partner-callbacks/nibss-nip`
- **Application, database, API, controller, route, callback-receipt persistence, and financial-runtime boundary:** The minimum internal callback boundary and receipt persistence are implemented; no provider communication, lifecycle transition, settlement, suspense, or reconciliation is implemented

## 1. Boundary

A6T06 receives a signed provider callback, validates its envelope and correlation, records an immutable receipt, and optionally records the provider reference against the existing A6 external operation. It does not advance the external-operation lifecycle or perform any financial action.

```text
Internal callback ingress
  -> A2 route classification: PROVIDER_CALLBACK
  -> partner signature/freshness authentication
  -> callback schema/version validation
  -> callback event idempotency reservation
  -> existing external-operation/reference correlation
  -> immutable RECEIVED or REJECTED receipt
  -> Operations audit/idempotency evidence
```

A provider callback is untrusted input. It cannot become Customer identity, A2 authorization, A3 binding, A4 policy, A5 lifecycle truth, Ledger truth, settlement proof, or reconciliation authority.

## 2. Route and A2 boundary

The callback route is:

```text
POST /api/v1/internal/partner-callbacks/nibss-nip
```

The existing route-policy registry classifies this route as:

```text
public: false
authenticationMode: PROVIDER_CALLBACK
resourceType: external-partner-callback
action: partner:callback:receive
```

The global runtime access guard does not require a customer bearer session for this route because a provider callback has no customer session. It also does not classify the route as public. The callback service performs provider-key, secret/signature, freshness, schema, and replay validation before any receipt/reference write.

No customer, public, mobile, web, support, or partner API is introduced by this boundary.

## 3. Authentication headers

The minimum callback headers are:

```text
x-a6-partner-key: NIBSS_NIP
x-a6-callback-id: bounded callback event ID
x-a6-callback-timestamp: Unix epoch seconds
x-a6-callback-signature: sha256=<lowercase hexadecimal HMAC-SHA256>
```

The signing input is:

```text
partnerKey + "." + callbackEventId + "." + callbackTimestamp + "." + canonicalJson(payload)
```

The callback authentication service:

- requires the selected `NIBSS_NIP` partner key;
- requires the callback event ID header and payload value to match;
- rejects missing, malformed, or unsupported headers;
- loads the selected environment callback secret through the isolated secret-source boundary;
- applies the configured freshness window, defaulting to 300 seconds;
- calculates HMAC-SHA256 over the canonical signing input;
- compares signatures using constant-time comparison; and
- returns only safe payload/signature hashes and timestamp metadata after successful authentication.

Secrets are never returned, logged, persisted in callback receipts, or included in Operations audit values.

## 4. Callback payload contract

The normalized callback payload is:

```text
PartnerCallbackPayloadV1 {
  contractName: "A6-PARTNER-CALLBACK"
  contractVersion: 1
  partnerKey: "NIBSS_NIP"
  callbackEventId: bounded event ID

  externalOperationId: UUID
  externalOperationReference: external-operation:v1:<SHA-256>
  correlationId: existing operation correlation ID

  providerReference: {
    referenceType: OPERATION | TRANSACTION | SETTLEMENT
    value: bounded opaque provider reference
    namespace: bounded provider namespace
  }

  providerStatus: bounded provider status
  amountMinor: positive decimal digit string
  currency: "NGN"
  occurredAt: RFC3339 UTC timestamp
}
```

Schema validation rejects:

- wrong contract name/version or partner key;
- callback event ID mismatch;
- invalid UUID or external-operation reference;
- invalid provider reference type, value, or namespace;
- empty/oversized provider status;
- zero, negative, fractional, or malformed amount;
- non-NGN currency; and
- invalid timestamps.

Provider status is stored as evidence only. It does not map to `COMPLETED`, `SETTLED`, `FAILED`, `PENDING`, `UNKNOWN`, or any other A6T07 lifecycle state in this task.

## 5. External-operation correlation

The callback must identify an existing operation through:

```text
externalOperationId
externalOperationReference
correlationId
```

The service reads the existing external operation through `ExternalOperationService.getInTransaction()` and requires:

- the operation exists;
- the deterministic external-operation reference matches the callback;
- the callback correlation ID equals the operation correlation ID;
- callback amount equals the operation amount; and
- callback currency equals the operation currency.

An unknown operation, wrong operation reference, correlation mismatch, amount mismatch, or currency mismatch is rejected and recorded as a rejected callback receipt. No provider reference is attached and no financial state changes.

A provider reference is recorded only through the A6T05 `ExternalOperationService.recordProviderReferenceInTransaction()` boundary. It remains partner-scoped and distinct from the internal operation ID.

## 6. Callback idempotency and replay

The shared Operations idempotency scope is:

```text
external.partner.callback.v1
```

The idempotency key is:

```text
NIBSS_NIP:<callbackEventId>
```

The idempotency request hash is the authenticated canonical payload hash.

| Condition                                                                | Result                                                 | Mutation                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------- |
| Same callback event ID and same payload hash                             | Replay original receipt result with `replayed = true`. | No second receipt/reference/audit effect.            |
| Same callback event ID and changed payload hash                          | `CALLBACK_IDEMPOTENCY_CONFLICT`.                       | No mutation.                                         |
| New event ID with a provider reference already attached to the operation | Rejected `DUPLICATE_CALLBACK`.                         | Rejected receipt only; no second provider reference. |
| Unknown external operation ID                                            | Rejected `UNKNOWN_PROVIDER_REFERENCE`.                 | Rejected receipt with no operation link.             |
| Invalid signature/freshness/schema                                       | Authentication or malformed rejection.                 | No receipt/reference/operation mutation.             |

Receipt facts are immutable after creation. The receipt payload stores hashes and safe metadata rather than the raw callback body.

## 7. Receipt persistence

`external_callback_receipts` stores:

```text
receipt ID
external operation ID, nullable for unknown/rejected correlation
partner key
callback event ID
canonical payload hash
signature hash
provider reference type/value/namespace
provider status
provider occurred-at and receipt timestamps
correlation ID
RECEIVED or REJECTED status
rejection code where applicable
```

The table has:

- unique `(partner_key, callback_event_id)` protection;
- external-operation and provider-reference indexes;
- status/rejection consistency checks;
- hash/reference shape checks; and
- a database trigger preventing receipt-fact mutation.

A receipt is operational evidence, not a provider truth source, external-operation lifecycle authority, settlement record, or Ledger record.

## 8. Operations audit

The callback service records safe facts through Operations:

```text
entityType: A6_EXTERNAL_CALLBACK
entityId: receipt ID
action: RECEIVED | REJECTED
actor: a6-partner-callback
correlationId: callback/operation correlation ID
requestId: callback event ID
newValues:
  receipt/event/operation IDs
  payload/signature hashes
  provider reference type/hash/namespace
  provider status
  receipt status
  rejection code
```

Raw callback payloads, signatures, secrets, credentials, target values, unrestricted risk/compliance data, balances, journals, and lines are excluded.

## 9. Explicitly out of scope

A6T06 does not:

- call or respond to NIBSS/bank/provider systems;
- implement provider status queries, statement/report ingestion, or outbound retry;
- transition an external operation lifecycle;
- create or modify a Withdrawal, Transfer, Deposit, Customer, Wallet, Ledger, A3 binding, A4 policy, or financial balance;
- post settlement, suspense, journals, lines, or compensating entries;
- reconcile provider data or repair source records;
- expose a public callback API; or
- implement A6T07-A6T11.

## 10. Verification record

- [x] Valid signed callback authentication is implemented.
- [x] Partner key, event ID, signature format, freshness, and schema/version are validated.
- [x] Provider references are correlated to an existing external-operation identity.
- [x] Unknown operation/reference, mismatched operation reference, correlation, amount, and currency are rejected.
- [x] Callback event idempotency uses the shared Operations idempotency service.
- [x] Same-event replay and changed-payload conflict behavior are implemented.
- [x] Duplicate provider references from a new callback event are rejected.
- [x] Callback receipts and Operations audit facts are immutable/minimized.
- [x] No A6T07 lifecycle transition, settlement, suspense, Ledger posting, financial execution, or reconciliation is introduced.
