# MonieNaija One Phase 1 — review evidence

**Owner visual approval is pending.** [Side-by-side visual comparison](visual-comparison.html). The exact reference files from the supplied package are in `reference/` (Drive ZIP MD5 `3210a348349c72d735c0349c2da466bf`). They contain illustrative data, not actual records.

The original implementation is commit `f8423fb0fb32a94ce5c8b323c5d9f799ecea3fef`; the targeted mobile table fix is `9c9a605499b08c4627428f13cb9347c2125d5cb7`, which is the source used for the latest captures. Screenshots are added in a subsequent evidence commit. The branch is `arena/44f00580-monienaija` (the session fixes the branch name; a separate branch could not be created). Revert the implementation and evidence commits to reverse this work.

## Captures

Headless Chromium, Vite UI, actual Nest AppModule and a fresh, **disposable migrated PostgreSQL** database; a local workforce seed and one explicitly synthetic customer were inserted only in that disposable database. No backend responses were mocked. The browser proxy allowed GET and the local login POST only; other browser mutations were blocked. Outbound Node networking was guarded, notification and cash-to-cash expiry workers were disabled. Servers bound to loopback and were stopped after capture. No preview, production service, user database, `.env`, deployed worker or real SMS was touched.

| Screen | Desktop 1440px | Mobile 375px |
|---|---|---|
| Sign-in | [login](evidence/login-1440.png) | [login](evidence/login-375.png) |
| Dashboard | [dashboard](evidence/dashboard-1440.png) | [dashboard](evidence/dashboard-375.png) |
| Directory | [directory](evidence/customers-1440.png), [preview](evidence/customer-preview-1440.png), [Customer 360](evidence/customer-360-1440.png) | [directory](evidence/customers-375.png), [preview](evidence/customer-preview-375.png), [Customer 360](evidence/customer-360-375.png) |

Most images are full-page Chromium captures using a 900px-high viewport. Chromium full-page capture omitted the off-screen scrollable table after the preview was opened, even when it was visible in an actual scrolled viewport. For the two complete 375px-wide directory images, the viewport height was temporarily expanded to fit the page so Chromium painted the entire table; the manifest records the actual height. They are not mobile-device or zoom simulations. Separate 375 × 900 viewport captures show the preview-open table [before horizontal scrolling](evidence/customer-preview-table-375.png) and [after scrolling to the action](evidence/customer-preview-table-scrolled-375.png). The narrow table no longer pins its first column, so it scrolls out of view rather than covering the action; the harness verified the action fits and opened Customer 360. Live testing on physical devices remains necessary. The manifest records the two tested document widths with no page-level horizontal overflow and no API 500 warnings; that is not a guarantee for every widget or role. Time shown is the test environment's clock, not production activity.

## Side-by-side images

These show the entire approved reference at left and the top 900 pixels of the 1440px capture at right. Both are scaled for comparison; full screenshots are linked above.

- [Login comparison](evidence/comparisons/login-side-by-side.png)
- [Dashboard comparison](evidence/comparisons/dashboard-side-by-side.png)
- [Customer directory comparison](evidence/comparisons/directory-side-by-side.png)

## Evidence and limitations

- Browser harness successfully signed in as a seeded local SUPER_ADMIN at both widths, navigated to the dashboard and directory, opened a synthetic customer's preview and entered the existing Customer 360 workspace (on mobile via the horizontally scrolled row action). This does not establish production authentication, other roles, writes, registration, or all customer actions. No browser mutations beyond local sign-in were allowed.
- Admin Web TypeScript check and production Vite build passed; the build reported a large-chunk warning. All **80 suites / 804 tests** passed. Additional tests cover quick filters using the existing customer endpoint, preview-to-360 navigation, permission-limited workspace search and no write in these interactions. Existing tests cover authentication and role/route guards; tests are not proof of visual acceptance or real environment operation.
- Top search is explicitly scoped to visible workspaces, not cross-entity/global search. The dashboard uses only resolved authorized widget data, including real transaction summary/trend, reconciliation and audit data where authorized. It does **not** implement the reference's unified action queue, invented aggregate health score, customer/agent KPIs or mock activity; widget availability and order vary by role. The four new transaction cards make an additional authorized summary request. Pending and completed counts are not equivalent to the reference's illustrative KPIs.
- Customer status buttons use existing directory query filters. The preview exposes only returned authorized fields and preserves the existing Customer 360 actions; sorting, mock drawer tabs, bulk actions, import/export and saved views shown in the reference are not implemented. Pagination retains the existing API behavior. The desktop detail area is inline and the mobile preview stacks above the directory rather than acting as a modal drawer.
- The login intentionally does not add invented password reset, remember-me, or production authentication policy. Decorative details and geometry differ from the reference. Existing real authentication flows and guards remain in place; production A00 sign-in policy remains blocked.
- Existing screen-reader testing and real browser zoom testing were **not** performed. Mobile width is not a substitute for zoom or screen-reader testing. No user/owner visual acceptance is asserted.

Stop here for owner visual approval before expanding the scope. No PR, merge, deployment, real SMS or deployed workers were initiated.
