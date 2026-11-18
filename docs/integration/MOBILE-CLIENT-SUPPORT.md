# Customer and agent mobile client support

Group 25. Scope: what the platform knows about the client builds talking to it, and what it should do about an
old one. Where a decision belongs to release management it is marked as such rather than assumed.

## What already existed

Both mobile surfaces are served: `CustomerAppController`, and the agent app / cash-in / cash-out /
cash-to-cash controllers. `ApiVersionService` reports a current API version, a supported list, a
`deprecated: []` array and an `X-API-Version` header name.

## The gap

`ApiVersionService` is a **report**, not a control:

- Nothing reads the `X-API-Version` header it advertises.
- `deprecated` is a hard-coded empty array.
- `APP_VERSION` describes the **server**, not any client build.

So there was no answer to the only question a mobile release turns on:

> "A customer is running a build from eight months ago. Is that acceptable, and if not, what should happen?"

Nothing recorded which builds exist, nothing could mark a build unsupported, and no operator could see what
share of the installed base was on an old build.

## Three states, not a boolean

A "force update" flag cannot express the range where real decisions happen:

| State        | Meaning                          | Allowed                 |
| ------------ | -------------------------------- | ----------------------- |
| `SUPPORTED`  | at the latest registered version | yes                     |
| `DEPRECATED` | usable, but a newer build exists | **yes** — advisory only |
| `BLOCKED`    | below the support floor          | no                      |
| `UNKNOWN`    | not on the register              | **yes** — never blocked |

Two of those choices are worth defending:

- **`DEPRECATED` does not refuse money.** An old app that still works is not a security event, and refusing a
  transaction because a customer has not updated is a worse outcome than a stale UI. Blocking is reserved for
  builds below a floor someone deliberately raised.
- **`UNKNOWN` is served, not blocked.** A register that starts empty is the normal case, and a malformed
  version usually means a client parsing bug. Blocking there would turn a cosmetic defect into an outage for
  every user of that build. `UNKNOWN` is _reported_, so the gap is visible — a build above every registered
  version is not "supported", because the register has not seen it.

## Versions compare numerically

`9.10.0` sorts above `9.9.0`. Comparing the text labels puts them the other way round, silently, and the bug
only appears on the release that crosses a double-digit component — at which point force-update logic inverts.
Versions are stored as three integers plus a label, and every comparison uses the integers.

**Verified:** mutating `compare()` to lexical comparison failed exactly the `9.10.0` / `9.9.0` test.

## The floor comes from the register, not from the client's own row

A release engineer raises the floor on the newest build. If the floor were read from the row matching the
_reported_ version, an old client would keep its own old floor forever — which is precisely the failure a
force-update exists to prevent. `evaluate()` takes the **highest** floor across all builds for that
client/platform.

The floor is per client **and** per platform: raising Android's floor does not block iOS or the agent app.

## A blocked build must state why

`floor_rationale` is required whenever the floor is above a build's own version, enforced by both the service
and a table `CHECK`. "Why can't I use my app" is a support question with a specific answer, and an unexplained
block is the kind of thing that becomes a complaint.

## The register is a release fact

- Build identity (client, platform, version) is immutable by trigger; re-registering the same build **updates**
  the floor rather than creating a second row that could disagree about support.
- `DELETE` is refused: a build that shipped did ship, and deleting it would make "we never supported that
  build" possible.
- `down()` refuses while any build is registered, so a past force-update stays explainable.

## Adoption visibility

`mobile_client_observations` counts **sessions per build per day** — not devices, not customers, not request
IDs. An operator needs the share of the installed base on an old build in order to time a force-update, and
nothing about who. There is a test asserting the table has no `device_id`, `customer_id` or `request_id`
column.

Blocked and deprecated shares are reported separately because they call for opposite decisions: a large
deprecated share means announce the update, a large blocked share means the floor was raised too early.

Telemetry failure is swallowed — an adoption metric is never worth failing a customer request.

## What is deliberately not decided here

- **No minimum version is seeded, and no build is registered.** Which build must be considered unsupported is a
  release-management decision made after a build ships and adoption is measured. Seeding a floor would block
  real users on the strength of an invented number.
- **No update URL, store identifier or deep link.** Those belong to the client applications and app-store
  configuration.
- **No platform detection from user-agent.** The client reports its own platform; guessing would mis-classify
  exactly the old builds that matter.
- **Not wired into existing routes.** `evaluate()` is safe to call anywhere, but whether a given endpoint should
  enforce `allowed` or merely surface the advisory is a per-endpoint decision. Applying it to every existing
  route at once would change behaviour on surfaces this group has not examined.

## Known gaps

- No request-path enforcement yet: the service is available and tested, but no controller calls it.
- No push notification of a required update; the client learns on its next request.
- No staged rollout or percentage gating of a new build.
- No per-app-store version reconciliation — the register is what this platform believes, not what a store
  lists.
- No device attestation or integrity signal (jailbreak/root detection). That is a separate control.
