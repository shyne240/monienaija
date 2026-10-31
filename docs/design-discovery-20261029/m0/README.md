# M0 — design validation and owner decision pack

**29 October 2026 · Status: ready for owner review; not approved**

This is a targeted follow-up to [discovery](../README.md), not a repeat of the full audit and not an implementation. It records what could be checked in this environment, the decisions still needed, the proposed Grounded Clarity direction, and the exact boundary of a future Admin Web pilot.

## What is established

- The M0 checks were run at discovery commit `cf60b9d8001c605f4d986a222c07ed10e7adee30`. Its `apps` tree is `77099e5a06167041ba3e178cf73157599093f537`, identical to the earlier application baseline at `d212c667c431b05b7b1771c27212e9dc7f360d17`. M0 introduces **documentation and illustrations only**.
- Customer Profile and PIN are registered, but the source search found no normal incoming route to Profile; the PIN entry is inside Profile. With no wallet, Home's direct Support button is absent, but **See All** can reach history; a history row can offer **Get help** leading to ticket creation. A fresh empty or failed history has no such row in the tested path. These findings are source inspection plus mocked component tests, **not device verification**.
- In simulated Admin Web at a 390px viewport, the transfers workspace measured 1,038px wide; horizontal scrolling can expose the Track button. The mobile drawer lacked an expanded state, allowed keyboard focus behind the overlay, and did not close on Escape in the sampled run. Chromium's accessibility tree was inspected; **no actual screen reader was run**.
- Customer `npm run ts:check` still fails with two `TS2344` errors in unregistered `FundWallet` and `Withdraw` screens. No route was enabled or source changed.
- The current Wallet→Cash receipt makes an unsupported assertion about physical handover. The current Cash→Cash result instructs private secret sharing, conflicting with the standing no-credential-distribution restriction. These are owner escalations, not changes authorized by this pack.

See the [evidence, results and unknowns](01-verification.md) for exact conditions and limits.

## Deliverables

1. [Verification and remaining unknowns](01-verification.md) — source links, mocked/native-test limits, browser measurements and follow-up verification.
2. [Owner decision register](02-owner-decisions.md) — explicit options, recommended defaults, accountable roles and blocking milestones.
3. [Grounded Clarity approval spec](03-design-approval.md) — light tokens, typography, layout, component behavior and two labeled, nonfunctional synthetic concepts.
4. [Exact proposed M1 file scope and acceptance](04-m1-scope.md) — a strictly bounded shell and read-only Directory presentation pilot, preserving all existing actions and authorization behavior.
5. [Branch, concurrency and dependency plan](05-branch-and-dependencies.md) — baseline, ownership boundaries and gates.
6. Reproducible test descriptions: [Customer component probe](evidence/customer-component-probe.md) and [Admin headless browser probe](evidence/admin-browser-probe.md). The test harnesses are documentation, not application tests or new application dependencies.

## Decisions that actually block work

**M1 cannot start in this session.** The user requested a separate frontend/design branch, but this session is pinned to `arena/92fd33dd-monienaija` and cannot create, switch to, rename or push any other branch. A separately provisioned, appropriately pinned design workspace is required. In addition, M1 requires explicit Product Owner authorization to edit the proposed Admin files, approval of the visual/interaction direction, an agreed application baseline, and authorization-owner review of parity tests. Approval of this document alone does not grant those permissions.

The financial and Customer Mobile decisions [D2–D5, D7, D12–D13](02-owner-decisions.md) block their **respective future sensitive/mobile work**, not the isolated read-only M1 pilot, provided that pilot does not touch them. Manual desktop assistive-technology acceptance is required **before M1 is accepted**, while actual native device and screen-reader validation is required before the relevant mobile milestone is accepted. Arena 4's independent security acceptance remains a separate process; this document does not close it.

**Requested next step:** owners review the [decision register](02-owner-decisions.md), approve or revise the [design](03-design-approval.md) and [M1 boundary](04-m1-scope.md), and explicitly authorize M1 only after a separate design workspace has been provisioned. Until then: no UI implementation, financial/security changes, merge, provider activation or deployment.
