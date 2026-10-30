# 04 — Admin Web Functionality for Operating Ordinary Agent V1

**Audit SHA:** `b8a5b94ee55aad7407dd78068428b3e97236ce8e` · Scope: only the capabilities needed to operate ordinary Agents directly under MonieNaija (per the mission, NOT the broader administrative platform). Method: screen/component source inspection at this SHA + the executed admin-web suite (25 suites / 167 tests, tsc 0 errors, vite build clean) + backend contract cross-check. No browser execution exists (OA-87); status below is source+Jest-verified, not browser-verified.

---

## 1. Capability inventory and classification

| Admin capability (Ordinary Agent V1 operations) | Surface | Wiring quality | Classification |
|---|---|---|---|
| Agent directory: list/search agents, select agent, view detail | `AgentNetworkScreen` | Structured workflow (real `GET /internal/agents`, selection state, gated by `agent.view`) | COMPLETE (source+Jest) |
| Application review/approve/reject/activate | `AgentNetworkScreen` (review/approve/reject/activate buttons → real internal endpoints) | Full workflow with state transitions | COMPLETE |
| Agent lifecycle: suspend / terminate / reactivate / activate | `AgentNetworkScreen` `doLifecycle(...)` | Wired to `POST /internal/admin/agents/:id/*` with confirm flow | COMPLETE |
| Credential issue / reissue (+ session invalidation) | `AgentCredentialPanel` | One-time value handling, 409 guidance ("Use Reissue + invalidate sessions"), explicit uncertain-outcome guidance ("Do not reissue again until access state is checked") | COMPLETE |
| Funding initiation (FUND/DEFUND, amountMinor, reason) | `AgentFundingPanel` | Scope-checked (`agent.fund`/`agent.defund`), idempotency key namespaced per principal+agent | COMPLETE |
| Funding approvals (execute/reject, maker-checker, MFA) | `ApprovalsScreen` + `PendingFundingApprovalsQueue` + panel actions | Decision-7 gating (SUPER_ADMIN excluded with explicit reason text), MFA assurance messaging, real execute/reject calls | COMPLETE |
| Global funding inbox (status/direction filters, pagination) | `ApprovalsScreen` inbox | Matches backend contract exactly (PENDING/EXECUTED/REJECTED, FUND/DEFUND, limit 1..50, `{items,page,limit,total}`); 403 fail-closed clears data, no retries | COMPLETE |
| Unified agent transaction history (6 types, pagination, type filter, minor-unit display, commission + masked counterparty) | `AgentUnifiedHistoryPanel` | Shape-reconciled to the authoritative backend projection at `18a9686` (normalizer + bridge test feeding exact real backend payloads: masked phone `803***6543 · CUSTOMER`, `Commission: NGN 25.00 (POSTED)`, no `undefined` rendering); 403 fail-closed | COMPLETE |
| Agent financial position | `AgentNetworkScreen` + backend `GET :id/financial-position` | Wired read | COMPLETE |
| Receiving number display | `AgentNetworkScreen` `loadReceivingNumber` | Read-only by design (auto-provisioned on activation; revoked on termination; never re-allocated) | COMPLETE (per approved design) |
| Agent class catalogue management | `AgentClassesScreen` + class catalog loader | CRUD wired | COMPLETE |
| Class assignment / reclassification | `AgentClassAssignmentPanel` | Assignment context functional; reclassification renders dependency note + disabled "Reclassify Agent (Policy blocked)" button; backend `PATCH /internal/admin/agents/:id/class` deliberately absent | POLICY_BLOCKED (visible-disabled, honest dependency note) |
| Transaction PIN status / unlock | `AgentTransactionPinSupportPanel` | Status/unlock endpoints referenced in copy remain disabled pending dual-control governance; disabled "Clear PIN Lockout (Policy blocked)" | POLICY_BLOCKED |
| Outlet/terminal management: list, create forms, suspend/reactivate/terminate | `AgentNetworkScreen` (outlet+terminal sections, `doOutletLifecycle`/`doTerminalLifecycle`, creation submit forms) | Fully wired to internal endpoints | COMPLETE |
| Cash-to-Cash operations monitoring | `CashToCashOperationsScreen` | Search/filter/pagination + "Inspect receipt" — genuine read-only workflow (backend exposes only `GET transfers`; no admin mutation endpoints exist by design) | COMPLETE (monitoring scope) |
| Wallet Transfers + Cash-to-Cash transaction views (transaction.view) | existing panels in `AgentNetworkScreen`/observability | Preserved through Sprint 3 (Promise.allSettled partial-failure resilience) | COMPLETE |
| Limit assignment (maker-checker) | `LimitAssignmentScreen` | Wired to limit-catalog internal API; FP/FC separation | COMPLETE |
| Support ticket servicing | `SupportTicketsScreen` | Workforce servicing of agent/customer tickets | COMPLETE |
| Audit trail queries | `AuditTrailScreen` | Read-only audit explorer | COMPLETE |
| Transaction observability | `TransactionObservabilityScreen` | Monitoring | COMPLETE |
| Reconciliation observability | `ReconciliationObservabilityScreen` | Reporting tier (9-check/trial balance) | COMPLETE (reporting); break-resolution workflow absent by decision |
| Ledger operations | `LedgerOperationsScreen` | Finance operations surface | COMPLETE (within its gated functions) |
| Workforce administration / role assignment / super-admin recovery | `WorkforceAdminScreen`, `RoleAssignmentScreen`, `SuperAdminRecoveryScreen` | Wired with governance gating | COMPLETE |
| Agent notification/comms console | none | Not required for V1 operation (SMS is server-side; agent lifecycle events unwired — OA-73) | n/a for V1 |

## 2. Explicit answers to the mission's Admin Web questions

- **Fully functional administrative workflows:** everything in rows 1–11 and 13–22 above — these are structured forms, confirmations, gated actions and state displays bound to real endpoints, with 403/401 fail-closed behaviour tested.
- **Backend-only capabilities (no admin UI, by design or by decision):** C2C admin mutation operations (none exist in backend either — read-only is the approved posture); expiry sweep trigger (no endpoint at all — OA-40 gap); per-agent commission configuration (rules are commercial-platform scope, zero rules by design).
- **Read-only interfaces (intentional):** C2C operations monitor, receiving number, audit trail, reconciliation reporting, financial position.
- **Incomplete forms/actions:** none found masquerading as complete. The two deliberately-incomplete surfaces (reclassification, PIN unlock) render explicit policy-blocked states with dependency explanations and disabled controls — they cannot be mistaken for working actions.
- **Raw JSON response viewers presented as workflows:** none in the Ordinary Agent V1 surfaces. `StructuredData.tsx` renders structured key/value data inside otherwise-complete workflows; no agent-operational screen is a bare API dump.
- **Missing API integrations:** the unified-history counterparty/commission mismatch (the one real missing integration of Sprint 3) was found and fixed at `18a9686`; no remaining panel consumes fields the backend does not emit (verified by the bridge test + Phase 7 cross-surface methodology).
- **Policy-blocked operations:** reclassification (D5), PIN unlock/reset (D6) — both visible+disabled with honest notes; funding remains fully operational under maker-checker (not blocked).

## 3. Caveat

All statuses above derive from source inspection and the executed Jest suite (component-level with mocked fetch) plus backend contract tests. **No browser journey has been executed** (OA-87): form ergonomics, real-session MFA prompts in a live browser, and end-to-end click-through remain UNVERIFIED at the browser layer. This is the single largest evidence gap for Admin Web and is a UAT-phase task, not an implementation task.
