# ARENA 2 — SMS & Email Notification Management: API Contract & Cross-Arena Dependency Specification

- **Date:** 2026-10-27
- **Branch:** `arena/ea070127-monienaija` (ARENA 2 — Admin Web Frontend)
- **Integrated Baseline SHA:** `5206d8f52b0deccba31149c6e600d9e0d774a6cb`
- **Reference Infrastructure Audit:** `docs/ARENA3-NOTIFICATION-INFRASTRUCTURE-AUDIT-20261027.md`

---

## 1. Purpose & Ownership Boundaries

This document establishes the explicit HTTP contract, TypeScript payload schemas, authorization function gates, maker-checker governance semantics, and runtime readiness states coordinating **ARENA 1**, **ARENA 2**, and **ARENA 3** for MonieNaija SMS and Email Notification Management:

| Arena | Ownership Scope |
|---|---|
| **ARENA 1** | Notification template registry (`notification_templates`), per-event approved variable resolvers, server-side safe template preview, notification event catalogue configuration (`notification_event_configurations`), trigger toggles, and Cash-to-Cash beneficiary SMS non-disclosure template (`cash_to_cash.created`). |
| **ARENA 2 (this branch)** | Complete Admin Web SMS & Email Notification Management UI (`NotificationManagementScreen`, `NotificationTemplateWorkspace`), typed API integration boundary (`notification-management-api.ts`), client-side validation & secret-exclusion guards, permission-based visibility, and explicit `BLOCKED` workflow gating wherever backend routes are not yet integrated. |
| **ARENA 3** | Email channel infrastructure (`NotificationChannel` widening to `'EMAIL'`, provider adapter, verified customer email resolution), non-secret provider configuration/readiness API (`provider-status`), notification authorization catalogue functions & maker-checker change-request workflow, delivery diagnostics `EMAIL` channel widening, and governed controlled `test-send` API. |

### Non-Negotiable Frontend Honesty Rule (ARENA 2)
Admin Web **never invents undocumented endpoints** and **never simulates successful persistence**. Every endpoint owned by ARENA 1 or ARENA 3 is wrapped in `NotificationManagementApi` returning a discriminated `IntegrationResult<T>`:
- When the backend responds `2xx`, the workflow operates in `LIVE` mode against persisted backend state.
- When the backend responds `404 Not Found` or `501 Not Implemented` (prior to ARENA 1 / ARENA 3 backend merge), `NotificationManagementApi` returns `{ status: 'BLOCKED', owner: 'ARENA_1' | 'ARENA_3', endpoint, method, httpStatus, message }`, and the UI explicitly marks the workflow **`BLOCKED`** without mutating state as saved.
- `400`, `401`, `403`, `409`, `422`, `429`, and `5xx` errors fail closed without automatic retries on `403` or `429`.

---

## 2. Live Backend Endpoints Integrated Today (at `5206d8f52b0deccba31149c6e600d9e0d774a6cb`)

| Method & Path | Controller | Required Scope / Policy | Current Status | Admin Web Usage |
|---|---|---|---|---|
| `GET /api/v1/internal/notifications/deliveries` | `AdminNotificationController` (`src/admin/admin-notification.controller.ts`) | Workforce session + UI scope `notification.view_deliveries` | **LIVE** (SMS & PUSH; `channel=EMAIL` returns `400` until ARENA 3 widens `VALID_CHANNELS`) | Overview delivery telemetry + Tab 7 (`Deliveries & Retries`) filtered, paginated table & diagnostic inspector (destination redacted). |
| `GET /api/v1/internal/outbox` | `OperationsController` (`src/operations/operations.controller.ts`) | `outbox.view` | **LIVE** | Overview shared outbox queue health (`PENDING` / `FAILED` / `PUBLISHED` notification-bearing events). |
| `GET /api/v1/internal/diagnostics` | `OperationsController` (`src/operations/operations.controller.ts`) | `diagnostics.view` | **LIVE** | Overview & Provider Status `pendingOutbox`, database, and migration compatibility indicators. |
| `GET /api/v1/internal/configuration` | `ProductionController` (`src/production/production.controller.ts`) | Authenticated internal route | **LIVE** | Provider Status non-secret runtime environment, version, `outboxRetryDelaySeconds`, `outboxRetentionSeconds`, `auditRetentionSeconds`. |
| `GET /api/v1/internal/audit` | `OperationsController` (`src/operations/operations.controller.ts`) | Workforce session (UI gated by `audit.view` / `audit.search`) | **LIVE** | Tab 5 (`Approvals & Governance`) audit lookup for `NOTIFICATION_TEMPLATE` and `NOTIFICATION_CONFIGURATION` entity types. |
| `POST /api/v1/internal/a2/workforce/approvals/:id/approve` | `A2WorkforceAdministrationController` (`src/authorization/workforce-administration.controller.ts`) | `FINANCE_CONTROLLER` + `privileged:approve` + `MFA` + Maker ≠ Checker | **LIVE** | Tab 5 (`Approvals & Governance`) checker sign-off for governed workforce approval IDs. |
| `POST /api/v1/internal/a2/workforce/approvals/:id/reject` | `A2WorkforceAdministrationController` (`src/authorization/workforce-administration.controller.ts`) | `FINANCE_CONTROLLER` + `privileged:approve` + `MFA` + Maker ≠ Checker | **LIVE** | Tab 5 (`Approvals & Governance`) checker rejection for governed workforce approval IDs. |

---

## 3. Authorization Catalogue Functions (ARENA 3 Dependency — Audit §4.6)

Admin Web gates route access, tab visibility, and action affordances using exact authorization function codes:

| Function Code | Purpose | Current Catalogue Status | Admin Web Enforcement |
|---|---|---|---|
| `notification.view_deliveries` | Read delivery attempts, failures, skip reasons, retries | **LIVE** (`SUPER_ADMIN`, `FINANCE_AUDITOR`, `OPERATIONS`) | Grants sidebar access to `SMS & Email Notifications` and unlocks `GET /internal/notifications/deliveries`. |
| `notification.view_events` | Read notification event catalogue, channel states, template versions | **PENDING ARENA 3** | Unlocks catalogue/template read probes when granted (also permitted alongside `notification.view_deliveries` during transition). |
| `notification.manage_templates` | Create/edit SMS & Email template versions (Maker — INITIATE) | **PENDING ARENA 3** | Enables template draft submission buttons (`POST /internal/notifications/templates`). Hidden/disabled for read-only principals. |
| `notification.approve_templates` | Approve/activate SMS & Email template versions (Checker — APPROVE) | **PENDING ARENA 3** | Enables template version activation / approval actions (`Maker !== Checker` + `MFA` enforced). |
| `notification.manage_configuration` | Submit event trigger enable/disable changes (Maker — INITIATE) | **PENDING ARENA 3** | Enables eligible trigger edit drawer (`PATCH /internal/notifications/events/:eventType/configuration`). Never unlocks `SECURITY` or `toggleLocked` events. |
| `notification.approve_configuration` | Approve event trigger configuration changes (Checker — APPROVE) | **PENDING ARENA 3** | Enables configuration change request approval actions (`Maker !== Checker` + `MFA` enforced). |
| `notification.test_send` | Initiate/execute governed test notifications to workforce destinations | **PENDING ARENA 3** | Enables Controlled Test-Send submission (`POST /internal/notifications/test-send`). |

---

## 4. ARENA 1 Backend API Contracts (Templates, Variables, Preview, Event Catalogue)

### 4.1 `GET /api/v1/internal/notifications/events`
Returns the DB-backed event catalogue, trigger configuration, delivery class, lock rules, and registered safe variables per event.

```ts
export interface NotificationEventCatalogueItemDto {
  eventType: string;
  category: 'FUNDING' | 'TRANSFER' | 'SUPPORT' | 'CASH_TO_CASH' | 'AGENT_LIFECYCLE' | 'SECURITY';
  description: string;
  deliveryClass: 'SECURITY' | 'TRANSACTIONAL' | 'INFORMATIONAL';
  recipientTarget: 'CUSTOMER' | 'AGENT' | 'CUSTOMER_AND_AGENT' | 'BENEFICIARY_PHONE';
  runtimeTriggerState: 'LIVE_OUTBOX' | 'DIRECT_PROVIDER_BYPASS' | 'UNWIRED_OUTBOX';
  smsEnabled: boolean;
  emailEnabled: boolean;
  toggleLocked: boolean;
  lockReason: string | null;
  templateEditable: boolean;
  approvedVariables: Array<{
    name: string;           // e.g. "amount", "reference", "sender_name", "agent_locator_url"
    description: string;
    sampleValue: string;    // Representative safe non-secret sample
    sourceSummary: string;  // e.g. "formatNgn(redactedPayload.amountMinor)"
  }>;
  activeSmsVersion: number | null;
  activeEmailVersion: number | null;
  pendingApprovalId?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export interface ListNotificationEventsResponseDto {
  data: NotificationEventCatalogueItemDto[];
}
```
- **Invariants:**
  - All events in `SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES` (`customer.registration.phone_verification`, `customer.credentials.temporary_credential`, `agent.desk.customer_otp`) MUST have `deliveryClass: 'SECURITY'`, `toggleLocked: true`, and `templateEditable: false` (Audit Finding `F-S6`).
  - `cash_to_cash.created` MUST restrict `approvedVariables` to `['sender_name', 'amount', 'agent_locator_url']` — excluding `transferNumber`, `senderPhone`, and `transferCode` (Audit Finding `F-S2` & §4.7.3).

### 4.2 `PATCH /api/v1/internal/notifications/events/:eventType/configuration`
Submits an administrative trigger configuration change for an eligible (`toggleLocked === false`) event.
- **Headers:** `Authorization: Bearer <token>`, `idempotency-key: <uuid>`
- **Request Body:**
```ts
export interface UpdateNotificationEventConfigurationRequestDto {
  smsEnabled: boolean;
  emailEnabled: boolean;
  reason: string;
  approvalIds?: string[];
}
```
- **Response (`200 OK` or `202 Accepted`):**
```ts
export interface NotificationMutationOutcomeDto {
  status: 'PENDING_APPROVAL' | 'APPLIED';
  approvalId?: string | null;
  changeRequestId?: string | null;
  requestedBy?: string;
  updatedAt: string;
  message?: string;
}
```
- **Error codes:** `400` invalid payload, `403` missing `notification.manage_configuration` or locked `SECURITY`/`toggleLocked` event, `409` conflicting pending change.

### 4.3 `GET /api/v1/internal/notifications/templates`
Lists template versions across `SMS` and `EMAIL` channels, including version history.
- **Query Params:** `eventType?`, `channel?` (`SMS | EMAIL`), `locale?` (default `en-NG`), `includeHistory?` (`true | false`)
- **Response (`200 OK`):**
```ts
export interface NotificationTemplateVersionDto {
  id: string;
  eventType: string;
  channel: 'SMS' | 'EMAIL';
  locale: string;
  version: number;
  subject: string | null; // MUST be null for SMS; required non-empty for EMAIL
  body: string;           // <= 1000 chars for SMS; <= 4000 chars for EMAIL
  variables: string[];    // Whitelisted token names used by this template
  isActive: boolean;
  approvalStatus: 'ACTIVE' | 'PENDING_APPROVAL' | 'SUPERSEDED' | 'REJECTED';
  approvalId?: string | null;
  changeSummary?: string | null;
  createdBy: string | null;
  approvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListNotificationTemplatesResponseDto {
  data: NotificationTemplateVersionDto[];
}
```

### 4.4 `POST /api/v1/internal/notifications/templates`
Creates a new versioned SMS or Email template proposal under maker-checker governance.
- **Headers:** `Authorization: Bearer <token>`, `idempotency-key: <uuid>`
- **Request Body:**
```ts
export interface CreateNotificationTemplateVersionRequestDto {
  eventType: string;
  channel: 'SMS' | 'EMAIL';
  locale: string;           // 'en-NG'
  subject: string | null;   // null for SMS; 1..200 chars for EMAIL
  body: string;             // 1..1000 chars for SMS; 1..4000 chars for EMAIL
  changeSummary: string;    // Required audit summary (10..500 chars)
}
```
- **Validation & Security Rules:**
  - Rejects `SECURITY`-class events (`403`).
  - Rejects any `{{token}}` not in the event's registered `approvedVariables` whitelist (`400`).
  - Rejects secret-bearing token names (`otp`, `pin`, `password`, `secret`, `token`, `transfer_code`, `transferCode`, `ledger`, `journal`) (`400`).
  - Enforces `subject === null` when `channel === 'SMS'` and non-empty `subject` when `channel === 'EMAIL'`.

### 4.5 `POST /api/v1/internal/notifications/templates/:templateId/activate`
Activates/approves a pending or historical template version (maker-checker checker execution).
- **Headers:** `Authorization: Bearer <token>`, `idempotency-key: <uuid>`
- **Request Body:** `{ comment?: string; approvalIds?: string[] }`
- **Governance:** Requires `notification.approve_templates` (or `FINANCE_CONTROLLER` + `privileged:approve`), `assuranceLevel === 'MFA'`, and `approverPrincipalId !== createdBy`.

### 4.6 `POST /api/v1/internal/notifications/templates/preview`
Renders a draft or saved template using safe sample variable bindings without sending or persisting any delivery or outbox record.
- **Request Body:**
```ts
export interface PreviewNotificationTemplateRequestDto {
  eventType: string;
  channel: 'SMS' | 'EMAIL';
  locale?: string;
  subject: string | null;
  body: string;
  sampleVariables?: Record<string, string>;
}
```
- **Response (`200 OK`):**
```ts
export interface PreviewNotificationTemplateResponseDto {
  eventType: string;
  channel: 'SMS' | 'EMAIL';
  renderedSubject: string | null;
  renderedBody: string;
  characterCount: number;
  estimatedSmsSegments: number | null;
  resolvedVariables: Record<string, string>;
  warnings: string[];
}
```

---

## 5. ARENA 3 Backend API Contracts (Email Infrastructure, Provider Status, Change Queue, Test-Send)

### 5.1 `GET /api/v1/internal/notifications/provider-status`
Returns strictly **non-secret** provider readiness, worker configuration, retry policy, and sender-identity metadata for `SMS` and `EMAIL`.
```ts
export interface NotificationProviderStatusResponseDto {
  checkedAt: string;
  environment: string;
  worker: {
    enabled: boolean;
    batchSize: number;
    smsRetryMaxAttempts: number;
    smsRetryBaseDelaySeconds: number;
    pendingOutboxCount: number;
  };
  sms: {
    provider: 'console' | 'robase' | string;
    operationalStatus: 'READY' | 'CONSOLE_ONLY' | 'MISCONFIGURED' | 'DEGRADED';
    baseUrl: string | null;
    apiKeyConfigured: boolean;
    apiKeyPrefixValid: boolean;
    apiKeyLast4Fingerprint: string | null; // Masked last-4 only (e.g. "9f2a"), NEVER raw key
    requestTimeoutMs: number;
    productionGuardSatisfied: boolean;
    senderIdentityMode: 'PROVIDER_WORKSPACE_ACCOUNT' | 'PER_MESSAGE_CONFIGURED';
    senderIdentitySummary: string;
    deliveryReceiptTracking: 'ACCEPTED_BY_PROVIDER_ONLY' | 'WEBHOOK_ENABLED' | 'POLLING_ENABLED';
  };
  email: {
    channelEnabledInSchema: boolean;
    provider: string | null;
    operationalStatus: 'READY' | 'CONSOLE_ONLY' | 'NOT_CONFIGURED' | 'DEGRADED';
    credentialsConfigured: boolean;
    credentialFingerprint: string | null; // Masked only, NEVER raw SMTP/API secret
    fromAddress: string | null;
    fromName: string | null;
    domainVerificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'NOT_APPLICABLE';
    honorsCustomerEmailPreference: boolean;
  };
}
```
- **Hard Security Rule (Audit `F-S5`):** Neither backend nor Admin Web may ever return, accept, log, or render raw API keys (`ROBASE_API_KEY`), SMTP passwords, or bearer credentials. Admin Web additionally runs `sanitizeProviderStatusForDisplay()` to scrub any unexpected secret-like property before state storage.

### 5.2 `POST /api/v1/internal/notifications/test-send`
Executes or initiates a dual-control governed test notification against the active template version using a verified workforce-owned destination.
- **Headers:** `Authorization: Bearer <token>`, `idempotency-key: <uuid>`
- **Request Body:**
```ts
export interface ControlledTestSendRequestDto {
  channel: 'SMS' | 'EMAIL';
  eventType: string;
  destination: string; // E.164 phone for SMS; RFC email for EMAIL (workforce-owned only)
  reason: string;
  workforceDestinationConfirmed: true;
  approvalId?: string;
}
```
- **Response (`200 OK` or `202 Accepted`):**
```ts
export interface ControlledTestSendResponseDto {
  status: 'SENT' | 'PENDING_APPROVAL' | 'FAILED';
  deliveryId?: string | null;
  approvalId?: string | null;
  providerRef?: string | null;
  correlationId?: string | null;
  renderedSubject?: string | null;
  renderedMessage?: string | null;
  lastError?: string | null;
  rateLimitRemaining?: number | null;
}
```

### 5.3 `GET /api/v1/internal/notifications/change-requests` & Decision Endpoints
Lists pending/historical maker-checker change requests for notification templates and event configurations so checkers do not have to rely solely on out-of-band UUID sharing.
- `GET /api/v1/internal/notifications/change-requests?status=PENDING_APPROVAL|APPROVED|REJECTED`
- `POST /api/v1/internal/notifications/change-requests/:requestId/approve` (`{ comment?: string }`)
- `POST /api/v1/internal/notifications/change-requests/:requestId/reject` (`{ reason: string }`)
- Note: Checkers with `FINANCE_CONTROLLER` + `privileged:approve` can also execute generic workforce approval decisions via the **already-live** `POST /api/v1/internal/a2/workforce/approvals/:id/approve` and `/reject` endpoints when notification governed actions register in `governed-action.registry.ts`.

### 5.4 `GET /api/v1/internal/notifications/deliveries` Widening & Optional Manual Retry
- **Channel Filter Widening (ARENA 3):** Update `VALID_CHANNELS` in `src/admin/admin-notification.controller.ts` from `new Set(['SMS', 'PUSH'])` to `new Set(['SMS', 'PUSH', 'EMAIL'])` alongside migration widening `notification_deliveries.channel` CHECK constraint. Until then, Admin Web catches `400` on `channel=EMAIL` and surfaces an explicit `BLOCKED (ARENA 3)` channel-schema banner.
- **Manual Retry Boundary (Optional ARENA 3 enhancement):** `POST /api/v1/internal/notifications/deliveries/:deliveryId/retry` (`idempotency-key` required). Automatic bounded retry is already live via `NotificationWorkerService` (`SMS_RETRY_MAX_ATTEMPTS`, exponential backoff, `FOR UPDATE SKIP LOCKED`) and never touches financial services.

---

## 6. Workflow Readiness Matrix at Current Baseline (`5206d8f52b0deccba31149c6e600d9e0d774a6cb`)

| # | Admin Web Capability | UI & Validation | Backend Endpoint Dependency | Runtime Status at `5206d8f` |
|---|---|---|---|---|
| 1 | Notification overview with channel & event status | Implemented | `GET /internal/notifications/deliveries` (LIVE), `GET /internal/outbox` (LIVE), `GET /internal/diagnostics` (LIVE); `GET /internal/notifications/events` & `provider-status` (probed) | **LIVE** for SMS delivery/outbox telemetry; **BLOCKED** badges shown for unmerged ARENA 1/3 DB registries |
| 2 | Notification event catalogue with editable eligible triggers | Implemented | `GET /internal/notifications/events`, `PATCH /internal/notifications/events/:eventType/configuration` (**ARENA 1**) | Read falls back to labeled code-catalogue reference; trigger persistence **BLOCKED (ARENA 1)** |
| 3 | SMS template management | Implemented | `GET/POST /internal/notifications/templates` (**ARENA 1**) | Editor, GSM/1000-char counter, whitelist & secret validation implemented; save **BLOCKED (ARENA 1)** |
| 4 | Email template management (subject + body) | Implemented | `GET/POST /internal/notifications/templates` (**ARENA 1**) + Email channel (**ARENA 3**) | Subject + body editor & validation implemented; persistence **BLOCKED (ARENA 1 / ARENA 3)** |
| 5 | Approved variable browser & insertion | Implemented | Event whitelist metadata (`approvedVariables`, **ARENA 1**) | **COMPLETE** in UI (cursor insertion into SMS body, Email subject & body, unapproved-token rejection) |
| 6 | Template preview using representative safe data | Implemented | `POST /internal/notifications/templates/preview` (**ARENA 1**) | Deterministic safe whitelist preview **LIVE** locally; authoritative server preview **BLOCKED (ARENA 1)** |
| 7 | Template version history | Implemented | `GET /internal/notifications/templates?includeHistory=true`, `POST .../activate` (**ARENA 1**) | Version comparison UI implemented; DB history & activation **BLOCKED (ARENA 1)** |
| 8 | Configuration change submission & approval status | Implemented | `POST /internal/a2/workforce/approvals/:id/approve\|reject` (**LIVE**), `GET /internal/audit` (**LIVE**), `GET /internal/notifications/change-requests` (**ARENA 3**) | Generic checker approval & audit lookup **LIVE**; dedicated notification change queue **BLOCKED (ARENA 3)** |
| 9 | Provider configuration/status without secrets | Implemented | `GET /internal/configuration` (**LIVE**), `GET /internal/diagnostics` (**LIVE**), `GET /internal/notifications/provider-status` (**ARENA 3**) | Runtime/outbox config **LIVE** + secret scrubber active; provider telemetry **BLOCKED (ARENA 3)** |
| 10 | Delivery history, failures & retry visibility | Implemented | `GET /internal/notifications/deliveries` (**LIVE** for SMS/PUSH); `EMAIL` filter & manual retry (**ARENA 3**) | **LIVE** for SMS/PUSH deliveries, failures, skip reasons & worker retry counts; `EMAIL` filter & manual retry **BLOCKED (ARENA 3)** |
| 11 | Controlled test-send interface | Implemented | `POST /internal/notifications/test-send` (**ARENA 3**) | Form validation, workforce destination attestation & dual-control fields implemented; send **BLOCKED (ARENA 3)** |
| 12 | Permission-based action visibility & error handling | Implemented | Workforce session scopes (`notification.*`, `outbox.view`, `diagnostics.view`, `privileged:approve`) | **LIVE / COMPLETE** (route, tab, and action gating + fail-closed `403`/`429` handling) |
