# M2 owner visual review package — pending approval

This is a complete **38-row index of representative captures**, not a completed visual review or sign-off. Every image uses synthetic data and a synthetic browser session, not a live operator or production record. The package covers one or more selected states per implemented row; it does **not** picture every action, role, error, empty/loading, responsive layout or workflow. Some captures intentionally share a workspace across rows. All owners must review the running application and missing states, not just screenshots; horizontal table scrolling in a screenshot is not by itself evidence of accessible reflow. Actual 200%/400% browser zoom is not represented. No Product/Design, Accessibility, Security or Finance/Operations approval has been obtained.

## How to review and record decisions

1. Product/Design review each row at both linked CSS viewport widths and compare with approved design, hierarchy, text, layout, focus and intended state; test additional embedded, empty, error, loading, restricted and action states in an approved isolated environment. Record each row, version/commit, reviewer, date, findings and explicit approval or rejection in the owner's decision system. The links themselves do not mean the images have been independently reviewed.
2. Accessibility owner tests with actual desktop-browser zoom set to 200% and 400%, keyboard-only navigation, focus order/visibility, dialog behavior, text reflow, charts/tables, live announcements and a real screen reader; record browser/OS/assistive technology versions and evidence. Do not infer these from screenshots or axe alone.
3. Security and Finance/Operations owners provide an approved isolated environment and appropriately scoped test accounts for role/MFA/maker-checker, scoped records, funding/defunding, reconciliation and recovery workflows. Arrange credentials through an approved secure channel, not in this document or chat. Keep messaging workers disabled and do not send tests. Document authorization decisions and independently review ambiguous-outcome and late-commit handling.
4. For the four excluded policy-blocked items, the relevant Product/Security/Compliance owners must decide A00 production workforce sign-in, E05 Tier 3 eligibility/evidence, E08 Agent reclassification and E09 PIN status/unlock policy before those actions can be implemented and accepted. E04 physical verification also requires a separately approved workflow if desired.

## Representative capture index

Each pair is 320px mobile / 1440px desktop; viewport sizes are **not** zoom levels. Details and test provenance are in the [acceptance report](acceptance-review.md) and linked scripts/evidence. Screenshots may include disabled, unconfirmed or synthetic-success messages as explicitly marked below.

| ID | Implemented item | Capture links | State / limitation |
|---|---|---|---|
| A01 | Dashboard | [320](evidence/acceptance-20261106/dashboard-redesign-320.png) · [1440](evidence/acceptance-20261106/dashboard-redesign-1440.png) | Synthetic populated overview / period |
| A02 | Dashboard settings | [320](evidence/acceptance-20261106/dashboard-settings-redesign-320.png) · [1440](evidence/acceptance-20261106/dashboard-settings-redesign-1440.png) | Synthetic assignment confirmation |
| A03 | Customer directory | [320](evidence/acceptance-20261106/customer-directory-safety-320.png) · [1440](evidence/acceptance-20261106/customer-directory-safety-1440.png) | Read-only directory |
| A04 | Agent network | [320](evidence/acceptance-20261106/agent-onboarding-redesign-320.png) · [1440](evidence/acceptance-20261106/agent-onboarding-redesign-1440.png) | Application draft / discard; other detail sections need separate review |
| A05 | Agent classes | [320](evidence/acceptance-20261106/agent-classes-redesign-320.png) · [1440](evidence/acceptance-20261106/agent-classes-redesign-1440.png) | Catalogue / draft guard |
| A06 | Cash-to-Cash | [320](evidence/acceptance-20261106/cash-to-cash-redesign-320.png) · [1440](evidence/acceptance-20261106/cash-to-cash-redesign-1440.png) | Synthetic trace / receipt |
| A07 | Support | [320](evidence/acceptance-20261106/support-redesign-320.png) · [1440](evidence/acceptance-20261106/support-redesign-1440.png) | Synthetic ticket detail |
| A08 | Transfers | [320](evidence/acceptance-20261106/transactions-redesign-320.png) · [1440](evidence/acceptance-20261106/transactions-redesign-1440.png) | Synthetic trace / fee scenario |
| A09 | Deposits | [320](evidence/acceptance-20261106/visual-cashIn-320.png) · [1440](evidence/acceptance-20261106/visual-cashIn-1440.png) | Synthetic trace, not settlement |
| A10 | Withdrawals | [320](evidence/acceptance-20261106/visual-cashOut-320.png) · [1440](evidence/acceptance-20261106/visual-cashOut-1440.png) | Synthetic trace, not settlement |
| A11 | Ledger explorer | [320](evidence/acceptance-20261106/ledger-redesign-320.png) · [1440](evidence/acceptance-20261106/ledger-redesign-1440.png) | Synthetic journal review |
| A12 | Reconciliation | [320](evidence/acceptance-20261106/reconciliation-redesign-320.png) · [1440](evidence/acceptance-20261106/reconciliation-redesign-1440.png) | Synthetic checks; trial and finance states not pictured |
| A13 | Fee registry | [320](evidence/acceptance-20261106/commercial-redesign-feeRules-320.png) · [1440](evidence/acceptance-20261106/commercial-redesign-feeRules-1440.png) | Synthetic registry |
| A14 | Commission registry | [320](evidence/acceptance-20261106/commercial-redesign-commissionRules-320.png) · [1440](evidence/acceptance-20261106/commercial-redesign-commissionRules-1440.png) | Synthetic registry |
| A15 | Reward registry | [320](evidence/acceptance-20261106/commercial-redesign-rewardRules-320.png) · [1440](evidence/acceptance-20261106/commercial-redesign-rewardRules-1440.png) | Synthetic registry |
| A16 | Product registry | [320](evidence/acceptance-20261106/commercial-redesign-productCatalogue-320.png) · [1440](evidence/acceptance-20261106/commercial-redesign-productCatalogue-1440.png) | Synthetic registry |
| A17 | Limit catalogue | [320](evidence/acceptance-20261106/commercial-redesign-limitCatalogue-320.png) · [1440](evidence/acceptance-20261106/commercial-redesign-limitCatalogue-1440.png) | Synthetic profile/rule registry |
| A18 | Limit assignment | [320](evidence/acceptance-20261106/limit-assignment-redesign-320.png) · [1440](evidence/acceptance-20261106/limit-assignment-redesign-1440.png) | Synthetic unconfirmed toggle / diagnostic workspace |
| A19 | KYC queue | [320](evidence/acceptance-20261106/compliance-redesign-kycQueue-320.png) · [1440](evidence/acceptance-20261106/compliance-redesign-kycQueue-1440.png) | Synthetic KYC lookup |
| A20 | Compliance cases | [320](evidence/acceptance-20261106/compliance-redesign-complianceCases-320.png) · [1440](evidence/acceptance-20261106/compliance-redesign-complianceCases-1440.png) | Synthetic compliance category |
| A21 | Fraud cases | [320](evidence/acceptance-20261106/compliance-redesign-fraudCases-320.png) · [1440](evidence/acceptance-20261106/compliance-redesign-fraudCases-1440.png) | Synthetic fraud category |
| A22 | Workforce access | [320](evidence/acceptance-20261106/workforce-redesign-320.png) · [1440](evidence/acceptance-20261106/workforce-redesign-1440.png) | Synthetic support disable result |
| A23 | Role governance | [320](evidence/acceptance-20261106/role-review-320.png) · [1440](evidence/acceptance-20261106/role-review-1440.png) | Synthetic grant review confirmation |
| A24 | Approvals | [320](evidence/acceptance-20261106/approvals-review-320.png) · [1440](evidence/acceptance-20261106/approvals-review-1440.png) | Synthetic generic review confirmation |
| A25 | Super-Admin recovery | [320](evidence/acceptance-20261106/recovery-focus-320.png) · [1440](evidence/acceptance-20261106/recovery-focus-1440.png) | Synthetic receipt and focus; no real signed statement |
| A26 | Notifications | [320](evidence/acceptance-20261106/notification-overview-redesign-320.png) · [1440](evidence/acceptance-20261106/notification-overview-redesign-1440.png) | Synthetic overview; nine tabs not all pictured |
| A27 | System health | [320](evidence/acceptance-20261106/system-health-redesign-320.png) · [1440](evidence/acceptance-20261106/system-health-redesign-1440.png) | Synthetic diagnostics |
| A28 | Audit trail | [320](evidence/acceptance-20261106/audit-redesign-320.png) · [1440](evidence/acceptance-20261106/audit-redesign-1440.png) | Synthetic filtered result |
| E01 | Customer 360 overview | [320](evidence/acceptance-20261106/visual-customer-overview-320.png) · [1440](evidence/acceptance-20261106/visual-customer-overview-1440.png) | Read-only synthetic profile and wallet |
| E02 | Customer registration | [320](evidence/acceptance-20261106/customer-registration-redesign-320.png) · [1440](evidence/acceptance-20261106/customer-registration-redesign-1440.png) | Synthetic registration / navigation guard |
| E03 | Customer personal information | [320](evidence/acceptance-20261106/visual-customer-personal-320.png) · [1440](evidence/acceptance-20261106/visual-customer-personal-1440.png) | Read-only synthetic personal and address data; editor not pictured |
| E04 | Proof of Address | [320](evidence/acceptance-20261106/visual-customer-proof-320.png) · [1440](evidence/acceptance-20261106/visual-customer-proof-1440.png) | Read-only synthetic document; physical verification unconfigured |
| E06 | Funding and defunding | [320](evidence/acceptance-20261106/visual-maker-320.png) · [1440](evidence/acceptance-20261106/visual-maker-1440.png) | Synthetic unsent maker draft; checker linked below |
| E07 | Agent credentials | [320](evidence/acceptance-20261106/agent-credentials-320.png) · [1440](evidence/acceptance-20261106/agent-credentials-1440.png) | Synthetic session controls; no real credential |
| E10 | Agent history | [320](evidence/acceptance-20261106/agent-history-redesign-320.png) · [1440](evidence/acceptance-20261106/agent-history-redesign-1440.png) | Synthetic stream panel crop |
| E11 | Funding checker queue | [320](evidence/acceptance-20261106/funding-checker-a24-320.png) · [1440](evidence/acceptance-20261106/funding-checker-a24-1440.png) | Synthetic FUND receipt / queue; not proof of posting |
| E12 | Channel templates | [320](evidence/acceptance-20261106/template-redesign-email-320.png) · [1440](evidence/acceptance-20261106/template-redesign-email-1440.png) | Synthetic email template; SMS channel linked below |
| E13 | Provider configuration | [320](evidence/acceptance-20261106/provider-redesign-320.png) · [1440](evidence/acceptance-20261106/provider-redesign-1440.png) | Synthetic provider metadata, no test-send or verification |

## Supplemental captures and provenance

- A23 [grant review](evidence/acceptance-20261106/role-review-1440.png) and [governance result](evidence/acceptance-20261106/role-governance-redesign-1440.png); A24 [generic review](evidence/acceptance-20261106/approvals-review-1440.png) and [funding checker](evidence/acceptance-20261106/funding-checker-a24-1440.png).
- A26 [notification approvals](evidence/acceptance-20261106/notification-approvals-redesign-1440.png), E12 [SMS template 320](evidence/acceptance-20261106/template-redesign-sms-320.png) / [1440](evidence/acceptance-20261106/template-redesign-sms-1440.png), and E13 [provider 320](evidence/acceptance-20261106/provider-redesign-320.png) / [1440](evidence/acceptance-20261106/provider-redesign-1440.png). These do not cover every tab or maker/checker state. These browser captures did not invoke SMS test-send or notification workers. The separate CI qualification is in the acceptance report.
- E06 [maker draft 320](evidence/acceptance-20261106/visual-maker-320.png) / [1440](evidence/acceptance-20261106/visual-maker-1440.png), and [checker receipt](evidence/acceptance-20261106/funding-checker-a24-1440.png). Neither image establishes real money movement.
- Current customer 360 and otherwise-missing deposit, withdrawal and funding-maker screenshots were collected at two widths solely for this package via [customer capture script](evidence/tools/acceptance-visual-customer.cjs) and [other capture script](evidence/tools/acceptance-visual-gaps.cjs), with intercepted reads and zero writes. Their JSON manifests are [customer](evidence/acceptance-20261106/visual-customer-capture.json) and [other](evidence/acceptance-20261106/visual-gaps-capture.json). Other image scripts and results were recorded in the earlier [acceptance report](acceptance-review.md). The A25 focus captures were generated after the focus fix; the remaining captures are from checkpoint `0070eaf` or its evidence, before that isolated recovery focus change.

## Status and exclusions

All 38 rows are **pending owner review**, not accepted. The policy-blocked A00, E05, E08 and E09 are deliberately excluded from the implemented-item index; incidental policy-neutral readiness text or disabled controls in an image does not constitute an approved policy. This package is a starting point for an owner review, not proof that every required visual state is complete.
