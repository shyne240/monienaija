# Transaction notification controls (H-04 / H-06)

The owner-approved policy makes all financial-transaction notifications configurable. The existing notification registry and its maker-checker workflow remain the source of truth. Earlier mission reports are historical records of the previous policy, not the current decision.

## Controls and scope

Each ordinary registry event has independently versioned `EVENT`, `SMS`, and `EMAIL` configuration rows. A customer notification can be sent on a channel only when both the event and that channel are enabled, in addition to the existing recipient, verified-contact, preference, provider, and delivery-reliability checks. These controls cover funding requests and outcomes; deposit and withdrawal completion/failure; transfer completion/failure/unknown; and cash-to-cash creation, claim, and expiry. No financial event is mandatory or locked. Direct SECURITY events remain outside this ordinary event-control path and retain their existing locks and security behavior.

`transfer.unknown` is an independent event, not an alias of `transfer.failed`. On upgrade its initial channel settings copy the then-current `transfer.failed` settings once; changes thereafter are independent. The existing cash-to-cash claim and expiry spelling aliases refer to the same underlying event, not separate transaction types. An unregistered phone-only beneficiary has no authoritative email address; email cannot be sent without an eligible CUSTOMER recipient and verified email contact.

These controls and mappings do not themselves create outbox facts. No production notification outbox producer was identified for `transfer.unknown`, `cash_to_cash.claimed`, or `cash_to_cash.expired`; the claim/expiry services currently write audit actions. Their configuration does not imply that those notifications are emitted automatically.

Newly created deposit and withdrawal controls start disabled at both the event and channel levels. Any pre-existing channel settings are preserved. Existing ordinary events start with their event-wide control enabled. Migration 103 repairs previously locked or misclassified financial configuration rows, records the changes in the audit trail, preserves SECURITY rows, and does not overwrite governed settings or template history.

## Governed API

An authorized MFA-backed maker reads `GET /api/v1/internal/notifications/events`. For ordinary events, the response includes `eventEnabled`, `eventLocked`, `eventConfigurationVersion`, and the existing per-channel `enabled`, `locked`, and `configurationVersion` values.

Submit a separate `CONFIGURATION` proposal for each changed target to `POST /api/v1/internal/notifications/changes`, using the current version of that target. For example, to propose enabling the event master on a freshly migrated deposit event:

```json
{
  "type": "CONFIGURATION",
  "eventType": "deposit.completed",
  "channel": "EVENT",
  "enabled": true,
  "expectedVersion": 1,
  "reason": "Enable deposit completion notifications"
}
```

Use `channel: "SMS"` or `channel: "EMAIL"` and the corresponding channel version for those controls. A separate authorized checker must approve through the existing workforce approval endpoint, then execute the stored proposal through `POST /api/v1/internal/notifications/changes/{approvalId}/execute`. Stale versions and unauthorized, self-approved, locked, or altered requests remain rejected. Setting `EVENT` does not modify either channel, and changing one event does not modify another. Template editing still accepts only `SMS` or `EMAIL`, not `EVENT`.

The admin event table displays the event-master state and warns when it is disabled. Its existing channel configuration form does **not** yet provide an event-master toggle; the governed API is the supported path for changing that setting. Admin Web therefore does **not** yet fully satisfy the owner's event-level configuration requirement.

### Frontend completion item

Add an event-master enable/disable control to the existing notification-management workflow. It must submit a separate `CONFIGURATION` proposal for `channel: "EVENT"` with the event's current configuration version and use the existing maker-checker approval and execution flow. It must not alter the SMS or EMAIL settings. Cover the control and its approval/version states in Admin Web tests, and coordinate overlapping notification-management changes with the Arena 2 F-01/F-05 owner. No notification-system redesign or direct, ungoverned update is required.

## Delivery and rollout boundaries

Deposit/withdrawal recipients are derived from the committed payment, wallet, and existing customer, not from an asserted customer in the outbox payload. A mismatched aggregate, status, payment identity, or explicit customer claim is quarantined. Delivery identity is stable per payment outcome, recipient, and channel. Notification payloads and templates omit journal IDs and raw failure text. Payment, ledger, and settlement logic are unchanged.

Workers recheck both controls, including under database row locks immediately before marking an attempt `STARTED`. Disabled work may leave a `SKIPPED` delivery and a materialization receipt for diagnostics; enabling a control later does not retroactively resend it, and previously quarantined facts are not automatically replayed. Workers suppress disabled pending/retry work, but a provider request already started cannot be recalled. Migration 103 refuses destructive rollback: old binaries cannot enforce event-wide controls. Any future rollout or rollback requires coordinated worker/fleet upgrades, stop/drain and egress fencing, and a separately authorized recovery plan. The accepted H-07 key custody, binding, reapproval, and provider-activation gates remain in force. No deployment, production credentials, external vendor activation, or live send is authorized by this change.
