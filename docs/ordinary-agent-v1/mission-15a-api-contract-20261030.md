# Mission 15A — Ordinary Agent V1 backend API contract for Arena 2

**Backend implementation:** `f61adad` + `9eb456e`, on top of integration baseline `9588329d639ab45b76ffe648ba2ef00951384ca2`. This is a handoff for integration, not production or policy approval. All paths below include the application's `/api/v1` prefix. IDs are UUIDs. Timestamps in JSON are ISO-8601 strings. Use `Authorization: Bearer <workforce-session>` on internal routes; a principal type by itself is not a permission. Relevant catalogue functions are checked in addition to the controller's type restrictions. HEAD is treated as GET by the route policy.

## 1. Agent sessions and lifecycle

### Revoke all current sessions without reissuing a credential — NEW

`POST /api/v1/internal/admin/agents/:id/sessions/revoke`

- Permission: `agent.manage_credentials`, plus an OPERATOR/SERVICE/PRIVILEGED workforce principal. SUPPORT, Agent and Customer sessions do not qualify. No special lifecycle state is required. No request body or reason is required; the endpoint uses a fixed administrative revocation reason.
- **200**: `{ "agentId": "<uuid>", "revokedSessionCount": 2 }`. A repeat with no active sessions returns `0`; the attempt is still audited. ACTIVE session rows are revoked even for PENDING, SUSPENDED, TERMINATED or soft-deleted Agents. Existing credentials are not replaced, unlocked, rotated or revealed. This is not a durable login ban: if an Agent remains ACTIVE and its credential is valid, a subsequent login may establish a fresh session.
- **400** malformed UUID; **401** absent/invalid workforce session; **403** wrong principal or missing function; **404** no Agent even when including soft-deleted records. Audit failure rolls the operation back.
- The Agent row serializes this command with issuance and lifecycle transitions. A fresh login ordered *after* a revocation may succeed. The command does not cancel an already executing request.

### Existing lifecycle routes — changed session behavior

| POST path | Function | Body | Success |
| --- | --- | --- | --- |
| `/api/v1/internal/admin/agents/:id/suspend` or legacy `/api/v1/internal/agents/:id/suspend` | `agent.suspend` | optional `{ "reason": "..." }` (admin route: string, max 500) | 200, Agent projection |
| `/api/v1/internal/admin/agents/:id/terminate` or legacy `/api/v1/internal/agents/:id/terminate` | `agent.terminate` | optional `{ "reason": "..." }` (admin route: string, max 500) | 200, Agent projection |
| `/api/v1/internal/admin/agents/:id/reactivate` or legacy `/api/v1/internal/agents/:id/reactivate` | `agent.reactivate` | none | 200, Agent projection |
| `/api/v1/internal/admin/agents/:id/activate` or legacy `/api/v1/internal/agents/:id/activate` | `agent.activate` | none | 200, Agent projection |
| `/api/v1/internal/admin/agents/applications/:applicationId/activate` or legacy `/api/v1/internal/agents/applications/:applicationId/activate` | `agent.activate` | none | 200, Agent projection |

All five operations additionally require OPERATOR/SERVICE/PRIVILEGED. Suspend/terminate and per-session revocation/audits commit atomically. A previously issued Agent token is rejected on subsequent validation when the Agent is not ACTIVE or is soft-deleted; normal suspend/terminate also persists its revocation. Reactivating an Agent does **not** revive revoked sessions. The `:id/activate` aliases accept either an Agent ID or application ID, but when an application with that ID exists, its approval failure is not masked by a fallback to direct Agent activation. Only APPROVED applications can be activated. This change does not create an identity-verification or human-cash-handover attestation.

Errors: **400** invalid ID/body; **401** absent/invalid session; **403** unauthorized function/type; **404** missing target; **409** invalid lifecycle transition, unapproved application, or other state conflict. The admin Agent projection is `{ id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt }`; the legacy aliases return the Agent entity. Lifecycle transitions still follow the existing state machine and receiving-number hooks.

## 2. Outlet and Terminal metadata

### Reads — tightened

All five require a valid workforce principal with `agent.view`:

- `GET /api/v1/internal/agents/:agentId/outlets` → array of Outlets.
- `GET /api/v1/internal/outlets/:outletId` → Outlet.
- `GET /api/v1/internal/outlets/:outletId/terminals` → array of Terminals.
- `GET /api/v1/internal/agents/:agentId/terminals` → array of Terminals.
- `GET /api/v1/internal/terminals/:terminalId` → Terminal.

The controller allows SUPPORT/OPERATOR/SERVICE/PRIVILEGED types, **but the function gate is mandatory**. The existing genuine SUPPORT session has no `agent.view`, so it is denied; FINANCE_AUDITOR and AGENT_NETWORK_MANAGER have the read grant in the seeded catalogue. Do not assume a named role will remain entitled if its actual grants change. Unauthorized callers are rejected before entity lookup. Authorized malformed UUIDs return 400; missing or soft-deleted objects return 404.

An Outlet has `{ id, agentId, reference, code, name, displayName, status, addressLine, city, state, country, createdBy, updatedBy, version, createdAt, updatedAt, deletedAt }`. A Terminal has `{ id, agentId, outletId, reference, code, label, status, serialNumber, createdBy, updatedBy, version, createdAt, updatedAt, deletedAt }`. Optional persisted fields may be null. `version` is the concurrency token, not a timestamp.

### PATCH — NEW

`PATCH /api/v1/internal/outlets/:outletId` requires `agent.manage_outlets_terminals` and OPERATOR/SERVICE/PRIVILEGED. Example (send only fields to change):

```json
{
  "expectedVersion": 3,
  "name": "Maitama outlet",
  "displayName": "Maitama service point",
  "addressLine": "12 Example Road",
  "city": "Abuja",
  "state": "FCT",
  "country": "NG"
}
```

`expectedVersion` is a required positive integer; at least one metadata field must be supplied. `name`, when present, must be a non-null string of 2–320 characters after trimming. Other editable fields are nullable strings: `displayName` ≤160, `addressLine` ≤500, `city`/`state`/`country` ≤100. Leading/trailing whitespace is trimmed; null or a whitespace-only optional value clears it. Control characters are rejected. Null `name` is invalid.

`PATCH /api/v1/internal/terminals/:terminalId` has the same permission/concurrency rules:

```json
{ "expectedVersion": 4, "label": "Counter 2", "serialNumber": null }
```

`label` is a nullable string ≤160 characters; `serialNumber` is nullable ≤100; same trimming, clearing and control-character rules apply. Both PATCH routes return **200** with the complete updated entity above, including its new version. Every accepted PATCH consumes one version, even when the values are identical. The server locks the row, compares `expectedVersion`, updates, and writes before/after audit in the same transaction. Two simultaneous PATCHes for one version cannot both succeed. Status transitions take the same row lock so a stale metadata write cannot overwrite them.

Do not send `id`, `agentId`, `outletId`, `reference`, `code`, `status`, timestamps, `actor` or other unknown fields: the production validation pipe rejects non-whitelisted fields. Metadata PATCH does not change identity, association, ownership or lifecycle; it may update a non-deleted SUSPENDED or TERMINATED record but does not reactivate it. Lifecycle changes use the existing separate suspend/reactivate/terminate endpoints.

- **400** missing/noninteger/invalid `expectedVersion`, empty patch, invalid field/value, unknown field, or malformed UUID.
- **401** no valid session; **403** missing management function/read-only or wrong principal; **404** missing/soft-deleted row.
- **409** `Outlet version is stale` or `Terminal version is stale`. Re-read the entity, show the current values, and ask the operator to reconcile; do not silently overwrite or automatically retry with a newer version.
- Audit failure fails the request and rolls back the metadata/version change. Do not infer success from a network timeout: re-read and reconcile.

### Public locator — existing contract, now maintainable

`GET /api/v1/public/agents/cash-to-cash-outlets?state=FCT&city=Abuja&page=1&limit=50` is public and remains read-only. Response: `{ "data": [{ "name": "...", "address": "... or null", "city": "... or null", "state": "... or null", "country": "NG" }], "page": 1, "limit": 50, "total": 1, "pages": 1, "filters": { "state": "FCT", "city": "Abuja" } }`. `name` comes from `displayName` or the safe fallback `Cash-to-Cash service outlet`, not the internal legal `name`; `address` comes from `addressLine`. Only eligible active Nigerian outlets of active Agents and active Cash-to-Cash-enabled classes are listed. Internal IDs, Agent identities and private contact data are not returned. A null/blank country is projected as `NG` by the existing locator. Locator updates do not establish service approval or customer identity.

## 3. Cash-to-Cash expiry and oversight

### Read-only expiry status — NEW

`GET /api/v1/internal/admin/cash-to-cash/expiry-status`

Requires `transaction.view` and OPERATOR/SERVICE/PRIVILEGED; no query/body. **200** example:

```json
{
  "asOf": "2026-10-30T12:00:00.000Z",
  "dueCount": 2,
  "oldestDueAt": "2026-10-30T11:00:00.000Z",
  "expiredCount": 3,
  "worker": {
    "configuredEnabled": false,
    "schedulerRunning": false,
    "tickInProgress": false,
    "pollIntervalMs": 60000,
    "batchSize": 100
  }
}
```

`dueCount` counts persisted `UNCLAIMED` transfers whose `expires_at <= asOf`; `oldestDueAt` is their minimum expiry or null; `expiredCount` counts rows already marked EXPIRED. The database supplies the clock and a single statement snapshot. Numbers are JSON numbers; these are counts, not monetary balances. No phone, transfer ID, secret, hash, amount or journal is in this response. **401** invalid/absent session; **403** wrong type/missing function. Database/audit failures surface through the standard server-error boundary.

`worker` describes only the HTTP-serving process, not the fleet: `configuredEnabled` reflects that process's setting, `schedulerRunning` indicates a local timer, and `tickInProgress` indicates a local in-flight tick. A running timer does **not** prove the last tick succeeded or another replica is healthy; consult existing logs/alerts. A 200 response neither starts a sweep nor changes a transfer, journal, liability, payment, notification or fund disposition. No manual sweep endpoint is provided. The existing worker is opt-in (default false); this mission does not enable it.

### Existing oversight list

`GET /api/v1/internal/admin/cash-to-cash/transfers?page=1&limit=20&status=UNCLAIMED&agentId=<uuid>&transferId=<uuid>&reference=<value>` requires the same `transaction.view` and types. All filters are optional; status is `UNCLAIMED`, `CLAIMED`, or `EXPIRED`; `page` 1–1,000,000; `limit` 1–100; UUIDs must be valid; reference ≤255. **200**: `{ data: [...], total, page, limit, totalPages }`. Each item contains id, agentId/reference, masked beneficiary phone, principal/fee/VAT/total minor-unit **strings**, currency, status, journal and claim identifiers/references, redemption method (`CUSTOMER_WALLET`, `AGENT_CASH`, or null), and lifecycle timestamps. It does not expose transfer-code hashes, codes, bearer credentials, or idempotency keys. **400** invalid filters, **401/403** authentication/authorization. Do not treat settlement or EXPIRED as evidence of physical cash handover or authorization to dispose of retained funds.

## 4. Application, Agent read, receiving-number and history parity

| Existing surface | Required permission / behavior |
| --- | --- |
| `GET /api/v1/internal/agents/applications[/:id]`; `POST .../:id/review`, `.../:id/approve`, `.../:id/reject` | `agent.review_application`, OPERATOR/PRIVILEGED. Review and approve take no body; reject accepts optional `{ "reason": "..." }` (1–500 characters). Returns 200 application(s). Review/approve/reject enforce existing application states; 409 on invalid state. |
| Application activation aliases above | `agent.activate`, not merely `agent.review_application`; only APPROVED can activate. |
| `GET /api/v1/internal/agents`, `.../:id`, `.../:id/financial-position`, `.../:id/transactions` | `agent.view`, with existing workforce type boundaries. List is `{ data,total,page,limit }`; detail and financial-position use their existing safe projections. History uses the shape below. |
| `GET /api/v1/internal/agents/:id/receiving-number` | `agent.view`, OPERATOR/SERVICE/PRIVILEGED; real SUPPORT is excluded. |
| `GET /api/v1/agents/me/receiving-number`, `GET /api/v1/agents/:id/receiving-number` | Valid Agent session; the addressed ID alias is SELF-bound and cross-Agent access is denied before lookup. Missing/revoked number returns `{ agentId, receivingNumber: null, status: "NONE" }`; existing view contains `{ id, agentId, receivingNumber, status, assignedAt, revokedAt, createdAt, updatedAt }`. |
| `GET /api/v1/agents/me/transactions` and workforce `GET /api/v1/internal/agents/:id/transactions` | Agent SELF vs workforce `agent.view`. Optional `page`, `limit`, `type`; types `CASH_IN`, `CASH_OUT`, `CASH_TO_CASH`, `CASH_TO_CASH_CLAIM`, `AGENT_FUNDING`, `AGENT_DEFUNDING`. Response `{ items, pagination: { page, limit, total, totalPages, hasNextPage } }`; amounts are minor-unit strings. Suspended/terminated/deleted Agent tokens cannot read history; authorized workforce oversight remains possible. |

Public application `POST /api/v1/agents/applications` still returns a one-time applicant capability. Subsequent public GET/PATCH/submit continue to require that capability or an appropriately authorized workforce principal. Invalid capabilities for existing and unknown UUIDs have the same 401 outcome; do not use applications as an enumeration oracle. `agent.review_application` is not an identity-document verification.

## 5. Existing funding approval handoff — verified, not modified

The API remains maker/checker-controlled. The actual role/function grants, MFA, approval state, maker/checker identity and approval fingerprint remain authoritative; an enabled UI or 201 maker response is **not** proof that money posted.

1. Maker: `POST /api/v1/internal/agents/:agentId/fund-request` or `.../defund-request`; `agent.fund` or `agent.defund`, entitled AGENT_NETWORK_MANAGER, MFA. Body requires `amountMinor` (positive integer **string**), `idempotencyKey` (1–255), `reason` (1–500); optional `currency`, `reference`, `correlationId`, `description`, `metadata`. **201** returns a funding-request view with request `id`, linked `approvalId`, `status`, and stored fingerprint. It does not post a journal.
2. Checker discovery: `GET /api/v1/internal/agents/funding-requests?status=PENDING&direction=FUND&page=1&limit=20`. Requires a non-SUPER_ADMIN FINANCE_CONTROLLER with MFA and both `agent.fund` and `agent.defund`; own maker requests are excluded. Status `PENDING|REJECTED|EXECUTED`; direction `FUND|DEFUND`; page ≥1, limit 1–50. Response `{ items, page, limit, total }`. The per-Agent read `GET /api/v1/internal/agents/:agentId/funding-requests?idempotencyKey=...` has its existing maker/checker visibility restrictions and returns an array.
3. Approval: `POST /api/v1/internal/a2/workforce/approvals/:approvalId/approve` with `{ "comment": "optional, max 500" }` or `{}`; existing configured action rule and independent entitled MFA checker apply. Do not call the generic approval rejection route for Agent funding.
4. Execute: `POST /api/v1/internal/agents/funding-requests/:requestId/execute` with no body, entitled independent checker; **201** returns the existing funding result. Reject instead with `POST .../:requestId/reject`, body `{ "reason": "..." }` (1–500), **201**. Maker, same-principal checker, wrong function/role, missing MFA or missing independent approval are denied; stale/already-decided state and fingerprint conflicts must be handled according to existing 403/409 behavior. For ambiguous outcomes, retrieve the existing instruction and preserve its idempotency key; never manufacture a new financial result.

The legacy direct `POST /api/v1/internal/agents/:agentId/fund` and `.../defund` require their existing matching independent instruction; their compatibility body property named `approvalId` is looked up as the **funding-request ID**, not the linked privileged-approval ID. Prefer the explicit request/approve/execute sequence above. No maker/checker or posting semantics were changed in Mission 15A.

## 6. Standard production error envelope

The bootstrapped backend's global filter returns `{ statusCode, code, message, error, timestamp, path, requestId, correlationId, traceId }`. `message` may be a string or validation-message array and is redacted. For 400, `code` is `VALIDATION_ERROR` for an array or `BAD_REQUEST` for a string; 404 → `NOT_FOUND`; 409 → `CONFLICT`; 401/403 → `REQUEST_ERROR`; unexpected 5xx → `INTERNAL_SERVER_ERROR`. Authorization may precede validation/lookup, so do not assume every invalid ID yields 400/404 to an unauthorized caller. Integration tests instantiate Nest directly and assert status/behavior; `src/http-exception.filter.ts` and its existing unit tests are authoritative for the bootstrapped envelope.
