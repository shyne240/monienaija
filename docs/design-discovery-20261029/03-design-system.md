# Proposed design system, tokens and accessibility

**Proposal only.** “Grounded clarity” retains MonieNaija's recognizably deep green and warm gold, but trades decorative noise for trustworthy hierarchy, warm neutral surfaces and precise typography. It is a product design direction, not a new brand asset or an implemented theme. Screenshots in [evidence](evidence/README.md) are the current UI, not proposed designs.

## Principles

1. **Show truth before polish:** amount, NGN/currency, recipient or authorized identifier, server status, and next action lead. Never turn an unavailable value into zero, verified identity or a successful settlement.
2. **Calm operations, clear consequences:** one primary action per context, compact but readable tables, clear privilege and review boundaries; destructive/irreversible actions are never hidden behind a color alone.
3. **One vocabulary, two renderers:** common semantic values and interaction contracts; separate React DOM and React Native components. Preserve the existing stacks, navigators, API clients, guards and financial handlers.
4. **Accessible by default:** every interaction has a visible focus/pressed state, programmatic name, status text and non-color cue. Device validation is mandatory.
5. **Local-first performance:** system fonts, existing icon resources and lightweight SVG/text charts; no external font fetch, chart framework or new app dependency is implied.

## Semantic color tokens

Hex values are opaque sRGB. Light is the proposed first-release theme; dark is a specified but deferred theme subject to Product approval, device review and contrast validation across all states. `brand-accent` is decorative unless paired with a tested foreground; do not put small gold text on white. Existing Expo configs explicitly request light mode.

| Token / use | Light | Dark |
|---|---|---|
| `surface.canvas` | `#F5F8F6` | `#101C19` |
| `surface.raised` | `#FFFFFF` | `#182A25` |
| `text.primary` | `#132B25` | `#EAF4EE` |
| `text.secondary` | `#52655F` | `#B1C8BD` |
| `border.control` | `#6D817A` | `#839B90` |
| `action.primary` / `text.onAction` | `#0B624A` / `#FFFFFF` | `#7ED9B1` / `#0B241A` |
| `focus.ring` | `#0B624A` | `#78D7B0` |
| `brand.accent` | `#8C5600` for text; warm gold `#E9BD63` decoration | `#E9BD63` |
| `status.success` / background | `#146348` / `#E4F4EC` | `#86DFB5` / `#182A25` |
| `status.warning` / background | `#8C5600` / `#FFF3D9` | `#FFD797` / `#182A25` |
| `status.danger` / background | `#B3261E` / `#FDEBE9` | `#FFAFA6` / `#182A25` |
| `status.info` / background | `#2057A4` / `#EAF1FC` | `#BCD4FF` / `#182A25` |

### Calculated pair checks

Calculation: convert each 8-bit sRGB channel to 0–1; linearize at 0.04045 (`c/12.92` or `((c+0.055)/1.055)^2.4`); luminance `L = .2126R + .7152G + .0722B`; ratio `(L_lighter + .05)/(L_darker + .05)`. Ratios below are rounded **downstream for display**, not rounded up to determine conformance. All listed text pairs exceed **4.5:1**; control boundaries/focus marks require **3:1** against adjacent colors. Text is never white-on-gold. These calculations do not cover transparency, overlays, disabled states or every component combination.

| Foreground / background | Ratio | Intended use |
|---|---:|---|
| `#132B25` / `#FFFFFF` | 15.00:1 | Light primary text on raised surface |
| `#132B25` / `#F5F8F6` | 14.03:1 | Light primary text on canvas |
| `#52655F` / `#FFFFFF` | 6.20:1 | Secondary text on raised surface |
| `#52655F` / `#F5F8F6` | 5.80:1 | Secondary text on canvas |
| `#FFFFFF` / `#0B624A` | 7.34:1 | Primary button text |
| `#0B624A` / `#FFFFFF` | 7.34:1 | Primary action/visible focus on raised surface |
| `#0B624A` / `#F5F8F6` | 6.87:1 | Primary action/visible focus on canvas |
| `#6D817A` / `#FFFFFF` | 4.14:1 | Light control boundary on raised surface |
| `#6D817A` / `#F5F8F6` | 3.87:1 | Light control boundary on canvas |
| `#146348` / `#E4F4EC` | 6.35:1 | Light success text |
| `#8C5600` / `#FFF3D9` | 5.54:1 | Light warning text |
| `#B3261E` / `#FDEBE9` | 5.68:1 | Light danger text |
| `#2057A4` / `#EAF1FC` | 6.24:1 | Light information text |
| `#FFFFFF` / `#B3261E` | 6.54:1 | Destructive button text |
| `#EAF4EE` / `#101C19` | 15.53:1 | Dark primary text on canvas |
| `#EAF4EE` / `#182A25` | 13.37:1 | Dark primary text on raised surface |
| `#B1C8BD` / `#182A25` | 8.50:1 | Dark secondary text |
| `#839B90` / `#182A25` | 5.05:1 | Dark control boundary on raised surface |
| `#78D7B0` / `#182A25` | 8.70:1 | Dark focus on raised surface |
| `#78D7B0` / `#101C19` | 10.10:1 | Dark focus on canvas |
| `#0B241A` / `#7ED9B1` | 9.71:1 | Dark primary button text |
| `#E9BD63` / `#182A25` | 8.54:1 | Dark warm accent on surface |
| `#86DFB5` / `#182A25` | 9.48:1 | Dark success text |
| `#FFD797` / `#182A25` | 11.04:1 | Dark warning text |
| `#FFAFA6` / `#182A25` | 8.55:1 | Dark danger text |
| `#BCD4FF` / `#182A25` | 10.02:1 | Dark information text |

Current source-derived comparisons: white `#FFFFFF` on Admin logout red `#EF4444` = **3.76:1**; customer warning `#F59E0B` on `#FEF3C7` = **1.93:1**; customer success `#10B981` on `#D1FAE5` = **2.24:1**; customer error `#EF4444` on `#FEE2E2` = **3.08:1**. Normal-size text needs 4.5:1; large text needs 3:1 under WCAG 2.2 AA. See [UX04](02-screen-audit.md#prioritized-cross-cutting-findings).

## Type, spacing and shape

| Token | Proposed value / use |
|---|---|
| Typeface | Platform system UI stack (`system-ui`, `-apple-system`, sans-serif on web; native System on iOS/Android); no remote font requirement. Preserve native font scaling. |
| Display | 32/40, weight 700 for a primary balance or desktop page heading; mobile 28/36 when space is tight. |
| Heading | 24/32 for page, 20/28 for section, 16/24 semibold for card heading. |
| Body | 16/24 default mobile, 14–16/21–24 web; helper/metadata normally ≥12/18 with tested contrast; avoid tiny uppercase for important information. |
| Money & tables | Tabular numerals (`font-variant-numeric: tabular-nums` on web, `fontVariant: ['tabular-nums']` on supported native fonts); explicit sign, currency and decimal places; line-wrap full accessible value, no truncation of important digits. Format authoritative minor units without unsafe numeric rounding; no new client-side fee math. |
| Spacing | 4px base: 4, 8, 12, 16, 24, 32, 40, 48, 64; prefer 16 within controls, 24 between sections; native values are density-independent. |
| Radius | 4 for status indicator, 8 for control, 12 for card, 16 for mobile sheet; full pill only for short labels. |
| Elevation | 0 for dense tables; level 1 `0 1px 3px rgba(19,43,37,.10)` for cards; level 2 `0 8px 24px rgba(19,43,37,.16)` for dialog/drawer. In dark mode rely primarily on borders/surface shifts, not black shadows. |
| Iconography | Single consistent stroke/icon set, paired with labels; never rely on emoji glyphs to convey meaning. Status shapes differ as well as colors. |
| Motion | 120–180ms ease for small transitions; no animation is required to understand state; honor `prefers-reduced-motion` and native reduce-motion settings. |

## Responsive layout

- Web: 320–599px single column, 16px gutter; 600–1023px flexible 8-column workspace, 24px gutter; ≥1024px 12-column workspace with 32px outer gutter and a navigation rail/sidebar. Max content width ~1440px for scanning, not a clipping rule. Collapse the sidebar below the appropriate tested breakpoint; preserve all role-filtered destinations. These are proposed breakpoints, not claims about current styling.
- Narrow forms stack in logical reading order; long IDs wrap or offer a safe copy affordance. Financial review remains vertically ordered and visible. Tables remain semantic with a named, keyboard-scrollable region and persistent row/column context; allow horizontal scroll only where two-dimensional data genuinely requires it, otherwise use a labeled detail view. Never hide or truncate status, amount or decision consequence to make a card fit.
- Native: safe-area and keyboard avoidance on both platforms; one-column forms; anchored primary action only if it does not cover content; support smallest target phones, tablets, rotation where permitted and user text scaling. Both current apps request portrait; changing orientation requires an explicit product/platform decision rather than silently overriding configuration.
- Test at 320, 360, 390, 768, 1024, 1280 and 1440 CSS px, and web at 200%/400% zoom. Test native with smallest supported physical devices, large text and screen readers. Proposed behavior is not current conformance.

## Component contract and state coverage

| Component | Required variants and states | Behavior and accessibility |
|---|---|---|
| Button/link | Primary, secondary, quiet, destructive; default, hover (web), focus, pressed, disabled, loading and error recovery | Semantic button/link; 44×44 CSS px/pt target preferred (48dp Android), 24×24 CSS px minimum where WCAG 2.5.8 applies with its exceptions; explicit name/state; loading keeps a stable label/announcement and prevents duplicate submit without changing idempotency. Disabled is not the only explanation. |
| Text, amount, phone, PIN, OTP, select | Default, filled, focus, invalid, disabled, read-only, submitting | Persistent associated labels; input mode/autofill appropriate to field; helper/error linked and announced; preserve exact decimal/identifier, leading zeros and platform password manager/paste support. Secret fields remain masked/ephemeral per existing policy. |
| Search/filter | Idle, filtering, active filter, clearing, loading, no results, error | Submit/clear named; preserve filters on return; distinguish no matches from data fetch failure. |
| Status badge / banner | Success, pending, unknown, failure, reversed, expired, restricted, information | Text + icon/shape + tested colors; status vocabulary server-mapped and explicit; never conflate pending, replay, expired, failed, verified or handover. Status announcements must not expose secrets. |
| Card/KPI/balance | Default, loading skeleton, data, partial, stale, empty, unavailable | Independent state per data source, source/currency/time when supplied, never substitute 0 for unknown; accessible reading order and no sensitive info in animation. |
| Tables/list/transaction row | Default, sorted/filtered, loading, empty, partial, error, pagination/selection | Proper headers, sort state and row context; numeric alignment/tabular digits; responsive scroll with label and focus; retain safe references and full status. Do not invent details/links. |
| Chart | Loaded, zero, no data, loading, error | Labels, period, units, legend, definition and data table/text equivalent; distinct patterns; keyboard access to any interactive values; never infer profit from fee revenue. Existing SVG can be adapted. |
| Dialog/drawer/sheet | Opening, open, focused, validation error, in-flight, resolved, cancelled | Clear title, affected entity, explicit consequence and reversible cancel. For modal overlays: focus enters, stays within, closes via supported controls/Escape where appropriate, returns to trigger; prevent background interaction and scrolling. Never dismiss an in-flight financial action as if cancelled. |
| Navigation / tabs / stepper | Default, selected, expanded, collapsed, restricted, focus | One current item with `aria-current`; disclosure `aria-expanded`; use appropriate tab semantics and keyboard pattern; show actual step/progress, preserve back/cancel semantics, capability gates and contextual return. |
| Skeleton / feedback | Loading, empty, retryable error, partial, success, definitive rejection, **outcome unknown**, replay | Skeleton has stable shape and accessible loading text; reduced motion; success only after authoritative response; unknown is not failure and retains existing recovery rules. |
| Toast / inline message | Information, success, warning, error | Non-color cue; announced politely or assertively according to urgency; persistent for consequential failures; no PIN, OTP, password or secret transfer code in message/log/analytics. |

## WCAG 2.2 AA and native acceptance target

- **Perceivable:** 4.5:1 normal text, 3:1 large text and non-text controls/meaningful graphics; do not rely on color alone. Text may resize to 200% without lost content; reflow at a 320 CSS px equivalent (with the WCAG exception for genuinely two-dimensional content). Provide accessible alternatives for charts and non-text content.
- **Operable:** keyboard-only access to every web control, visible focus and focus not obscured (2.4.7 / 2.4.11), no keyboard trap; use 24×24 CSS px minimum target size per 2.5.8 and design for 44×44 or greater where feasible. A modal drawer has controlled focus and a non-obscured close path. Native controls must be reachable via VoiceOver/TalkBack and switch access.
- **Understandable:** associated labels/instructions and errors; useful error summaries/focus on submit; programmatically announced dynamic changes; consistent navigation and help. Support accessible authentication (3.3.8), password managers and paste without weakening current MFA/PIN requirements. Do not introduce cognitive puzzles or secret disclosure.
- **Robust:** semantic HTML, native accessibility roles/names/state, correct heading order, live regions and meaningful reading order. Device-test with VoiceOver (iOS) and TalkBack (Android), keyboard, web NVDA/VoiceOver, zoom, large text, reduced motion and screen rotation where supported. Automated checks are necessary, not sufficient.
- Acceptance requires **no unresolved critical/high accessibility defects** in scoped journeys, with explicitly approved exceptions and documented owner/date; formal AA conformance requires full evaluation, not merely token contrast.

## Low-disruption architecture and governance

Today Admin mixes inline style objects, dashboard-specific tokens and `customer-management.css`; both native apps duplicate theme and primitives. The proposed future architecture is: one versioned, platform-neutral **semantic token source** (values, modes, naming/contrast tests); a small web adapter (`CSS custom properties` + typed React primitives) and a native adapter (typed RN styles/primitives); product-specific composed components retain their existing API, state and permission ownership. Share values and accessibility/state contracts, **not DOM components in React Native**. Reuse current stacks and libraries; introduce no dependency merely for appearance. A new package/workspace, manifest change or font asset requires a separate approved implementation proposal.

Pilot on Admin shell + Customer Directory before migration. Maintain a token ownership/change log, screenshot and contract test matrix, deprecation map for old styles and explicit exemptions for specialized security flows. Migrate incrementally without a big-bang rewrite. Security- or finance-sensitive handlers, direct OTP flows, provider governance, backend contracts and database behavior are outside the visual adapter and require their existing owners' review. The mobile apps wait until backend/Admin completion, per the standing sequencing constraint.
