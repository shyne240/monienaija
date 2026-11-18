# SMS and email delivery receipts

Group 26. Scope: what happens _after_ a provider accepts a message. Where a decision belongs to the product
owner or to infrastructure it is marked as such rather than assumed.

## What already existed

Notification infrastructure is substantial and none of it was rebuilt:

- `NotificationDispatcherService` turns domain events into durable delivery intents.
- `NotificationDeliveryProcessor` claims them under a lease, retries with bounded attempts, and distinguishes
  `PENDING` / `SENT` / `FAILED` / `SKIPPED` / `UNKNOWN` / `DEAD`.
- Brevo and Resend adapters exist for email; a normalising adapter exists for SMS.
- `NotificationChannelResolverService` honours per-channel opt-outs, with a hardened rule that
  security-critical messages bypass a customer's opt-out.

## The gap, stated exactly

`email-provider.interface.ts` said it plainly in its own comment:

> `SENT` for email strictly means "accepted by the provider API" — confirmed recipient delivery
> (bounce/open/delivered webhooks or status polling) is a documented future enhancement.

So `SENT` meant "the provider took it". Nothing could learn that an address bounced, a handset was unreachable,
a carrier filtered a message, or a mailbox marked it as spam. Three consequences:

1. **A dead destination is retried forever** across different messages — every send accepted, logged `SENT`,
   repeated on the next event.
2. **Nobody could answer "did the customer actually receive the OTP that mattered?"** Every attempt looked
   identical.
3. **Bounce and complaint rates — the signals that get a sending domain blocked — were invisible** until the
   provider shut the account off.

## A receipt never rewrites the original verdict

A receipt is a **separate fact with its own timestamp**. A delivery marked `SENT` stays `SENT`; a later bounce
is recorded beside it, so the history reads "accepted at 10:00, bounced at 10:00:04".

Rewriting `SENT` into a failure would erase the distinction between _"the system could not know"_ and _"the
system knew and continued"_. That is the same declared-versus-measured discipline that governs recovery and
alerting elsewhere in this work, and collapsing it would make a missed OTP unexplainable.

There is a test asserting the delivery row's `status` and `sent_at` are untouched after a hard bounce is
recorded against it.

## Suppression requires permanent, verified evidence

Suppression means the customer stops receiving messages — **including security-critical ones that deliberately
bypass opt-out**. That makes it the most dangerous write in this group, so two conditions are both required:

| Receipt kind     | Suppresses | Reason                                       |
| ---------------- | ---------- | -------------------------------------------- |
| `DELIVERED`      | no         | —                                            |
| `DEFERRED`       | **no**     | greylisting and full mailboxes are temporary |
| `BOUNCED` (soft) | **no**     | a full mailbox resolves                      |
| `BOUNCED` (hard) | yes        | the mailbox does not exist                   |
| `COMPLAINED`     | yes        | the recipient reported spam                  |
| `UNSUBSCRIBED`   | yes        | the recipient asked to stop                  |

And independently: **an `UNVERIFIED` receipt never suppresses**, no matter the kind.

A webhook endpoint is a public surface, so any receipt can be forged by anyone who can reach it. A forged bounce
would be a denial-of-service against a customer's ability to receive a one-time code. Unverified receipts are
therefore **recorded but not acted on**, and this is enforced by a table `CHECK`
(`suppressed_at IS NULL OR suppression_verified`) — not by service convention.

**Verified:** removing that `CHECK` failed exactly the DB-layer test and nothing else; restoring returned 27/27.

## Provider retries do not multiply

`(channel, provider_event_id)` is unique, so the same webhook delivered five times is **one** bounce. Without
this, whichever provider retries hardest would dominate the reputation calculation and a single bounce would
look like an outage. A receipt with no event id cannot be de-duplicated and is stored separately rather than
dropped.

## Destinations are hashed, not listed

Reputation must be per destination across messages that carry no shared identifier, but an operator dashboard
must not become a readable list of customer phone numbers and addresses. Each destination is stored as an
unsalted SHA-256 hash plus a masked display form (`ab***@example.com`, `*******1234`). A deployment that wants
enumeration resistance should add a secret to the hash — that is an infrastructure decision, not one to invent
here.

## Are security notices actually arriving?

`notification_security_delivery_posture` answers the question a fraud or security team asks after an incident:
of the security-critical notices we attempted, how many did we _know_ reached the recipient?

| Column                | Meaning                             |
| --------------------- | ----------------------------------- |
| `attempted`           | deliveries the provider accepted    |
| `confirmed_delivered` | receipts said `DELIVERED`           |
| `known_undelivered`   | receipts said `BOUNCED` or `FAILED` |
| `no_receipt`          | provider reported nothing           |

`no_receipt` is **not** a failure — most providers do not report every message, and alerting on it would be a
permanent, meaningless signal that trains operators to ignore the area. Only `knownUndelivered` produces an
operations-centre item, and it is `IMMEDIATE`: these are the notices that deliberately bypass opt-out because
the platform judged them necessary.

Unverified receipts are excluded from the view, because an unauthenticated bounce is not knowledge.

## Suppression is reviewable and reversible

Suppression is invisible to the customer: they do not know it happened, and the next message they expect simply
never arrives. So suppressed destinations are listed, and lifting a suppression requires a **named principal
and a stated reason**. Counters and receipts survive a lift — the history of why it happened is evidence.

## Known gaps

- **No webhook HTTP endpoint.** The service records receipts and is fully tested, but nothing exposes a public
  route for Brevo, Resend or an SMS aggregator to call. That needs signature verification per provider, and
  **no provider credentials or webhook secrets exist in this environment** — inventing an endpoint that cannot
  be exercised against a real provider would be a claim without evidence.
- **No provider signature scheme implemented.** `verification` is set by the caller; the caller that verifies a
  Brevo or Resend signature does not exist yet.
- **No status-polling fallback** for providers that do not push.
- **Suppression is advisory to the send path, not enforced.** `isSuppressed()` exists but
  `NotificationDeliveryProcessor` does not call it; wiring it in changes send behaviour and needs the
  interaction with the security-critical bypass decided deliberately.
- **No open/click analytics beyond recording the receipt.** `OPENED`/`CLICKED` are stored; nothing aggregates
  them, and open tracking is unreliable by nature.
- `down()` refuses once any receipt exists.
