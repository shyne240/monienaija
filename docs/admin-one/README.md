# MonieNaija One — Phase 1 review

The owner-approved source images are in [`reference/`](reference/) (supplied ZIP MD5 `3210a348349c72d735c0349c2da466bf`). The revised frontend is commit **`74053064c3f97d226d68fe7f90de47abe259a743`**, on `arena/44f00580-monienaija`. Screenshots and comparisons are recorded in a subsequent evidence commit. This is not owner approval.

## Rendered images

| Screen | 1440px | 375px | Original reference vs desktop capture |
|---|---|---|---|
| Login | [desktop](evidence/login-1440.png) | [mobile](evidence/login-375.png) | [comparison](evidence/comparisons/login-side-by-side.png) |
| Dashboard | [desktop](evidence/dashboard-1440.png) | [mobile](evidence/dashboard-375.png) | [comparison](evidence/comparisons/dashboard-side-by-side.png) |
| Directory | [directory](evidence/customers-1440.png), [drawer](evidence/customer-preview-1440.png) | [directory](evidence/customers-375.png), [drawer](evidence/customer-preview-375.png) | [comparison](evidence/comparisons/directory-side-by-side.png) |

The comparison PNGs show the entire original on the left and the top 900px of the desktop capture on the right, scaled to fit. The references are illustrative; their figures are not actual data.

Chromium captured Vite and the real Nest application against a disposable migrated PostgreSQL database with synthetic local workforce accounts and one synthetic customer. No API fixtures were used. The proxy allowed only GET and local-login POST; Node outbound networking was guarded, and notification/cash-to-cash workers were disabled. No real SMS, user database, production services or `.env` were changed. The dashboard screenshots and the mobile directory screenshot use expanded-height viewports at the stated widths to avoid Chromium omitting off-screen scrollable content. The mobile drawer image is an actual 375 × 900 viewport. Separate 375 × 900 captures show the directory table [before](evidence/customer-preview-table-375.png) and [after](evidence/customer-preview-table-scrolled-375.png) horizontal scrolling, **after the modal drawer is closed**. The [manifest](evidence/manifest.json) records the screenshot heights and verifies the authorized customer search at both widths.

## Connected behavior and remaining dependencies

- **Search:** The top search performs real authorized customer name/reference/contact search through `GET /internal/customers` (contact matching remains server scope-gated) and searches permitted workspace names. Search results use the existing customer-ID navigation guard. It does not search agents, transactions or tickets. Those need authorized backend text-search contracts: the current agent list and support list expose filters but no text-search query; the transaction interface supports exact UUID lookup rather than a general search. The UI identifies the supported scope rather than claiming universal search.
- **Action items:** The panel uses the guarded KYC status summary and `OPEN` support-ticket total where authorized, and links to eligible approvals without claiming an unavailable count. A unified count, flagged-transaction queue and a reliably scoped approvals-count endpoint remain backend dependencies. Available counts are not fabricated.
- **Cards and activity:** Transaction totals use the authorized summary; active-agent and customer totals use guarded existing endpoints. A role without permission sees restricted states. The trend is actual completed-count data; recent transactions, reconciliation and audit entries use authorized existing widgets. There is no fabricated overall health score, mock trend, or percentage comparison.
- **Directory drawer:** It is a modal side drawer with focus trapping, Escape dismissal and focus restoration. Its transaction and KYC quick actions appear only with the corresponding scope and route to the existing guarded customer-context workflows; Customer 360 remains the complete workspace. Reference-only sorting, import/export, saved views, notes and mock drawer tabs were not presented as functional. The 375px table scrolls as a whole so its action is not covered by a pinned column.
- **Login:** The diagonal composition, decorative dotted map/waves and password reveal were added without changing authentication. The reference's remember-me and password-reset controls were not invented; they require an approved authentication policy and supported backend flow. A00 production sign-in remains policy-blocked.

The 81 Admin Web suites / 811 tests, TypeScript check and Vite build passed (the build reports a large-chunk warning). Chromium verified local login, authorized customer global search, directory navigation, drawer opening, horizontal scroll/action visibility and Customer 360 entry at both widths. It did not verify production login, writes, all roles, real devices, zoom or screen readers. No PR, merge or deployment was made.

### Full-console batch: Support and shared contextual drawers

Source commit `6b5bee476520d68c2d53958c6f45f30525788ecc` adds status filters to the Support queue and uses the shared responsive modal drawer for Support detail and Customer Directory preview. The drawer delegates close decisions to existing workflow guards; a modal stack prevents nested confirmation dialogs from competing for focus. Support assignment, status changes, message submission, retry and draft/uncertain-outcome protections remain the existing workflows.

Browser evidence is in [`evidence/support-batch/`](evidence/support-batch/manifest.json), captured from the committed source at widths 1440, 768 and 375 using the real local Nest API, Vite and a disposable migrated PostgreSQL database with synthetic records. The browser proxy allows GET and local-development login only; external calls and notification/expiry workers are blocked. The harness checks Escape and dirty-draft discard without submitting a mutation. Some full-page captures use an expanded viewport height, documented in the manifest; these are not zoom or screen-reader tests. No owner visual acceptance is implied. Automated checks: 82 suites / 814 tests, TypeScript and Vite build passed (the existing large-chunk warning remains).

The support assignment API does not provide an assignee directory, so the existing workforce principal ID input remains. Other console workspaces remain to be redesigned; this batch is not full-console completion.

### Full-console batch: commercial registries

Source commit `4b2f29e` aligns the fee, commission, reward, product and limit registry workspace with the directory pattern. Record details now open in the shared contextual drawer, and the details action remains visible when wide tables scroll. Read-only messaging, scope-gated keyboard tabs, per-registry search and pagination, safe limit projections and independent error states remain in place. Search is explicitly limited to the current page; these registries do not establish live transaction decisions or permit edits.

[`evidence/commercial-batch/`](evidence/commercial-batch/manifest.json) contains real-app captures of fee, product and limit views and their drawers at 1440, 768 and 375 pixels, using synthetic records in an isolated database. The capture checks drawer dismissal and focus return; browser requests permit GET and local login only, with external calls and workers blocked. Captures show the SUPER_ADMIN role; other role permissions are exercised by automated tests, not this browser capture. No zoom, screen-reader or owner visual-acceptance claim is made. Full tests: 82 suites / 815 tests; TypeScript and production build passed, with the existing Vite large-chunk warning.

### Full-console batch: audit search

Source `b8cf54f` adds a directory-aligned audit search and a contextual, read-only event drawer. The drawer exposes only the six already-validated, projected result fields (including the returned event ID); raw audit payloads remain excluded. Scope checks, exact-filter validation, late-response invalidation and the 100-result boundary remain unchanged. Capture harness correction `01be348` records separate viewport positions rather than an extremely long full-page mobile image.

[`evidence/audit-batch/`](evidence/audit-batch/manifest.json) shows searches and drawers at 1440, 768 and 375 pixels using real locally generated audit records in a disposable database. Capture is limited to SUPER_ADMIN, GET and local login; workers and external calls are blocked. No zoom, screen-reader or owner visual-acceptance claim is made. Full tests: 82 suites / 816 tests; TypeScript and build passed (existing large-chunk warning).

### Full-console batch: transaction trace and customer history

Source `05dd72d` applies directory-style category controls to the existing Transfers, Deposits and Withdrawals trace and introduces a read-only customer-history detail drawer. Category changes select the existing endpoint and clear the prior trace; lookup validation, simulation permissions and exact integer checks remain intact. History drawers show only returned fields; pagination and type filters use the existing customer-scoped service. No global list has been invented.

[`evidence/transaction-batch/`](evidence/transaction-batch/manifest.json) records the three views and customer history/drawer at 1440, 768 and 375 pixels. The real local API runs against a disposable database containing a synthetic failed transfer and synthetic customer/accounts; no journal or financial command is created. The browser proxy permits GET and local-login POST only, so the simulator was not submitted in browser checks. Automated isolated tests exercise simulation, permissions and failed responses. 82 suites / 818 tests, TypeScript and Vite build passed; the existing large-chunk warning remains. Capture uses the SUPER_ADMIN role; no zoom, screen-reader or owner visual-acceptance claim is made.

See [PROGRESS.md](PROGRESS.md) for the full navigation inventory and remaining work.

### Full-console batch: Cash-to-Cash Operations

Source `d190f6f` replaces the staged status selector with directory-style controls and moves read-only receipt and authorized journal inspection into the shared contextual drawer. Search remains explicitly applied by the Search button. Receipt data, masked phone, journal permissions, stale-read invalidation, expiry boundary and the prohibition on claim/refund/release/expiry commands remain intact.

[`evidence/c2c-batch/`](evidence/c2c-batch/manifest.json) captures the actual local app at 1440, 768 and 375 pixels, including filter application, receipt, journal inspection, Escape and focus return. The disposable database contains a synthetic agent, transfer and balanced synthetic journal; no financial API command runs. Browser proxy allows GET and local-login POST only; outbound network and workers are blocked. Full tests: 82 suites / 819 tests; TypeScript and build passed, with the existing Vite chunk warning. Browser capture uses SUPER_ADMIN; no zoom, screen-reader or owner visual-acceptance claim is made.

### Full-console batch: ledger accounts and journal workspace

Source `93b9e5c` replaces account cards with a searchable directory table and contextual account drawer. Search is local to the returned account list for the selected currency, and missing balances remain explicitly unavailable. Journal lookup and maker/checker reversal logic, draft protection, approval checks, uncertain-outcome locks and session safeguards remain unchanged.

[`evidence/ledger-batch/`](evidence/ledger-batch/manifest.json) captures the real local workspace and account drawer and journal lookup at desktop, tablet and mobile widths. It uses synthetic accounts and a balanced synthetic journal in disposable PostgreSQL; no financial command is issued. Only GET and local-login POST pass the browser proxy, and external network and workers are blocked. Full tests: 82 suites / 820 tests; TypeScript and build passed (existing Vite chunk warning). Browser capture uses SUPER_ADMIN; no zoom, screen-reader or owner visual-acceptance claim is made.

### Full-console batch: reconciliation and breaks

Source `6230993` aligns report navigation with directory filters and presents internal binding discrepancies in a searchable-by-inspection table and contextual drawer. Existing report validation, report generation, trial-balance and account-activity requests remain in place. Discrepancy details only show returned values; neither a reported internal balance nor an absent break establishes external settlement.

[`evidence/reconciliation-batch/`](evidence/reconciliation-batch/manifest.json) shows the real local report, a synthetic unbound-wallet discrepancy and drawer, trial balance and finance views at 1440, 768 and 375 pixels. The report GET uses its existing read-only database transaction; the browser proxy permits GET and local login only, with external network and workers blocked. Full tests: 82 suites / 821 tests; TypeScript and build passed (existing Vite chunk warning). Browser capture uses SUPER_ADMIN; no zoom, screen-reader or owner visual-acceptance claim is made.

### Full-console batch: compliance and fraud lookup

Source `6fd7d6d` aligns customer-scoped KYC and case workspaces with directory patterns and adds a shared read-only case drawer for compliance and fraud. Only customer-matched validated case fields appear. Existing category separation, role/function gates, KYC decision confirmation, dirty-draft and uncertain-outcome safeguards remain unchanged.

[`evidence/compliance-batch/`](evidence/compliance-batch/manifest.json) records KYC and compliance views under SUPER_ADMIN and fraud under RISK_FRAUD at 1440, 768 and 375 pixels, using one synthetic customer, KYC assessment and two cases in disposable PostgreSQL. Search and drawer focus/escape were exercised; no assessment or case mutation was sent. The proxy permits GET and local-login POST only; external network and workers are blocked. Full tests: 82 suites / 823 tests; TypeScript and build passed (existing Vite chunk warning). No zoom, screen-reader or owner visual-acceptance claim is made.

### Full-console batch: agent network

Source `3bfe962` changes the agent directory to status tabs and a sticky details action, and brings the existing selected-Agent workspace into a responsive, focus-managed drawer. Escape, backdrop and Close go through the existing draft, in-flight and uncertainty safeguards; permissions and policy-blocked agent reclassification and PIN support are unchanged. Tests also cover a rejected Escape with an unsaved outlet draft.

[`evidence/agent-network-batch/`](evidence/agent-network-batch/manifest.json) records SUPER_ADMIN directory, status filtering and detail at 1440, 768 and 375 pixels with a synthetic Agent in disposable PostgreSQL. GET and local-login POST only, no writes; network and workers blocked. Full tests: 82 suites / 825 tests; TypeScript and build passed (existing Vite chunk warning). Browser capture does not exercise onboarding, funding, credential or lifecycle writes; screen-reader and actual zoom tests were not performed.

### Agent classes: catalogue exploration (partial)

Source `ef4a610` adds local reference/code/name search and active/inactive filters over the authorized returned class catalogue, with sticky row actions. The editor remains open and retains its draft as filters change; all existing version, canonical-service, uncertainty and limit-assignment safeguards remain. The catalogue portion was browser-checked, but the governed editor still requires a substantive design pass before this workspace is considered complete.

[`evidence/agent-classes-batch/`](evidence/agent-classes-batch/manifest.json) records filtering and opening/closing the editor at 1440, 768 and 375 pixels with two synthetic classes in disposable PostgreSQL. GET and local-login POST only, no class changes; network and workers blocked. Full tests: 82 suites / 826 tests; TypeScript and build passed (existing Vite chunk warning). No screen-reader or actual zoom testing was performed.

### Full-console batch: agent class editor

Source `99de306` completes the agent-class workspace begun in `ef4a610`: the existing inline governed editor is organized into navigable class details, canonical services, policy fields and limit assignments, with operation errors shown in context. The editor deliberately remains in the page so catalogue refresh and uncertain-outcome review remain accessible. Existing validation, versioning, draft-discard and authorization controls are unchanged.

[`evidence/agent-class-editor-batch/`](evidence/agent-class-editor-batch/manifest.json) records 15 captures at 1440, 768 and 375 pixels, including section navigation and a local unsaved draft with keep/discard interactions. It uses disposable synthetic classes and GET/local-login POST only; no class mutation, external network or worker. Full tests: 82 suites / 827 tests; TypeScript and build passed before a final responsive scroll-offset-only adjustment. Screen-reader and actual zoom tests were not performed.

### Customer 360: overview and section navigation (partial)

Source `d0f0d4c` adds a read-only drawer for validated, customer-matched wallet and balance data and in-page links within personal information and address verification. Wallet permission, response validation, masked data, tab/draft guards, lifecycle controls and Tier 3 policy block remain intact. The personal-information and proof workflows still need a substantive design pass; this is not full Customer 360 completion.

[`evidence/customer360-batch/`](evidence/customer360-batch/manifest.json) contains 21 captures at 1440, 768 and 375 pixels using a synthetic customer and zero-activity wallet in disposable PostgreSQL. Navigation and wallet Escape/focus were checked with GET and local-login POST only; no lifecycle, customer, proof or financial mutations, external calls or worker. Proof upload is disabled in this isolated setup, so upload/review interactions were not browser-exercised. Full tests: 82 suites / 829 tests; TypeScript and build passed. Screen-reader and actual zoom tests were not performed.
