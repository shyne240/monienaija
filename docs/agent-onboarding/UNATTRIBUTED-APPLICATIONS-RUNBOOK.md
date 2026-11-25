# Runbook: Agent applications with no recorded submitter

Applies to any installation upgraded across the submitter-attribution change
(`1785753600809-AgentApplicationSubmitterAttribution`).

## Why these applications cannot be approved

Approval independence is enforced by comparing the approving operator's principal id with the
application's `submitted_by`. Rows created before attribution existed have `submitted_by IS NULL`.
For those, independence **cannot be verified**, and an unverified approval is indistinguishable
from a self-approval. So the API refuses with **409**:

> This application predates submitter attribution, so approval independence cannot be verified and
> it cannot be approved. A different operator must reject it with a reason, and a new application
> must be submitted by an authenticated principal so its submitter is recorded.

**No backfill is performed and none should be performed by hand.** Writing a submitter onto a
historical row now would manufacture the very evidence the guard checks. The database trigger
permits a first write from `NULL`, which is what makes an honest resubmission possible — and what
would also make a dishonest one possible, so it must not be used that way.

## Find them

```sql
SELECT status, count(*) AS applications
  FROM agent_applications
 WHERE submitted_by IS NULL
 GROUP BY status
 ORDER BY status;
```

Only **SUBMITTED** and **UNDER_REVIEW** rows are blocked from approval. **DRAFT** rows are not
blocked: `updateDraft` does not check attribution, so editing a draft and submitting it through the
normal console path records the submitter at submission time. **APPROVED** rows need no action —
they are already decided and cannot be approved again.

## What staff do

### In review (SUBMITTED / UNDER_REVIEW) — reject, then re-create

There is **no withdraw operation** in this product. `reject` is the only terminal transition
available to staff, and it is exactly the right instrument here because it closes the row without
deciding it, and it records *why*.

1. Open **Agent network → Agent Onboarding Applications**, load the queue, and find the application.
2. Enter a rejection reason naming the cause, e.g.
   *"Closed: submitted before submitter attribution; please resubmit so the submitter is recorded."*
   `POST /internal/agents/applications/:id/reject` accepts `reason` as **optional** (up to 500
   characters), so the API will not force you to justify it — the instruction in the 409 response is
   a procedural requirement on staff, not a validation the endpoint enforces. Always supply one:
   without it the audit trail loses the only record of why an undecidable application was closed.
3. **Reject.** The row becomes `REJECTED` and stays in the audit trail with the reason on it.
4. **New Agent Application** — re-create it with the same business details and class. The operator
   creating it saves a draft.
5. **Submit.** The submission records the authenticated operator as `submitted_by`, so a different
   operator can now review and approve it.

Nothing is lost: the rejected application and its reason remain in the audit trail, and the new
application is attributable from the moment it is submitted.

**Do not** re-create the application as the same operator who will approve it. The new row will
carry that operator as submitter and will be refused for the same legitimate reason.

### Still a draft (DRAFT) — just submit it

No rejection is needed. Open the draft, edit if necessary, and submit it through the console. The
submission records the submitter.

### Already approved (APPROVED) — no action

Already decided. Excluded from the approval path.

## Verify afterwards

```sql
SELECT status, count(*) AS applications
  FROM agent_applications
 WHERE submitted_by IS NULL AND status IN ('SUBMITTED','UNDER_REVIEW')
 GROUP BY status;
```

This must return no rows before staff expect unattributed applications to be decidable.
