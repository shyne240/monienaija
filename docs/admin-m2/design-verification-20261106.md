# M2 visual verification and correction — 6 November 2026

## Scope and provenance

This is an implementation checkpoint, **not formal visual acceptance**. Images are real headless Chromium renders of actual Admin Web Vite development source, the real Nest AppModule and a newly migrated disposable PostgreSQL database. Login uses actual local role/password authentication; API reads are real. Only local login POST is permitted by the capture proxy; all other HTTP writes are blocked. Disposable customer, ticket, agent, class and wallet records were created in the test database. Workers were disabled, browser outbound traffic blocked, and the Node network guard was enabled (not an OS firewall). Real SMS/providers and deployed workers were not used. The 90 screenshots in the [manifest](evidence/design-real/manifest.json) include 28 canonical views, login and 16 interaction states at 1440px and 375px; two additional baseline login screenshots are separate. The captured source is the working-tree corrections on top of `3d36053e92064bf3e947c2ccc689e231d9a6e134`, not that commit alone. Views are selected using authorized local roles; aliases are not separate screens. Empty datasets, errors, access differences and unvisited interactions limit what can be concluded.

## The Windows login question

At baseline `3b0ca4488fb40ac5a64ed4ff6264dc64be2e954e`, the real rendered login was a [centered card](evidence/design-real/baseline-login-1440.png) ([375px](evidence/design-real/baseline-login-375.png)). This checkpoint renders the [green identity rail and white sign-in panel](evidence/design-real/login-1440.png) ([375px stacked](evidence/design-real/login-375.png)). Current `App.tsx` renders the redesigned `LoginScreen` directly for unauthenticated sessions. Thus the redesign exists and is the actual current app entry point; this does **not** establish what the user's Windows machine served. Another checkout, branch, server, port or stale browser are possibilities, not diagnosed causes. Commands to identify the served instance are in [Windows verification](windows-local-run.md#verify-which-admin-web-your-browser-is-serving). The same Vite build in Linux produced a bundle containing the redesigned copy and CSS; a Windows-native build and the user's running instance were not observed.

## Screen-by-screen rendered comparison

All links show the current actual render: desktop / narrow. The older baseline comparison above is specifically for login, not a claim that each old screen was independently captured. M2 traits observed across these screens include the green navigation shell, labeled page hierarchy, light surfaces and structured panels. These do not establish that every nested component or interaction is visually complete. Rows describe the captured state, not all possible records.

| ID | Screen and actual screenshots | What is visible | Remaining qualification |
|---|---|---|---|
| A01 | dashboard: [1440](evidence/design-real/dashboard-1440.png) · [375](evidence/design-real/dashboard-375.png) | Overview cards and widgets | Audit widget had squeezed columns; now locally scrollable with a wider time column. |
| A02 | dashboardSettings: [1440](evidence/design-real/dashboardSettings-1440.png) · [375](evidence/design-real/dashboardSettings-375.png) | Template and role-assignment panels | Configuration and confirmation states not exercised here. |
| A03 | customers: [1440](evidence/design-real/customers-1440.png) · [375](evidence/design-real/customers-375.png) | Directory heading, search and table | One disposable customer; empty/error variants not exhaustive. |
| A04 | agents: [1440](evidence/design-real/agents-1440.png) · [375](evidence/design-real/agents-375.png) | Network header, applications and directory | Native filter and undersized controls corrected; nested detail retains some compact inline styles. |
| A05 | agentClasses: [1440](evidence/design-real/agentClasses-1440.png) · [375](evidence/design-real/agentClasses-375.png) | Class catalogue and actions | One disposable class; edits not submitted. |
| A06 | cashToCashOps: [1440](evidence/design-real/cashToCashOps-1440.png) · [375](evidence/design-real/cashToCashOps-375.png) | Find-transfer investigation | No populated transfer. |
| A07 | support: [1440](evidence/design-real/support-1440.png) · [375](evidence/design-real/support-375.png) | Queue and ticket detail | Filter and actions enlarged; one disposable ticket. |
| A08 | transfers: [1440](evidence/design-real/transfers-1440.png) · [375](evidence/design-real/transfers-375.png) | Trace and fee simulator | Empty lookup, no transaction submitted. |
| A09 | cashIn: [1440](evidence/design-real/cashIn-1440.png) · [375](evidence/design-real/cashIn-375.png) | Deposit trace and simulator | Empty lookup, no settlement. |
| A10 | cashOut: [1440](evidence/design-real/cashOut-1440.png) · [375](evidence/design-real/cashOut-375.png) | Withdrawal trace and simulator | Empty lookup, no settlement. |
| A11 | ledgerExplorer: [1440](evidence/design-real/ledgerExplorer-1440.png) · [375](evidence/design-real/ledgerExplorer-375.png) | Account cards and journal investigation | Fixed real account-list contract error; balances are explicitly unavailable, not fabricated. |
| A12 | reconciliation: [1440](evidence/design-real/reconciliation-1440.png) · [375](evidence/design-real/reconciliation-375.png) | Reconciliation verification checks | Default view only; operational exception states not proven. |
| A13 | feeRules: [1440](evidence/design-real/feeRules-1440.png) · [375](evidence/design-real/feeRules-375.png) | Fee registry | Empty catalogue; editor not exercised. |
| A14 | commissionRules: [1440](evidence/design-real/commissionRules-1440.png) · [375](evidence/design-real/commissionRules-375.png) | Commission registry | Empty catalogue; editor not exercised. |
| A15 | rewardRules: [1440](evidence/design-real/rewardRules-1440.png) · [375](evidence/design-real/rewardRules-375.png) | Reward registry | Empty catalogue; editor not exercised. |
| A16 | productCatalogue: [1440](evidence/design-real/productCatalogue-1440.png) · [375](evidence/design-real/productCatalogue-375.png) | Product catalogue | Empty catalogue; editor not exercised. |
| A17 | limitCatalogue: [1440](evidence/design-real/limitCatalogue-1440.png) · [375](evidence/design-real/limitCatalogue-375.png) | Limit profiles and rules | Empty catalogue; editor not exercised. |
| A18 | limitAssignments: [1440](evidence/design-real/limitAssignments-1440.png) · [375](evidence/design-real/limitAssignments-375.png) | Assignments and diagnostics | Empty lookup; mutation states not exercised. |
| A19 | kycQueue: [1440](evidence/design-real/kycQueue-1440.png) · [375](evidence/design-real/kycQueue-375.png) | KYC lookup and decision area | No decision submitted. |
| A20 | complianceCases: [1440](evidence/design-real/complianceCases-1440.png) · [375](evidence/design-real/complianceCases-375.png) | Compliance case lookup | No case selected. |
| A21 | fraudCases: [1440](evidence/design-real/fraudCases-1440.png) · [375](evidence/design-real/fraudCases-375.png) | Fraud case lookup | No case selected. |
| A22 | workforceAccess: [1440](evidence/design-real/workforceAccess-1440.png) · [375](evidence/design-real/workforceAccess-375.png) | Workforce overview and support provisioning | Provision/disable not submitted. |
| A23 | roleGovernance: [1440](evidence/design-real/roleGovernance-1440.png) · [375](evidence/design-real/roleGovernance-375.png) | Role governance forms | No grant submitted. |
| A24 | approvalsInbox: [1440](evidence/design-real/approvalsInbox-1440.png) · [375](evidence/design-real/approvalsInbox-375.png) | Maker-checker inbox | No approval executed; funding checker has no fixture. |
| A25 | superAdminRecovery: [1440](evidence/design-real/superAdminRecovery-1440.png) · [375](evidence/design-real/superAdminRecovery-375.png) | Recovery statement form | No statement signed or submitted. |
| A26 | notifications: [1440](evidence/design-real/notifications-1440.png) · [375](evidence/design-real/notifications-375.png) | Notification console | Nine read-only tab captures linked below; no test send. |
| A27 | systemHealth: [1440](evidence/design-real/systemHealth-1440.png) · [375](evidence/design-real/systemHealth-375.png) | Metrics, diagnostics and outbox | Local environment only, not production health. |
| A28 | auditEvents: [1440](evidence/design-real/auditEvents-1440.png) · [375](evidence/design-real/auditEvents-375.png) | Audit search and results | Local seed/login audit only. |

## Embedded workflows

| ID | Current actual render | Scope and gap |
|---|---|---|
| E01 | Customer 360 [1440](evidence/design-real/customer-overview-1440.png) · [375](evidence/design-real/customer-overview-375.png) | One local customer, read-first overview. |
| E02 | Registration [1440](evidence/design-real/customer-registration-1440.png) · [375](evidence/design-real/customer-registration-375.png) | Initial form only; no registration, OTP or subsequent steps submitted. |
| E03 | Personal information [1440](evidence/design-real/customer-personal-1440.png) · [375](evidence/design-real/customer-personal-375.png) | Empty personal/contact/address records; edit flows not exercised. |
| E04 | Proof of address [1440](evidence/design-real/customer-proof-1440.png) · [375](evidence/design-real/customer-proof-375.png) | Empty local records; physical verification not configured. |
| E06 | Agent funding and defunding | Not captured with a funding-entitled role in this run; earlier [functional integration harness](evidence/tools/integrated-browser-pg.cjs) exercised disposable flows, not visual sign-off. |
| E07 | Agent credentials [1440](evidence/design-real/agent-detail-1440.png) · [375](evidence/design-real/agent-detail-375.png) | Panel in a full agent-detail page; no credentials issued. |
| E10 | Agent history [1440](evidence/design-real/agent-transactions-1440.png) · [375](evidence/design-real/agent-transactions-375.png) | Loaded empty local transaction view; unified stream not loaded. |
| E11 | Funding checker [1440](evidence/design-real/approvalsInbox-1440.png) · [375](evidence/design-real/approvalsInbox-375.png) | Empty checker; populated request and confirmation not visually verified here. |
| E12 | [SMS](evidence/design-real/notification-smsTemplates-1440.png), [email](evidence/design-real/notification-emailTemplates-1440.png) | Actual local template tabs, no saved changes; corresponding 375px files in manifest. |
| E13 | [Provider configuration](evidence/design-real/notification-providerConfig-1440.png) · [375](evidence/design-real/notification-providerConfig-375.png) | Real local fail-closed state; no secrets, connection verification or sends. |

The remaining notification tabs are [overview](evidence/design-real/notification-overview-1440.png), [events](evidence/design-real/notification-events-1440.png), [approvals](evidence/design-real/notification-approvals-1440.png), [provider status](evidence/design-real/notification-providers-1440.png), [deliveries](evidence/design-real/notification-deliveries-1440.png), and [controlled test-send](evidence/design-real/notification-testSend-1440.png); all nine have 375px counterparts in the manifest. [Support ticket detail](evidence/design-real/support-detail-1440.png) is also captured. Agent outlet/terminal sections are visible in agent detail but not loaded; dialogs, error/disabled/focus variants, populated transaction, notification and governance records are not exhaustively captured. Previous [visual review package](visual-review-package.md) contains additional intercepted/synthetic response states and is not evidence of this real integration run.

## Corrections and verification boundaries

* Ledger account list returns account metadata, not balances. The UI incorrectly required a `balanceMinor` field and rejected the real 200 response. It now accepts the real contract and labels an absent balance as unavailable; an invalid supplied balance still fails validation. It does not infer or calculate an amount. A real-browser assertion and a unit regression test cover this case.
* Agent directory filter and action controls, support controls, and dashboard audit-table sizing were visibly inconsistent in the first real capture. These were corrected without changing permissions or mutation logic; current captures show the result. Some nested agent detail and other older inline layouts remain compact; do not equate a redesigned shell with complete design-system consistency.
* 1440px and 375px viewport captures showed no document-wide overflow for the 28 landing views, but local table scrolling is intentional. This is not 200%/400% browser zoom testing, a screen-reader test, or a full keyboard/accessibility audit. Earlier automated axe results have their own scope and cannot replace human checks.
* Frontend typecheck, all 80 Jest suites (801 tests), and Vite production build passed. The local build contains redesigned login CSS/copy; Vite reported a large-bundle warning. Functional results, rendered visual evidence and owner approval are distinct. No formal acceptance has been granted. A00 production sign-in, E05 Tier 3, E08 reclassification and E09 PIN support remain policy-blocked. Nothing here approves or enables them.
