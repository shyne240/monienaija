# ARENA 3 — Sprint 2: Backend Authorization Fixes, Funding Approvals Inbox, and Operational-Gap Findings

Date: 2026-10-26
Branch: `arena/8e59e188-monienaija` (baseline `dc8c109`, common with `arena/870f970d-monienaija`)
Author: ARENA 3 (backend authorization, workforce operational APIs, funding/approval discovery)
Status tags used below: **[FIXED]**, **[IMPLEMENTED]**, **[VERIFIED-NO-DEFECT]**, **[POLICY-BLOCKER]**.

---

## 1. Priority 1 — Authorization defects fixed

### 1.1 [FIXED] Cross-Agent receiving-number read (privilege escalation)

`GET /api/v1/agents/:id/receiving-number` had **no effective authorization**. The route fell to
the generic `/api/v1/agents/*` branch of `RoutePolicyRegistry` (`agentAccess: 'SELF'`,
AGENT-only), but no registry branch ever extracted the URL `:id`, and `RuntimeAccessGuard`
passed `principal.agentId ?? route.agentId` as the resource id — so the SELF check compared
the caller's session Agent **with itself** and always passed. Any authenticated Agent could
read any other Agent's receiving number. This violated
`docs/V1/A21-AGENT-APP-CONTRACT.md:42-43` (SELF-bound; 403/404 when `:id ≠ principal.agentId`).

Fix (resource-bound SELF):
- `route-policy-registry.ts`: the generic agents branch now returns `agentId: input.params?.id`
  when a route parameter is present (today only this endpoint; `/agents/me/*` literals and
  `/agents/applications/:id` — handled by earlier branches — are unaffected).
- `runtime-access.guard.ts`: resource precedence corrected to `route.agentId ?? principal.agentId`.
  The reorder is provably inert for every pre-existing route (no branch set `route.agentId`
  before this change).

Behavior now: self `:id` → 200; other Agent's `:id` (existing or random UUID) → **403 with no
existence disclosure**; workforce token → 403; unauthenticated/garbage → 401.
`GET /agents/me/receiving-number` (the contract-preferred alias, `agent-app.controller.ts`)
is unchanged and re-pinned by test.

### 1.2 [FIXED] Missing `agent.view` gate on the internal receiving-number read

`GET /api/v1/internal/agents/:id/receiving-number` had **no authorization at all**: the guard's
`WORKFORCE_SESSION` branch authenticates without consulting `route.policy` (documented
structural decision, V1-HARDEN-01 Part D — enforcement lives in controllers), and the
controller checked nothing. Any workforce principal, including SUPPORT, could read any
Agent's receiving number.

Policy: `docs/V1/V1-PHASE1-AGENT-SECURITY-IMPLEMENTATION-01.md` §"Applications and function
permissions" — **"Internal receiving-number reads require agent.view."**

Fix: `AgentReceivingNumberInternalController` now calls
`AuthorizationService.requireFunction(principal, 'agent.view', 'agent-receiving-number',
['OPERATOR','SERVICE','PRIVILEGED'])` — the identical pattern used by `AgentClassController`.
A matching registry branch (`requiredFunctions: ['agent.view']`, SUPPORT excluded) declares the
same gate for defense in depth. SUPPORT holds no agent-domain functions by policy
(`support-authentication.service.ts` `principalFor`), so it is denied (FUNCTION_MISSING → 403).

**Client impact (ARENA 2):** Admin Web `AgentNetworkScreen.tsx:286` calls this endpoint.
Workforce roles that hold `agent.view` keep working: **SUPER_ADMIN, FINANCE_AUDITOR,
AGENT_NETWORK_MANAGER, ADMINISTRATOR**. Roles without it (**OPERATIONS, FINANCE_PREPARER,
FINANCE_CONTROLLER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY**, and SUPPORT) now
receive **403** where they previously received 200. Admin Web should render 403 on the
receiving-number card as "Not entitled" rather than a hard error.

### 1.3 [FIXED] `agent.manage_classes` role-grant configuration

The function existed and both the controller and registry enforced it, but the catalogue seed
assigned it to **no role** ("pending an explicit owner/policy decision") — so class
administration failed closed for every role in a seeded system.

The owner decision is documented in
`docs/V1/V1-PHASE1-AGENT-SECURITY-IMPLEMENTATION-01.md` §"Applications and function
permissions": *"Class mutations require the new agent.manage_classes function, granted to the
existing Agent Network Manager and Super Admin owners by the bootstrap catalogue seeder."*

Implemented: `nowAssign('AGENT_NETWORK_MANAGER', 'agent.manage_classes', EXECUTE)` and
`nowAssign('SUPER_ADMIN', 'agent.manage_classes', EXECUTE)`; the function-level note was
updated to record the decision. No other role received any grant; nothing was inherited from
`agent.review_application`. The seeder is insert-missing-only/idempotent, so environments pick
the grants up on the next catalogue bootstrap.
`test/phase1-agent-security.integration.spec.ts` was updated from the pending-decision
expectations to the approved policy, **retaining negatives** (OPERATIONS and FINANCE_CONTROLLER
still 403 on class mutations; grant-row assertion pins the holder set to exactly
`['AGENT_NETWORK_MANAGER','SUPER_ADMIN']` with accessType EXECUTE).

### 1.4 [VERIFIED-NO-DEFECT] Remaining Agent Network operational-route sweep

Every other Agent Network operational controller was inspected; all enforce catalogue
functions at the controller boundary via `AuthorizationService.requireFunction` (the pattern
mandated by V1-ADMIN-AUTHORIZATION-HARDENING-01, required because the guard's
WORKFORCE_SESSION branch does not evaluate route policy):

| Surface | Gate | Result |
| --- | --- | --- |
| `agent-lifecycle.controller` (suspend/terminate/reactivate/activate, application-activate) | `agent.suspend/.terminate/.reactivate/.activate`, `agent.review_application` | OK |
| `agent-application-admin.controller` (list/get/review/approve/reject) | `agent.view` / `agent.review_application` | OK |
| `admin-agent.controller` (list/get/financial-position) | `agent.view` (+financial) | OK |
| `admin-agent-lifecycle.controller` | per-action lifecycle functions | OK |
| `admin-agent-credentials.controller` (issue/reissue) | `agent.manage_credentials` | OK |
| `outlet.controller` (internal outlets/terminals) | `agent.manage_outlets_terminals` (mutations), `agent.view` reads | OK |
| `agent-cash-to-cash-operations.controller` (GET transfers) | requireFunction (masked phone projection) | OK |
| `agent-funding.controller` (all routes) | `agent.fund`/`agent.defund` + Decision 7 checker policy | OK |
| `agent-class.controller` | `agent.view` / `agent.manage_classes` | OK |

No further independently verified authorization defect was found inside my ownership scope.

---

## 2. Priority 2 — [IMPLEMENTED] Global funding/approvals discovery inbox

### 2.1 Exact contract for ARENA 2

```
GET /api/v1/internal/agents/funding-requests
Authorization: Bearer <A2 workforce session token>
```

Query parameters (all optional, validated server-side):

| Param | Values | Default | Invalid → |
| --- | --- | --- | --- |
| `status` | `PENDING` \| `REJECTED` \| `EXECUTED` | all | 400 |
| `direction` | `FUND` \| `DEFUND` | all | 400 |
| `page` | integer ≥ 1 | 1 | 400 |
| `limit` | integer 1–50 | 20 | 400 |

Response `200`:

```jsonc
{
  "items": [ /* AgentFundingRequestView — the exact same DTO the per-Agent
                 GET /internal/agents/:agentId/funding-requests already returns:
                 id, direction, agentId, aggregatorId, isAggregatorFunding, metadata,
                 amountMinor, currency, idempotencyKey, reference, correlationId,
                 description, requestHash, approvalFingerprint, approvalId, status,
                 approvalStatus (REQUESTED|APPROVED|REJECTED|CONSUMED|EXPIRED),
                 approvalExpiresAt, approvalApprovedBy, reason, actionType, resourceType,
                 resourceId, requesterPrincipalId, policy, makerPrincipalId, makerRole,
                 makerType, checkerPrincipalId, checkerRole, checkerType,
                 journalId (null unless caller is the recorded checker of an EXECUTED row),
                 rejectionReason, createdAt, approvedAt, rejectedAt, executedAt */ ],
  "page": 1,
  "limit": 20,
  "total": 42
}
```

Ordering: `created_at DESC, id DESC` (deterministic, newest first). Filtering and pagination
are server-side (SQL `WHERE`/`LIMIT`/`OFFSET`; the `(status, created_at)` index on
`agent_funding_requests` supports it).

Errors: `401` unauthenticated/garbage token; `403` any principal that is not a non-SUPER_ADMIN
**FINANCE_CONTROLLER** with **MFA** assurance holding both `agent.fund` and `agent.defund`
(APPROVE-level) — this includes AGENT_NETWORK_MANAGER makers, OPERATIONS, SUPER_ADMIN, Agent
sessions, and SUPPORT; `400` invalid query params.

### 2.2 Authorization rules and maker-checker preservation

- Double gate identical to the existing execute/reject routes: registry policy
  (WORKFORCE_SESSION, OPERATOR/SERVICE/PRIVILEGED, `requiredRoles: ['FINANCE_CONTROLLER']`,
  `requiredFunctions: ['agent.fund','agent.defund']`) **plus** controller
  `requireFundingChecker` **plus** service `assertCheckerPrincipal` (Decision 7).
- **No Agent Network permission is required or conferred**: FINANCE_CONTROLLER still holds no
  `agent.view`; the inbox reads only `agent_funding_requests ⋈ privileged_action_approvals`.
- **Maker-checker independence**: rows whose `maker_principal_id` equals the caller are
  excluded server-side — proven by test D with a dual ANM+FC principal (own request invisible,
  other makers' requests visible). The endpoint cannot become a maker tracker.
- **Read-only**: pure SELECTs; test F pins that request/approval state is untouched; approval,
  execution and rejection remain the existing separately authorized POST routes.
- Per-Agent list route and all funding POST routes are unchanged (test G + a19 re-run).

---

## 3. Priority 3 — Operational-gap findings

### 3.1 [VERIFIED-NO-DEFECT] Agent B Cash-to-Cash redemption visibility in transaction history

Agent B's AGENT_CASH redemption **is** visible in Agent B's unified history
(`GET /agents/me/transactions`, type `CASH_TO_CASH_CLAIM`): the claim audit event is written
with `actor = Agent B principalId` (`agent-cash-to-cash-claim.service.ts` `claimantActor`),
and `AgentTransactionHistoryService` projects those audit rows with
`direction: 'CREDIT'`, narration `'Cash→Cash cash payout'`, amount, currency, counterparty
beneficiary phone. Evidence already pinned by tests:
- `test/a16-agent-cash-to-cash-claim.integration.spec.ts` test 41 — full AGENT_CASH settlement
  then asserts `agentHistoryService.listUnified({agentId: claimant.id, type:'CASH_TO_CASH_CLAIM'})`
  returns `{status:'COMPLETED', amountMinor, direction:'CREDIT', narration:'Cash→Cash cash payout'}`
  (and the customer-side history row).
- `test/v1-agent-history-01.integration.spec.ts` test 6 — the HTTP surface
  (`/agents/me/transactions?type=CASH_TO_CASH_CLAIM`) for claims, plus initiator-side
  lifecycle (UNCLAIMED→CLAIMED on the same row).
Both suites re-passed in this sprint (see §5). No defect found; no change made.

### 3.2 [POLICY-BLOCKER] Agent class assignment / reclassification

- Class **definition** administration exists (`/internal/agents/classes`, now granted per §1.3).
- Class **assignment** happens once, at application time (`agent_applications.agent_class_id`
  → activation copies it to the Agent).
- **No reclassification surface exists** for a live Agent (no PATCH on any agent resource;
  `admin-agent.controller` exposes reads only), and **no approved policy document defines one**
  (searched: `reclassif*` across docs — only unrelated B2/roadmap accounting contexts; no
  Decision entry in V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS or the Agent contracts).
- Reclassification changes derived capabilities (`applicableServices`), limits
  (`applicableLimits`) and lifecycle semantics of a live financial principal, so it would
  require a new governed policy (maker-checker or approval workflow, in-flight-transaction
  rules, audit, limit-migration invariants) before implementation. Per the mission constraint
  ("implement only changes supported by established security/product policy"), this is
  reported as a blocker, not invented. **Owner decision needed**, then implementation can
  follow the `agent.manage_classes` + approval-workflow patterns already in place.

### 3.3 [POLICY-BLOCKER] Locked Agent transaction PIN recovery

Current verified state:
- Lockout: 5 failed PIN attempts → `agent_transaction_pins.account_locked` (atomic, tested by
  `v1-agent-05-transaction-pin-security` and phase1 concurrency tests). While locked, even the
  correct PIN is rejected; `POST /agents/me/transaction-pin/change` answers 403
  "…locked due to too many failed attempts. Contact support to proceed."
- `docs/V1/V1-AGENT-05-TRANSACTION-PIN-SECURITY-01.md` §7 ("Recovery behavior — explicit
  limitation, not a silent gap") **deliberately removed** the insecure self-service reset and
  states a locked/forgotten Agent PIN "requires an operational/support path"; Agent Mobile's
  LOCKED state shows only "Contact Support" (support ticket, `prefillCategory: 'PIN'`).
- The support-ticket intake exists, but **no backend recovery ceremony is specified anywhere**:
  no catalogue function for agent PIN unlock/reset exists (the catalogue has zero PIN-related
  functions), no workforce role is designated, and no identity-verification/approval/audit
  policy is documented. `AgentAuthenticationService.unlockCredential` (login credentials, not
  PIN) exists at service level and is unexposed on any Agent/admin route.
- Implementing an unlock API without that policy would be exactly the "privileged bypass" the
  mission forbids. **Blocked pending an approved recovery policy** that names: the entitled
  workforce role(s) + catalogue function, the required identity-verification evidence, whether
  maker-checker/approval applies, cooldown/rate limits, and the audit contract. Once approved,
  the implementation pattern is established (requireFunction + approval workflow + audit).

---

## 4. Files changed (this sprint)

| File | Change |
| --- | --- |
| `src/authorization/route-policy-registry.ts` | internal receiving-number branch (agent.view, SUPPORT excluded); generic agents branch extracts resource `agentId` from params; global funding-inbox branch |
| `src/authorization/runtime-access.guard.ts` | resource precedence `route.agentId ?? principal.agentId` (resource-bound SELF) |
| `src/agent/agent-receiving-number.controller.ts` | internal controller: `requireFunction('agent.view')`; contract comments on both controllers |
| `src/authorization-catalogue/authorization-catalogue.seed.ts` | `agent.manage_classes` EXECUTE grants to AGENT_NETWORK_MANAGER + SUPER_ADMIN; note updated to the recorded decision |
| `src/agent/agent-funding.controller.ts` | `GET internal/agents/funding-requests` inbox route (+BadRequestException import) |
| `src/agent/agent-funding.service.ts` | `listGlobalFundingRequests` (checker-gated, maker-excluded, filtered, paginated, read-only) |
| `test/phase1-agent-security.integration.spec.ts` | manage_classes test rewritten to approved policy; negatives retained |
| `test/v1-agent-receiving-number-authorization.integration.spec.ts` | NEW — 15 HTTP-level positive/negative authorization tests |
| `test/v1-funding-approvals-inbox.integration.spec.ts` | NEW — 7 inbox tests (discovery, filters, pagination, independence, denials, read-only, regression pin) |

Not touched: ARENA 1 claim-settlement services, ARENA 2 frontends (`apps/**`), ARENA 4 UAT docs.

---

## 5. Test evidence

Environment: embedded PostgreSQL 18.4, sequential execution (`PG_TEST_CONCURRENCY=1`,
`--runInBand`), `node scripts/prepare-pg-test-env.js` env, small-runner memory limits respected.

| Gate | Result |
| --- | --- |
| Backend build (`npm run build`) | PASS (after every source change) |
| Backend unit tests (`npm run test`) | **191/191 suites, 1959/1959 tests PASS** |
| ESLint on all six touched `src` files | 0 problems (no new issues) |
| Targeted batch 1 (new receiving-number authz suite, a9, a21, a8, phase1) | 5/5 suites PASS after fix (initial run exposed the two defects below) |
| Targeted batch 2 (a19 funding, v1-admin-authorization-hardening-01, v1-admin-authorization-foundation-01, s-fix-01-customer-lifecycle-authorization, v1-workforce-bootstrap-01, a22-admin-foundation) | **6/6 suites, 104/104 tests PASS** |
| Targeted batch 3 (a15, a16, a17, v1-agent-history-01, v1-agent-cash-to-cash-operations, phase1 re-run) | **6/6 suites, 141/141 tests PASS** |
| Fix-verification batch (v1-007-support-ticket, new authz suite 16/16, a21, inbox suite) | **4/4 suites, 65/65 tests PASS** |
| **Full PostgreSQL regression (all suites, sequential)** | **115/115 suites, 2187/2187 tests PASS** (113 pre-existing + 2 new; baseline was 113/113, 2162/2162) |

Two defects were caught by test evidence during this sprint and fixed before delivery:
1. Initial internal receiving-number gate was declared only in the route registry — the
   WORKFORCE_SESSION guard branch does not evaluate route policy (V1-HARDEN-01 Part D), so
   OPERATIONS/FINANCE_CONTROLLER still got 200. Fixed by moving enforcement into the
   controller (`requireFunction`), matching `AgentClassController`.
2. The first full-regression attempt (aborted at suite 26, log kept locally) caught
   `/agents/me/support/tickets/:id` binding the TICKET id as a resource Agent id
   (v1-007 tests 5/14: 404→403, 201→403 drift). Fixed by restricting extraction to non-`me`
   paths (commit `66fb383`) and pinned by a new regression test; the restarted full
   regression is the 115/115 result above.

Commits (all pushed to `arena/8e59e188-monienaija`):
- `8012250` — receiving-number authorization (both routes) + `agent.manage_classes` grants + new 15-test authz suite + phase1 policy update.
- `d6c7cb6` — global funding approvals inbox (endpoint, service, registry gate) + 7-test inbox suite.
- `66fb383` — scope resource agentId extraction to non-`me` routes + support-ticket regression pin.
- (this document) — sprint report and ARENA 2 contract.

---

## 6. ARENA 2 action items

1. **Admin Web AgentNetworkScreen**: handle 403 on
   `GET /internal/agents/:id/receiving-number` for roles without `agent.view`
   (OPERATIONS, FINANCE_*, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY, SUPPORT) —
   render "Not entitled to view receiving number" instead of a generic failure.
2. **Admin Web funding inbox (new capability)**: consume
   `GET /internal/agents/funding-requests` per the contract in §2.1 for the
   FINANCE_CONTROLLER approvals queue (filter `status=PENDING` for the work queue; show
   `direction`, `amountMinor`, `currency`, `reason`, `makerRole`, `createdAt`,
   `approvalExpiresAt`; paginate with `page`/`limit`; `total` for counts). Approve/reject
   continue via the existing
   `POST /internal/agents/funding-requests/:id/(execute|reject)` routes — the inbox changes
   nothing about that flow.
3. **Agent Mobile**: no change required (`/agents/me/receiving-number` alias unchanged).
