# Operational security: break-glass access and post-incident review

Group 21. Scope: emergency ("break-glass") privileged access. This document covers only what exists in the
code; where a decision belongs to the product owner it is marked as such rather than assumed.

## What was already true before this group

Break-glass access was **already properly gated**, and this group adds no new way to obtain it:

- `privileged:break-glass` is a distinct permission, not implied by ordinary privileged approval.
- Activation requires MFA and passes the same privileged-action approval machinery
  (`PrivilegedActionApprovalService.activateEmergencyAccess`).
- The window is **bounded**: `normalizeEmergencyTtl` clamps the requested lifetime into
  `MIN_EMERGENCY_TTL_SECONDS`..`MAX_EMERGENCY_TTL_SECONDS` (default 300). A caller cannot request an unbounded
  emergency grant.
- Expiry is **lazy but enforced**: `requiresExpiry`/`applyExpiry` transition the record to `EXPIRED` on access,
  so the window cannot be used past its end even if nothing ran a scheduled job.
- Revocation exists (`revokeEmergencyAccess` → `EMERGENCY_REVOKED`).
- Every transition writes an audit row and a `SecurityEvent`.

Because the gate was already sound, adding another gate would have been redundant. The gap was elsewhere.

## The actual gap: nobody has to ask what it was used for

The most common way a temporary emergency grant becomes a permanent one is not a failure to expire. It is
that the window closes and **no named person ever records what happened during it**. An expired record with no
review is indistinguishable from an expired record that was abused.

So the obligation added here is a **post-incident review duty** attached to an existing privileged action —
not a new permission, not a new scope, and not a new approval path.

## Why the obligation lives in the database

A review requirement implemented as a dashboard flag or a service-layer convention is advisory: anything that
writes the row directly (a migration backfill, an operator with SQL access, a future service that forgets to
call the validator) can leave an emergency window closed and unreviewed, and nothing objects.

The migration `1785753600608-EmergencyAccessReviewRequirement` therefore encodes the obligation as table
constraints:

| Constraint                                | Meaning                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `chk_emergency_review_only_for_emergency` | Review state may only exist on an emergency approval. Keeps the column meaningful instead of a column everything happens to have.           |
| `chk_emergency_review_status`             | Status is exactly `PENDING_REVIEW` or `REVIEWED` (or NULL).                                                                                 |
| `chk_emergency_review_complete`           | `REVIEWED` requires a timestamp, a named reviewer **and** non-empty notes. A reviewer cannot "sign off" without saying what they concluded. |
| `chk_emergency_review_after_window`       | The review cannot be dated before the window it reviews. Blocks backdating a review to look timely.                                         |

There is a partial index `idx_privileged_action_approvals_unreviewed_emergency` so "what is still owed" is a
cheap query rather than a table scan as the table grows.

The backfill marks already-closed emergency rows as `PENDING_REVIEW`. It does **not** invent a review, a
reviewer or notes for them: those windows genuinely have no recorded review, and manufacturing one would
falsify security evidence.

## Reviews are not amendable

`EmergencyAccessReviewService.review()` refuses a second review of the same window. A review is evidence of
what a named person concluded at a moment; allowing edits turns evidence into a mutable field. If a review was
_wrong_, the correction is a new record, not an overwritten one.

The service also refuses: empty notes, no reviewer, a window that is still open, and a review of a
non-emergency approval. These are validated in the service **and** backed by the constraints above, so the
direct-SQL path fails too.

## What operators see

`OperationsCentreService` (Group 20) reports unreviewed emergency access as a `SECURITY` item when the review
service is present in the module graph. Two deliberate choices:

- **Urgency escalates with age, not with count.** One break-glass window forgotten for a week is a worse
  signal than five reviewed promptly. Past 24 hours outstanding, it is `IMMEDIATE`.
- **An unreadable review state is `unavailable`, not clear.** If the security state cannot be read, the centre
  reports `partial` and refuses `clear: true`, for the same reason a supervisor reporting healthy when it
  measured nothing is a failure.

The dependency is `@Optional()`: the operations centre must remain constructible without the authorization
module (its unit tests and the read-surface wiring both do that), and unreviewed emergency access is an
additional signal rather than a precondition for the centre working.

## Rollback

`down()` **refuses** to run while any review record exists. Dropping these columns and constraints would erase
security-audit evidence, so the rollback is deliberately blocked rather than silently destructive.

## Known gaps

- No reviewer **assignment** or SLA. Who must review, and by when, is a policy decision for the product owner;
  the system records the obligation and its age, and does not invent a deadline.
- No notification when a review becomes owed. `NoneAlertChannel` is still dark (Group 19) — an alert created
  is not an alert delivered, and this group does not change that.
- Review is recording-only; it does not automatically trigger disciplinary, access or escalation workflow.
- The review UI is not built. The duty is enforceable and queryable; it is not yet presented to a reviewer.
