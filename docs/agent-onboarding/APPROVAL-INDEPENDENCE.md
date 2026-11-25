# Agent application approval independence

**Status:** enforced at the approval boundary (this branch). PR #28, unmerged.

## The rule

The operator who submitted an Agent application cannot approve it. A different principal holding
`agent.review_application` must decide it.

Enforced in `AgentApplicationService.approve()` — inside the approval transaction, before any state
change — rather than only at the controller. A controller-only check is bypassed by every other
caller of the service (the lifecycle service, the local scripts, any future consumer), and the point
of the rule is that it cannot be routed around.

What did **not** change:

- Function gate: `agent.review_application`, via `requireFunction`, exactly as before.
- Institution scope: untouched.
- `ADMINISTRATOR` grants: still `agent.view` only. No grant was widened.
- No second approval workflow, no maker-checker registry entry, no new role.

Comparison is on the persisted principal id, so the same operator is refused regardless of which
session the attempt comes from (new tab, refreshed token, second device).

## Where the submitter is recorded

`created_by` could never answer this question. Workforce drafts are created through the **public**
applicant endpoint (`POST /agents/applications`), which attributes the row to the application itself
(`agent-application:<id>`) because the console has no field to declare a submitter. Every
pre-existing row is therefore unattributed with respect to review.

Migration `1785753600806-AgentApplicationSubmitterAttribution` adds `submitted_by`:

- Written on submission from the authenticated principal.
- **Immutable** after first write — a database trigger rejects any later change, so a self-approval
  cannot be laundered by re-attributing the row.
- Audited in the `SUBMITTED` event, so the decision is reconstructible from the trail alone.
- **No backfill.** Inferring a submitter for historical rows would invent exactly the evidence the
  guard exists to check.

## The legacy blocker, and the safe path

A row submitted before this migration has `submitted_by IS NULL`. Independence cannot be verified
for it, and the API refuses approval with **409**:

> This application predates submitter attribution, so approval independence cannot be verified.
> Re-attribution requires the original submitting operator to withdraw and resubmit the
> application; it cannot be approved until then.

Why refuse instead of allowing it through: an unverified approval is indistinguishable from a
self-approval, and there is no signal in the historical row that would tell the two apart.

**Safe handling path, in order of preference:**

1. **Withdraw and resubmit.** The original submitting operator re-submits the application, which
   records `submitted_by` on the new submission. The old row is left in place for the audit trail.
2. **If the original operator is unavailable**, the application is re-created by whoever is now
   responsible and submitted by them — again recording attribution honestly. Do not hand-write
   `submitted_by` for a historical row: the trigger allows a first write, and doing so would forge
   the attribution rather than establish it.

Both paths are operational. Neither requires a code change, a bypass flag, or a widened grant.

**Deployment note:** check for unattributed applications before relying on approvals after upgrade:

```sql
SELECT id, reference, status FROM agent_applications
 WHERE status IN ('SUBMITTED','UNDER_REVIEW') AND submitted_by IS NULL;
```

## Tests

`test/agent-application-approval-independence.integration.spec.ts` — real PostgreSQL, real HTTP, the
real 11 local role accounts (7 tests):

| Test | Asserts |
| --- | --- |
| records the submitting operator | `submitted_by` = the submitter's principal id, while `created_by` stays `agent-application:<id>` |
| refuses self-approval | 403, message names separation of duties, status stays `SUBMITTED`, no `approved_at`, no Agent created, no `APPROVED` audit row |
| refuses the same operator from a different session | distinct session id, same principal, 403 |
| lets an independent checker approve the same application | submitter 403 → `SUPER_ADMIN` 200 → `APPROVED`, persisted `submitted_by` is the maker's |
| applies to the privileged account too | `SUPER_ADMIN` cannot approve an application `SUPER_ADMIN` submitted — the rule is about the principal, not the role |
| refuses an unattributed legacy row | 409, message names submitter attribution and the withdraw/resubmit path |
| attribution cannot be rewritten | direct `UPDATE submitted_by` is rejected by the trigger |

Admin Web: `__tests__/agent-application-separation-of-duties.test.tsx` — the console explains the
rule in place of the Approve button, and still offers Approve on another operator's application.
