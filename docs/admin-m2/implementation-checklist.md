# M2 Admin Console — implementation and continuation checklist

**Status: INCOMPLETE.** No complete-M2 PR or integration. This is a partial checkpoint, not visual acceptance.

Baseline: `3b0ca4488fb40ac5a64ed4ff6264dc64be2e954e` (fetched integration branch, 2026-11-06). Branch: `arena/44f00580-monienaija` (session-provisioned, fixed). No changes to `main`.

## Recovered foundations and limitations

- [Discovery and inventory](../design-discovery-20261029/README.md), [view/embedded inventory](../design-discovery-20261029/01-inventory.md), [design system](../design-discovery-20261029/03-design-system.md), [financial UX](../design-discovery-20261029/05-financial-ux.md), [M2 roadmap and gates](../design-discovery-20261029/06-roadmap-and-decisions.md).
- [M0 decisions](../design-discovery-20261029/m0/02-owner-decisions.md), [Grounded Clarity](../design-discovery-20261029/m0/03-design-approval.md), [M1 report](../design-discovery-20261029/m1/README.md), [M1 acceptance readiness](../design-discovery-20261029/m1/acceptance/README.md) and historical evidence there. The recovered M0 design document labels itself proposed, not approved; do not infer historical sign-off from code.
- A separate whole-Admin M2 acceptance specification and the latest full redesign investigation were not found in the checked-out tree. The recovered roadmap and inventory, plus the current mission, remain the scope; do not invent a replacement direction. Relevant owner decisions and sensitive-work gates in the recovered docs still need confirmation.

## Inventoried views and embedded workflows

“Partial” is not complete or accepted. “Pending” means no M2 implementation in this checkpoint, even where existing M1 or legacy functionality exists. Inventory links specify access and contextual workflow requirements. All rows require functional, accessibility, responsive and visual verification.

| ID | View / workspace | Implementation and evidence |
|---|---|---|
| [A00](../design-discovery-20261029/01-inventory.md#A00) | Login | Partial: token-based Login restyle; manual visual, keyboard and responsive review pending. |
| [A01](../design-discovery-20261029/01-inventory.md#A01) | dashboard | Partial: Dashboard cards, charts, states, responsive layout and widget request ordering; populated and keyboard review pending. |
| [A02](../design-discovery-20261029/01-inventory.md#A02) | dashboardSettings | Partial: settings form labels, disclosure, states and responsive table; interaction and visual review pending. |
| [A03](../design-discovery-20261029/01-inventory.md#A03) | customers | Partial: M1 customer baseline plus scoped palette changes; full M2 workflow review pending. |
| [A04](../design-discovery-20261029/01-inventory.md#A04) | agents | Partial: Agent list/error handling, request ordering, local table scroll and funding form layout; populated workflows pending. |
| [A05](../design-discovery-20261029/01-inventory.md#A05) | agentClasses | Partial: token palette and responsive adjustments; populated states and actions pending. |
| [A06](../design-discovery-20261029/01-inventory.md#A06) | cashToCashOps | Partial: list ordering/error handling, journal local scroll and unknown balance state; financial/action review pending. |
| [A07](../design-discovery-20261029/01-inventory.md#A07) | support | Partial: list/detail redesign, labeled filters, request ordering and distinct failures; synthetic populated detail tested at eight widths. |
| [A08](../design-discovery-20261029/01-inventory.md#A08) | transfers | Partial: shared transaction layout, exact declared units and customer-history error/empty; populated actions pending. |
| [A09](../design-discovery-20261029/01-inventory.md#A09) | cashIn | Partial: shared transaction layout and declared units; populated actions pending. |
| [A10](../design-discovery-20261029/01-inventory.md#A10) | cashOut | Partial: shared transaction layout and declared units; populated actions pending. |
| [A11](../design-discovery-20261029/01-inventory.md#A11) | ledgerExplorer | Partial: responsive header, labeled controls, locally scrollable tables, exact NGN display and error states; synthetic populated account tested at eight widths. |
| [A12](../design-discovery-20261029/01-inventory.md#A12) | reconciliation | Partial: no inferred balance; exact minor units, report timestamp and stale refresh warning; full workflow visual review pending. |
| [A13](../design-discovery-20261029/01-inventory.md#A13) | feeRules | Partial: shared commercial layout, keyboard tabs, request ordering and exact fee amounts; synthetic populated Fees tested at eight widths. |
| [A14](../design-discovery-20261029/01-inventory.md#A14) | commissionRules | Partial: shared commercial layout and keyboard tabs; populated/action review pending. |
| [A15](../design-discovery-20261029/01-inventory.md#A15) | rewardRules | Partial: shared commercial layout and keyboard tabs; populated/action review pending. |
| [A16](../design-discovery-20261029/01-inventory.md#A16) | productCatalogue | Partial: shared commercial layout and keyboard tabs; populated/action review pending. |
| [A17](../design-discovery-20261029/01-inventory.md#A17) | limitCatalogue | Partial: shared commercial layout and keyboard tabs; populated/action review pending. |
| [A18](../design-discovery-20261029/01-inventory.md#A18) | limitAssignments | Partial: token palette, local table scroll and failure/empty separation; populated workflow review pending. |
| [A19](../design-discovery-20261029/01-inventory.md#A19) | kycQueue | Partial: labeled lookups and failure/empty separation; populated workflow review pending. |
| [A20](../design-discovery-20261029/01-inventory.md#A20) | complianceCases | Partial: labeled lookups and failure/empty separation; populated workflow review pending. |
| [A21](../design-discovery-20261029/01-inventory.md#A21) | fraudCases | Partial: labeled lookup and failure/empty separation; populated workflow review pending. |
| [A22](../design-discovery-20261029/01-inventory.md#A22) | workforceAccess | Partial: shared header and list failure/empty separation; populated permission/action review pending. |
| [A23](../design-discovery-20261029/01-inventory.md#A23) | roleGovernance | Partial: shared header and responsive governance grid; populated role/action review pending. |
| [A24](../design-discovery-20261029/01-inventory.md#A24) | approvalsInbox | Partial: shared header and token palette; populated approval and permission review pending. |
| [A25](../design-discovery-20261029/01-inventory.md#A25) | superAdminRecovery | Partial: token palette only; full recovery workflow redesign and review pending. |
| [A26](../design-discovery-20261029/01-inventory.md#A26) | notifications | Partial: token palette, local scroll, unavailable provider/delivery/outbox states; template, configuration, action and populated review pending. |
| [A27](../design-discovery-20261029/01-inventory.md#A27) | systemHealth | Partial: shared header and token palette; populated diagnostics review pending. |
| [A28](../design-discovery-20261029/01-inventory.md#A28) | auditEvents | Partial: token-based audit surface, labeled search, distinct result states and local table scroll; manual verification pending. |
| [E01](../design-discovery-20261029/01-inventory.md#E01) | Customer 360 workspace | Partial: M1 baseline and customer palette changes; workspace redesign and populated verification pending. |
| [E02](../design-discovery-20261029/01-inventory.md#E02) | Customer registration wizard | Partial: customer palette changes only; wizard redesign and populated verification pending. |
| [E03](../design-discovery-20261029/01-inventory.md#E03) | Personal information & contact | Partial: customer palette changes only; workflow redesign and populated verification pending. |
| [E04](../design-discovery-20261029/01-inventory.md#E04) | Proof of address | Partial: customer palette changes only; workflow redesign and populated verification pending. |
| [E05](../design-discovery-20261029/01-inventory.md#E05) | Tier 3 readiness | Partial: customer palette changes only; workflow redesign and populated verification pending. |
| [E06](../design-discovery-20261029/01-inventory.md#E06) | Agent funding/defunding | Partial: responsive funding form layout and existing approval/MFA/recovery controls retained; loaded maker/checker and action states still require browser review. |
| [E07](../design-discovery-20261029/01-inventory.md#E07) | Agent credentials | Partial: token palette only; credential and session action states need redesign and review. |
| [E08](../design-discovery-20261029/01-inventory.md#E08) | Agent class assignment | Partial: token palette only; assignment workflow states need redesign and review. |
| [E09](../design-discovery-20261029/01-inventory.md#E09) | Agent PIN support | Partial: token palette only; PIN support workflow states need redesign and review. |
| [E10](../design-discovery-20261029/01-inventory.md#E10) | Agent unified history | Partial: palette and failed-refresh distinction; full loaded workflow redesign pending. |
| [E11](../design-discovery-20261029/01-inventory.md#E11) | Funding approvals queue | Partial: token palette only; loaded queue and checker workflow need redesign and review. |
| [E12](../design-discovery-20261029/01-inventory.md#E12) | Notification template workspace | Partial: token palette only; template editor and approval states need redesign and review. |
| [E13](../design-discovery-20261029/01-inventory.md#E13) | Provider configuration workspace | Partial: token palette only; configuration and approval states need redesign and review. |

## Cross-cutting requirements

| Requirement | Status / evidence |
|---|---|
| Existing shell and role-aware navigation | M1 baseline; 28 destinations visited with a synthetic super-admin principal. Contextual and restricted-role manual review remains. |
| Design primitives, tokens, states, forms, tables, charts and dialogs | Partial: M1 tokens plus shared operational surfaces, structured tables, dashboard, support, commercial and funding layout. A palette pass is not full module redesign. Accessible dialogs, charts and remaining states still need review. |
| Financial truth and data freshness | Partial: reconciliation does not equate zero binding discrepancies with balanced books; stale report flagged, C2C incomplete journals unknown, exact amounts in selected surfaces. Remaining financial displays and action states require review. |
| Error vs empty / stale | Partial: Audit, history, Support, Compliance, Fraud, Workforce, Ledger, Agent lists, C2C and Notification read failures improved. Other surfaces and refresh races require review. |
| Authorization, maker-checker, MFA and APIs | Existing tests pass; no intended policy, endpoint or financial action changes. Per-action/role acceptance remains. |
| Responsive widths and zoom | [Navigation smoke](evidence/navigation-smoke.json): 224 synthetic mostly initial/503 cases at 320, 360, 390, 768, 769, 1024, 1280 and 1440 px, no document overflow. [Loaded smoke](evidence/loaded-smoke.json): 24 populated Support, Fees and Ledger cases at those widths, no document overflow. This is not comprehensive responsive acceptance; real 200%/400% zoom and all other populated/action states remain. |
| Keyboard, contrast and assistive technology | Commercial tab keyboard test added; comprehensive manual keyboard, contrast and assistive technology review remains. |
| Visual design, screenshots and owner acceptance | [Synthetic screenshots and scripts](evidence/) include Login, Dashboard, Support, Agents, Notifications, Transfers, populated Fees and Ledger at selected widths. They are not visual acceptance. Obtain Product/Design, Accessibility, Security and Finance/Operations review as applicable; historical design approval remains unconfirmed. |
| Automated checks | Latest: frontend typecheck, 40 Jest suites / 322 tests and production build passed. React test `act(...)` warnings, Vite CJS deprecation and >500 kB bundle warning remain. No Admin lint script provided. |
| CI, PR and integration | Not run / not opened / not merged: substantial implementation and acceptance remain outstanding. |

## Continuation plan

1. Complete actual component-level redesign for all partially treated views and E01–E13, especially customer workspaces, Agent credentials/class/PIN/history/approvals and Notification template/configuration; a token or initial-state pass is not completion.
2. Extend synthetic browser fixtures to populated, empty, error, stale, loading, restricted and mutation/approval states for every view and embedded workflow. Test all specified widths, true browser zoom, keyboard, dialogs and accessibility without real backend actions. Add regression tests for Agent Network and C2C request-order guards.
3. Review all finance formatting, freshness and reconciliation outcomes; check request races and error/empty handling across remaining screens. Preserve APIs, permissions, MFA and maker-checker semantics.
4. Obtain visual and required owner approvals and resolve the historical approval-document discrepancy as final acceptance, not a coding blocker.
5. Re-run typecheck, tests, build, applicable lint and CI; update this matrix and only open the integration PR when the full scope is addressed. Do not merge without required approvals or touch main, live providers, workers or queues.
