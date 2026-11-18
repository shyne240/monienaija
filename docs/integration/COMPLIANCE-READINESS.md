# Compliance readiness: evidence export and case age

Group 23. Scope: the ability to answer a regulator, auditor or dispute handler, and to see whether
compliance cases are being resolved. Where a decision belongs to the product owner or a regulator it is
marked as such rather than assumed.

## What already existed

- `CustomerComplianceService` creates cases with category, severity, assignment, comments, evidence,
  per-field history and assignment history. The case tables are guarded and the controller is authorized.
- `audit_events` is **already immutable** — a `BEFORE UPDATE OR DELETE` trigger has existed since
  migration `1785753600005`. The application cannot rewrite the trail, and neither can SQL.
- There are indexes on `(entity_type, entity_id, occurred_at)`, `(correlation_id, occurred_at)` and
  `(created_at)`.

So the trail was trustworthy and the case workflow was real. The readiness gap was elsewhere.

## The three gaps

1. **No time-range query at all.** `AuditService.list()` filters by `entityType`, `entityId` and
   `correlationId`, and caps at 1,000 rows. It has **no date bound**. "Show me everything that happened
   between these two dates" — the first request any auditor makes — could not be answered through any
   interface, and could not be assembled by widening a filter. There was also no index on `occurred_at`
   alone, so even a hand-written range query would sequentially scan a table that grows without bound.
2. **No record that an export happened.** Exporting the trail is itself security-relevant: it removes a
   copy from the system's control. Nothing recorded who took what, over which range, or why.
3. **No case age.** A case has `opened_at` and `closed_at`. Whether cases are being resolved or quietly
   ageing in `OPEN` was not observable.

## The export is paged, and the paging is keyset

An export over an unbounded range cannot be a single response, and a silently truncated one is worse than
no response at all — it presents a partial record as complete evidence. So:

- The order is `(occurred_at ASC, id ASC)` and the cursor is the composite `(occurred_at, id)`.
- The next page resumes with a **row comparison** `(occurred_at, id) > (cursor_time, cursor_id)`, which is
  what PostgreSQL can use as an index range condition. The equivalent `OR` form usually is not.
- Paging is **keyset, not `OFFSET`**. The trail is append-only and being written to continuously. With
  `OFFSET`, a row inserted before the cursor shifts every later row down and the next page repeats one; a
  deletion does the opposite and skips one. For an evidence export, silently skipping an event is the worst
  possible failure.
- The page size is capped and a range longer than 366 days is refused: an unbounded range turns "the whole
  trail" into a normal-looking request and defeats paging.
- `hasMore` comes from fetching one row beyond the page, so it is known without a count query — a count over
  a range is itself a scan of the trail, which a caller may not be entitled to.

**Verified, not assumed:** the `id` tiebreak is load-bearing only when several events share a timestamp,
and my first test data had unique timestamps, so removing the tiebreak left the suite green. Adding a test
with nine events on the same instant made the mutation fail that test and nothing else.

## Taking a copy is recorded

Every page writes a row to `compliance_audit_exports`: the requester, their principal type, the range, the
applied filters, the cursor used, the row count, the first and last timestamps seen, and a **required**
stated purpose. Constraints keep it honest:

- A cursor is an ordered pair or nothing — half a cursor cannot resume anything.
- The page's reported row bounds must fall inside the requested range.
- A blank purpose is refused; `n/a` is a legitimate answer, a blank field is not.
- The register is **append-only** by trigger. A register that can be edited is not evidence.
- The page read and the register write share one transaction. An export that happened but was not recorded
  is exactly the gap this closes.
- A **refused** export writes nothing, because it took no evidence.

The register records **pages, not sessions**. The system cannot know whether a caller intended to continue,
and claiming a session was complete when it may not have been would be worse than reporting the pages.
Continuation pages are marked as such, so a session that stopped after page 2 is visibly incomplete.

## Deadlines are configured, and a missing one is reported as missing

`compliance_case_sla` maps a case category to a resolution deadline in hours. **No rows are seeded.** What
the right deadline is for an AML case versus a document case is a regulatory decision; seeding a
plausible-looking number would present an invented policy as an implemented control.

Consequently the operations centre reports:

- cases **past a configured deadline** as `COMPLIANCE` / `IMMEDIATE`;
- categories with **no configured deadline** as a separate `ROUTINE` gap, and explicitly **not** as zero
  breaches. A compliance view showing zero breaches because no deadline was ever set is the same failure as
  a supervisor reporting healthy when it measured nothing.

A deadline must be attributable to a named principal, must be a positive integer, and categories are
validated. A zero deadline would mark every case breached on creation and train everyone to ignore the
signal.

## What is deliberately not decided here

- **No retention period.** Deleting audit rows is a policy decision with legal consequences, and the table
  is deliberately immutable. Nothing in this migration permits deletion.
- **No legal hold.** A hold the system does not enforce is worse than none; one it does enforce would
  silently block a retention job nobody has defined yet.
- **No statutory deadline.** See above.
- **No HTTP surface.** Exporting the trail removes a copy from the system's control, so _who may export_ is
  an access-policy decision this group does not make. The service API exists and is tested; the first HTTP
  caller will appear in the register from its first request.

## Known gaps

- **No controller.** Nothing exposes the export over HTTP yet; access policy is the open decision.
- **No scheduled export.** A recurring regulator feed would need the same invocation mechanism as the
  outstanding Group 15 requirement.
- **No chain or hash of exported content.** The export is a faithful page of an immutable table, but there
  is no cryptographic commitment proving a given export equals the trail at a point in time.
- **`down()` refuses while any export record exists**, so this schema cannot be rolled back once evidence
  has been produced — by design.
- **No case-to-audit cross-reference.** Finding every audit event for a case works by `entity_id` only if
  the caller knows the case id; there is no case-scoped export helper.
