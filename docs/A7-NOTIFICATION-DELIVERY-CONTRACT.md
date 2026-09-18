# A7T06 — A7 Notification Delivery Contract

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T06 — Notification Delivery Infrastructure and Preferences Enforcement
- **Status:** A7 notification delivery dispatcher boundary, outbox contract, and audit/idempotency integration defined; A7 notification dispatcher consumes approved `CustomerPreference.notifications` (the existing `customer-preference` module) and the A6T10 data-classification matrix; no new customer intent, consent, or preference authority is introduced; no live email, SMS, push, or web-channel provider is wired; no public, mobile, or partner channel is wired; no `CustomerPreference` source record is mutated
- **Contract:** `A7NotificationDeliveryContractV1` / `A7NotificationDispatchV1` / `A7NotificationDeliveryStateV1` / `A7NotificationDeliveryHandoffV1`
- **Identity namespaces:** `A7-NOTIFICATION-DELIVERY` v1 (durable notification event identity), `A7-NOTIFICATION-DISPATCH` v1 (durable notification dispatch identity), `a7.notification-dispatch.idempotency.v1` (notification internal idempotency scope)
- **Upstream authorities consumed (not replaced):** A1 canonical ownership and identifier contracts, A2 protected route and audience authorization, A3 customer-binding identity, A4 product-policy profile (A7T03), A5 customer-aware command/correlation, A6 partner-adapter boundary, A6T10 data-classification matrix, A7 product catalog (A7T02), A7 product-policy profile (A7T03), A7 product customer-binding map (A7T04), A7 product command/operation identity (A7T05), `CustomerPreference.notifications` (the existing `customer-preference` module intent authority), Operations `IdempotencyService` / `AuditService` / `OutboxService` (shared primitives)
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, and A8 changes:** None (A7T06 is a documentation and consumer-boundary artifact; the existing `CustomerPreference` and A6T10 data-classification sources are read without mutation; the existing Operations `IdempotencyService` / `AuditService` / `OutboxService` are reused as-is; no new table, no new column, no new index, no new trigger, no new entity, no new migration)

This document defines the A7 notification delivery dispatcher boundary, the outbox contract, and the audit/idempotency integration for the A7 first product (`VIRTUAL_ACCOUNT` v1). The A7 notification delivery contract defers customer intent to the existing `CustomerPreference.notifications` (the existing `customer-preference` module is the only customer intent authority). The A7 notification delivery contract defers data classification to the existing A6T10 data-classification matrix (the existing `ExternalDataClassificationRegistry` is the only data-classification authority). The A7 notification delivery contract does not introduce a new policy evaluator, a new authorization system, a new customer-binding authority, a new settlement authority, a new reconciliation engine, a new audit authority, a new idempotency authority, a new outbox authority, or a new product command identity. The A2 / A3 / A4 / A5 / A6 / `CustomerPreference` / Operations authorities are the only authorities.

## 1. Contract boundary

### 1.1 Purpose

The A7 notification delivery contract is the dispatcher boundary between the A7 first product and the existing `CustomerPreference.notifications` intent authority. The A7 notification delivery service reads the `CustomerPreference.notifications` (the existing `customer-preference` module), reads the A6T10 data-classification matrix (the existing `ExternalDataClassificationRegistry`), and writes only delivery facts through the shared Operations `IdempotencyService` / `AuditService` / `OutboxService`. The A7 notification delivery service does not mutate any `CustomerPreference` source record and does not write any new customer intent, consent, or preference record.

```text
A2 authorization context (A2 principal, audience, scopes, customer access)
  + A4 product-policy decision reference (A7T03)
  + A3 internal account binding reference (A3 binding record id + version; A7T04 map)
  + A7 product catalog registration (A7T02: productKey, capabilityKey, action, productState, currency, accountingUnit)
  + A7 product customer-binding map reference (A7T04)
  + A7 product command/operation reference (A7T05)
  + CustomerPreference.notifications (the existing customer-preference module; intent authority)
  + A6T10 data-classification matrix (the existing ExternalDataClassificationRegistry; classification authority)
  -> A7NotificationDeliveryService
       -> A7NotificationDispatchV1
            A7 notification event id
            A7 notification dispatch id
            customer id (canonical Customer.id)
            customer preference reference (the CustomerPreference.id)
            product key
            product state
            product operation reference (A7T05)
            product customer-binding map reference (A7T04)
            A2 authorization context reference
            A4 product-policy decision reference
            A3 binding tuple (from A7T04)
            notification channel (email, sms, push, inApp)
            notification template reference
            notification payload (minimized, A6T10-classified)
            request/correlation/trace/causation
       -> A7NotificationDeliveryHandoffV1
            notificationDispatchReference
            a2AuthorizationContextReference
            a4ProductPolicyDecisionReference
            a3BindingReference
            a7ProductCustomerBindingMapReference
            a7ProductCommandReference
            customerPreferenceReference
            notificationChannel
            notificationTemplateReference
            notificationPayloadHash
```

The A7 notification delivery contract is a read-only consumer of the A2 authorization context, the A3 customer-binding tuple, the A4 product-policy decision, the A7 product catalog, the A7 product-policy profile, the A7 product customer-binding map, the A7 product command/operation identity, the `CustomerPreference.notifications` (the existing `customer-preference` module), and the A6T10 data-classification matrix. The A7 notification delivery contract is a read-write contract only with respect to the shared Operations `IdempotencyService`, `AuditService`, and `OutboxService`. The A7 notification delivery contract does not write to `CustomerPreference`, the A2 authorization authority, the A3 binding authority, the A4 policy authority, the A5 internal transfer authority, the A6 partner boundary, Wallet, Ledger, or the Reconciliation authority.

### 1.2 Normative language

- **MUST** means a required contract invariant.
- **MUST NOT** means a prohibited state, dependency, or interpretation.
- **SHOULD** means the default behavior unless a later approved product contract documents a safer alternative.
- **MAY** means an optional field or later product-extension point that cannot weaken an invariant.
- **CustomerPreference** means the existing `customer-preference` module (the only customer intent authority for notification delivery; A7T06 consumes, it does not redefine).
- **CustomerPreference.notifications** means the existing `NotificationPreference` entity (the only customer notification intent authority).
- **A2 authorization** means the A2 `AuthorizationDecision` produced by the existing A2 `AuthorizationService`. A2 is the only authorization authority.
- **A3 binding** means the A3 `CustomerFinancialAccountBinding` record that links `Customer.id` → `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`. A3 is the only customer-binding authority.
- **A4 product-policy decision** means the A4 `PolicyDecisionResult` produced by the A7T03 A4 product-policy service. A4 is the only policy authority.
- **A6T10 data-classification matrix** means the existing `ExternalDataClassificationRegistry` (the only data-classification authority for external-rail data; reused for A7T10 and A6T10).
- **A7 product customer-binding map** means the A7T04 `A7ProductCustomerBindingMapV1`. A7T04 is the only A7 product customer-binding authority.
- **A7 product command/operation** means the A7T05 `A7ProductCommandOperationV1`. A7T05 is the only A7 product command/operation authority.
- **Operations idempotency** means the shared Operations `IdempotencyService` (reused as-is). Operations is the only idempotency authority.
- **Operations audit** means the shared Operations `AuditService` (reused as-is). Operations is the only audit authority.
- **Operations outbox** means the shared Operations `OutboxService` (reused as-is). Operations is the only outbox authority.

### 1.3 Contract port shape

The logical A7 notification delivery port is equivalent to:

```text
A7NotificationDeliveryContractV1
  resolveNotificationPreferences(
    customerId: UUID
  )
    -> A7NotificationPreferenceViewV1 | null

  dispatchNotification(
    command: A7NotificationDispatchV1
  )
    -> A7NotificationDeliveryResultV1

  suppressNotification(
    notificationDispatchId: UUID,
    reason: string
  )
    -> A7NotificationDeliveryResultV1

  markNotificationFailed(
    notificationDispatchId: UUID,
    failure: A7NotificationFailureV1
  )
    -> A7NotificationDeliveryResultV1

  getNotificationDeliveryHandoff(
    notificationDispatchId: UUID
  )
    -> A7NotificationDeliveryHandoffV1 | null
```

The A7 notification delivery port is read-only with respect to A2, A3, A4, A5, A6 partner, A6T10 data-classification matrix, A7 product catalog, A7 product-policy profile, A7 product customer-binding map, A7 product command/operation identity, `CustomerPreference`, Wallet, Ledger, Reconciliation, and `CustomerPreference` source records. The A7 notification delivery port is read-write only with respect to the shared Operations `IdempotencyService`, `AuditService`, and `OutboxService`.

### 1.4 Identity namespaces (frozen)

```text
contractName:           "A7-NOTIFICATION-DELIVERY"
contractVersion:        1
notificationEventNamespace: "A7-NOTIFICATION-DELIVERY"
dispatchNamespace:      "A7-NOTIFICATION-DISPATCH"
dispatchIdempotencyScope: "a7.notification-dispatch.idempotency.v1"
auditEntityType:        "A7_NOTIFICATION_DISPATCH"
```

Every A7 notification event identity, A7 notification dispatch identity, replay, conflict, and handoff is part of `A7-NOTIFICATION-DELIVERY` v1. A later identity version (v2) may add optional fields, optional evidence sources, or a second frozen notification dispatch shape; it MUST NOT weaken v1 invariants or silently re-broaden the v1 first-product notification delivery contract.

### 1.5 Selected first-product notification delivery envelope (frozen summary)

```text
productKey:           VIRTUAL_ACCOUNT
productVersion:       1
capabilityKey:        virtual-account.assign
                       virtual-account.inbound-funding
direction:            inbound
currency:             NGN
accountingUnit:       CUSTOMER_FUNDS
notificationChannel:  email | sms | push | inApp (selected from CustomerPreference.notifications)
notificationTemplate: A7 notification template reference (A7T06 establishes the boundary; A7T11 wires a live provider)
notificationPayload:  A6T10-classified, minimized, redacted (no raw credentials, signatures, private keys, full risk/compliance content, or unnecessary customer data)
```

## 2. Canonical identity and identity-separation rules

### 2.1 Identity vocabulary

```text
A7NotificationEventIdV1            UUID (canonical A7 notification event id; generated by the A7 notification delivery service)
A7NotificationEventReferenceV1     string (deterministic A7 notification event reference; SHA-256 of the A7 notification event id)
A7NotificationDispatchIdV1         UUID (canonical A7 notification dispatch id; generated by the A7 notification delivery service)
A7NotificationDispatchReferenceV1  string (deterministic A7 notification dispatch reference; SHA-256 of the A7 notification dispatch id)
A7NotificationDeliveryStateV1      string (A7 notification delivery state vocabulary: PENDING / DISPATCHED / SUPPRESSED / FAILED / REPLAYED)
A7NotificationDeliveryHandoffV1    A7 notification delivery handoff (single-use, bounded-validity, A2-protected internal control surface)
CustomerPreferenceIdV1             UUID (the existing customer-preference module preference id; A7T06 reads but does not write)
NotificationChannelV1              'email' | 'sms' | 'push' | 'inApp' (from the existing NotificationPreference)
NotificationTemplateReferenceV1    string (A7 notification template reference; opaque, A7T06 establishes the boundary)
NotificationPayloadHashV1          string (SHA-256 hash of the A7 notification payload)
A2AuthorizationContextReferenceV1  string (A2 authorization context reference; reused from A7T05)
A4ProductPolicyDecisionReferenceV1 string (A4 product-policy decision reference; reused from A7T03)
A3BindingReferenceV1               string (A3 binding reference; reused from A7T04/A7T05)
A7ProductCustomerBindingMapReferenceV1 string (A7T04 product customer-binding map reference; reused from A7T05)
A7ProductCommandReferenceV1        string (A7T05 product command reference; reused from A7T05)
RequestContextV1                   { requestId, correlationId, traceId, causationId } (reused from A5)
```

The canonical internal customer identity is `Customer.id`. The A3 binding tuple is the only source of `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`. The `CustomerPreference.notifications` (the existing `customer-preference` module) is the only source of the customer notification intent. The A6T10 data-classification matrix is the only source of the notification payload classification. The A7 product command/operation identity (A7T05) is the only source of the A7 product command reference. The four identities — `Customer.id`, the A3 binding tuple, the `CustomerPreference.notifications`, and the A7 product command/operation — remain distinct and correlated through the A7 notification delivery handoff.

### 2.2 Canonical identity rules

- `Customer.id` MUST be the only canonical internal customer identity. A virtual-account identifier, a bank code, a bank account number, a partner reference, a provider reference, a payment reference, a funding-instrument identifier, a beneficiary identifier, a notification identifier, a preference value, an A7 product command id, or an A7 product operation id MUST NOT become or substitute for `Customer.id`.
- The A3 `CustomerFinancialAccountBinding` record is the only source of `CustomerWallet.id`, `WalletAccount.id`, and `LedgerAccount.id`. The A7 notification delivery service MUST read these ids from the A3 binding record (via the A7T04 product customer-binding map) and MUST NOT derive them from any other source.
- The `CustomerPreference.notifications` (the existing `customer-preference` module) is the only source of the customer notification intent. The A7 notification delivery service MUST read the customer notification intent from the existing `CustomerPreferenceService.getPreferences()` consumer boundary and MUST NOT write a new customer intent, consent, or preference record. A change in `CustomerPreference.notifications` does NOT retroactively rewrite past notification delivery decisions; it affects only future notifications.
- The A6T10 data-classification matrix is the only source of the notification payload classification. The A7 notification delivery service MUST classify every notification payload field through the existing `ExternalDataClassificationRegistry` consumer boundary and MUST reject any notification payload that contains raw credentials, raw signatures, raw private keys, raw risk/compliance content, or unnecessary customer data.
- The A7 product command/operation identity (A7T05) is the only source of the A7 product command/operation reference. The A7 notification delivery service MUST read the A7 product command reference from the A7T05 product command/operation record (via the A7T05 consumer boundary) and MUST NOT derive it from any other source.
- The A2 `AuthorizationDecision` is the only authorization authority. The A7 notification delivery service MUST record the A2 authorization context reference and MUST NOT issue, refresh, or substitute the A2 authorization.
- The A4 `PolicyDecisionResult.decisionReference` is the only policy authority. The A7 notification delivery service MUST record the A4 product-policy decision reference and MUST NOT evaluate, mutate, or refresh the A4 product-policy decision.

### 2.3 Identity separation matrix

| Identity                                                            | Owner                                       | A7T06 read relationship                                                                                                  | A7T06 MUST NOT do                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `Customer.id`                                                        | Customer module                              | Correlation only; never internal account source                                                                         | Treat customer reference as virtual-account, partner reference, or notification reference |
| `CustomerWallet.id`                                                  | Customer-wallet module                       | Read from A3 binding record (via A7T04 product customer-binding map); never infer                          | Treat customer-wallet id as virtual-account, partner reference, or notification reference |
| `CustomerFinancialAccountBinding.id` / `bindingVersion`              | A3                                          | The only source of internal account tuple                                                                                 | Repair, reassign, activate, or close an A3 binding to make a notification pass      |
| `WalletAccount.id`                                                   | Wallet module                                | Read from A3 binding record                                                                                              | Derive from any other source                                                         |
| `LedgerAccount.id`                                                   | Ledger module                                | Read from A3 binding record                                                                                              | Derive from any other source                                                         |
| A4 `PolicyDecisionResult.decisionReference`                          | A4 (A7T03)                                  | Read the A4 product-policy decision reference                                                                            | Evaluate or mutate A4 policy/source evidence                                        |
| A2 `AuthorizationDecision.principalId` / `action`                    | A2                                          | Read the A2 authorization context reference                                                                              | Issue, refresh, or substitute A2 authorization                                      |
| `CustomerPreference.id` / `CustomerPreference.notifications`          | customer-preference module (A1/A2/A6 inputs) | The only source of the customer notification intent; the A7 notification delivery service reads but does not write   | Create a new customer intent, consent, or preference record; mutate `CustomerPreference` source records |
| A6T10 data-classification matrix                                       | partner module (A6T10)                     | The only source of the notification payload classification; the A7 notification delivery service classifies the payload through the A6T10 registry | Bypass the A6T10 data-classification matrix; transmit HIGHLY_RESTRICTED or RESTRICTED fields without classification |
| A6T05 `externalOperationId` / `externalOperationReference`           | A6T05 (per ADR-0049)                         | The only source of the A6 partner reference identity (for partner-correlation metadata)                                | Issue, refresh, or substitute the A6 partner reference                                |
| `VirtualAccount.{id, provider, accountNumber, accountName, bankCode, reference, status, assignedAt, deactivatedAt}` | existing `virtual-account` module (compatibility input) | Read as correlation context (for product notification correlation); never internal account source        | Mutate, deactivate, or reassign the existing `VirtualAccount` row                |
| `payment_reference`                                                  | `payment` module (compatibility input)        | Read as cross-domain correlation evidence                                                                                  | Treat payment reference as internal account source                                   |
| A7T05 `productCommandId` / `productOperationId`                      | A7T05                                       | The only source of the A7 product command/operation identity                                                              | Treat A7 product command/operation id as a customer intent or as a notification reference |
| A7T04 `A7ProductCustomerBindingMapV1.mapReference`                 | A7T04                                       | The only source of the A7 product customer-binding map reference; the A7 notification delivery service references it | Re-derive the A7 product customer-binding map inside the A7 notification delivery       |

## 3. A7 notification delivery dispatcher boundary

### 3.1 Dispatcher envelope

```text
A7NotificationDispatchV1 {
  contractName: "A7-NOTIFICATION-DELIVERY"
  contractVersion: 1

  productKey: A7ProductKey
  productVersion: A7ProductVersion
  capabilityKey: A7ProductCapabilityKey
  action: A7ProductAction
  productState: A7ProductState

  customerId: UUID
  customerWalletId: UUID
  bindingId: UUID
  bindingVersion: number

  customerPreferenceId: UUID                   (the existing customer-preference module preference id; A7T06 reads but does not write)
  notificationChannel: 'email' | 'sms' | 'push' | 'inApp'
  notificationTemplateReference: string

  a7ProductCustomerBindingMapReference: string   (A7T04)
  a4ProductPolicyDecisionReference: string         (A7T03)
  a2AuthorizationContextReference: string          (A2)
  a7ProductCommandReference: string              (A7T05)
  a6ExternalOperationReference: string            (A6T05; for partner-correlation metadata)

  notificationPayload: {                        (A6T10-classified, minimized, redacted)
    // minimal fields only; no raw credentials, no signatures, no private keys,
    // no full risk/compliance content, no unnecessary customer data
  }
  notificationPayloadHash: string                (SHA-256 of the canonicalized notificationPayload)

  idempotencyScope: 'a7.notification-dispatch.idempotency.v1'
  idempotencyKey: string
  requestHash: string                            (SHA-256 of the canonicalized A7 notification dispatch semantic material)

  requestContext: RequestContext
  causationId: string | null
}
```

The A7 notification delivery service accepts the dispatch command, validates the A2 authorization context reference, validates the A4 product-policy decision reference, validates the A7 product catalog registration, validates the A7 product customer-binding map reference, validates the A7 product command/operation reference, classifies the notification payload through the A6T10 data-classification matrix, reads the `CustomerPreference.notifications` to determine the customer's notification intent for the selected channel, derives the canonical A7 notification dispatch request hash, reserves the A7 notification dispatch idempotency scope/key, builds the A7 notification dispatch event, publishes the A7 notification dispatch outbox fact, records the A7 notification dispatch audit fact, and returns the A7 notification delivery result. The A7 notification delivery service does not call a partner, dispatch an email/SMS/push/web-channel, post a journal, mutate a balance, mutate a `CustomerPreference` source record, or change a source record through this method.

### 3.2 Dispatcher rules

- A command MUST declare exactly one `productKey`, `productVersion`, `capabilityKey`, `action`, and `productState`.
- A command MUST declare a `customerId`, a `customerWalletId`, a `bindingId`, and a `bindingVersion`. The A7 notification delivery service MUST NOT derive these ids from a virtual-account identifier, a partner reference, a preference value, or product data.
- A command MUST declare a `customerPreferenceId`, a `notificationChannel`, and a `notificationTemplateReference`. The A7 notification delivery service MUST read the `CustomerPreference.notifications` to verify the customer's notification intent for the selected channel. If the customer's notification intent for the selected channel is disabled, the A7 notification delivery service MUST fail closed with `A7_NOTIFICATION_CUSTOMER_PREFERENCE_DISABLED` and MUST NOT dispatch the notification.
- A command MUST declare an `a7ProductCustomerBindingMapReference`, an `a4ProductPolicyDecisionReference`, an `a2AuthorizationContextReference`, and an `a7ProductCommandReference`. The A7 notification delivery service MUST verify each reference against the corresponding authority and MUST NOT re-derive any reference internally.
- A command MUST declare a `notificationPayload` and a `notificationPayloadHash`. The A7 notification delivery service MUST classify every notification payload field through the A6T10 data-classification matrix and MUST reject any notification payload that contains HIGHLY_RESTRICTED or RESTRICTED fields outside the A6T10 audience maximum. A notification payload that contains a secret field (per the A6T10 secret categories) MUST fail closed with `A7_NOTIFICATION_PAYLOAD_SECRET_PRESENT`.
- A command MUST declare a non-empty `idempotencyKey` and a non-empty `requestHash`. The A7 notification delivery service does not trust a caller-supplied request hash; the A7 notification delivery service derives the canonical A7 notification dispatch request hash from the dispatch semantic material.
- A command MUST declare a valid `requestContext` (`requestId`, `correlationId`, `traceId`, `causationId`). The A7 notification delivery service preserves the `requestId`, `correlationId`, `traceId`, and `causationId` exactly as supplied.

## 4. A7 notification delivery state vocabulary

The A7 notification delivery service uses a separate A7 notification delivery state vocabulary that is distinct from the A7 product command/operation state vocabulary (A7T05) and the A7 product state vocabulary (A7T02). The A7 notification delivery state vocabulary is a delivery-lifecycle vocabulary, not a product-lifecycle vocabulary.

```text
A7NotificationDeliveryState:
  PENDING       (A7 notification event has been reserved against the A7 internal idempotency scope; the customer notification intent has not yet been verified; no outbox fact has been published)
  DISPATCHED    (A7 notification event has been admitted; the customer notification intent has been verified; the A7 notification dispatch outbox fact has been published; the A7 notification dispatch audit fact has been recorded)
  SUPPRESSED    (A7 notification event has been suppressed; the customer's notification intent is disabled, revoked, expired, blocked, or unavailable; the A7 notification suppression audit fact has been recorded; no A7 notification dispatch outbox fact is published)
  FAILED        (A7 notification event has failed; the A6T10 data-classification matrix has rejected the notification payload, or the Operations audit/outbox/idempotency evidence is unavailable; the A7 notification failure audit fact has been recorded)
  REPLAYED      (A7 notification event has been replayed; the durable original A7 notification dispatch event has been returned with `replayed: true`; the A7 notification dispatch idempotency scope/key has been completed; no second outbox fact is published)
```

The A7 notification delivery service MUST NOT transition a `DISPATCHED`, `SUPPRESSED`, or `FAILED` record back to `PENDING`. The A7 notification delivery service MUST NOT transition a `REPLAYED` record to a non-terminal state. A7T07 (product lifecycle) owns the broader product lifecycle transitions; the A7 notification delivery service only owns the A7 notification delivery state transitions.

## 5. Notification event identity and dispatch identity

### 5.1 A7 notification event identity

The A7 notification delivery service generates one `notificationEventId` (UUID) and one `notificationEventReference` (deterministic SHA-256 derivative) per A7 notification event. The `notificationEventId` is the durable A7 notification event identity; the `notificationEventReference` is the deterministic derivative of that identity. The A7 notification event identity is distinct from the A7 product command/operation identity (A7T05), the A6T05 external-operation identity (A6T05), the Ledger journal identity, the `CustomerPreference.id`, and the A3 binding identity.

### 5.2 A7 notification dispatch identity

The A7 notification delivery service generates one `notificationDispatchId` (UUID) and one `notificationDispatchReference` (deterministic SHA-256 derivative) per A7 notification dispatch. The `notificationDispatchId` is the durable A7 notification dispatch identity; the `notificationDispatchReference` is the deterministic derivative of that identity. The A7 notification dispatch identity is distinct from the A7 notification event identity, the A7 product command/operation identity (A7T05), the A6T05 external-operation identity (A6T05), the Ledger journal identity, the `CustomerPreference.id`, and the A3 binding identity.

## 6. Normalized A7 notification dispatch request hash

### 6.1 Hash material

The A7 notification delivery service derives the canonical A7 notification dispatch request hash from the dispatch semantic material. The hash material includes:

```text
contractName
contractVersion
productKey
productVersion
capabilityKey
action
productState

customerId
customerWalletId
bindingId
bindingVersion

customerPreferenceId
notificationChannel
notificationTemplateReference

a7ProductCustomerBindingMapReference
a4ProductPolicyDecisionReference
a2AuthorizationContextReference
a7ProductCommandReference
a6ExternalOperationReference

notificationPayloadHash

correlationId
causationId
```

The hash material is serialized as canonical JSON (sorted object keys, declared array order) and hashed with `SHA-256`.

### 6.2 Hash exclusions

The A7 notification delivery service MUST exclude the following values from the hash material because they identify transport, observation, or later-created identity rather than the requested A7 notification dispatch effect:

```text
notificationEventId
notificationEventReference
notificationDispatchId
notificationDispatchReference

idempotencyKey
requestHash                    (caller-supplied; the A7 notification delivery service derives its own canonical hash)
requestId
traceId
createdAt
dispatchedAt
suppressedAt
failedAt
replayed
version
```

### 6.3 Hash derivation

```text
A7NotificationDispatchRequestHash =
  SHA-256(lowercase hex of canonical UTF-8 JSON of A7NotificationDispatchRequestHashInputV1)
```

The A7 notification delivery service MUST derive the canonical A7 notification dispatch request hash from the A7 notification dispatch semantic material and MUST compare it to the caller-supplied `requestHash` exactly. A caller-supplied `requestHash` that does not match the canonical hash MUST fail closed with `A7_NOTIFICATION_REQUEST_HASH_CONFLICT`.

## 7. Customer intent consumption (the only notification intent authority)

### 7.1 CustomerPreference.notifications read contract

The A7 notification delivery service reads the `CustomerPreference.notifications` through the existing `CustomerPreferenceService.getPreferences(customerId)` consumer boundary. The A7 notification delivery service does NOT write a new `CustomerPreference` record, does NOT mutate the `CustomerPreference.notifications` channel flags, does NOT bypass the customer's notification intent, and does NOT invent a parallel preference store. The A7 notification delivery service does NOT treat a `CustomerPreference.notifications` channel flag as A2 authorization or as A4 policy.

### 7.2 Customer intent enforcement

For each A7 notification dispatch, the A7 notification delivery service MUST verify that the customer's `CustomerPreference.notifications` channel flag is enabled for the selected `notificationChannel`:

- If `CustomerPreference.notifications.email` is `false` and the A7 notification dispatch `notificationChannel` is `'email'`, the A7 notification delivery service MUST fail closed with `A7_NOTIFICATION_CUSTOMER_PREFERENCE_DISABLED` and MUST NOT publish the A7 notification dispatch outbox fact.
- If `CustomerPreference.notifications.sms` is `false` and the A7 notification dispatch `notificationChannel` is `'sms'`, the A7 notification delivery service MUST fail closed with `A7_NOTIFICATION_CUSTOMER_PREFERENCE_DISABLED` and MUST NOT publish the A7 notification dispatch outbox fact.
- If `CustomerPreference.notifications.push` is `false` and the A7 notification dispatch `notificationChannel` is `'push'`, the A7 notification delivery service MUST fail closed with `A7_NOTIFICATION_CUSTOMER_PREFERENCE_DISABLED` and MUST NOT publish the A7 notification dispatch outbox fact.
- If `CustomerPreference.notifications.inApp` is `false` and the A7 notification dispatch `notificationChannel` is `'inApp'`, the A7 notification delivery service MUST fail closed with `A7_NOTIFICATION_CUSTOMER_PREFERENCE_DISABLED` and MUST NOT publish the A7 notification dispatch outbox fact.

The A7 notification delivery service MUST also verify that the `CustomerPreference` record exists, is not soft-deleted, and is current. A missing, soft-deleted, or stale `CustomerPreference` record MUST fail closed with `A7_NOTIFICATION_CUSTOMER_PREFERENCE_MISSING` or `A7_NOTIFICATION_CUSTOMER_PREFERENCE_STALE`.

### 7.3 Preference change does not retroactively rewrite past delivery decisions

A change in `CustomerPreference.notifications` (e.g., the customer disabling the email channel) does NOT retroactively rewrite past A7 notification delivery decisions. The change affects only future A7 notification dispatches. The A7 notification delivery service MUST preserve the durable A7 notification dispatch event identity and the durable A7 notification dispatch audit fact, even if the customer later changes the notification intent. The Operations `IdempotencyService` retention interval (default 24 hours) protects the same-key/same-payload replay for the duration of the retention interval.

## 8. Product/provider idempotency behavior

### 8.1 A7 internal idempotency scope

```text
A7NotificationInternalIdempotencyScope = "a7.notification-dispatch.idempotency.v1"
A7NotificationInternalIdempotencyKey   = a7 notification dispatch caller-supplied bounded key
A7NotificationInternalIdempotencyHash  = A7 notification dispatch request hash (A7T06-derived canonical hash)
```

The A7 notification delivery service reserves the A7 internal idempotency scope/key/hash against the shared Operations `IdempotencyService` (the only internal idempotency authority). The A7 notification delivery service MUST use a separate A7 internal idempotency scope from the A7T05 internal idempotency scope and from the A6T05 internal idempotency scope. The A7 internal idempotency scope is a distinct namespace.

### 8.2 A7 provider idempotency (sourced from A6T05)

The A7 notification delivery service does NOT generate or maintain a separate A7 provider idempotency scope. The A7 notification delivery service reads the A6T05 provider idempotency scope/key from the A6T05 `ExternalOperation` record (per ADR-0049) and references it inside the A7 notification dispatch outbox payload as correlation metadata. The A7 notification delivery service MUST NOT issue, refresh, or substitute the A6T05 provider idempotency scope/key.

### 8.3 Same-key/same-payload replay

For a same scope/key with a same request hash, the A7 notification delivery service MUST return the durable original A7 notification dispatch event with `deliveryState: 'REPLAYED'` and `replayed: true` and MUST NOT create a second A7 notification dispatch event, a second A7 notification dispatch outbox fact, a second A7 notification dispatch audit fact, or a second product financial effect.

### 8.4 Same-key/changed-payload conflict

For a same scope/key with a different request hash, the A7 notification delivery service MUST return a deterministic conflict with `deliveryState: 'FAILED'`, `failureCode: 'A7_NOTIFICATION_REQUEST_HASH_CONFLICT'`, and MUST NOT create a second A7 notification dispatch event, a second A7 notification dispatch outbox fact, a second A7 notification dispatch audit fact, or a second product financial effect.

### 8.5 In-progress reservation

For a same scope/key with an in-progress reservation, the A7 notification delivery service MUST return a deterministic conflict with `deliveryState: 'FAILED'`, `failureCode: 'A7_NOTIFICATION_IDEMPOTENCY_IN_PROGRESS'`, and MUST NOT create a second A7 notification dispatch event.

## 9. Operations audit, idempotency, outbox, metrics, diagnostics, and support-trace integration

The A7 notification delivery service records the A7 notification dispatch audit facts through the shared Operations `AuditService` (the only audit authority). The A7 notification delivery service reserves the A7 internal idempotency scope/key through the shared Operations `IdempotencyService` (the only internal idempotency authority). The A7 notification delivery service publishes the A7 notification dispatch outbox fact through the shared Operations `OutboxService` (the only outbox authority). The A7 notification delivery service records the A7 notification dispatch metric through the shared Operations `MetricsService` (the only metrics authority). The A7 notification delivery service records the A7 notification dispatch diagnostic through the shared Operations `DiagnosticsService` (the only diagnostics authority). The A7 notification delivery service produces the A7 notification dispatch support-trace evidence using the canonical internal IDs, the `CustomerPreference.id`, the A6T05 external-operation reference, the A4 product-policy decision reference, the A2 authorization context reference, the A3 binding tuple, the A7 product customer-binding map reference, the A7 product command/operation reference, the A6T10 data-classification matrix entries, and the request/correlation/trace/causation identifiers. The A7 notification delivery service does not introduce a module-local audit, idempotency, outbox, metrics, diagnostics, or support-trace authority.

The A7 notification dispatch audit metadata carries the A7 notification dispatch event identity, the A7 notification dispatch reference, the A7 product command/operation reference, the A7 product customer-binding map reference, the A4 product-policy decision reference, the A2 authorization context reference, the A3 binding tuple, the `CustomerPreference.id`, the A6T05 external-operation reference (if any), the A6T10 data-classification entries applied to the notification payload, the selected `notificationChannel`, the `notificationTemplateReference`, the `notificationPayloadHash`, the canonical A7 notification dispatch request hash, the request/correlation/trace/causation identifiers, the A7 notification delivery state, and the `replayed` flag — and does NOT carry raw credentials, signatures, private keys, full risk/compliance content, raw customer PIN/OTP, or unnecessary customer data.

## 10. A6T10 / A7T10 data controls

The A7 notification delivery service classifies every notification payload field through the existing A6T10 `ExternalDataClassificationRegistry` consumer boundary. The A6T10 data-classification matrix is the only data-classification authority. The A7 notification delivery service:

- MUST reject any notification payload that contains a secret field (per the A6T10 secret categories) with `A7_NOTIFICATION_PAYLOAD_SECRET_PRESENT`.
- MUST reject any notification payload that contains a HIGHLY_RESTRICTED field (per the A6T10 secret categories) outside the SECURITY audience with `A7_NOTIFICATION_PAYLOAD_DISCLOSURE_REJECTED`.
- MUST reject any notification payload field that exceeds the audience maximum for the selected audience (SUPPORT, OPERATIONS, RECONCILIATION, FINANCE, COMPLIANCE, LEGAL, SECURITY, A6_TEN_INTERNAL) with `A7_NOTIFICATION_PAYLOAD_DISCLOSURE_AUDIENCE_TOO_LOW`.
- MUST record the A6T10 data-classification entries applied to the notification payload in the A7 notification dispatch audit metadata and the A7 notification dispatch outbox payload.
- MUST NOT transmit raw credentials, PAN/account secrets, customer PIN/OTP, callback signatures, raw risk/compliance content, or unnecessary customer data in the notification payload, audit metadata, or outbox payload.

The A7 notification delivery service honors the A6T10 retention, legal hold, consent, and disclosure rules for the notification payload. The A6T10 data-classification matrix, the A6T10 retention matrix, the A6T10 legal hold, the A6T10 consent assertion, and the A6T10 disclosure rules remain the only authority for the notification payload classification, retention, hold, consent, and disclosure.

## 11. Bounded retry, suppression, manual review, and unknown outcome delivery states

The A7 notification delivery service represents the bounded A7 notification delivery lifecycle as a finite set of delivery states (per §4). The A7 notification delivery service:

- MAY be retried by the caller for `PENDING` or `FAILED` deliveries (via a new `dispatchNotification` call with the same `idempotencyKey` and a fresh `requestHash` only if the A7 notification dispatch semantic material has changed; otherwise the caller MUST consume the replayed durable original).
- MUST be suppressed when the customer's notification intent is disabled, revoked, expired, blocked, or unavailable. The A7 notification delivery service MUST record the suppression audit fact and MUST NOT publish the A7 notification dispatch outbox fact.
- MAY be placed in `FAILED` for Operations audit/outbox/idempotency evidence unavailability or for A6T10 data-classification rejection. The A7 notification delivery service MUST record the failure audit fact.
- MUST NOT be retried blindly with a new A7 notification dispatch event identity, a new A7 notification dispatch outbox fact, a new A7 notification dispatch audit fact, or a new product financial effect.
- MUST NOT treat a missing customer notification intent, a revoked customer notification intent, or an expired customer notification intent as a successful delivery.

The A7 notification delivery service does NOT introduce an unbounded retry loop, a product-specific scheduler, or a module-local retry authority. The A7 notification delivery service relies on the caller to drive the retry, suppression, manual review, and unknown outcome flow; the A7 notification delivery service only owns the A7 notification delivery state transition.

## 12. A2 audience/authorization enforcement for any internal control surface

The A7 notification delivery service enforces A2 audience/authorization for any internal control surface that consumes the A7 notification delivery handoff. The A2 `AuthorizationService` is the only authorization authority. The A7 notification delivery service MUST record the A2 authorization context reference and MUST NOT issue, refresh, or substitute the A2 authorization context. The A7 notification delivery service MUST refuse to dispatch an A7 notification if the A2 authorization context is missing, stale, denied, or unavailable. A missing, stale, or denied A2 authorization context MUST fail closed with `A7_NOTIFICATION_A2_AUTHORIZATION_MISSING`, `A7_NOTIFICATION_A2_AUTHORIZATION_STALE`, or `A7_NOTIFICATION_A2_AUTHORIZATION_DENIED`.

## 13. Tokenized or reference-only handoff from the A7 notification delivery to A7T07/A7T08

The A7 notification delivery service issues the A7 notification delivery handoff as a tokenized, reference-only artifact. The A7 notification delivery handoff carries only the safe cross-domain references and never raw credentials, signatures, private keys, or unrestricted customer data. The A7 notification delivery handoff is consumed by A7T07 (product lifecycle) and A7T08 (product financial effect) for correlation only; the A7 notification delivery handoff is not a financial command, not an A2 authorization, not an A3 binding repair, not an A4 policy decision, and not a Ledger record.

## 14. Tests and validation

The A7 notification delivery consumer-boundary contract is tested by:

- A7 notification delivery dispatcher, channel selection, deduplication, and template reference tests.
- `CustomerPreference.notifications` read contract tests that verify the A7 notification delivery service fails closed for missing, soft-deleted, stale, revoked, expired, blocked, or disabled `CustomerPreference` records.
- A6T10 data-classification tests that verify the A7 notification delivery service fails closed for HIGHLY_RESTRICTED, RESTRICTED, secret, or audience-mismatched notification payloads.
- Same-key/same-payload replay tests that verify the A7 notification delivery service returns the durable original A7 notification dispatch event with `deliveryState: 'REPLAYED'` and does not create a second A7 notification dispatch event, a second A7 notification dispatch outbox fact, a second A7 notification dispatch audit fact, or a second product financial effect.
- Same-key/changed-payload conflict tests that verify the A7 notification delivery service returns a deterministic conflict with `deliveryState: 'FAILED'` and `failureCode: 'A7_NOTIFICATION_REQUEST_HASH_CONFLICT'`.
- In-progress reservation tests that verify the A7 notification delivery service returns a deterministic conflict with `deliveryState: 'FAILED'` and `failureCode: 'A7_NOTIFICATION_IDEMPOTENCY_IN_PROGRESS'`.
- Operations audit evidence availability tests that verify the A7 notification delivery service fails closed when the Operations audit/outbox/idempotency evidence is unavailable.
- Sensitive-data, redaction, consent, access-scope, retention, and no-secret-leakage tests that verify the A7 notification delivery service does not include raw credentials, signatures, private keys, full risk/compliance content, or unnecessary customer data in the notification payload, audit metadata, or outbox payload.
- No-source-mutation tests that verify the A7 notification delivery service does not mutate `CustomerPreference`, the A2 authorization context, the A3 binding record, the A4 product-policy decision, the A7 product command/operation record, the A7 product customer-binding map record, the A6T05 external-operation record, or the A6T10 data-classification matrix.

## 15. Prohibited edges

The A7 notification delivery service MUST NOT:

- treat a notification delivery record, an A7 notification event identity, an A7 notification dispatch identity, an A6 partner reference, a virtual-account identifier, a bank code, a bank account number, a payment reference, a funding-instrument identifier, a beneficiary identifier, a preference value, a product data value, or a customer reference as `Customer.id`, `CustomerWallet.id`, `WalletAccount.id`, or `LedgerAccount.id`;
- treat a notification delivery record, an A7 notification event identity, an A7 notification dispatch identity, a `CustomerPreference` channel flag, an A4 product-policy decision, or a preference value as A2 authorization;
- write a new `CustomerPreference` record, mutate the `CustomerPreference.notifications` channel flags, or bypass the customer's notification intent;
- treat a missing, revoked, expired, or disabled `CustomerPreference.notifications` channel flag as a successful delivery;
- treat a notification delivery as an A3 binding repair, an A4 product-policy decision, or a Ledger record;
- write a second A7 notification dispatch event, a second A7 notification dispatch outbox fact, a second A7 notification dispatch audit fact, or a second product financial effect for a same-key/same-payload replay;
- write a second A7 notification dispatch event, a second A7 notification dispatch outbox fact, a second A7 notification dispatch audit fact, or a second product financial effect for a same-key/changed-payload conflict (a deterministic conflict must be returned instead);
- write a second A7 notification dispatch event, a second A7 notification dispatch outbox fact, a second A7 notification dispatch audit fact, or a second product financial effect for an in-progress reservation (a deterministic conflict must be returned instead);
- include raw credentials, raw signatures, raw private keys, raw customer PIN/OTP, raw risk/compliance content, or unnecessary customer data in the notification payload, audit metadata, or outbox payload;
- transmit HIGHLY_RESTRICTED or RESTRICTED fields outside the A6T10 audience maximum;
- transmit a secret field (per the A6T10 secret categories) in any form (raw, hashed, redacted, or otherwise) in the notification payload, audit metadata, or outbox payload;
- call a bank, NIBSS, partner, SMS provider, email provider, push provider, or any external channel from Customer, Wallet, Ledger, A5, A6, Reconciliation, diagnostics, readiness, support, or an unapproved controller instead of the A6 partner boundary or the A7 notification dispatcher boundary;
- create a second customer intent, consent, or preference authority;
- create a second audit authority, idempotency authority, outbox authority, metrics authority, or diagnostics authority;
- retry an ambiguous A7 notification outcome with a new A7 notification dispatch event identity, a new A7 notification dispatch outbox fact, a new A7 notification dispatch audit fact, or a new product financial effect;
- expose a public, customer, mobile, web, or partner channel;
- introduce a public, mobile, web, partner, or push provider;
- introduce a live email, SMS, push, or web-channel provider;
- implement A7T07, A7T08, A7T09, A7T10, A7T11, or any later A7 task;
- begin A8 (Scale & Selective Extraction) or any product-roadmap expansion beyond the first selected product.

## 16. Versioning rules

- The A7 notification delivery contract version `A7-NOTIFICATION-DELIVERY` v1 defines this contract. A patch revision may clarify documentation; a minor revision may add optional fields, optional evidence sources, or a second frozen notification dispatch shape; a major revision is required for any change to required fields, identity semantics, request-hash semantics, idempotency semantics, A6T10 correlation semantics, A2/A3/A4 correlation semantics, `CustomerPreference.notifications` correlation semantics, or the first product's notification delivery envelope.
- Every A7 notification event, A7 notification dispatch, replay, conflict, and handoff identifies the contract version that produced it. Historical evidence remains interpretable under the version that produced it.
- A retired contract version MUST NOT be reactivated. A successor contract MUST be a new contract version with a new ADR.
- The A7 notification delivery service does not introduce a parallel `CustomerPreference` authority, a parallel A6T10 data-classification authority, a parallel A2 authorization authority, a parallel A3 binding authority, a parallel A4 product-policy authority, a parallel A7 product catalog authority, a parallel A7 product customer-binding map authority, a parallel A7 product command/operation authority, a parallel A6T05 external-operation authority, a parallel A5 internal transfer authority, a parallel Wallet authority, a parallel Ledger authority, a parallel Operations audit authority, a parallel Operations idempotency authority, a parallel Operations outbox authority, a parallel Operations metrics authority, a parallel Operations diagnostics authority, a parallel Reconciliation authority, or a parallel notification authority.

## 17. A7T06 verification record

- [x] A7 notification delivery dispatcher boundary and outbox contract defined as a read-write contract against the shared Operations `IdempotencyService`, `AuditService`, and `OutboxService`; the existing `CustomerPreference` and A6T10 data-classification sources are read without mutation; the existing Operations `IdempotencyService`/`AuditService`/`OutboxService` are reused (reused as-is, without modification).
- [x] `CustomerPreference.notifications` (the existing `customer-preference` module) is the only source of the customer notification intent; the A7 notification delivery service consumes it through a read-only consumer boundary and does NOT write a new customer intent, consent, or preference record.
- [x] A6T10 data-classification matrix is the only source of the notification payload classification; the A7 notification delivery service classifies every notification payload field through the A6T10 registry and rejects HIGHLY_RESTRICTED, RESTRICTED, secret, or audience-mismatched fields.
- [x] A3 binding tuple is the only source of `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`; the A7 notification delivery service does NOT infer an internal account from a notification identifier, a preference value, a partner reference, a virtual-account identifier, or product data.
- [x] A7 product command/operation identity (A7T05) is the only source of the A7 product command/operation reference; the A7 notification delivery service does NOT derive the A7 product command reference from any other source.
- [x] A2 authorization context is the only source of authorization; the A7 notification delivery service does NOT issue, refresh, or substitute the A2 authorization context.
- [x] A4 product-policy decision reference is the only source of the A4 product-policy decision; the A7 notification delivery service does NOT evaluate, mutate, or refresh the A4 product-policy decision.
- [x] A7 internal idempotency scope (`a7.notification-dispatch.idempotency.v1`) is separate from the A7T05 internal idempotency scope and from the A6T05 internal idempotency scope; the A7 provider idempotency scope is sourced from A6T05 (per ADR-0049) and is NOT generated or maintained by the A7 notification delivery service.
- [x] Same-key/same-payload replay returns the durable original A7 notification dispatch event with `deliveryState: 'REPLAYED'` and does NOT create a second A7 notification dispatch event, a second A7 notification dispatch outbox fact, a second A7 notification dispatch audit fact, or a second product financial effect.
- [x] Same-key/changed-payload conflict returns a deterministic conflict with `failureCode: 'A7_NOTIFICATION_REQUEST_HASH_CONFLICT'` and does NOT create a second A7 notification dispatch event, a second A7 notification dispatch outbox fact, a second A7 notification dispatch audit fact, or a second product financial effect.
- [x] In-progress reservation returns a deterministic conflict with `failureCode: 'A7_NOTIFICATION_IDEMPOTENCY_IN_PROGRESS'` and does NOT create a second A7 notification dispatch event.
- [x] A change in `CustomerPreference.notifications` does NOT retroactively rewrite past A7 notification delivery decisions; the change affects only future A7 notification dispatches.
- [x] A7 notification delivery service does NOT include raw credentials, raw signatures, raw private keys, raw customer PIN/OTP, raw risk/compliance content, or unnecessary customer data in the notification payload, audit metadata, or outbox payload.
- [x] A7 notification delivery service fails closed for missing, stale, denied, or unavailable A2 authorization; missing, soft-deleted, stale, revoked, expired, blocked, or disabled `CustomerPreference`; missing, stale, expired, denied, or unavailable A4 product-policy decision; A6T10 data-classification rejection; and Operations audit/outbox/idempotency evidence unavailability.
- [x] A2 / A3 / A4 / A5 / A6 / A6T10 / A7 product catalog / A7 product-policy profile / A7 product customer-binding / A7 product command / `CustomerPreference` / Wallet / Ledger / Operations / Outbox / Reconciliation authorities remain separate.
- [x] No A7 runtime notification delivery service, entity, migration, repository, controller, API, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, or A8 work is introduced by A7T06.
- [x] A7T06 introduces no public, mobile, web, partner, or push provider; no live email, SMS, push, or web-channel provider; only the dispatcher boundary, the outbox contract, the audit/idempotency integration, and the consumer-boundary contract are committed.

## 18. A7T06 handoff to later A7 tasks

This contract is consumed later as follows:

- **A7T07:** consumes the A7 notification delivery handoff to correlate the A7 notification delivery state with the A7 product lifecycle transitions and to trigger A4 re-evaluation when the A7 notification delivery state changes.
- **A7T08:** does NOT consume the A7 notification delivery envelope; A7T08 consumes the A7T05 product command/operation identity and the A6T08 settlement, suspense, and compensating-entry contracts.
- **A7T09:** consumes the A7 notification delivery handoff as part of the A7 product reconciliation evidence (the A7 notification delivery is a non-financial, non-notification fact, but it is part of the A7 product operation correlation).
- **A7T10:** consumes the A7 notification delivery envelope fields for the A7T10 data-classification matrix (the A7T10 data controls extend the A6T10 data controls; the A7 notification delivery envelope is a read-only consumer of both).
- **A7T11:** records the A7 notification delivery evidence in the A7 release-gate package.

No later task may weaken the `CustomerPreference.notifications` consumer-boundary, the A6T10 data-classification correlation, the A2 authorization consumer-boundary, the A3 binding consumer-boundary, the A4 product-policy consumer-boundary, the A7 product catalog, the A7 product-policy profile, the A7 product customer-binding map, the A7 product command/operation identity, the A6T05 external-operation identity, the canonical A7 notification dispatch request hash, the A7 notification delivery state vocabulary, or the handoff.

## 19. Authoring note

The A7 plan reserves the proposed A7 ADR range `ADR-0054` through `ADR-0060`. ADR-0054 records the A7T02 product-catalog freeze. A7T03 introduced the A7 product-policy profile. A7T04 introduced the A7 product customer-binding. A7T05 introduced the A7 product command/operation identity. A7T06 introduces the A7 notification delivery dispatcher boundary, the outbox contract, the audit/idempotency integration, and the consumer-boundary contract; A7T06 is a documentation and consumer-boundary artifact; A7T06 does NOT introduce a new runtime code, entity, migration, repository, service, controller, API, route, scheduler, notification dispatcher, public channel, fee, commission, settlement, reconciliation, or A8 work. A7T11 will record the A7T06 ADR-0055-or-later authoring evidence as part of the A7 release-gate package.
