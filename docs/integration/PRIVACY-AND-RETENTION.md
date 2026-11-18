# Privacy and retention

Group 27. Scope: data-subject erasure requests and a retention policy register. Where a decision belongs to a
lawyer, a regulator or the product owner it is marked as such rather than assumed.

## What did not exist

Nothing in the codebase could answer a data-subject request. Searches for "retention", "erasure", "anonymise",
"right to" and "data subject" returned only unrelated hits. `customers` has a `softDelete` timestamp — a _hiding_
mechanism, not an erasure one; the personal data is all still there.

## Why this is a request workflow, not a delete

Erasure of a financial-services customer is legally constrained in a way that makes a synchronous "delete
everything" both wrong and dangerous:

- **Ledger records must survive.** `ledger_journals`, `ledger_lines` and `transfers` are immutable by trigger
  precisely so the record of money movement cannot be edited. A routine that reached into them would either fail
  its own triggers or succeed because someone had relaxed them.
- **Statutory retention periods are not mine to invent.** An AML record has a minimum retention in most
  jurisdictions. Deciding that a Nigerian customer's KYC evidence may go after 30 days is a legal decision with
  criminal-liability consequences, and a plausible-looking default is worse than none.
- **Erasure must be auditable.** "We deleted their data" is unverifiable unless the _fact_ of erasure, who
  authorised it, and which categories were covered are recorded — necessarily without retaining the data.

So this builds the request and decision machinery, an **unseeded** retention register, and an executor that
anonymises only what policy permits.

## The safety property: no policy means no erasure

`privacy_retention_policies` ships **empty**. With no policy row for a category, the executor erases nothing and
returns `HELD_UNDER_RETENTION` with the gap recorded. A missing policy can never be read as permission.

**Verified by mutation:** defaulting a missing policy to `erasable: true` failed exactly the "erases nothing when
no policy is configured" test and nothing else.

`erasable` also defaults to **false**, so a category added without a decision is not erasable.

## Refusing is a first-class outcome

| Status                                | Meaning                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| `RECEIVED` → `VERIFYING` → `APPROVED` | the workflow                                                          |
| `COMPLETED`                           | everything requested was erased                                       |
| `PARTIALLY_COMPLETED`                 | what could be erased was; some categories are held — **not terminal** |
| `HELD_UNDER_RETENTION`                | nothing could be erased; the basis is recorded                        |
| `REJECTED`                            | refused, with a recorded basis                                        |
| `WITHDRAWN`                           | the claimant withdrew                                                 |

`PARTIALLY_COMPLETED` is deliberately _not_ terminal. It means "the part we can do is done and the rest is still
owed", so closing it would end the tracking of what the customer is still waiting for. It closes when the held
categories resolve. (This was caught by a schema conflict during development: my first constraint treated it as
terminal, which contradicted the intended workflow. The workflow won and the constraint changed.)

"Erase everything" is not a request the system will guess at: an explicit category list is required, because it
cannot know what the law permits for each category — guessing would either destroy records that must be kept or
refuse a request that should be honoured.

## Verification gates erasure

An unverified claimant cannot erase a customer's data: that would be a **denial-of-service against the
customer**, not a service to them. Approval is refused until identity verification is recorded, and verification
requires a named principal plus a description of how identity was established.

## Anonymisation, never deletion, and never the ledger

The tables written are fixed and enumerated per category — no dynamic SQL, no caller-supplied table name:

| Category                                                            | Target                     | Operation                                                                  |
| ------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `PROFILE_IDENTITY`                                                  | `customer_profiles`        | names → null, `display_name` → `erased`, DOB/nationality → null            |
| `CONTACT_METHODS`                                                   | `customer_contact_methods` | `value`, `normalized_value` → `erased`                                     |
| `ADDRESSES`                                                         | `customer_addresses`       | line fields → `erased`/null                                                |
| `NOTIFICATION_HISTORY`                                              | `notification_deliveries`  | `destination` → `erased`                                                   |
| `BENEFICIARY_DETAILS`, `AUTHENTICATION_CREDENTIALS`, `RISK_FACTORS` | —                          | **not implemented**, reported as `NOT_IMPLEMENTED` with zero rows affected |

The rows survive: the customer's financial history still needs an owner. `city`, `state` and `country` are NOT
NULL on `customer_addresses`, so they are replaced rather than nulled — nulling them would fail the update and
leave the personal data in place while the action log claimed otherwise. (Also caught during development.)

The three unimplemented categories are honest limitations rather than approximations:

- **Beneficiary details** are referenced by transfers that must remain attributable.
- **Authentication credentials** need the revocation path (sessions, recovery challenges, device bindings), not a
  column update.
- **Risk factors** are the evidence behind past policy decisions; anonymising them makes a declined transaction
  unexplainable.

There is a test asserting that no action row names a ledger, journal or transfer table, and that
`ledger_journals` is unchanged after an erasure.

## The record of erasure is evidence

`privacy_erasure_actions` is append-only and records request, category, target, rows affected, outcome, reason and
actor — **never the erased values**, because an erasure log that kept a copy of what it erased would defeat the
erasure. There is a test asserting the action log does not contain the customer's name or phone number.

The request's claim (customer, categories, claimant, opened-at) is immutable by trigger: widening the category
list after approval would make the approval meaningless. Requests cannot be deleted. `down()` refuses while any
request exists.

## What operators see

- `privacy:erasure-approved-not-executed` — `IMMEDIATE`: the customer was told their data would be erased and it
  has not happened.
- `privacy:erasure-open` — `ROUTINE`, escalating to `IMMEDIATE` at 30 days.

## Known gaps

- **No HTTP surface.** Who may raise, approve and execute are three different authorization decisions, and the
  approver must not be the requester — a policy this group does not invent.
- **Retention is registered but not enforced.** Nothing sweeps old data automatically, because the sweep is the
  retention decision and no period is configured.
- **`minimum_age_days` is stored but not consulted.** The executor does not compare the data's age against it,
  because "the age of the data" per category is not a single column — it needs a per-category age definition that
  depends on the retention rule itself.
- **Three categories cannot be erased.** See above.
- **No export/portability** counterpart to erasure (the right to receive one's data is a separate obligation).
- **No consent register.** Consent is not currently tracked as a first-class record.
