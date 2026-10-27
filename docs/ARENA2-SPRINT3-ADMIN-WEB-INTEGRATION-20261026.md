# ARENA 2 — Sprint 3 Report: Admin Web Integration & Mobile Claim Contract Review

- **Date:** 2026-10-26
- **Branch:** `arena/ea070127-monienaija`
- **Aligned Common Baseline:** `3428e37e02e7ea55b431f8d2d461fb2356a418de` (`arena/8e59e188-monienaija`)
- **Scope:** Frontend only (`apps/admin-web`, `apps/agent-mobile`, and this report). Zero backend services, controllers, authorization seeds, backend tests, or database migrations were modified.

---

## 1. Branch Alignment Verification

- Fetched `3428e37e02e7ea55b431f8d2d461fb2356a418de` from `arena/8e59e188-monienaija` and fast-forwarded `arena/ea070127-monienaija` cleanly without rebase, reset, or force-push.
- Verified commit ancestry: all prior ARENA 2 Sprint 1 & Sprint 2 commits (`473fe82`, `f9ebe04`, `679b4f4`, `68c2107`, `a78f982`) and Sprint 2 Common Baseline (`3428e37`) remain ancestors of `HEAD`.

---

## 2. Priority 1 — Live Global Funding Inbox (`apps/admin-web`)

Connected `PendingFundingApprovalsQueue` on `ApprovalsScreen` directly to ARENA 3's `GET /api/v1/internal/agents/funding-requests`:

- **Server-side filters & pagination:** Supports `status=PENDING|EXECUTED|REJECTED` (plus `All statuses`), `direction=FUND|DEFUND`, `limit=10|20|50` (`1..50` backend contract), and `page>=1` (`{ items, page, limit, total }`).
- **Decision 7 authorization preserved (`agent.view` NOT required):**
  - Pre-flight and runtime entitlement checks enforce non-`SUPER_ADMIN` `FINANCE_CONTROLLER` + `MFA` assurance + both `agent.fund` and `agent.defund` on an `OPERATOR`/`SERVICE`/`PRIVILEGED` workforce principal, never requiring `agent.view`.
  - Renders dedicated loading (`funding-inbox-loading`), empty (`funding-inbox-empty`), error + retry (`funding-inbox-error`), and unauthorized/forbidden (`funding-inbox-unauthorized`) states; `403` responses clear any cached rows and stop automatic retries.
- **Detail inspection & Checker handoff:**
  - `Inspect details` opens `funding-inbox-detail` with full instruction metadata, maker identity, expiry, ledger journal/rejection metadata, and copyable Maker-Checker handoff JSON.
  - `Review in Checker` / `Proceed to Checker Decision` targets `AgentFundingPanel` via `selectedInboxTarget`, loads `/internal/agents/:agentId/funding-requests?idempotencyKey=...`, and pre-selects the exact `requestId` while keeping manual handoff (`JSON`, `MN-FUND:<agentId>:<idempotencyKey>`, or raw `agentId`) available.
  - Approving, executing, or atomically rejecting a funding request fires `onCheckerOutcome`, automatically refreshing `PendingFundingApprovalsQueue`.

---

## 3. Priority 2 — Receiving-Number Authorization (`apps/admin-web`)

Updated `AgentNetworkScreen.tsx` (`GET /api/v1/internal/agents/:id/receiving-number`) to align with ARENA 3's explicit `agent.view` + workforce-type enforcement:

- Gates `canViewReceivingNumber` on `agent.view` AND `['OPERATOR', 'SERVICE', 'PRIVILEGED']` (blocking `SUPPORT` principals pre-flight without issuing forbidden network calls).
- On `403 Forbidden`, immediately clears `receivingInfo` so protected data is never exposed, sets `receivingNotEntitled`, disables the lookup button (`Not entitled`), renders `data-testid="receiving-number-not-entitled"`, and prevents forbidden retries.

---

## 4. Priority 3 — Operational Workflows & Policy-Blocked Capabilities (`apps/admin-web`)

- **Agent Classes (`AgentClassesScreen.tsx`):** Updated read-only governance copy (`agent-classes-readonly-governance`) to reflect that `agent.manage_classes` is now seeded for `AGENT_NETWORK_MANAGER` and `SUPER_ADMIN` while keeping read-only mode intact for `agent.view`-only roles (`FINANCE_AUDITOR`, `ADMINISTRATOR`).
- **Agent Network partial transaction resilience (`AgentNetworkScreen.tsx`):** Hardened `loadAgentTransactions` with `Promise.allSettled` and workforce-type gating so a failure in either Wallet Transfers or Cash-to-Cash Transfers preserves the surviving stream alongside a clear error notice.
- **Unavailable / policy-blocked capabilities kept visibly disabled & explained (zero fabricated calls):**
  - `AgentClassAssignmentPanel.tsx`: `Reclassify Agent (Policy blocked)` button disabled; explains V1 post-activation reclassification policy.
  - `AgentTransactionPinSupportPanel.tsx`: `Inspect PIN state (Unavailable)` and `Clear PIN Lockout (Policy blocked)` buttons disabled; explains `V1-AGENT-05 §7` governance block.
  - `AgentUnifiedHistoryPanel.tsx`: `Load unified stream (Unavailable)` button disabled; explains `GET /internal/agents/:id/transactions` unavailability and directs staff to live Wallet + Cash-to-Cash views.

---

## 5. Priority 4 — Agent Mobile Cash-to-Cash Claim Contract Review (`apps/agent-mobile`)

- **Isolated typed integration plan (`cash-to-cash-reference-handoff.plan.ts`):**
  - Documents the verified handoff gap (`AgentReceipt` shares `CASH_TO_CASH-...` human `reference` while `POST /api/v1/agents/cash-to-cash/claim` and `GET /api/v1/agents/cash-to-cash/claims/:transferId` currently require `@IsUUID() transferId`).
  - Exports pure classifier `classifyCashToCashClaimIdentifier` (`UUID` | `TRANSFER_REFERENCE` | `EMPTY` | `INVALID`) and enumerates all 5 mobile touchpoints ready for ARENA 1's approved API without guessing endpoints.
- **Live mobile validation & ARENA 1 Sprint 2 security alignment:**
  - `CashToCashClaimRecipientScreen.tsx`: Detects pasted `CASH_TO_CASH-...` / `C2C-...` receipt references and guides the Agent to enter the 36-character UUID Transfer ID until reference lookup lands.
  - `CashToCashClaimConfirmScreen.tsx`: Validates `transferCode` as `1..20` numeric digits (`/^\d{1,20}$/`) client-side before submitting so typos do not consume the beneficiary's live OTP challenge.
  - `api-client.ts` & `agent-api.ts`: Aligned `isBearerSessionExpired401Message` and `describeCashToCashClaimError` with ARENA 1 Sprint 2's mid-claim session revocation (`401` -> purges session back to login), mid-claim PIN rotation (`401` -> preserves session, prompts PIN re-entry), and expired wallet KYC assessment (`403`).

---

## 6. Priority 5 — Dependency Security Review

- **`apps/agent-mobile`:** Added `"uuid": "^11.1.1"` override (`uuid@11.1.1` provides dual CJS+ESM root exports verified against all 3 CJS consumers: `xcode`, `@expo/bunyan`, and `@expo/rudder-sdk-node`), reducing total advisories from `30` to `26` (`GHSA-w5hq-g745-h8pq` resolved). Remaining 26 transitive Expo 52 / React Navigation 6 CLI/build-time advisories (`tar`, `@xmldom/xmldom`, `decode-uri-component`, `image-size`, `node-forge`) require ESM-only or semver-major upgrades and were intentionally not force-applied.
- **`apps/admin-web`:** `0` production advisories (`npm audit --omit=dev`). Remaining 2 dev-only `vite@5.4.21` / `esbuild` advisories require major `vite@8` upgrade and were not forced.
