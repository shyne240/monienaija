# Agent onboarding — browser acceptance walkthrough (2026-11-25)

One synthetic Agent, driven through the real Admin Web against the real API and a disposable,
fully-migrated local PostgreSQL. Nothing is stubbed: every assertion below is read back from the
API or the database after the click that produced it.

34 recorded steps, 15 screenshots, 0 findings.

Reproduce with:

```bash
node scripts/agent-onboarding-acceptance.cjs \
  --executable /path/to/chromium --lib-path /path/to/chromium/libs \
  --admin-web http://127.0.0.1:5173 --api http://127.0.0.1:3000/api/v1
```

Evidence (screenshots + `report.json`) is written to `evidence/acceptance-20261125/`, which is the
script's default `--out`, so the run above rewrites exactly the committed set.

## This run, and the migration renumber

The evidence in `evidence/acceptance-20261125/` was regenerated on the coordinated migration head —
after this PR's migration moved from `1785753600806` to `1785753600809` (see
[`../migrations/MIGRATION-IDENTITY-COORDINATION.md`](../migrations/MIGRATION-IDENTITY-COORDINATION.md))
and after the disposable database was upgraded through the real `npm run migration:run` path. The
run was not repeated against the old identity, so the screenshots and the `report.json` in that
directory all come from one database state: schema head `1785753600809`, `submitted_by` present,
attribution trigger armed.

Server state for this run, as recorded by the harness in `report.json.environment`:

- API: `scripts/local-dev-api-server.js`, release readiness reported as `error`
  (`financial_dependencies_not_ready`) and **not bypassed**, bound to `127.0.0.1` only.
- `dist/main.js` neither used nor modified; it still refuses to start.
- Database: disposable local PostgreSQL, fully migrated, synthetic rows only.

## What the walkthrough proves

| Step | Result |
| --- | --- |
| No class pre-selected | Selector starts empty; provenance reads "No class selected — … No default is applied." |
| Save without a class | Refused in the UI, and **no POST is issued** |
| Explicit selection | `DEMO_ORDINARY_L1`, provenance reads "Explicitly selected by you" |
| Class-declared requirements | 2 info fields + 1 evidence reference rendered and supplied |
| Draft | Persisted as `DRAFT` against the chosen class |
| Submission | Reaches `SUBMITTED`, with `submittedAt` set **and** `submittedBy` recorded (reported by the harness as `submittedBy=recorded`) |
| Submitter cannot approve | Own row shows *"You submitted this application, so you cannot approve it"* and offers no Approve button |
| Self-approval refused | Submitter's own `POST /approve` → 403, application stays `SUBMITTED` |
| Independent checker | Same application approved by a different principal → 200, `APPROVED` |
| Review → approval | Driven by a **different principal** from the maker |
| Pre-activation panel | Selected class, eligible services, effective limits, and per-product fee/commission |
| Activation | Application remains `APPROVED`; the canonical Agent reaches `ACTIVE` |
| Class governs the Agent | `agents.agent_class_id` equals the chosen class (checked in SQL, not only via the API) |
| Activation audit | `CREATED_PENDING(class …) → RECEIVING_NUMBER_ALLOCATED → ACTIVATED(class …)` |
| Class history | Empty (0 entries) and *correctly* so: that surface records class **switches**, and activation is not a switch. The class assignment is proved instead from `agents.agent_class_id` in SQL. |
| Missing configuration | A class with no limit profile renders its gaps *before* activation, worded as absent — not zero, not unlimited |

## Accounts used

Existing local role accounts only; no password was changed.

- Maker: `agent-network-manager@monienaija.local` (`AGENT_NETWORK_MANAGER`, 16 scopes)
- Reviewer: `super-admin@monienaija.local` (`SUPER_ADMIN`)

`ADMINISTRATOR` was tried first and rejected: its role holds `agent.view` only, so
`POST /internal/agents/applications/:id/approve` returns `403 FUNCTION_MISSING`. Only
`AGENT_NETWORK_MANAGER` and `SUPER_ADMIN` hold `agent.review_application`.

## Independence is enforced (was an open finding)

On the previous revision this walkthrough recorded a finding: the submitting principal could
approve their own application. That is now **closed** at the approval boundary —
`AgentApplicationService.approve()` refuses an approver whose principal id equals the persisted
`submitted_by`, before any state change, and a database trigger prevents the attribution from being
rewritten.

Verified in this walkthrough (throwaway application, 34/34 steps):

| Attempt | Result |
| --- | --- |
| Submitting operator approves their own application | `403` *"Separation of duties: the operator who submitted this application cannot approve it."* — application remains `SUBMITTED` |
| Different principal approves the same application | `200` → `APPROVED` |
| Same operator, second session | Still the same submitter — a second, distinct session id for the same principal is refused identically |

The walkthrough's own approval is therefore an enforced separation, not a procedural one. See
`APPROVAL-INDEPENDENCE.md` for the rule, the legacy-attribution blocker
([`UNATTRIBUTED-APPLICATIONS-RUNBOOK.md`](./UNATTRIBUTED-APPLICATIONS-RUNBOOK.md) for the operator
procedure), and the safe handling path.

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
