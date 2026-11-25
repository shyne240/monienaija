# Agent onboarding — browser acceptance walkthrough (2026-11-25)

One synthetic Agent, driven through the real Admin Web against the real API and a disposable,
fully-migrated local PostgreSQL. Nothing is stubbed: every assertion below is read back from the
API or the database after the click that produced it.

Reproduce with:

```bash
node scripts/agent-onboarding-acceptance.cjs \
  --executable /path/to/chromium --lib-path /path/to/chromium/libs \
  --admin-web http://127.0.0.1:5173 --api http://127.0.0.1:3000/api/v1
```

Evidence (screenshots + `report.json`) lives in `evidence/acceptance-20261125/`.

## What the walkthrough proves

| Step | Result |
| --- | --- |
| No class pre-selected | Selector starts empty; provenance reads "No class selected — … No default is applied." |
| Save without a class | Refused in the UI, and **no POST is issued** |
| Explicit selection | `DEMO_ORDINARY_L1`, provenance reads "Explicitly selected by you" |
| Class-declared requirements | 2 info fields + 1 evidence reference rendered and supplied |
| Draft | Persisted as `DRAFT` against the chosen class |
| Submission | Reaches `SUBMITTED` with a `submittedAt` |
| Review → approval | Driven by a **different principal** from the maker |
| Pre-activation panel | Selected class, eligible services, effective limits, and per-product fee/commission |
| Activation | Application remains `APPROVED`; the canonical Agent reaches `ACTIVE` |
| Class governs the Agent | `agents.agent_class_id` equals the chosen class (checked in SQL, not only via the API) |
| Activation audit | `CREATED_PENDING(class …) → RECEIVING_NUMBER_ALLOCATED → ACTIVATED(class …)` |
| Missing configuration | A class with no limit profile renders its gaps *before* activation, worded as absent — not zero, not unlimited |

## Accounts used

Existing local role accounts only; no password was changed.

- Maker: `agent-network-manager@monienaija.local` (`AGENT_NETWORK_MANAGER`, 16 scopes)
- Reviewer: `super-admin@monienaija.local` (`SUPER_ADMIN`)

`ADMINISTRATOR` was tried first and rejected: its role holds `agent.view` only, so
`POST /internal/agents/applications/:id/approve` returns `403 FUNCTION_MISSING`. Only
`AGENT_NETWORK_MANAGER` and `SUPER_ADMIN` hold `agent.review_application`.

## Open finding — independence is not enforced

**The submitting principal can approve its own application.** A throwaway second application was
approved by the account that submitted it (`HTTP 200`, state `APPROVED`). `AgentApplicationService.approve()`
compares nothing but the function scope, and there is no `AGENT_APPLICATION_APPROVE` maker-checker
rule in the governed-action registry.

So the "independent approval" above is a **procedural** separation (two accounts were used), not an
enforced one. Enforcing it needs a product decision: either a `principal != submittedBy` guard in
the service, or a governed maker-checker rule for the approve action.

## Two defects found and fixed while producing this evidence

1. `AgentClassTransitionService.readiness()` joined `limit_profiles` on `a.is_active`, a column that
   does not exist. Any Agent with an active limit assignment got a 500, which the pre-activation
   panel degraded into "this class permits no services". Now uses the same predicate as
   `LimitProfileResolverService`: `deleted_at IS NULL AND enabled AND status='ACTIVE'`.
2. The review queue loaded applications without the class catalogue, so an `APPROVED` row could not
   resolve its own class and the panel told the operator not to activate a class that exists.
   The queue and the catalogue now load together.

Both were invisible to the unit suite and to a type check; they only appear when a real browser
reviews a real approved application.
