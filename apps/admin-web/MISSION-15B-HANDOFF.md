# Mission 15B — Ordinary Agent V1 Admin Web Handoff & Arena 1 Contract Boundary

- **Session Branch:** `arena/ea070127-monienaija`
- **Pinned Integration Baseline:** `9588329d639ab45b76ffe648ba2ef00951384ca2` (`integration/main-backend-frontend-20261030`)
- **Scope:** Admin Web (`apps/admin-web/`) only — zero changes to backend (`src/`, `test/`), migrations, or mobile apps.

---

## 1. Completed Admin Web Scope Summary

### Priority 1 — Agent Onboarding (`AgentNetworkScreen.tsx` + `ordinary-agent-admin-api.ts`)
- Added **New Agent Application** workflow inside `AgentNetworkScreen` (reusing existing `/agents/applications` and `/internal/agents/applications` endpoints; no public applicant portal created).
- Added editable `DRAFT` creation (`POST /agents/applications`) and `DRAFT` update (`PATCH /agents/applications/:id` with `expectedVersion`) plus queue `DRAFT` filter, **Edit draft**, and **Submit draft** (`POST /agents/applications/:id/submit`) actions.
- Added active `AgentClass` selection (`GET /internal/agents/classes`) and dynamic input rendering/validation for class-declared `requiredInformation` and `requiredDocumentCategories` alongside structured applicant, contact, address, registration, and KYC evidence fields inside `payload`.
- Stripped any one-time `applicantAccessToken` returned by `POST /agents/applications` so public capability tokens are never persisted or rendered in Admin Web; workforce sessions authenticate via `agent.review_application`.
- Fixed `ApiClient` (`src/services/api-client.ts`) so `Content-Type: application/json` is only sent when `options.body !== undefined`, preventing Fastify `400 FST_ERR_CTP_EMPTY_JSON_BODY` rejections on bodyless `POST` endpoints (`/submit`, `/review`, `/approve`, `/credentials`, `/sessions/revoke`).

### Priority 2 — Agent Management (`AgentNetworkScreen.tsx` + `AgentCredentialPanel.tsx`)
- Completed Outlet creation (`POST /internal/agents/:agentId/outlets`) with `displayName`, `code`, `addressLine`, `city`, `state`, and `country` (omitting blank optional fields to preserve `CreateOutletDto` validation and existing payload shapes) and Terminal creation with `code`, `label`, and `serialNumber`.
- Added inline Outlet (`PATCH /internal/outlets/:outletId`) and Terminal (`PATCH /internal/terminals/:terminalId`) metadata editors behind the explicit Arena 1 integration boundary (`Arena1IntegrationResult<T>`).
- Added authorized **Invalidate active sessions** (`POST /internal/admin/agents/:id/sessions/revoke`) with optional audit reason in `AgentCredentialPanel` across `ACTIVE`, `SUSPENDED`, and `TERMINATED` Agents while keeping credential issuance/reissue restricted to `ACTIVE` Agents and preserving in-memory-only one-time secret handling.
- Added accurate lifecycle status and session-revocation consequence guidance in `AgentNetworkScreen`.

### Priority 3 — Classes, Limits, and Permissions (`AgentClassesScreen.tsx`, `AgentNetworkScreen.tsx`, `LimitAssignmentScreen.tsx`, `navigation-access.ts`)
- Replaced freeform `Applicable services JSON` editing in `AgentClassesScreen` with validated canonical service checkboxes (`CASH_IN`, `CASH_OUT`, `CASH_TO_CASH`, `AGENT_FUNDING`, `AGENT_DEFUNDING`), legacy alias normalization (`CASH_TO_WALLET` → `CASH_IN`, `WALLET_TO_CASH` → `CASH_OUT`), and save-blocking protection when an older class record contains unrecognized non-canonical tokens.
- Corrected `limit.view` gating in `AgentNetworkScreen` and `LimitAssignmentScreen` so principals holding `agent.assign_limit` without `limit.view` never trigger unauthorized `GET /internal/limit-assignments*` calls while retaining per-Agent limit assignment capability.
- Exposed `AGENT_CLASS` limit assignments (`GET /internal/limit-assignments/agent-class/:id` with `limit.view`, `POST /internal/limit-assignments` and `PATCH /internal/limit-assignments/:id` with `subjectType: 'AGENT_CLASS'` and `limit.modify`) in both `LimitAssignmentScreen` and `AgentClassesScreen`.
- Preserved policy-disabled state of Agent reclassification (`D5`, `AgentClassAssignmentPanel`) and Transaction PIN unlock/reset (`D6`, `AgentTransactionPinSupportPanel`).

### Priority 4 — Operations and Navigation (`Layout.tsx`, `DashboardScreen.tsx`, `widgets.tsx`, `SupportTicketsScreen.tsx`, `CashToCashOperationsScreen.tsx`)
- Connected `AgentNetworkScreen` selected-Agent drawer to Agent-filtered `SupportTicketsScreen` (`initialAgentId`) with a **Back to Agent Network** action returning directly to the Agent drawer.
- Connected Dashboard `agent-lifecycle-summary` (**Open Agent Network →**) and `agent-applications-queue` (**Open Onboarding Queue →**) widgets to `AgentNetworkScreen`.
- Corrected misleading Money Movement sidebar labels in `Layout.tsx` from `Cash-In (C2W)` / `Cash-Out (W2C)` to `💸 Transaction & Fee Ops — Deposits` and `💸 Transaction & Fee Ops — Withdrawals` while preserving route keys and `data-testid` selectors.
- Added read-only Cash-to-Cash expiry worker & overdue backlog display (`GET /internal/admin/cash-to-cash/expiry-status`) behind the Arena 1 integration boundary.
- Preserved maker-checker funding/defunding (`AgentFundingPanel`) and global pending-approvals workflows (`ApprovalsScreen`).

---

## 2. Coordinated Arena 1 API Integration Boundary (`src/services/ordinary-agent-admin-api.ts`)

All four Arena 1 endpoints use `Arena1IntegrationResult<T>`:
- `2xx`: `{ status: 'LIVE', data }` — live data/mutation rendered immediately.
- `404` or `501`: `{ status: 'BLOCKED', owner: 'ARENA_1', method, endpoint, httpStatus, message }` — surfaces an explicit Cross-Arena Integration Boundary banner without fabricating state or claiming a write succeeded.
- `400` / `401` / `403` / `409` / `500`: rethrown as `ApiError` so validation, authorization, and optimistic-version conflicts surface directly.

| # | Capability | Method & Path | Required Function | Request Payload Sent by Admin Web | Expected `200` Response Shape |
|---|---|---|---|---|---|
| 1 | Outlet metadata update | `PATCH /api/v1/internal/outlets/:outletId` | `agent.manage_outlets_terminals` | `{ name?: string, displayName?: string \| null, code?: string \| null, addressLine?: string \| null, city?: string \| null, state?: string \| null, country?: string \| null, expectedVersion?: number }` | Updated `AgentOutlet` projection (`id`, `reference`, `name`, `displayName`, `addressLine`, `city`, `state`, `country`, `status`, `version?`) |
| 2 | Terminal metadata update | `PATCH /api/v1/internal/terminals/:terminalId` | `agent.manage_outlets_terminals` | `{ label?: string \| null, serialNumber?: string \| null, code?: string \| null, expectedVersion?: number }` | Updated `AgentTerminal` projection (`id`, `outletId`, `reference`, `code`, `label`, `serialNumber`, `status`, `version?`) |
| 3 | Standalone Agent session invalidation | `POST /api/v1/internal/admin/agents/:id/sessions/revoke` | `agent.manage_credentials` | Bodyless when reason blank; `{ reason: string }` when reason entered | `{ agentId?: string, revokedCount?: number }` (also tolerates `sessionsInvalidated` / `revokedSessions` / `invalidatedCount`) |
| 4 | Read-only Cash-to-Cash expiry status | `GET /api/v1/internal/admin/cash-to-cash/expiry-status` | `transaction.view` | None | `{ workerEnabled?: boolean, dueUnclaimedCount?: number, totalUnclaimedCount?: number, expiredTotalCount?: number, oldestDueExpiresAt?: string \| null, lastSweepAt?: string \| null, batchSize?: number, pollIntervalMs?: number }` (also tolerates `enabled`, `dueCount`, `overdueUnclaimedCount`, `backlogCount`, `expiredCount`, `oldestDueAt`, `lastRunAt`) |
