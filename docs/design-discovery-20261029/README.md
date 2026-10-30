# MonieNaija premium UI/UX discovery

**Decision document · 29 October 2026 · baseline `d212c667c431b05b7b1771c27212e9dc7f360d17`**

**Status:** discovery complete; proposals await Product Owner approval. No redesign implementation, feature, provider activation, deployment or financial/security change is included. Existing notification reliability work is not production-ready and Arena 4's independent security acceptance remains open.

**Follow-up:** the [M0 design validation and owner decision pack](m0/README.md) adds targeted simulated verification, explicit decisions, nonfunctional concepts and a proposed M1 file boundary. Approval and a separately provisioned design workspace are still required before M1.

## Executive assessment

MonieNaija has a stronger functional foundation than its fragmented visual language suggests: Customer 360 has coherent responsive styling and form semantics; Agent mobile already distinguishes many backend outcomes and gates services using server capabilities; admin navigation contains permission checks; several flows preserve replay/unknown outcomes and secret handling. A premium redesign should **retain those controls**, make money/state/identity more legible, and reduce operator cognitive load—not replace domain behavior.

The material risks are not merely cosmetic:

1. **Critical, source-inferred:** Customer Profile has no visible incoming in-app navigation found; PIN management is linked from that Profile. A customer without a PIN may therefore be unable to set one before a PIN-protected transfer. Verify on device and review under existing policy. [UX01](02-screen-audit.md#prioritized-cross-cutting-findings)
2. **High, source-inferred:** a Wallet→Cash receipt asserts physical cash was handed over although the ledger result does not establish that; a separate Cash→Cash instruction conflicts with the standing prohibition on sending sensitive transfer credentials to beneficiaries. These are escalation items, not authorization to change security or invent handover policy. [UX02–03](02-screen-audit.md#prioritized-cross-cutting-findings)
3. **High, measured/source-inferred:** existing customer status colors are below 4.5:1 for normal text; a narrow Admin transfer view measured 1038px of scrollable content in a 390px viewport; the Admin overlay did not close on Escape and allowed focus behind it. [UX04–05, UX08](02-screen-audit.md#prioritized-cross-cutting-findings)
4. **High, source-inferred:** history load failure can be presented as empty, Profile falls back to apparently factual KYC/account values when data is unavailable, and customer transfers require a raw wallet UUID without a verified recipient name or fee/total review. No recipient or fee contract is assumed. [UX06–07, UX13](02-screen-audit.md#prioritized-cross-cutting-findings)
5. **High, command-verified:** Customer Mobile's existing TypeScript check fails on two **unregistered sandbox** screens whose route types are absent. The test suite can pass while this remains unresolved; do not register the screens to silence the errors. [Validation](evidence/README.md)

## Portfolio in one view

| Actual app | Registered view/route entries | Distinct routed components | Other status |
|---|---:|---:|---|
| Admin Web | 29 = 28 in-memory canonical views + Login | 22 | Nine legacy aliases canonicalize to existing views; no URL router. |
| Customer Mobile | 12 native-stack names, including Splash | 12 | Profile is registered but no incoming in-app link was found; two sandbox screens are unregistered. |
| Agent Mobile | 28 native-stack names, including Splash | 27 | `History` aliases `Transactions`; one generic placeholder is unregistered. |
| **Total** | **69** | **61** | 13 substantial embedded Admin panels and three unregistered mobile screens are audited separately, not counted as routed screens. |

No separate merchant or aggregator self-service application was found. The route inventory is deliberately not a count of distinct URLs, simultaneous role access, complete workflows, or production features. See the complete [inventory](01-inventory.md) and [85-row, 12-dimension audit](02-screen-audit.md).

## Recommended design direction: “Grounded clarity”

A restrained Nigerian fintech identity built around **deep treasury green, quiet mineral neutrals and a sparing warm-gold accent**; no decorative gradients or “luxury” flourish at the expense of data. Strong type and tabular numerals emphasize the amount, currency, recipient and state. Light mode is the first release; a fully specified dark palette is a later, explicitly approved accessibility-tested option, not assumed to exist today. Dashboard layouts should feel calm and compact; money-moving journeys should use deliberately paced review/authorization/result states. See [tokens, components and WCAG standards](03-design-system.md), [IA and low-fidelity wireframe specifications](04-ia-and-wireframes.md), and [financial UX rules](05-financial-ux.md).

## Proposed sequence and decision gate

1. **M0 — Owner/security sign-off and device validation**: agree on safety boundaries, validate the critical findings and contracts.
2. **M1 — Admin foundation + read-only Customer Directory pilot**: semantic tokens, web primitives, accessible responsive shell and one governed pilot. This is the recommended first implementation milestone **only after approval**.
3. **M2 — Complete Admin operational surfaces**: preserve all 28 canonical views, all current capability/scope gates and their nested workflows; coordinate sensitive areas with their owners.
4. **M3 / M4 — Customer and Agent mobile**, potentially in parallel only **after backend/Admin completion**, security acceptance and required decisions; preserve native stacks and financial behavior.
5. **M5 — Cross-platform accessibility, regression and release-readiness review**; deployment remains a separate decision.

Indicative range: **220–342 person-days**, roughly **12–18 calendar weeks** with the stated staffing and M3/M4 parallelism, excluding backend contract expansion and external review delays. This is a planning estimate, not a commitment. [Roadmap, staffing, dependencies, acceptance and decisions](06-roadmap-and-decisions.md).

**Approval requested:** Product Owner should approve or revise M0/M1, appoint Finance/Operations/Security/accessibility owners, and resolve the decision register before implementation. No redesign work should start merely because this document exists.

## Deliverables and boundaries

- [Complete app/route/component/state inventory](01-inventory.md)
- [Per-screen 12-axis scorecard and prioritized findings](02-screen-audit.md)
- [Design system, tokens, contrast and accessibility](03-design-system.md)
- [Information architecture and low-fidelity wireframe specifications](04-ia-and-wireframes.md)
- [Evidenced financial journeys and safety rules](05-financial-ux.md)
- [Phased roadmap, ownership, risks and decisions](06-roadmap-and-decisions.md)
- [Labeled synthetic current-state screenshots and test evidence](evidence/README.md)

The user requested a separate design branch; this session is pinned to `arena/92fd33dd-monienaija` and cannot create, rename or switch branches. These documentation-only deliverables are committed on that pinned branch, separated by path and commit rather than branch. No other agent's branch or work is modified.
