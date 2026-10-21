# A6T07 — External Operation Lifecycle and Recovery Contract

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T07 — External Operation Lifecycle, Retry, Circuit Breaker, and Unknown Outcomes
- **Status:** Implemented lifecycle/retry/recovery boundary; settlement, suspense, and reconciliation not implemented
- **Contract:** `ExternalOperationLifecycleContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Application, database, API, callback, settlement, and financial-runtime boundary:** Lifecycle persistence, transition guards, bounded attempt state, circuit-breaker control, status-verification abstraction, and recovery behavior are implemented; no provider communication or financial execution is implemented

## 1. Lifecycle boundary

A6T07 owns the external-operation lifecycle after A6T05 creates the durable operation and A6T06 authenticates callback receipts. It does not decide settlement or write Ledger value.

```text
external operation CREATED
  -> bounded attempt admission
  -> SUBMITTING
  -> PENDING_PROVIDER or PENDING_VERIFICATION
  -> verified status abstraction / callback evidence / manual recovery
  -> UNKNOWN or MANUAL_REVIEW when outcome is unresolved
  -> FAILED or later A6T08 settlement boundary
```

The lifecycle record preserves A6T05 identity, target mapping, provider idempotency, request hash, customer/account IDs, and correlation fields. Identity fields cannot be rewritten during a lifecycle transition.

## 2. State vocabulary and transitions

```text
CREATED
SUBMITTING
PENDING_PROVIDER
PENDING_VERIFICATION
UNKNOWN
MANUAL_REVIEW
FAILED
CANCELLED
```

Allowed transitions:

| Current state          | Allowed next states                                             |
| ---------------------- | --------------------------------------------------------------- |
| `CREATED`              | `SUBMITTING`, `FAILED`, `CANCELLED`                             |
| `SUBMITTING`           | `PENDING_PROVIDER`, `PENDING_VERIFICATION`, `UNKNOWN`, `FAILED` |
| `PENDING_PROVIDER`     | `PENDING_VERIFICATION`, `UNKNOWN`, `MANUAL_REVIEW`, `FAILED`    |
| `PENDING_VERIFICATION` | `SUBMITTING`, `UNKNOWN`, `MANUAL_REVIEW`, `FAILED`              |
| `UNKNOWN`              | `PENDING_VERIFICATION`, `MANUAL_REVIEW`, `FAILED`               |
| `MANUAL_REVIEW`        | `PENDING_VERIFICATION`, `FAILED`                                |
| `FAILED`               | terminal                                                        |
| `CANCELLED`            | terminal                                                        |

`COMPLETED`, `SETTLED`, and `BALANCE_UPDATED` are intentionally not A6T07 lifecycle states. A6T08 owns verified settlement and financial outcome handling.

## 3. Lifecycle command and version rules

```text
TransitionExternalOperationCommand {
  externalOperationId
  nextState
  idempotencyKey
  requestContext: requestId + correlationId + traceId
  expectedVersion?
  providerStatus?
  recoveryReference?
  failureCode?
  failureMessage?
  failureStatusCode?
  reason?
}
```

Rules:

- Every transition locks the external-operation row in a serializable transaction.
- `expectedVersion`, when supplied, must equal the current optimistic version.
- A stale version fails with `STALE_LIFECYCLE_VERSION` and does not mutate the operation.
- Terminal `FAILED` and `CANCELLED` states cannot be changed.
- Identity, target mapping, amount, currency, account tuple, provider idempotency, request hash, command ID, and correlation fields are immutable.
- `UNKNOWN` and `MANUAL_REVIEW` require a deterministic recovery reference.
- A recovery reference cannot be replaced by a different reference.
- `FAILED` requires a failure code and safe failure message.
- Every transition is replay-safe through Operations idempotency scope `external.partner.lifecycle.v1`.

## 4. Bounded retry behavior

A6T07 uses a maximum of three attempts per external operation. `SUBMITTING` increments `attemptCount` while retaining the same:

```text
externalOperationId
externalOperationReference
providerIdempotencyScope/key
requestHash
resource/customer/account/target mapping
amount/currency/accounting unit
correlation/causation context
```

When the attempt count reaches `maxAttempts`, a further attempt admission does not create a fourth attempt. It transitions the operation to terminal `FAILED` with:

```text
failureCode: RETRY_EXHAUSTED
failureStatusCode: 409
```

A6T07 does not perform a provider request or schedule a retry. It establishes the state and admission boundary that a later adapter/execution owner may consume.

## 5. Timeout and unknown outcome

`markTimeout()` handles a deadline after a provider request may have been sent:

```text
recoveryReference =
  external-operation-recovery:<sha256(externalOperationId + ":provider-status")>
```

The operation transitions to `UNKNOWN` with:

```text
failureCode: TIMEOUT_AFTER_SEND_UNKNOWN
failureStatusCode: 504
```

The same recovery reference is returned on later recovery attempts. A timeout is never converted into provider rejection, financial failure, settlement, or success without external evidence.

## 6. Status-verification abstraction

The lifecycle service consumes an `ExternalOperationStatusVerifier` port:

```text
verify({
  operation,
  externalOperationId,
  externalOperationReference,
  providerIdempotencyKey,
  providerReferences,
  correlationId,
  requestedAt,
}) -> ExternalOperationStatusVerificationResult
```

The default A6T07 implementation returns:

```text
state: UNAVAILABLE
reasonCode: STATUS_VERIFICATION_NOT_CONFIGURED
```

It performs no provider communication. A later approved adapter/status-query implementation may replace the port without changing lifecycle identity or settlement boundaries.

## 7. Circuit breaker

`PartnerCircuitBreakerService` provides process-local partner-attempt admission control:

```text
CLOSED
  -> failure threshold reached
OPEN
  -> open duration elapsed
HALF_OPEN
  -> successful probe: CLOSED
  -> failed probe: OPEN
```

Configuration is environment-aware:

```text
A6_PARTNER_CIRCUIT_FAILURE_THRESHOLD
A6_PARTNER_CIRCUIT_OPEN_SECONDS
```

Rules:

- A closed circuit permits attempts.
- An open circuit blocks new attempts before lifecycle mutation.
- After the open window, one half-open probe is permitted.
- A successful provider-accepted boundary closes the circuit and resets failures.
- A timeout/transport failure records a circuit failure.
- Circuit state does not delete, rewrite, or cancel completed operation history.
- Circuit state does not post settlement or clear suspense.

The current circuit is an admission/isolation abstraction. Durable multi-process circuit state and provider health aggregation remain future architecture review items.

## 8. Operations idempotency and audit

Lifecycle transitions use:

```text
scope: external.partner.lifecycle.v1
key: external-operation:<externalOperationId>:<callerKey>
requestHash: normalized transition semantic hash
```

The transition request hash includes operation ID, next state, expected version, provider status, recovery reference, failure details, and reason. It excludes request/trace transport fields.

Same-key/same-payload replay returns the original transition result with `transitionReplayed = true`. A changed transition under the same key fails closed.

Operations audit records safe lifecycle facts:

```text
entityType: A6_EXTERNAL_OPERATION
action: LIFECYCLE_TRANSITIONED
actor: a6-external-operation-lifecycle
previousState + nextState
attemptCount + maxAttempts
providerStatus
recoveryReference
failureCode
requestHash
correlationId + requestId
```

No raw provider payload, secret, signature, balance, journal line, or unrestricted risk/compliance content is written to audit.

## 9. Explicitly out of scope

A6T07 does not:

- call a provider, execute a status query, send a retry, or implement callback ingestion;
- interpret a provider status as settled financial value;
- post Ledger journals, mutate balances, create settlement, create suspense, or perform compensating entries;
- reconcile provider reports or repair source records;
- change Customer, funding instruments, beneficiaries, A3 bindings, A4 policy, Wallet, Ledger, Transfer, Deposit, Withdrawal, or callback-receipt facts;
- introduce a scheduler, broker, public API, customer route, notification, or product expansion; or
- implement A6T08 or any later A6/A7/A8 task.

## 10. Verification record

- [x] External-operation lifecycle states and transition guards are implemented.
- [x] Bounded three-attempt retry behavior and deterministic retry exhaustion are implemented.
- [x] Timeout transitions to deterministic `UNKNOWN` recovery state.
- [x] Status verification is represented by a provider-neutral no-communication abstraction.
- [x] Circuit breaker open, half-open, close, threshold, and duration behavior is implemented.
- [x] Lifecycle replay uses Operations idempotency and preserves the original transition result.
- [x] Stale optimistic lifecycle versions are rejected.
- [x] Duplicate recovery and immutable recovery references are handled deterministically.
- [x] No provider communication, settlement, suspense, financial posting, reconciliation, or A6T08 work is included.
