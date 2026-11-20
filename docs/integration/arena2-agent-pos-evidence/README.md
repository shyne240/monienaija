# Arena 2 — Agent Network and POS administration handoff

Integration target: `arena/5-main-web-integration`. This session is bound to `arena/280a0dd6-monienaija`, based on `380fbcdf` from `arena/5-a2-agents-pos`; the source branch itself is unchanged. Scope is based on [issue #3](https://github.com/shyne240/monienaija/issues/3) and the integration branch's commercial coordination document.

## What changed

| Workflow | Contract and boundary |
| --- | --- |
| Agent directory | `GET /internal/agents`, unchanged `agent.view` gate and response envelope. Filters apply before counting and paging: case-insensitive literal reference substring or exact Agent UUID (`search`), exact `status`, exact `agentClassId` and `aggregatorId` (active assignment). `sort=newest\|oldest` orders by creation time with an Agent-ID tie-breaker. The query does not search application PII or infer KYC or financial eligibility. |
| Direct detail and onboarding | Application links and contextual navigation resolve `GET /internal/agents/:id`, not the loaded directory page. Responses are bound to the requested Agent and superseded selections are ignored. Application list adds `linkedAgentStatus` for reviewers who also have `agent.view`. An application can be `APPROVED` while its Agent is still `PENDING`; the queue uses the linked status, not the directory, to offer activation. Draft, class selection, submission, review, activation and lifecycle use the existing services. |
| Agent limits | Uses the existing Agent-specific assignment API, including versioned toggle. `agent.assign_limit` permits Agent writes, and `limit.view` permits reads. UI gates also match the API's workforce principal types. No catalogue, precedence or enforcement changes. |
| Agent financial history | The same authoritative history endpoint now has all eight types selectable in Admin Web, including `WALLET_TRANSFER` and `EXTERNAL_BANK_TRANSFER`. No client-side financial totals or new accounting. |
| Funding and defunding | Existing maker/checker request, independent approval and execution are unchanged. No new funding endpoint, proposal state, balance writer, or inbox. |
| Outlets and terminals | New record drill-down uses `GET /internal/outlets/:id`, `GET /internal/outlets/:id/terminals` and `GET /internal/terminals/:id` under `agent.view`, validating Agent and parent IDs. The existing `agent.manage_outlets_terminals` mutations retain their version and receipt checks. Terminal creation and reactivation require an active parent; outlet reactivation requires an active Agent. Optional aggregator-context creation calls the existing aggregator-scoped variants and relies on their server-side relationship check; it does not transfer ownership. |

## Arena 3 and Arena 5 coordination

- `agentClassId` is the persisted class UUID from the authenticated Agent context, not a client-provided financial decision. Agent-level limit assignments use `subjectType: AGENT` and the Agent UUID. They do not write the Arena 3 rule/profile catalogue or modify the distinction between Agent and class scope.
- Directory `aggregatorId` is a filter on current `ACTIVE` rows in `aggregator_agent_assignments`. Outlet/terminal creation in aggregator context also requires the backend to verify the aggregator and relationship are active. Neither use is institutional affiliation or financial or commission authority.
- Flow call sites that currently pass `aggregatorId: null` for commissions are unchanged. Arena 3 and Arena 5 should agree on transaction-time resolution and retained evidence/replay semantics before wiring aggregator-targeted commissions. Include missing or suspended relationships and reassignment between admission and replay. Do not source a payable recipient from the directory or a client-supplied ID. The issue #3 comment was attempted but GitHub denied the integration permission; this handoff is included here and in the PR instead.

## Financial enforcement review

Cash-in, cash-out and Cash-to-Cash initiation use `AgentTransactionAuthorizationService` and the existing class capability service before execution; Agent-cash redemption also checks current `CASH_TO_CASH` capability inside the claim transaction. Agent wallet transfer checks the class's `WALLET_TRANSFER` permission in quote and transfer execution. Agent external bank transfer uses the authorization service with `EXTERNAL_BANK_TRANSFER` and passes the server-resolved class to limit admission. The funding service owns its capability checks and maker/checker rules. This change adds a negative operation test for a valid, active Agent whose class permits `CASH_OUT` but not `CASH_IN`, and verifies transfer history using an actual bank commitment in the disposable integration database. It does not edit the underlying engines.

## Browser evidence

Playwright/Chromium against the actual Admin Web bundle in Vite, using synthetic HTTP fixtures intercepted in the browser. The smoke run checked page two and back, opening an off-page Agent from the application queue, loading the assigned terminals for an outlet, and server query parameters for search. No browser exceptions. Backend contracts are tested separately against disposable PostgreSQL.

- [Directory search](directory-search.png)
- [Off-page Agent → outlet and assigned terminals](outlet-assignment.png)

## Out of scope / blockers

Post-activation class reassignment, workforce transaction-PIN status/unlock, and post-creation terminal reassignment do not have an approved API and remain unavailable. Administrative `ACTIVE` is not KYC, device connectivity or payment readiness. Automatic provisioning, heartbeat, and POS payment processing remain separate and unapproved. No hardware, vendor, or real money was used.
