# A6 integration regression progress — not an A6 completion checkpoint

The A6 PostgreSQL suite now exercises new withdrawals through the actual customer
session and PIN services, wallet eligibility, destination binding, limit enforcement,
withdrawal operation, and ledger reservation. Provider outcomes are controlled local
adapters; no external submission is enabled. Historical recovery cases explicitly
create pre-existing legacy operation/settlement/journal records and do not create or
backfill a financial commitment. They test existing historical recovery only; they do
not authorize post-settlement restoration for commitment-linked withdrawals.

The original 12 A6 PostgreSQL failures listed in
`financial-commitment-lifecycle-checkpoint.md` are resolved in this fixture migration:
new settlements consume a genuine reservation, while the four historical recovery
cases use historical records and their original compensation assertions. The new
commitment-linked case explicitly rejects compensation even after settlement. The
rollback test now actually posts inside the aborted transaction and proves settlement,
commitment and ledger changes roll back, followed by a successful retry. The settlement
journal test asserts debit to reserve and credit to settlement asset, and the customer
balance remains debited once at reservation.

The focused A6 PostgreSQL suite passes 17/17; A6 plus commitment/schema/readiness
passed 52/52 before the background-worker isolation improvement. The combined targeted
A6/A7/commitment/schema/readiness PostgreSQL run has **12 failures**, all in the A7
suite, down from 24. The A6 unit regression still has **15 failures**; the broader
A6-related unit selection has 49 passing and 15 failing tests. Stage 1 is not complete.

## Remaining A6 unit failures by cause

All failures below are in `external-settlement.service.spec.ts`. Its in-memory manager
returns no rows for commitment queries, so every SETTLE path stops at the reserved
commitment guard before reaching the feature under test. It also lacks real transaction
rollback and the newer reservation settlement methods. This fake must not be made green
by inventing a reserved commitment or treating a fake ledger as financial acceptance.

* **Provider/dependency evidence:** `treats a verifier exception as a retryable dependency outage`,
  `propagates retryable evidence unavailability without completing a failed idempotency record`,
  `refuses unverified provider outcomes and mismatched verification references`.
* **New settlement, replay and binding:** `posts a single balanced Ledger journal for a verified external outcome`,
  `replays an identical settlement deterministically and does not post a second journal`,
  `rejects duplicate settlement with a different evidence hash`,
  `correlates the settlement record to the Ledger journal via a single journalId`,
  `keeps external operation, settlement, and journal identities distinct`.
* **Missing evidence/suspense:** `routes unmatched evidence to a suspense entry with named exception ownership`;
  `rejects a compensating entry against a settlement that has no journal`. Current committed
  semantics require careful review, because uncertain evidence must not release a reservation.
* **Rollback:** `rolls back the failed settlement and preserves no journal on Ledger post failure`;
  the old fake expects a failed idempotency row despite its lack of transactional rollback.
  A real PostgreSQL rollback/retry assertion is now present, but the old test still requires migration.
* **Historical recovery / deferred committed recovery:** `posts a compensating entry against an open suspense entry and clears the suspense`,
  `rejects a second compensating entry for an already reversed settlement`,
  `records outbox events for settled, suspense, and compensating actions`.
  Their successful legacy compensation expectation cannot be applied to a new settled commitment.
* **Audit:** `records audit evidence for settlement, suspense, and compensating actions`.

Some old negative unit tests also pass at the commitment guard rather than reaching their
intended verifier assertion. Passing those tests is not independent proof of provider
verification. The controlled real-PostgreSQL commitment suite covers several verifier,
evidence, reservation and rollback cases, but does not by itself migrate every old unit
assertion. The production A6 initiation path is still not registered/wired; institutional
and destination-verification dependencies remain unavailable and production execution
must stay disabled. No A7 development was started in this stage.
