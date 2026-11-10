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
