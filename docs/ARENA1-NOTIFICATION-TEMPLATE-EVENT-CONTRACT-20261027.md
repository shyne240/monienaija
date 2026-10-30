# Notification template and event configuration foundation

**Arena 2 integration contract** · Baseline `5206d8f52b0deccba31149c6e600d9e0d774a6cb` · 2026-10-27

## Boundary and rollout

This delivers persistent SMS and EMAIL **templates and event configuration**, not an email provider or email delivery. Existing SMS outbox, delivery identity `(event_key, recipient_id, channel)`, provider, preferences and bounded retry remain in use. No public locator, C2C outbox wiring, Admin Web screen or financial posting was added. The security-critical direct-send paths remain outside this registry and outside the outbox.

Migration `1785753600097-CreateNotificationTemplateRegistry` must be applied through the normal reviewed deployment migration process **before** the new application version is started. It adds `notification_event_configurations`, `notification_templates` and `notification_change_requests`, constraints, indexes and immutability triggers; it seeds 20 ordinary event types for each channel, plus six locked SECURITY channel rows. It does not widen `notification_deliveries` or alter financial tables. No production migration or deployment was performed in this workspace.

Ordinary SMS configuration defaults enabled, preserving the existing event/pref path; ordinary EMAIL configuration defaults disabled. Every ordinary event has an SMS and an EMAIL version 1; email has a plain-text subject and body, but **even setting EMAIL enabled does not send or resolve email**. An email owner must later integrate provider, recipient resolution, preference handling, subject delivery, delivery schema/diagnostics and tests. SMS-only deployments must not interpret an email configuration flag as delivery readiness. Only locale `en-NG` is supported in V1.

There is no runtime fallback to a built-in template if an expected active DB version/configuration is missing. The SMS event fails closed; the outbox is marked `FAILED` with `NOTIFICATION_DISPATCH_FAILED`, and becomes eligible after its `available_at` retry delay. Unknown mapped-free events generate no notification. A direct compatibility call to `buildMessage` for an unknown event returns a fixed generic message, never the internal event name.

## Authentication and separation of duties

All routes below use the normal `/api/v1` prefix and an authenticated **workforce session**, not customer/agent bearer tokens or client-supplied actor IDs. Existing global read-only enforcement remains in force.

- **Read** events, templates and changes: the existing `notification.view_deliveries` function, or an MFA `FINANCE_CONTROLLER` checker so that checker can inspect proposals. `FINANCE_AUDITOR` can use permitted GETs, but the existing read-only guard blocks POST preview.
- **Request** a change: `SUPER_ADMIN`, existing `notification.view_deliveries`, MFA, and a non-read-only principal. This is an interim, deliberately narrow role gate using the existing authorization catalogue; no new catalogue function or role was silently assigned.
- **Approve/reject**: an independent `FINANCE_CONTROLLER` with `privileged:approve` and MFA through the existing privileged-action approval endpoint. The maker and checker must be different principal IDs, even if one principal has both roles. Inspect the `approved` boolean in the response; a self-approval attempt can return HTTP 201 with `approved: false` and `reason: SELF_APPROVAL_FORBIDDEN`.
- **Execute**: only the same independent checker who approved, still holding the checker role/scope with MFA. A general `privileged:execute` delegate, the maker, or another checker cannot execute this change.

**Integration dependency:** the authorization owner should approve this interim `SUPER_ADMIN`/`FINANCE_CONTROLLER` split and decide whether to provision notification-specific maker/checker/view functions as proposed in the Arena 3 audit. Until that governed catalogue work is agreed, do not assume the generic read function is an edit permission. All edits already require dual control. No blanket approval or role policy is implied by this implementation.

## Event and template APIs

All JSON field names are case-sensitive. Unrecognized body fields are rejected. `channel` is `SMS` or `EMAIL`; `locale` defaults to `en-NG` and any other value is rejected. Read responses contain template content, not destinations or customer data.

### `GET /api/v1/internal/notifications/events`

Returns `{ "items": [...] }`. Each item has:

```json
{
  "eventType": "customer.funding.approved",
  "deliveryClass": "TRANSACTIONAL",
  "editable": true,
  "variables": ["reference", "amount_clause"],
  "channels": {
    "SMS": { "enabled": true, "locked": false, "configurationVersion": 1, "activeTemplateVersion": 1 },
    "EMAIL": { "enabled": false, "locked": false, "configurationVersion": 1, "activeTemplateVersion": 1 }
  }
}
```

SECURITY entries have `editable: false`, an empty `variables` list, `locked: true` and `activeTemplateVersion: null` for both channels. Their SMS flag is informational and permanently true; EMAIL is permanently false. The fixed direct-send security implementations do **not** depend on the configuration table and are not suppressible by these controls.

### `GET /api/v1/internal/notifications/templates`

Required query: `eventType`, `channel`. Optional: `locale`, `limit` (1–100, default 50), `beforeVersion` (positive integer). Returns `{ eventType, channel, locale, items, nextBeforeVersion }`, newest first. Each item is `{ id, eventType, channel, locale, version, active, subject, body, createdBy, createdAt }`. `subject` is `null` for SMS. Pass `nextBeforeVersion` as `beforeVersion` to page; `null` means no further page. Versions are immutable; exactly one active version is enforced for each ordinary event/channel/locale.

### `POST /api/v1/internal/notifications/templates/preview`

Preview never sends or writes and uses **fixed synthetic data defined in code**. The request cannot supply sample values, customer IDs, a recipient or payload fields.

```json
{ "eventType": "customer.funding.approved", "channel": "EMAIL", "locale": "en-NG", "subject": "Funding update", "body": "Funding{{amount_clause}} approved. Ref {{reference}}." }
```

Response is `{ eventType, channel, locale, subject, body, variablesUsed }`. To preview the active version, omit both `body` and `subject`. For an SMS draft, omit `subject` or set it to `null`; EMAIL drafts require a nonempty subject. Templates are plain text, not HTML. Display them as text in the UI; any future HTML email transport must escape output and must not reinterpret template syntax.

## Change/approval API

### `POST /api/v1/internal/notifications/changes` — maker

All configuration and template changes require approval. The response is HTTP 201:

```json
{ "approvalId": "<uuid>", "status": "REQUESTED", "actionType": "NOTIFICATION_TEMPLATE_CHANGE", "actionFingerprint": "<sha256>", "requestedAt": "<timestamp>", "expiresAt": "<timestamp>" }
```

Template new version (for EMAIL provide a nonempty `subject`; for SMS omit it or use `null`):

```json
{ "type": "TEMPLATE", "eventType": "customer.funding.approved", "channel": "SMS", "locale": "en-NG", "body": "Your funding{{amount_clause}} is approved. Ref {{reference}}.", "expectedVersion": 1, "reason": "Improve notification wording" }
```

Rollback is a **new** version copied from the indicated historical version; it is not reactivation or mutation of the old row:

```json
{ "type": "TEMPLATE_ROLLBACK", "eventType": "customer.funding.approved", "channel": "SMS", "locale": "en-NG", "sourceVersion": 1, "expectedVersion": 2, "reason": "Restore earlier wording" }
```

Channel enablement change (`expectedVersion` here is the **configuration** version, not the template version):

```json
{ "type": "CONFIGURATION", "eventType": "customer.funding.approved", "channel": "SMS", "enabled": false, "expectedVersion": 1, "reason": "Pause this event" }
```

`expectedVersion` and `sourceVersion` are JSON positive integers. Reason is required, trimmed, 5–500 characters and subject to safety checks; never include secrets or personal data. The server persists the normalized, immutable proposal and approval together, then binds the full payload to an action/resource fingerprint. The rollback content is copied into that frozen proposal at request time. A generic manually created privileged approval has no proposal row and cannot execute a registry change.

### `GET /api/v1/internal/notifications/changes`

Optional query: `status` (`REQUESTED`, `APPROVED`, `REJECTED`, `CANCELLED`, `CONSUMED`, `EXPIRED`), `page` (1–1000, default 1), `limit` (1–100, default 25). Returns `{ page, limit, hasMore, items }`; each summary has `{ approvalId, type, eventType, channel, createdBy, createdAt, status, approvedBy, expiresAt }`. An elapsed `expiresAt` can precede persisted `EXPIRED` status until the approval service evaluates it; do not treat an elapsed approval as actionable.

### `GET /api/v1/internal/notifications/changes/{approvalId}`

Returns `{ approvalId, change, reason, createdBy, createdAt, status, requestedBy, approvedBy, expiresAt }`. Review this frozen proposal before approving. A rollback proposal includes the copied `body`, `subject`, `sourceVersion` and `expectedVersion`.

### Checker decision and execution

1. `POST /api/v1/internal/a2/workforce/approvals/{approvalId}/approve` with `{ "comment": "Reviewed" }`, or `/reject` with an appropriate comment/reason. These are the existing approval endpoints. Do not treat HTTP success alone as approval; inspect `approved` and `reason`.
2. The **same checker** calls `POST /api/v1/internal/notifications/changes/{approvalId}/execute` with `{}` (or no body). No replacement content is accepted. Successful template execution returns `{ approvalId, type, template }`; configuration execution returns `{ approvalId, type, eventType, channel, enabled, version }`.

Approval consumption, version/configuration write and immutable audit insertion occur in one PostgreSQL transaction. Concurrent/stale proposals fail with 409 rather than overwriting newer work; failed execution rolls the consumed state back. Re-review and submit a fresh proposal with the current version. Replaying a consumed approval is rejected. No endpoint grants a direct edit or reactivates an old version.

Typical errors: 400 invalid channel, locale, fields, variables, content or SECURITY template attempt; 401 missing/invalid session; 403 wrong role/scope, no MFA, self/delegate execution or locked operation; 404 absent proposal/version; 409 stale/unapproved/consumed change; 500 generic persistence failure. Self-approval denial uses the existing approval response semantics described above. Never display raw SQL/provider errors.

## Variables and security guarantees

The **code**, not database records or the client, selects permitted variables per event. The event catalogue response is the UI source of truth. The frozen V1 snapshot is `src/notification/notification-defaults-v1.ts`:

- `reference`: short, restricted public-reference/UUID-prefix derivation; unsafe/unrecognized values become `your request`. It does not traverse objects or expose arbitrary fields. Producers must still never put a secret into a public reference.
- `amount_clause`: empty when absent/invalid; otherwise ` of NGN <major>.<two digits>` from a valid nonnegative minor-unit amount, formatted with exact integer arithmetic.
- `status`: only on `support.ticket.status_changed`; one of the fixed code-defined status values, otherwise `updated`.

Only exact `{{name}}` placeholders in the event allowlist are recognized. Expressions, property paths, unmatched braces, unknown names, HTML/control characters, credential-related words, long literal digit sequences, literal URLs and literal email addresses are rejected. SMS body is bounded to 1,000 characters, email body 4,000, email subject 200 with no newline; worst-case allowed substitutions are checked on submission and post-render limits also apply. `assertSafe()` now rejects unsafe text and is invoked for templates and rendered output. This is defense in depth, **not** a universal data-loss-prevention scanner: approved human-authored literal text can still contain an unrecognizable secret, so maker/checker review and restricting DB/DDL privileges remain mandatory.

The only V1 SECURITY event types are `customer.registration.phone_verification`, `customer.credentials.temporary_credential`, and `agent.desk.customer_otp`. Registry APIs reject their templates/config changes, database triggers prevent editable templates and locked-row mutation, and the ordinary outbox dispatcher explicitly refuses them. Direct OTP/credential senders remain unchanged. Adding a future SECURITY event requires a code-reviewed taxonomy change and a corresponding migration; never introduce one as an ordinary editable template.

`cash_to_cash.created` is a **safety-related wording change**: its default ordinary message no longer renders `senderPhone`, `transferNumber` or the secret transfer code; existing failed messages containing the old detectable pair are suppressed on retry. No beneficiary event was wired, no sender-name/locator URL was invented, and no SMS release-gate claim is made. This conflicts with the earlier six-digit contract's pair-rendering wording; product/security owners must explicitly reconcile or supersede that wording before rollout (audit decision D-N7). Historical SENT/other stored messages are not retroactively erased. The UI and Arena 3 must not infer that the open beneficiary-SMS/locator decisions are resolved.

All ordinary events, including transactional outcomes, are initially toggleable; the audit's proposed additional locks for required events remain product decision D-N8. The security-only lock above is enforced now. For `support.ticket.status_changed`, enablement is evaluated against the **source event** even when RESOLVED/CLOSED selects a different template. Existing aliases `transfer.unknown`, `cash-to-cash.claimed` and `cash-to-cash.expired` resolve to their canonical event settings.

## Operations and integration dependencies

- Version payloads and proposals are persisted as plain text for authorized review. Audit records contain actor, approval ID, version and body/subject hashes—not the template body—and the existing `audit_events` update/delete trigger makes them immutable for ordinary database operations. Database owners with TRUNCATE/DDL/superuser privilege can bypass table triggers; restrict those privileges and keep normal audit backups.
- Deactivation/activation of a new template, config updates and audit records are atomic. Template rows allow only active-to-inactive state change; content/history cannot be edited or deleted. The migration's down path refuses to remove the registry after any governed proposal, later template version or config change.
- An SMS event disabled before a dispatch is persisted `SKIPPED/EVENT_DISABLED` under the usual idempotency key. The retry worker checks config before resending a FAILED SMS and suppresses it if disabled. Re-enabling does not replay already-SKIPPED records. A provider call already in flight can complete after a toggle; stopping/quiescing workers is necessary if an operational change needs a hard delivery barrier. Customer SMS opt-out continues to apply to ordinary events.
- Monitor failed outbox events with `last_error = 'NOTIFICATION_DISPATCH_FAILED'`, missing active versions/configs, approval backlog and failed/skipped deliveries. The new outbox failure path stores a generic error rather than SQL parameters and honors `available_at` before retry. Restore the dependency or approved configuration, then allow retry; do not fabricate deliveries or post financial journals.
- New ordinary events and allowed variables require reviewed code and an additive migration/seed. Do not add executable expressions or customer DB fields through the database. Keep the V1 seed snapshot immutable after release.
- No Admin Web, EMAIL transport, public locator, C2C notification enqueue/destination resolution or live test-send endpoint is included. A future EMAIL sender must explicitly consult `isEventEnabled`, resolve verified recipients, honor email preferences and safely use the active EMAIL subject/body. Agent SMS still depends on an authoritative agent contact model; PUSH behavior remains its existing dependency path.

## Verification evidence

- `npm run build` — PASS.
- `npx jest --runInBand` — **195 backend suites / 1,980 tests PASS**.
- Real PostgreSQL: `npx jest --config jest.integration.config.js --runInBand --runTestsByPath` for `notification-registry`, `v1-005-notification-delivery`, `v1-006-customer-notification-inbox`, `sms-v1-01`, `v1-hardening-09-admin-notification-delivery-diagnostics`, `migration-chain`, and `v1-commercial-rule-governance` integration specs — **7 suites / 117 tests PASS**.
- Targeted ESLint on the changed production modules, migration, new tests and shared migration/PG harness — PASS.

The database tests include a full empty-database migration chain and seed, real MFA workforce sessions/HTTP authorization, maker-checker and self-approval rejection, approved SMS/EMAIL versioning, rollback, immutable audit/history, locked security rows, safe fixed-data preview, duplicate delivery suppression, event disable/reenable and retry behavior, concurrent stale changes, and audit-failure rollback/recovery. These checks do not constitute a full-platform integration or production rollout claim.
