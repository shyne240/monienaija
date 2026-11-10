# MonieNaija One — Approved Visual Reference and Phase 1 Implementation Brief

## Status
The three accompanying mockups have been approved by the product owner as the **starting visual direction**. They are visual targets, not pixel-perfect specifications or evidence of existing functionality. All displayed amounts, records, dates, and statuses are illustrative and must not be seeded as production data.

## Files
- `01-login.png`: split-screen sign-in, deep forest-green identity panel, restrained gold details, clear white form panel.
- `02-dashboard.png`: modern operations dashboard, top global search, narrow icon rail, contextual navigation, KPI cards, transaction analytics, action queue, activity and transactions.
- `03-customer-directory.png`: customer workspace, search and filtering, status tabs, modern data grid, side customer detail drawer and contextual actions.

## Implementation sequence — stop after Phase 1 for approval
1. Create a separate, reversible frontend-only design branch from the user's current authorized codebase. Do not merge, deploy, or change backend/business logic.
2. Inventory existing login, dashboard, customer directory routes and the current design system. Reuse actual role/permission gates and existing APIs. Do not invent operational metrics or customer records.
3. Implement the shared application shell: slim primary icon rail, contextual secondary navigation (collapsible), top command/search area, responsive workspace. Avoid independently scrolling nested navigation regions.
4. Implement login, dashboard and customer directory to visually match the attached references. Build reusable typography, spacing, colour, table, input, button, badge, drawer and card components. Adapt responsive/mobile layouts intentionally.
5. Ensure existing working workflows remain working. Filters, search, sorting, tabs, pagination and actions must use existing authorized behavior or be explicitly labeled not yet connected; do not create fake success states.
6. Capture actual Chromium screenshots at 1440px and 375px for all three screens, and compare side-by-side with approved mockups. Include visible differences and limitations, not just passing tests.
7. Stop and request owner visual approval before extending to other screens.

## Non-negotiable constraints
- This is a structural visual redesign, not a CSS recolour of the old console.
- Preserve existing backend, database, permissions, audit logs, financial controls and functionality.
- Do not modify production data or credentials; do not reset the user's local DB or `.env`.
- No PR, merge, deploy, real SMS, or deployed workers without explicit permission.
- Never present mock data as real; the design images contain illustrative data.
- Do not use the internal labels M1/M2 as a substitute for these visual references.
- Avoid claiming completion solely from test results or screenshot counts.

## Phase 1 acceptance
- Three screens visibly reflect the approved references and are substantially different from the old console.
- Navigation is legible, accessible, responsive and free of hidden nested scroll traps.
- Real APIs, role gates, security behavior and core user actions remain intact.
- Actual browser screenshots are provided for visual comparison.
- The owner explicitly approves the rendered implementation before any rollout.
