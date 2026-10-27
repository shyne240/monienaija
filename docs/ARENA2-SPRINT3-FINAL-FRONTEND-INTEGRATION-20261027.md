# ARENA 2 — Sprint 3 Final Frontend Integration Report

- **Date:** 2026-10-27
- **Branch:** `arena/ea070127-monienaija`
- **Role:** ARENA 2 (Frontend — Admin Web & Agent Mobile)
- **Inspected Backend Contract Sources (Read-Only, Not Merged):**
  - ARENA 1: `origin/arena/92fd33dd-monienaija` (`d0d8f6c61a2d243dda69e45c342195ae4526c098`) — `docs/APPROVED-C2C-SIX-DIGIT-REDEMPTION-CONTRACT.md`
  - ARENA 3: `origin/arena/8e59e188-monienaija` (`bad1b9b2b521af96644329a73491f32c8b50680b`) — `docs/ARENA3-SPRINT3-WORKFORCE-API-AND-AUTHORIZATION-20261026.md`

---

## 1. Part A — Agent Mobile Cash-to-Cash Six-Digit Locator & Redemption

### 1.1 Agent A Initiation (`POST /api/v1/agents/cash-to-cash`)
- **`CashToCashRecipientScreen.tsx` & `CashToCashAmountScreen.tsx` & `CashToCashConfirmScreen.tsx`**:
  - Collects and canonicalizes `senderPhone` (10-digit Nigerian number beginning `7`, `8`, or `9`) explicitly from the sending customer — never inferred from Agent A's login phone and never represented as verified sender identity.
  - Displays `senderPhone` alongside `beneficiaryPhone` and `amountMinor` on `CashToCashConfirmScreen` so Agent A confirms the immutable locator phone before sending.
  - Binds durable `PendingAgentOperation` (`CASH_TO_CASH_SEND`) to `${senderPhone}->${beneficiaryPhone}` + `amountMinor` + `currency` matching the backend request-hash fingerprint, and retains the persisted key on `409 C2C_LOCATOR_UNAVAILABLE` (`"Unable to allocate transfer number; retry unchanged request"`) as well as ambiguous network/5xx outcomes.
- **`CashToCashSuccessScreen.tsx` & `AgentReceipt.tsx`**:
  - Renders the six-digit `transferNumber` strictly as a 6-character string preserving leading zeros (e.g. `"000042"`) alongside canonical `senderPhone` in a dedicated `Public Claim Locator` card (`c2c-public-locator-card`), visually and semantically separated from the display-once `One-Time Secret Transfer Code` card (`c2c-transfer-code-card`).
  - Provides `Copy claim locator` (`c2c-copy-locator-button`) and `Share claim locator` (`c2c-share-locator-button`) controls via supported mobile APIs (`navigator.clipboard.writeText` with React Native `Share.share` fallback). Neither locator copy/share nor `AgentReceipt` (`receipt-share`) ever includes `transferCode`.
  - Omits the number-handoff card cleanly when legacy initiation responses omit `senderPhone` or `transferNumber`.

### 1.2 Agent B Redemption (`POST /api/v1/agents/cash-to-cash/claim-by-number`)
- **`CashToCashClaimRecipientScreen.tsx` & `cash-to-cash-reference-handoff.plan.ts`**:
  - Replaces raw UUID entry with beneficiary Nigerian phone, sender Nigerian phone, and exact 6-digit string `transferNumber` (`^[0-9]{6}$`).
  - Validates exact 6 digits as text without numeric coercion, zero-padding (`"42"` is rejected), or truncation, and guides Agents if a printed receipt reference (`CASH_TO_CASH-...`) or UUID is pasted.
  - Navigates to `CashToCashClaimConfirm` without populating `transferId`.
- **`CashToCashClaimConfirmScreen.tsx` & `agent-api.ts`**:
  - Validates 8–20 digit numeric `transferCode` (`^\d{8,20}$`), beneficiary MFA OTP (`CASH_TO_CASH_CLAIM`), `redemptionMethod` (`CUSTOMER_WALLET` | `AGENT_CASH`), and 4–12 digit `agentPin` (untrimmed secret when `AGENT_CASH`).
  - Submits to `POST /api/v1/agents/cash-to-cash/claim-by-number` with `transferNumber` serialized as a 6-character JSON string and `transferId` strictly omitted (`@IsEmpty()` on `CashToCashLocatorClaimDto`).
  - Preserves `agentCashToCashClaim` (`POST /api/v1/agents/cash-to-cash/claim`) and `getAgentCashToCashClaim` (`GET /api/v1/agents/cash-to-cash/claims/:transferId`) internally for historical UUID compatibility without ever substituting `transferNumber` into `transferId`.

### 1.3 Receipt Recovery (`POST /api/v1/agents/cash-to-cash/claims/recover-by-number`) & Error/Security Handling
- **`pending-operation.ts` & `CashToCashClaimConfirmScreen.tsx`**:
  - Persists non-secret locator claim metadata (`PendingCashToCashLocatorClaim`: `senderPhone`, `transferNumber`, `beneficiaryPhone`, `customerId`, `redemptionMethod`, `idempotencyKey`) scoped to `agentId` immediately before `claim-by-number` is sent (never storing `transferCode`, `otp`, or `agentPin`, and wiping on logout).
  - Does **not** speculatively call `recover-by-number` on fresh screen mounts, preserving the shared 60-second locator rate budget (`20/Agent`, `100/senderPhone`, `10/pair`).
  - On `503 C2C_RETRY_REQUIRED`, `5xx`, `NetworkError`, or app restart with a persisted attempt: recovers via `POST /api/v1/agents/cash-to-cash/claims/recover-by-number` using `{ senderPhone, transferNumber, idempotencyKey }` with the **original `idempotencyKey`**, locks `redemptionMethod`, and hides `"Change payout method (new attempt)"` after any ambiguous outcome so a potentially committed claim is never retried with a new idempotency key.
  - Handles uniform `404 C2C_CLAIM_NOT_AVAILABLE` with privacy-safe, non-enumerating guidance (never asserting whether unrelated transfers exist), invalidates the potentially consumed MFA challenge, and retains the original `idempotencyKey` for same-key retry.
  - Handles `429 C2C_LOCATOR_RATE_LIMITED` with explicit 60-second cooldown guidance without forcing OTP resends or triggering extra recovery requests.

---

## 2. Part B — Admin Web Unified Agent History

- **`AgentUnifiedHistoryPanel.tsx` & `AgentNetworkScreen.tsx`**:
  - Connected live to `GET /api/v1/internal/agents/:id/transactions` (`page >= 1`, `limit` `10 | 20 | 50` within `1..100`, optional `type` in `CASH_IN | CASH_OUT | CASH_TO_CASH | CASH_TO_CASH_CLAIM | AGENT_FUNDING | AGENT_DEFUNDING`) and removed the temporary disabled placeholder.
  - Gated by `agent.view` + workforce principal type in `['OPERATOR', 'SERVICE', 'PRIVILEGED']` (`SUPER_ADMIN`, `AGENT_NETWORK_MANAGER`, `ADMINISTRATOR`, `FINANCE_AUDITOR`), excluding `SUPPORT` principals and preserving `FINANCE_CONTROLLER` global funding-inbox operation without `agent.view`.
  - Preserved existing `transaction.view`-gated **Wallet Transfers** and **Cash-to-Cash Transfers** panels in `AgentNetworkScreen.tsx`.
  - Renders loading, empty, non-403 error, and fail-closed `403 Forbidden` states (preventing repeat `403` retries), plus minor-unit `amountMinor`, `feeMinor`, `commission`, `counterparty`, `narration`, `failureCode`/`failureMessage`, and verbatim `type`, `direction`, `status`, and `reference`.
  - Kept remaining policy-blocked controls (`AgentClassAssignmentPanel`, `AgentTransactionPinSupportPanel`) visibly disabled and explained.

---

## 3. Contract Verification & Unresolved Mismatches

- **Unresolved API-contract mismatches:** **None.** All request DTOs, query parameters, response envelopes, authorization gates, and error envelopes match ARENA 1 (`d0d8f6c61a2d243dda69e45c342195ae4526c098`) and ARENA 3 (`bad1b9b2b521af96644329a73491f32c8b50680b`) verbatim, with zero backend files modified.

---

## 4. Verification Results

- **Agent Mobile (`apps/agent-mobile`):**
  - `npm --prefix apps/agent-mobile run ts:check` — **0 TypeScript errors**
  - `npm --prefix apps/agent-mobile test -- --runInBand` — **20/20 suites passed, 297/297 tests passed**
- **Admin Web (`apps/admin-web`):**
  - `npm --prefix apps/admin-web run ts:check` — **0 TypeScript errors**
  - `npm --prefix apps/admin-web test -- --runInBand` — **25/25 suites passed, 166/166 tests passed**
  - `npm --prefix apps/admin-web run build` — **Production Vite bundle built cleanly**
