# Targeted verification, evidence and unknowns

**Scope:** M0 checks at `cf60b9d8001c605f4d986a222c07ed10e7adee30`, 29 October 2026. The [discovery evidence](../evidence/README.md) remains the record of the earlier broader checks; only targeted additions and clarifications are listed here. No account, provider, real customer, real credential, backend operation or transaction was used.

**Evidence levels:** **S** = source inspection; **C** = local command; **M** = synthetic or mocked test; **D** = real device/assistive-technology observation. There was **no D-level observation** in this environment. `adb`, Android emulator, QEMU, a system browser and Orca were unavailable. A bundled headless Chromium was used for the web probe; it is not an Android or iOS emulator and an accessibility-tree dump is not a screen-reader session.

## Customer Profile, transaction PIN and Support

| Finding | Evidence and qualification |
|---|---|
| Profile and TransactionPin are registered | **S:** both authenticated screens are in [AppNavigator](../../../apps/customer-mobile/src/navigation/AppNavigator.tsx#L70-L107). The source search found no ordinary `navigate('Profile')` caller or configured `NavigationContainer` linking; this is evidence of a likely unreachable normal path, not proof about a production build or every possible entry mechanism. |
| PIN entry is inside Profile | **S/M:** [Profile](../../../apps/customer-mobile/src/screens/authenticated/ProfileScreen.tsx#L281-L286) navigates to `TransactionPin`. Rendering Profile **directly**, with mocked navigation and data, exposes the button and calls that route. This does not prove Profile is reachable. |
| Home with a wallet | **M:** a mocked wallet shows direct **Support** and **See All**; pressing Support calls `navigate('Support')`. The test did not find Profile or Transaction PIN controls on Home. |
| Home without a wallet | **S/M:** [Home](../../../apps/customer-mobile/src/screens/authenticated/HomeScreen.tsx#L112-L157) places direct Support inside the `primaryWallet` branch, but **See All** remains outside it. With a successful empty-wallet response, tests found no Support button, with or without a recent synthetic transaction; See All calls `navigate('Transactions')`. A Home transaction row itself has no help callback. |
| Conditional history alternative | **S/M:** with a synthetic item in [Transactions](../../../apps/customer-mobile/src/screens/authenticated/TransactionsScreen.tsx#L90-L118), **Get help** calls `CreateSupportTicket` with transaction context; this is not the Support ticket-list screen. Fresh empty history has no Get help action. Therefore “no-wallet Support is impossible in every case” is **not established**. |
| Error is not the same as empty | **S/M:** on a fresh Home, a mocked wallet failure displayed its error alongside **No Wallet Found** and no direct Support. On a fresh failed Transactions request, the error and **No transaction records found** were both rendered, without a contextual help action. Home separately maps a history request failure to an empty list in source. Retained data after a later refresh is a different state and was not exhaustively tested. |

The isolated [component probe](evidence/customer-component-probe.md) passed **8/8** tests in one Jest suite. `@testing-library/react-native`/React test renderer rendered the screens separately, with mocked API, store and navigator. It did not mount a real native navigator, use real services, exercise actual device gestures, or check VoiceOver/TalkBack. Jest ran with `--silent`, so this result does not establish a warning-free native test run. The previous full Customer suite passed independently but emitted `act(...)` warnings.

**Still needed:** on supported iOS and Android builds, test first sign-in, screen-reader and keyboard/switch navigation, Profile and PIN discoverability, no-wallet Home, history containing an item, history empty and history unavailable. Use a non-production, consented test account and agreed safe fixtures. Record OS/app versions and any alternate entry point. Confirm the intended behavior with Customer Product and Security before changing navigation or PIN rules.

## Admin transfers: measured overflow

**M:** Headless Chromium 141, synthetic workforce principal and intercepted API responses; no backend or external request was used. The main region was measured immediately after opening the existing transfer view, before horizontal scrolling. `Track` and `Run Simulation` visibility below means the whole button lies within the visible main-region bounds, not that a financial action was performed.

| Viewport width (CSS px) | Main client width | Main scroll width | Track initially visible? | Run Simulation initially visible? |
|---:|---:|---:|:---:|:---:|
| 320 | 320 | 1,038 | No | No |
| 360 | 360 | 1,038 | No | No |
| 390 | 390 | 1,038 | No | No |
| 768 | 768 | 1,038 | Yes | No; 1px beyond the visible edge |
| 769 | 441 | 1,038 | No | No |
| 1,024 | 696 | 1,038 | Yes | No |
| 1,440 | 1,112 | 1,112 | Yes | Yes |

At 390px, `overflow-x` computed to `auto`; Track initially occupied x=472–543. Setting the main region's horizontal scroll offset to 452px brought it into view. Thus this is a **measured reflow/initial-visibility problem**, not proof that the controls can never be reached. The 768→769 discontinuity reflects the existing shell breakpoint and sidebar width in this build. The synthetic test did not submit either form or establish touch, keyboard-scroll, real-data or production behavior. Script and raw measurements: [Admin probe](evidence/admin-browser-probe.md); earlier current-state [narrow screenshot](../evidence/admin-transfers-mobile.png).

**Still needed:** reproduce with real browsers and supported touch/keyboard input, 200%/400% zoom, long values, error states and authorized non-production data. Correcting the transfer screen is **outside M1**; the shell pilot must not worsen its reachability and a later approved financial/Admin milestone must own its reflow and labels.

## Admin drawer: keyboard and accessibility tree

**M:** at 390×844 with a deliberately synthetic all-scope principal, the local Chromium probe found:

- Before and after Enter opened the drawer, the toggle's accessible role/name were `button` / `Open navigation menu`; no `aria-expanded` property was exposed, and its name did not change. The drawer contained a navigation landmark named `Mobile navigation`.
- The main region was not `inert`. With the drawer open, 37 Tab presses reached a button inside main content behind it. Escape left the drawer open.
- Focusing a synthetic Customer navigation item and activating it with Enter closed the drawer; focus then landed on `BODY`, not the destination main region. This is one scripted path, not a complete focus audit.

The exact accessibility tree and keyboard checks are in the [probe](evidence/admin-browser-probe.md). **No NVDA, JAWS, VoiceOver, TalkBack or other screen reader was run**, and these observations do not certify or exhaustively evaluate WCAG. The earlier [axe sample](../evidence/README.md#automated-accessibility-sample) is also limited to synthetic states.

**Still needed:** keyboard-only and actual NVDA + a supported Windows browser, and VoiceOver + Safari where available; check programmatic name/state, opening, focus entry/containment for a modal, Escape, close, destination focus, scroll, zoom and reduced motion. Record user agent, assistive-technology versions and results. These checks are required for acceptance of an implemented M1 shell, not claimed as completed here.

## Customer TypeScript check

**C:** from `apps/customer-mobile`, `npm run ts:check` exits nonzero with:

```text
src/screens/authenticated/FundWalletScreen.tsx(15,69): error TS2344: Type '"FundWallet"' does not satisfy the constraint 'keyof RootStackParamList'.
src/screens/authenticated/WithdrawScreen.tsx(15,69): error TS2344: Type '"Withdraw"' does not satisfy the constraint 'keyof RootStackParamList'.
```

The two files are not registered in [AppNavigator](../../../apps/customer-mobile/src/navigation/AppNavigator.tsx), and their keys are absent from [RootStackParamList](../../../apps/customer-mobile/src/navigation/types.ts). This is a reproducible typecheck result, not evidence that those self-service financial features should be enabled. Leave both unchanged pending the Mobile owner’s approved resolution; no route activation merely to make the check pass. Existing tests passing does not contradict a typecheck failure. Install/toolchain qualifications are in the [discovery evidence](../evidence/README.md#verification-performed-during-discovery).

## Environment and result boundaries

- Repo branch was clean before M0, and a fresh fetch showed `HEAD` and its remote at `cf60b9d8001c605f4d986a222c07ed10e7adee30`, with no divergence. Its `apps` tree `77099e5a06167041ba3e178cf73157599093f537` equals that of `d212c667c431b05b7b1771c27212e9dc7f360d17`.
- Node `v22.22.3`, npm `10.9.8`, Jest `29.7.0`; Admin browser probe used `puppeteer-core` `24.25.0` and `@sparticuz/chromium` `141.0.0` installed outside the repository. Vite used a dummy proxy target and was stopped after capture.
- Source observations about Wallet→Cash handover and Cash→Cash secret copy are linked in [D2/D3](02-owner-decisions.md). Neither physical handover nor the claim credential lifecycle was tested end to end.
- No change was made to application files, dependencies, APIs, schema, authentication, financial logic, provider configuration or security. These results are not a release, provider or production-readiness assessment.
