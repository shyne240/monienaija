# 02 — Prioritized Implementation Backlog to Finish Ordinary Agent V1

**Audit SHA:** `b8a5b94ee55aad7407dd78068428b3e97236ce8e` · Ranked by severity then dependency. Each task states exact missing functionality, affected files/modules, expected behaviour, required work per layer, acceptance criteria, dependencies, suggested Arena ownership, and whether a product-owner decision is required FIRST. This is not an enhancement list: every item closes an audited gap (matrix row IDs cited) or a decision-gated build whose decision is already registered.

---

## P1 — HIGH: close the functional gap

### B1. Wire the C2C expiry sweep trigger + expired-event emission (OA-40) — no decision needed for the status leg
- **Exact missing functionality:** `AgentCashToCashExpiryService.expireDueTransfers()` has zero production callers. Expired transfers never transition `UNCLAIMED → EXPIRED`, never write their audit rows in production, and `cash_to_cash.expired` never emits. (Financial safety is already independent of this — claim paths fail closed.)
- **Affected files/modules:** `src/agent/agent-cash-to-cash-expiry.service.ts` (exists); new trigger — either `src/operations/operations.controller.ts` (governed ops endpoint) and/or a bootstrap interval in the agent module (the notification worker's `setInterval` pattern in `src/notification/notification-worker.service.ts` is the in-repo precedent; there is NO scheduler dependency in `package.json`); optional outbox enqueue inside the sweep for `cash_to_cash.expired` (recipient mapping = D8-adjacent mini-decision; event/template already registered in `src/notification/notification-event-map.ts` + inbox title map).
- **Expected behaviour:** past-deadline UNCLAIMED transfers transition to EXPIRED with `expired_at` set and audit rows written, idempotently, in bounded batches; monitoring (`CashToCashOperationsScreen`) then shows accurate EXPIRED status; if approved, beneficiaries receive the already-templated expired notification (public pair only, never the secret code).
- **Work:** Backend: trigger (endpoint with workforce authorization + audit, or supervised interval with single-flight guard) + optional enqueue. API: `POST /internal/admin/cash-to-cash/expiry-sweep` (suggested) returning sweep counts. Frontend: optional "Run expiry sweep" action in `CashToCashOperationsScreen` for authorized workforce (or none if interval-based). Tests: integration suite asserting trigger → transition → audit → idempotent second run → (if wired) outbox row without secret code; extend a17.
- **Acceptance criteria:** a fresh PG suite proves end-to-end trigger-to-EXPIRED without direct service calls; sweep is idempotent under concurrency; no financial mutation occurs; monitoring reflects status; full regression stays green.
- **Dependencies:** none for the status/audit leg. Notification leg depends on D8-style recipient approval. Disposition of expired funds (D2) explicitly NOT included — liability retention continues.
- **Suggested owner:** ARENA 1 (owns the C2C backend + a17).
- **Owner decision required?** Mechanism choice (ops endpoint vs interval vs both) — engineering-owner ruling sufficient; funds disposition stays with product (D2).

## P2 — MEDIUM: decision-gated builds (decision first, then contained work)

### B2. Agent-flow notification wiring per ownership ruling (OA-72, OA-73; decisions D8/D9)
- **Missing:** outbox enqueue for `cash_to_cash.created` (beneficiary SMS with public pair — only if D8 rules it a release gate), `cash_to_cash.claimed/expired`, and/or `agent.*` lifecycle events (only if D9 rules them in-scope).
- **Files:** `src/agent/agent-cash-to-cash.service.ts`, `agent-cash-to-cash-claim.service.ts`, `agent-cash-to-cash-expiry.service.ts`, `agent-lifecycle.service.ts`, `agent-funding-governance.service.ts` (enqueue calls); `src/notification/*` machinery already complete (templates render the public pair safely — verified by locator-contract tests).
- **Expected behaviour:** recipient-mapped, outbox-persisted (never the secret transfer code), worker-delivered SMS; failures retry per existing dispatcher policy.
- **Acceptance:** integration tests asserting outbox rows with exact safe payloads + zero secret leakage; template rendering already covered.
- **Dependencies:** D8/D9 rulings; recipient-mapping approval.
- **Owner:** ARENA 1 (agent services) with notification-owner sign-off. **Decision required: YES (first).**

### B3. Agent credential self-change route (OA-12; decision D11)
- **Missing:** `POST /agents/me/credentials/change` (or ratified absence). If approved: current-credential verification + new-credential policy (≥8 chars, matching rotation rules), optional session invalidation of OTHER sessions, audit event.
- **Files:** `src/agent-authentication/agent-authentication.controller.ts` + service + DTO; mobile `AccountScreen` entry + small form; admin copy update in `AgentCredentialPanel`.
- **Acceptance:** HTTP suite (old credential still valid-or-invalidated per ruling; weak new credential rejected; audit without secrets); mobile binding tests; credentials-01 regression.
- **Dependencies:** D11 founder ruling. **Owner:** ARENA 3 (backend auth) + ARENA 2 (mobile). **Decision required: YES.**

### B4. Public agent-application UI (OA-02; decision D10)
- **Missing (only if ruled in-scope):** applicant-facing web form (create → complete → submit → status check using the secured applicant access token from migration `…095`).
- **Files:** new lightweight public frontend (or a public section in an existing app — owner choice); backend API already complete (`agent-application-public.controller.ts`).
- **Acceptance:** E2E HTTP tests already exist for the API; add UI journey tests + browser UAT lane.
- **Dependencies:** D10 scope ruling; if ruled out, close OA-02 as OUT_OF_SCOPE with the ruling recorded. **Owner:** ARENA 2 (frontend) if approved. **Decision required: YES.**

### B5. Administrative PIN unlock ceremony (OA-52; decision D6)
- **Missing (after governance decision):** backend `GET /internal/admin/agents/:id/transaction-pin` + `POST .../transaction-pin/unlock` with dual control, identity-evidence capture, cooldowns, audit; enable the already-built disabled UI (`AgentTransactionPinSupportPanel` form shell exists).
- **Acceptance:** authorization matrix tests (entitled role+function only; maker≠checker if dual control chosen); audit without secrets; UI enablement tests.
- **Dependencies:** the seven S3R §4.2 decisions. **Owner:** ARENA 3 (backend/guard) + ARENA 2 (admin UI enablement). **Decision required: YES.**

### B6. Agent reclassification (OA-21; decision D5) — only if pulled into V1
- **Missing (after governance decision):** `PATCH /internal/admin/agents/:id/class` with maker-checker, in-flight-transaction handling, limit migration, invariant preservation (capability/lifecycle), audit; enable `AgentClassAssignmentPanel`'s existing functional form (it already implements reason capture and gating).
- **Dependencies:** the seven S3R §4.1 decisions. **Owner:** ARENA 3 + ARENA 2. **Decision required: YES.**

### B7. KYC-freshness harmonization for wallet-mode redemption (OA-17; decision D4)
- **Missing (after decision):** assessment-expiry gate in the CUSTOMER_WALLET claim path mirroring the cash-mode gate, with the approved window.
- **Files:** `src/agent/agent-cash-to-cash-claim.service.ts` (`assertWalletAssessmentUnexpired` currently cash-mode only); a16 test extension.
- **Dependencies:** D4 ruling (window value must not be invented). **Owner:** ARENA 1. **Decision required: YES.**

## P3 — LOW / polish (schedule with UAT preparation)

### B8. Dependency-uplift sprint (OA-90)
- Security-owner triage of agent-mobile critical/high advisories (transitive `tar`, expo toolchain, node-forge, xmldom) + admin-web `vite@8` breaking upgrade; full regression after lockfile changes. **Owner:** ARENA 4 (evidence) + frontend owners. **Decision:** security-owner reachability review.

### B9. Mobile polish bundle (OA-06 leg, OA-78 leg, G6)
- Outlet/terminal detail screens (read-only); dedicated PIN-lockout guidance screen with support link; dedicated session-expired → Login UX; back/cancel + accessibility sweep; screenshot-guard implementation IF D14 rules yes (before device UAT with real codes). **Owner:** ARENA 2. **Decision:** D14 (screenshot guard, assets).

### B10. Ops tooling: locator attempts-table retention job (S3R §10.5)
- Approved cleanup of expired budget rows in `cash_to_cash_locator_attempts` (never locator reservations); monitoring dashboards for 429/409 budget hits. **Owner:** ARENA 1. **Decision:** retention window approval.

### B11. Formal ratification sweep (documentation hygiene, closes claim-vs-source drift)
- Update `V1-CAPABILITY-REGISTRY.md` (CASH_TO_CASH_EXPIRY status until B1 lands), record D9/D10/D11/D12/D13 rulings, supersede the 2026-10-02 mobile matrix rows that shipped, annotate A21 §2.4 as superseded. **Owner:** ARENA 3 (docs). **Decision:** none — records decisions made elsewhere.

## P4 — UAT / deployment-preparation phase (explicitly NOT implementation backlog)

- **B12. Browser UAT (OA-87):** provision runner with NSS/NSPR libs (or approved Playwright cache); execute Admin Web journeys: login → application approval → activation → credential issue → funding maker-checker (two distinct workforce identities) → unified history → C2C monitoring → support servicing; capture traces + DB extracts.
- **B13. Device UAT (OA-88):** Android emulator/KVM image or physical devices; execute mobile journeys: login+rotation → cash-in → cash-out (OTP+PINs) → C2C send (display-once code + locator share) → claim by number (both methods) → ambiguous-outcome recovery → history/receipts → support. Per UATP scenario matrix incl. reconciliation lane.
- **B14. Staging/go-live gates (OA-89):** per `V1-AGENT-MOBILE-15/16/17`, `V1-INFRA-01..03`, `V1-GO-LIVE-01/02`, `V1-RELEASE-01`; includes the §4 migration-ordering prerequisites from S3R (apply `…096` before flows; never destructive `down()` after issuance; coordinated FE/BE rollout).
- **B15. Real-cash UAT precondition:** D1 (handover controls) + D6 (PIN recovery) must be decided before any physical-cash pilot with real agents.

---

## Ranking summary

| Rank | Task | Severity | Decision first? | Owner |
|---|---|---|---|---|
| 1 | B1 expiry trigger | HIGH | No (mechanism ruling internal) | ARENA 1 |
| 2 | B2 notification wiring | MEDIUM | Yes (D8/D9) | ARENA 1 |
| 3 | B3 credential self-change | MEDIUM | Yes (D11) | ARENA 3 + 2 |
| 4 | B4 public application UI | MEDIUM | Yes (D10) | ARENA 2 |
| 5 | B5 PIN unlock ceremony | MEDIUM (deploy-critical) | Yes (D6) | ARENA 3 + 2 |
| 6 | B6 reclassification | MEDIUM (if in-scope) | Yes (D5) | ARENA 3 + 2 |
| 7 | B7 KYC freshness | MEDIUM | Yes (D4) | ARENA 1 |
| 8 | B8–B11 polish/ratification | LOW | Partially (D14, retention) | 4/2/1/3 |
| 9 | B12–B15 UAT/deployment | Phase-gated | Yes (D1, D6 preconditions) | ARENA 4 + all |

**Definition of done for "Ordinary Agent V1 development complete":** B1 merged with green regression + rulings recorded for D8/D9/D10/D11 (and B2/B3/B4 built if ruled in-scope) + B5/B6 either built or formally deferred by the owner + B11 documentation ratification. Browser/device UAT (B12–B15) then constitutes the separate deployment-readiness phase.
