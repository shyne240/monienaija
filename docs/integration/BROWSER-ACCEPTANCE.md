# Browser acceptance

Group 33. Scope: the Admin console driven in a real browser engine — DOM, layout, storage, network — and the
exact boundary of what that does and does not certify.

## The position changed, and the record should say so

Every previous checkpoint in this mission recorded browser acceptance as **impossible here**: `npx playwright
install chromium` fails with `Download failure, code=1` because egress is restricted to package registries, and the
system libraries a Chromium needs (`libnss3`, `libnspr4`) are absent and not installable.

Both statements are still true. Neither is the end of the story. A Chromium binary **is** obtainable from a
package registry, and it brings the NSS libraries with it:

```bash
# 67 MB, from registry.npmjs.org — the one thing egress does allow
npm i --no-save @sparticuz/chromium

# the package ships the browser brotli-compressed, plus an Amazon-Linux library bundle
node -e "require('@sparticuz/chromium').inflate('node_modules/@sparticuz/chromium/bin/al2023.tar.br')"
# -> /tmp/al2023/lib/libnspr4.so, libnss3.so, ...  (exactly the libraries apt could not provide)

node scripts/admin-web-browser-acceptance.cjs \
  --dist /tmp/g33-dist --executable /tmp/chromium --lib-path /tmp/al2023/lib
```

```
HeadlessChrome/153.0.8010.0  —  Blink  —  27/27 checks
```

This is a genuine browser: V8, Blink, a real layout engine, a real network stack, real `localStorage`. It is **not**
a desktop Chrome installed by a user, and the disclaimers below are unchanged in spirit — but "no browser exists
here" is no longer accurate, and an acceptance record that kept saying it would be wrong.

## The defect the run found

`LOGIN-RETRY-PRESERVES-EMAIL` failed on the first run: after a rejected sign-in the email field was **empty**.

The cause was in `App.tsx`, not the login form:

```tsx
if (isLoading) return <div>Initializing MonieNaija Admin Core...</div>;
```

`isLoading` is true for the duration of **every** sign-in attempt, not only at boot. So the whole `LoginScreen`
unmounted mid-request, its `useState` was discarded, and it remounted blank. An operator who mistyped a password
lost their email address too, and watched the form they were typing into be replaced by a boot spinner.

Nothing in the unit suite caught it — jsdom tests mount the component and never observe it being replaced — and
nothing in code review catches it, because each file is correct on its own. This is the class of defect that only
a browser run finds.

**Fixed** by gating the initialising screen on the first paint only (`isLoading && !booted`), with a regression
test in `apps/admin-web/__tests__/app.test.tsx` ("keeps the login form mounted during a sign-in attempt so a
rejection does not discard the email"). Mutation-verified: reverting the fix makes the browser run fail
`LOGIN-RETRY-PRESERVES-EMAIL` with `email field after a rejected sign-in = ""`, and the run then aborts at the
authenticated-shell step because the login cannot proceed.

## What was run

`scripts/admin-web-browser-acceptance.cjs` serves the **production Vite bundle** (built with
`ADMIN_WEB_API_BASE_URL=/api/v1`, `__ADMIN_DEV_AUTH_MOCK__` false) from a static server and drives it with
Playwright. 27 checks, all passing:

| Area             | Check                                         | What it proves                                                            |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| boot             | `BOOT-RENDERS-LOGIN`                          | the shipped bundle boots to a usable login form                            |
| boot             | `BOOT-NO-PAGE-ERROR`                          | zero uncaught exceptions on load                                          |
| boot             | `BOOT-NO-PROTECTED-CHROME`                    | no sidebar exists before authentication                                   |
| a11y             | `KEYBOARD-FIRST-TAB-LANDS-IN-DOCUMENT`        | Tab from load lands on a real control, not `<body>`                       |
| a11y             | `A11Y-FORM-LABELS`                            | both inputs are reachable by their visible labels                          |
| a11y             | `A11Y-DOCUMENT-LANG`                          | `html[lang]` is set                                                       |
| a11y             | `A11Y-SKIP-LINK-FIRST-IN-AUTHENTICATED-SHELL` | the skip link is genuinely first in tab order in the shell                 |
| a11y             | `PASSWORD-MASKED-BY-DEFAULT`                  | the password field ships as `type=password`                                |
| login            | `LOGIN-FAILURE-SHOWS-ALERT`                   | a 401 renders `role="alert"` and stays on the form                         |
| login            | `LOGIN-FAILURE-SETS-NO-TOKEN`                 | a rejected sign-in writes no token                                         |
| login            | `LOGIN-RETRY-PRESERVES-EMAIL`                 | **the defect above, now pinned**                                          |
| login            | `LOGIN-FORM-STAYS-MOUNTED-IN-FLIGHT`          | the form is not replaced by the boot spinner while a request is outstanding |
| login            | `LOGIN-IS-ONE-POST`                           | one attempt is one request                                                 |
| login            | `LOGIN-BODY-CARRIES-CREDENTIALS-ONLY`         | the body is `{email, password}` and nothing else                           |
| session          | `SESSION-PERSISTED-IN-LOCALSTORAGE`           | token, session id and principal are stored                                 |
| session          | `PASSWORD-NEVER-PERSISTED`                    | the password appears in no storage key                                     |
| session          | `SESSION-RESTORED-AFTER-RELOAD`               | a full reload restores the authenticated shell                             |
| session          | `EXPIRED-SESSION-RETURNS-TO-LOGIN`            | a 401 on a later call clears the token and returns to login                |
| authorization    | `AUTHENTICATED-NAV-RENDERS`                   | 24 nav items for a scoped principal; a section expands to reveal them      |
| authorization    | `ROLE-DIFFERENTIAL-NAV`                       | 24 items scoped, **1** for a principal with no scopes, privileged item absent |
| authorization    | `ROLE-DIFFERENTIAL-NO-PAGE-ERROR`             | the reduced shell raises nothing                                           |
| rendering        | `RENDER-PRODUCED-AUTHENTICATED-LAYOUT`        | real text, a sidebar with real pixel dimensions, painted backgrounds       |
| rendering        | `DASHBOARD-ACCEPTS-A-WELL-FORMED-RESPONSE`    | a valid `my-dashboard` payload renders and the error state does not        |
| rendering        | `SCREENSHOTS-CAPTURED`                        | three screenshots written at 1440×900                                      |
| network          | `NETWORK-SAME-ORIGIN-ONLY`                    | every request is relative to the console origin — no third party           |
| bundle           | `BUNDLE-HAS-NO-LOOPBACK-HOST`                 | 1.9 MB of served JS/CSS contains zero `localhost`/`127.0.0.1`              |
| hygiene          | `CONSOLE-NO-UNEXPECTED-ERRORS`                | 2 console errors, both the deliberate 401s; **0 unexpected**               |

Evidence: `docs/integration/evidence/browser-acceptance/` — `browser-acceptance.json` plus three screenshots
(login, authenticated shell, minimal-role shell). Pinned by `test/browser-acceptance-evidence.spec.ts` (11 cases),
which fails if any check regresses to `ok: false`, if the report stops saying the API was stubbed, if a disclaimer
is dropped, or if the client fix is reverted.

## The API was stubbed, and why that is the honest choice

The backend **refuses to start** while eight financial dependencies are unverified (Group 31:
`Production readiness failed: financial_dependencies_not_ready`). Two options existed:

1. add a flag that lets it boot for acceptance — which would be a flag that lets it boot in production;
2. intercept `/api/v1/**` in the browser and answer with fixtures.

Option 2 was taken. Every assertion above is about the **client**; none of them is evidence about the server, and
the report says so in `api.origin`. The dashboard fixture is deliberately minimal: this screen keys its slots by
widget name, so asserting five widget payloads would test my fixtures rather than the browser. Widget shapes stay
with the unit suite that owns them.

## Screenshots

| File                                    | What it shows                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `admin-login-1440x900.png`              | split layout, product panel, labelled email/password, password masked          |
| `admin-authenticated-1440x900.png`      | icon rail, grouped navigation, "Welcome back, super admin", action queue        |
| `admin-minimal-role-1440x900.png`       | the same shell for a principal with no scopes — one nav item, no privileged view |

## What this does NOT certify

- **Not the server.** Every API response was a stub. No endpoint was called, no database was read.
- **Not cross-browser.** Blink only. No WebKit, no Gecko — Safari and Firefox are unverified.
- **Not a handset.** A 1440×900 desktop viewport, device pixel ratio 1, no touch, no soft keyboard. The mobile
  apps are Group 32 and remain unbuilt and unsigned.
- **Not assistive technology.** Labels, roles and focus order were asserted through the accessibility tree. No
  screen reader announced anything, and no real keyboard-only user session was conducted.
- **Not a visual baseline.** The screenshots are evidence that pixels were produced, not a compared regression
  baseline; nothing would fail if a colour changed.
- **Not load, concurrency or performance.** One browser, one page, sequential requests.
- **Not a deployment.** The bundle was served by a local static server, not by nginx or a container.

## Honest summary

The Admin console **renders and behaves correctly in a real browser**: it boots, it authenticates, it keeps and
restores a session, it expires one, it scopes its navigation to the principal, it is keyboard-reachable, it leaks
neither the password nor a loopback host, and it talks to nobody but its own origin. In the process the run found
and fixed a real client defect that no unit test could see.

It is still not a browser acceptance of the **system**, because the system's own API refuses to start. That gap is
Group 34's subject, and no browser run can close it.
