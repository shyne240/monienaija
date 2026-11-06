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
| [A01](../design-discovery-20261029/01-inventory.md#A01) | dashboard | Pending — redesign and verification. |
| [A02](../design-discovery-20261029/01-inventory.md#A02) | dashboardSettings | Pending — redesign and verification. |
| [A03](../design-discovery-20261029/01-inventory.md#A03) | customers | M1 baseline only; M2 acceptance pending. |
| [A04](../design-discovery-20261029/01-inventory.md#A04) | agents | Pending — redesign and verification. |
| [A05](../design-discovery-20261029/01-inventory.md#A05) | agentClasses | Pending — redesign and verification. |
| [A06](../design-discovery-20261029/01-inventory.md#A06) | cashToCashOps | Pending — redesign and verification. |
| [A07](../design-discovery-20261029/01-inventory.md#A07) | support | Pending — redesign and verification. |
| [A08](../design-discovery-20261029/01-inventory.md#A08) | transfers | Partial: customer-history error/empty and exact minor units; no M2 screen redesign. |
| [A09](../design-discovery-20261029/01-inventory.md#A09) | cashIn | Partial: shared transaction component; full redesign and verification pending. |
| [A10](../design-discovery-20261029/01-inventory.md#A10) | cashOut | Partial: shared transaction component; full redesign and verification pending. |
| [A11](../design-discovery-20261029/01-inventory.md#A11) | ledgerExplorer | Pending — redesign and verification. |
| [A12](../design-discovery-20261029/01-inventory.md#A12) | reconciliation | Partial: no inferred balance; exact minor units, report timestamp and stale refresh warning; full redesign pending. |
| [A13](../design-discovery-20261029/01-inventory.md#A13) | feeRules | Pending — redesign and verification. |
| [A14](../design-discovery-20261029/01-inventory.md#A14) | commissionRules | Pending — redesign and verification. |
| [A15](../design-discovery-20261029/01-inventory.md#A15) | rewardRules | Pending — redesign and verification. |
| [A16](../design-discovery-20261029/01-inventory.md#A16) | productCatalogue | Pending — redesign and verification. |
| [A17](../design-discovery-20261029/01-inventory.md#A17) | limitCatalogue | Pending — redesign and verification. |
| [A18](../design-discovery-20261029/01-inventory.md#A18) | limitAssignments | Pending — redesign and verification. |
| [A19](../design-discovery-20261029/01-inventory.md#A19) | kycQueue | Pending — redesign and verification. |
| [A20](../design-discovery-20261029/01-inventory.md#A20) | complianceCases | Pending — redesign and verification. |
| [A21](../design-discovery-20261029/01-inventory.md#A21) | fraudCases | Pending — redesign and verification. |
| [A22](../design-discovery-20261029/01-inventory.md#A22) | workforceAccess | Pending — redesign and verification. |
| [A23](../design-discovery-20261029/01-inventory.md#A23) | roleGovernance | Pending — redesign and verification. |
| [A24](../design-discovery-20261029/01-inventory.md#A24) | approvalsInbox | Pending — redesign and verification. |
| [A25](../design-discovery-20261029/01-inventory.md#A25) | superAdminRecovery | Pending — redesign and verification. |
| [A26](../design-discovery-20261029/01-inventory.md#A26) | notifications | Baseline has limited M1 primitive adoption; M2 pending. |
| [A27](../design-discovery-20261029/01-inventory.md#A27) | systemHealth | Pending — redesign and verification. |
| [A28](../design-discovery-20261029/01-inventory.md#A28) | auditEvents | Partial: token-based audit surface, labeled search, distinct result states and local table scroll; manual verification pending. |
| [E01](../design-discovery-20261029/01-inventory.md#E01) | Customer 360 workspace | Pending — redesign and verification. |
| [E02](../design-discovery-20261029/01-inventory.md#E02) | Customer registration wizard | Pending — redesign and verification. |
| [E03](../design-discovery-20261029/01-inventory.md#E03) | Personal information & contact | Pending — redesign and verification. |
| [E04](../design-discovery-20261029/01-inventory.md#E04) | Proof of address | Pending — redesign and verification. |
| [E05](../design-discovery-20261029/01-inventory.md#E05) | Tier 3 readiness | Pending — redesign and verification. |
| [E06](../design-discovery-20261029/01-inventory.md#E06) | Agent funding/defunding | Pending — redesign and verification. |
| [E07](../design-discovery-20261029/01-inventory.md#E07) | Agent credentials | Pending — redesign and verification. |
| [E08](../design-discovery-20261029/01-inventory.md#E08) | Agent class assignment | Pending — redesign and verification. |
| [E09](../design-discovery-20261029/01-inventory.md#E09) | Agent PIN support | Pending — redesign and verification. |
| [E10](../design-discovery-20261029/01-inventory.md#E10) | Agent unified history | Partial: failed refresh no longer retains a misleading empty result; full redesign pending. |
| [E11](../design-discovery-20261029/01-inventory.md#E11) | Funding approvals queue | Pending — redesign and verification. |
| [E12](../design-discovery-20261029/01-inventory.md#E12) | Notification template workspace | Pending — redesign and verification. |
| [E13](../design-discovery-20261029/01-inventory.md#E13) | Provider configuration workspace | Pending — redesign and verification. |

## Cross-cutting requirements

| Requirement | Status / evidence |
|---|---|
| Existing shell and role-aware navigation | M1 baseline; M2 parity, contextual navigation and responsive/manual sign-off pending. |
| Design primitives, tokens, states, forms, tables, charts and dialogs | Partial: M1 tokens extended to Login, primitives reused for Audit; comprehensive migration, accessible dialogs, charts and state coverage pending. |
| Financial truth and data freshness | Partial: reconciliation no longer equates zero binding discrepancies with balanced books; retained finance report marked stale on failed refresh; touched reconciliation and customer history displays show exact server minor units and currency. Other financial surfaces remain unreviewed. |
| Error vs empty / stale | Partial: Audit, customer history and Agent history corrections; no whole-console audit performed. |
| Authorization, maker-checker, MFA and APIs | No intended policy or backend changes; existing Jest suite passes, full per-action and role acceptance pending. |
| Responsive 320, 360, 390, 768, 769, 1024, 1280, 1440; 200%/400% zoom | Not verified in a real browser; audit local table scroll and reconciliation grid improvements require visual confirmation. |
| Keyboard, contrast and assistive technology | Not manually verified. Existing M1 checks do not establish M2 accessibility. |
| Visual design, screenshots and owner acceptance | Not performed; no browser executable was present. Historical M1 evidence is not evidence for current changes. Obtain Product/Design, Accessibility, Security and Finance/Operations review as applicable. |
| Automated checks | `npm test -- --runInBand`: 39 suites, 314 tests passed; targeted `m2-truthful-states.test.tsx` added. `npm run ts:check` and `npm run build` passed; Vite reported a large-chunk warning. No Admin lint script provided. |
| CI, PR and integration | Not run / not opened / not merged: substantial implementation and visual acceptance remain outstanding. |

## Next steps

1. Recover any missing authoritative whole-admin M2 specification/investigation if available, and confirm the historically open approval and sensitive-work gates with owners without changing policies.
2. Complete shell/Login/Dashboard, then Customer and Support, Agent and nested workflows, Transactions and Finance, Commercial, Compliance/Risk and Governance, Notifications and System in the mission order. Update each row only with exact code and verification evidence.
3. Review all financial formatting and status semantics across remaining screens; avoid currency or exponent assumptions and audit empty/error/stale/unknown states. Preserve API, authorization, maker-checker, MFA and financial behavior.
4. Add module-by-module synthetic tests and perform browser/keyboard/zoom checks at every required viewport. Record screenshots and findings, remediate failures and obtain owner review.
5. Re-run typecheck, tests, build and relevant lint; open the full-scope PR only when substantially complete, confirm CI and acceptance, and merge solely into the integration branch after required approvals. Do not touch `main` or activate providers, workers or live queues.
