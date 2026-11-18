# Fraud and risk signals

Group 22. Scope: automated detection of unusual transaction patterns, and what the system does with a
finding. Where a decision belongs to the product owner it is marked as such rather than assumed.

## What already existed before this group

Risk was not absent, and this group does not replace any of it:

- `CustomerRiskProfileService` records a versioned risk profile with factors, per-factor history and a
  review-due date.
- `CapabilityPolicyService.evaluateRisk` **consumes** it: `CRITICAL` routes to `PENDING_REVIEW`, `HIGH` does
  too when the policy profile says so, a stale review date raises `RISK_REVIEW_DUE`, a missing or inactive
  profile raises `RISK_PROFILE_MISSING`, and a legacy `PROHIBITED` level is a hard `DENY`.
- `LimitEnforcementService` enforces fixed, pre-approved limits including `DAILY_COUNT` and `DAILY_AMOUNT`.
- `ComplianceCaseCategory.FRAUD` already existed, so a human could open a fraud case by hand.

That is real enforcement. It is also **entirely slow-moving and threshold-shaped**: it answers "is this
customer risky in general?" and "is this transaction under a fixed ceiling?", not "is this transaction
unusual for this customer right now?"

## The gap

Three things did not exist:

1. **No velocity or pattern detection.** A fixed daily limit is a ceiling, not a signal. Five transfers of
   10,000 sit comfortably under a 100,000 limit and are invisible, even though the _pattern_ is the thing
   worth looking at.
2. **No duplicate-shape detection.** Idempotency keys stop a retried request. They do not stop two genuinely
   distinct requests with the same amount to the same destination minutes apart, which is the most common
   retail double-submission and small-batch fraud pattern.
3. **No record of what fired.** Nothing recorded that a rule observed something unusual, what it observed, or
   that a human dismissed it and why. Without that, a threshold can never be tuned, because there is no
   evidence of how often it was wrong.

## Detection is separated from financial authority

**A finding cannot stop money.** Every blocking authority remains what it was: limits, capability policy,
balances, authorization. This is deliberate and is the most important design decision in the group:

- A heuristic that also refused transfers would be a second, unaccountable authority over customer funds
  whose behaviour changes whenever a threshold is tuned.
- Velocity and duplicate rules have predictable false positives — a salary paid in three parts, an
  institution bulk-paying staff. Hard-blocking on those converts a detection problem into a support problem
  and an incentive to stay under the number.
- The migration therefore has **no blocking verdict value**. `escalation` is `OBSERVE` or `REVIEW_QUEUE` and
  nothing else.

## Findings are deduplicated at the source

A scheduled evaluator re-observes the same condition on every run. Writing a row per run fills the queue with
N copies of one problem and trains reviewers to ignore it. Group 20 fixed this class of bug by filtering
duplicates at the aggregation layer; here it is fixed at the **source**: `dedupe_key` is unique, and a repeat
observation refreshes the existing open finding rather than inserting a second one.

Two consequences worth stating:

- The refresh is **not** counted as a new finding. `xmax = 0` distinguishes the insert branch from the update
  branch; without it the run summary claims more fraud was found than exists.
- `observed_count` rising on a stable finding shows an _escalating_ pattern, which duplicate rows would hide.

A finding that a human **dismissed** is not re-raised from the same rule and bucket. Re-raising it would
override a human judgement without review.

**Verified, not assumed:** the dedupe test originally gave all three runs an identical `now`, so it would
have passed even with a dedupe key that wrongly incorporated the run time. Advancing the clock between runs
made the mutation fail exactly the two dedupe tests, and restoring the code returned 22/22.

## A run that did not look is not a clean run

`fraud_evaluation_runs` records every evaluation, including runs that find nothing and runs that fail. This
is the Group 18 distinction applied to fraud: "no findings" and "we were not looking" are identical in a
findings count, and only the second is dangerous.

The operations centre reports:

- detection that has **never completed** as `unavailable` (forcing `partial`, never `clear`);
- a **stalled evaluator** as a separate `IMMEDIATE` item from finding volume, because an evaluator that last
  passed days ago is an outage even when it found nothing — folding it into the findings item would make
  "no findings" look like good news.

## Findings are evidence

Append-only by trigger:

- `DELETE` is refused outright.
- Observation columns (rule, subject, observed values, thresholds, detail, detection time, dedupe key) are
  immutable. Disposition may change, because that is what humans did about it.
- A `DISMISSED` or `ESCALATED` finding cannot return to `OPEN`. Reopening is a real investigative event and
  must be a new finding, so the record of the original disposition stands.
- `DISMISSED` requires a non-empty reason, and any reviewed status requires a named reviewer and timestamp.
- `down()` **refuses** while any finding exists: the thresholds in force at the time cannot be reconstructed
  from the transfers.

## Thresholds are configuration, never code

Every window, count and amount is read from `fraud_signal_rules`. No threshold is baked into the schema or
the service. **Out of the box the system detects nothing, and says so** — `rulesEvaluated: 0`. There is a
test asserting exactly that, because a plausible-looking hard-coded value would dress an invented policy as
an implemented control.

Deciding what the right numbers are for Nigerian retail transfers — window lengths, counts, amounts, and
whether any of them should be regulatory thresholds — is a product-owner and compliance decision with
regulatory consequences. This group builds the mechanism and refuses to guess the policy.

`NEW_DESTINATION` is a declared signal type that **never fires**. Detecting a genuinely new destination
requires durable first-seen history per source; an approximation ("no earlier transfer in this window")
would fire on every quiet customer's first payment of the day and be actively harmful. The type exists so the
decision can be made deliberately rather than being approximated badly.

## Known gaps

- **No blocking or automatic hold.** By design; see above.
- **No rule is configured.** Until the product owner sets thresholds, detection is inert — and correctly
  reports itself as never having passed.
- **No scheduled invocation.** `runDetection()` must be called by something. This is the same outstanding
  Group 15 requirement: an internal scheduler, dedicated worker or external scheduler must invoke it, and
  supervision does not constitute execution.
- **No case creation.** `escalation: REVIEW_QUEUE` is recorded on the rule and in the finding, but no
  compliance case is opened automatically; deciding that a heuristic may open cases against customers is a
  policy decision, not an implementation detail.
- **No HTTP surface.** Nothing exposes findings over HTTP yet, because that requires deciding who may read
  fraud data. The service API exists and is tested.
- **No consumer watchlist, sanctions or device fingerprinting.** Those are separate controls, not gaps in
  this one.
- `MAX_FACTS_PER_RUN` bounds one evaluation to 5,000 facts. A busy deployment needs windowed/paged
  evaluation, which is not built.
