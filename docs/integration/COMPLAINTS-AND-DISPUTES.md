# Complaints and transaction disputes

Group 24. Scope: a formal claim against a specific transaction, its investigation, its decision, its award,
and the record of whether the claimant was told. Where a decision belongs to the product owner it is marked
as such rather than assumed.

## What already existed, and why it was not a disputes register

`SupportService` is a real helpdesk: tickets with reference, category, priority, assignment, threaded
messages, status transitions and audit. `support_tickets.related_transfer_id` even lets a ticket point at the
transaction it concerns.

A complaint about a specific transaction asking for money back is a different object with different
obligations:

|         | Support ticket                   | Transaction dispute                                              |
| ------- | -------------------------------- | ---------------------------------------------------------------- |
| Nature  | a conversation                   | a claim with a decidable outcome                                 |
| Subject | a topic                          | an identified transaction                                        |
| Closure | by whoever is handling it        | after a decision, customer contact, and execution                |
| Money   | none                             | an awarded amount, with the award decided by someone independent |
| Refusal | no concept of a refused decision | `REJECTED` is a first-class outcome                              |

Searches for "complaint", "redress" and "chargeback" across the codebase returned nothing outside
commercial-governance constants. This group adds the missing object rather than overloading the helpdesk.

## A dispute cannot move money

This is the central constraint. A dispute records a claim and a decision. When a decision is `UPHELD_IN_FULL`
or `UPHELD_IN_PART`, **it credits nobody and touches no journal**. It records that a named adjudicator
concluded the customer should be made whole for a stated amount, and points at the governed financial path
that must then execute it — `LedgerReversalGovernanceService` for a reversal, or the existing approval
machinery for another remedy.

The schema has **no journal, wallet or credit-account column** — nothing a well-meaning future implementation
could write to make money move from here. `remedy_execution_reference` is a pointer to the governed path that
executed, never an authorization. `DisputesModule` deliberately does not import `LedgerModule`.

There is a test that completes a full lifecycle including an upheld award and asserts that
`ledger_journals` and `ledger_lines` are unchanged. If a future change made the dispute service write to the
ledger, that test fails.

The alternative is the failure this design avoids: a support agent with dispute rights would hold an unaudited
path to customer funds that bypasses reversal governance, and every financial control in the system would have
a hole shaped like the disputes desk.

## An upheld award needs two people

For `UPHELD_IN_FULL` and `UPHELD_IN_PART`, the adjudicator must differ from the person who raised the claim
and from the person who investigated it. Enforced by a table `CHECK`, so a service bug or a direct SQL
`UPDATE` cannot collapse the roles — verified by removing the constraint and watching exactly the DB-layer
test fail.

A `REJECTED` claim has no such requirement: a decision that owes nothing is not a financial act.

## The award must match the outcome

Consistency is enforced in both the service and the schema:

| Outcome          | Required award                                              |
| ---------------- | ----------------------------------------------------------- |
| `UPHELD_IN_FULL` | exactly the claimed amount                                  |
| `UPHELD_IN_PART` | strictly greater than zero and strictly less than the claim |
| `REJECTED`       | zero                                                        |
| `WITHDRAWN`      | zero                                                        |

A decision also requires a named adjudicator, a timestamp, a rationale and an amount — "upheld, amount
unspecified" cannot be recorded, because that state would need a human to reconstruct from memory what was
agreed.

## The claim is immutable; the decision is final

`UPDATE` is blocked on customer, transaction reference, channel, grounds, claimed amount, currency,
statement, raiser and opening time. This matters for a specific reason: if the claim were mutable, the award
constraints could be satisfied by **editing the claim instead of honouring it** — a full uphold of 1 naira
because someone rewrote a 100,000 claim.

An outcome, an awarded amount and the adjudicator's identity cannot change after the decision. A wrong
decision is corrected by a new dispute or by the governance path for an erroneous reversal, not by overwriting
evidence. `DELETE` is refused outright.

## Closure requires the customer to have been told

A dispute cannot be closed until the claimant has been recorded as informed of the decision, and — where an
award exists — until the remedy is recorded as executed.

This is the substantive rule of the group. An un-informed customer is not a resolved case; it is precisely
the thing that becomes a regulatory complaint, and closure is the moment everyone stops looking.

Correspondence distinguishes an **internal note** (`communicated_to_customer = false`) from a **communication
to the customer** (`true`). Conflating the two is how a bank convinces itself it informed someone who never
heard anything. The event trail is append-only.

## What operators see

`OperationsCentreService` reports three **separate** populations, because they need different actions:

- `disputes:undecided` — work outstanding; `IMMEDIATE` once the oldest is a week old.
- `disputes:decided-not-informed` — `IMMEDIATE`: the customer has not been told.
- `disputes:award-not-executed` — `IMMEDIATE`: money is owed and has not moved.

Collapsing these into one "open disputes" number would hide the two that are actually failures.

## Known gaps

- **No HTTP surface.** Raising a dispute as a customer and deciding one as staff need different authorization
  policies, and deciding an upheld claim needs a financial-control policy. Those are access decisions this
  group does not make. The service API is complete and tested.
- **No automatic remediation.** `recordRemedyExecution` records a reference; it cannot verify that the
  reference points at a real ledger execution without reading the ledger and effectively trusting its own
  write. Verification is the ledger's evidence to produce.
- **No regression claim** (`UPHELD_IN_FULL` reversed on appeal) and no appeal process.
- **No scheme or network complaint escalation** (card scheme dispute timelines, ombudsman referral). Those are
  external processes with their own SLAs.
- **No dispute deadline or SLA.** The age is reported; what the correct deadline is for a Nigerian retail
  dispute is a regulatory decision, as in Group 23.
- **No customer-facing status view.** The customer is informed out-of-band; there is no endpoint they can
  poll.
- `down()` refuses once any dispute exists.
