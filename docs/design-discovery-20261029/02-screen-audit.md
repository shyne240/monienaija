# Per-screen UX audit

The inventory links every ID to its implementation, access condition, controls and visible/conditional states. This table evaluates **every registered view/route plus the substantial embedded and unregistered surfaces** (85 rows). Duplicate route aliases have duplicate assessment rows, not duplicate implementation counts. “Current” means baseline, not a proposal.

## Method and scale

Each vector contains exactly 12 scores, in this fixed order:

1. **H** hierarchy; 2. **T** typography/spacing; 3. **L** layout; 4. **N** navigation/IA; 5. **C** color/contrast; 6. **K** component consistency; 7. **F** forms/validation; 8. **R** responsive behavior; 9. **A** accessibility/keyboard; 10. **S** loading/empty/error/success/unknown states; 11. **$** financial trust/security communication; 12. **P** refinement. `–` means not applicable (not zero).

**1–2** blocked or serious mismatch; **3–4** material gaps; **5–6** mixed/functional foundation; **7–8** comparatively strong with gaps; **9–10** requires validated, exceptional experience (not awarded here). This is a **single-reviewer, provisional, ordinal expert judgment**, not measured usability, compliance certification, implementation completion, or statistically meaningful scoring; source-only layout, contrast and accessibility estimates are especially uncertain (roughly ±2 points). No averages are calculated because screens and applicability differ. A high score does not mean security is approved. Color scores reflect relevant source tokens and calculated examples, not an exhaustive contrast sweep.

**Evidence:** `V` = rendered local Admin Web, synthetic principal, every API call intercepted; only A00, A01, A03 and A08 were visually sampled. `I` = code inference, including all native screens and all unobserved states. Even a `V` row has source-inferred dimensions; no real backend, native simulator, VoiceOver/TalkBack, production data, provider, financial action or user study was exercised. See [evidence and validation](evidence/README.md).

**Priority, separate from score:** **C** = likely core task blocked or immediate material safety conflict; **H** = substantial task, trust, accessibility or security risk; **M** = significant friction/consistency debt; **L** = localized polish. Priorities are triage hypotheses until reproduced and accepted by the owning teams; not a vulnerability classification.

Vectors: `H/T/L/N/C/K/F/R/A/S/$/P`. Each entry has a screen-specific action; cross-cutting finding IDs and evidence follow the matrix.

## Admin Web

| ID / view | Evidence | Priority | Scores | Screen-specific action |
|---|---|---|---|---|
| [A00](01-inventory.md#A00) `Login` | V + I | M | `7/7/7/6/7/5/6/7/6/6/6/6` | Retain associated labels, autocomplete and build-only advanced controls; improve error/focus handling. |
| [A01](01-inventory.md#A01) `dashboard` | V + I | M | `6/6/5/5/5/4/–/4/4/6/6/5` | De-emphasize the long raw-scope block; retain permitted, server-resolved widgets and definitions. |
| [A02](01-inventory.md#A02) `dashboardSettings` | I | M | `5/5/5/5/5/4/5/3/4/6/6/4` | Group template preview and assignment result; preserve role checks. |
| [A03](01-inventory.md#A03) `customers` | V + I | H | `7/7/7/6/5/6/6/7/4/7/6/7` | Extend the servicing structure while correcting sampled contrast and table keyboard access. |
| [A04](01-inventory.md#A04) `agents` | I | H | `5/5/4/4/5/4/5/3/5/6/6/4` | Separate long agent workspace into a stable detail hierarchy without hiding guarded operations. |
| [A05](01-inventory.md#A05) `agentClasses` | I | M | `6/5/5/5/5/4/5/4/5/6/6/5` | Replace technical JSON editor presentation with clearer field guidance only where the same contract permits. |
| [A06](01-inventory.md#A06) `cashToCashOps` | I | H | `6/5/5/5/5/4/5/4/5/6/7/5` | Maintain expiry and claim distinctions; clarify that ledger settlement does not prove physical handover. |
| [A07](01-inventory.md#A07) `support` | I | M | `5/5/5/5/5/4/5/3/5/6/6/5` | Make list-to-detail, context and partial-message failures easier to scan. |
| [A08](01-inventory.md#A08) `transfers` | V + I | H | `5/5/4/4/5/4/4/2/3/6/6/4` | Reflow trace/simulator at 320–390px and associate each label; do not invent a global-search API. |
| [A09](01-inventory.md#A09) `cashIn` | I | H | `5/5/4/4/5/4/4/2/3/6/6/4` | Retain category/initial state while fixing the shared narrow-screen and form defects. |
| [A10](01-inventory.md#A10) `cashOut` | I | H | `5/5/4/4/5/4/4/2/3/6/6/4` | Retain category/initial state while fixing the shared narrow-screen and form defects. |
| [A11](01-inventory.md#A11) `ledgerExplorer` | I | H | `5/5/5/5/5/4/5/4/4/6/6/5` | Separate read-only journal inspection from any existing guarded reversal action and expose exact outcome. |
| [A12](01-inventory.md#A12) `reconciliation` | I | M | `5/5/5/5/5/4/5/5/5/6/6/5` | Improve density and responsive table handling; no invented break-resolution workflow. |
| [A13](01-inventory.md#A13) `feeRules` | I | M | `5/5/5/5/5/4/–/4/5/6/6/5` | Explain minor units/BPS and retain read-only, per-tab function guard. |
| [A14](01-inventory.md#A14) `commissionRules` | I | M | `5/5/5/5/5/4/–/4/5/6/6/5` | Expose model, basis and status clearly; do not invent commission policy. |
| [A15](01-inventory.md#A15) `rewardRules` | I | M | `5/5/5/5/5/4/–/4/5/6/6/5` | Distinguish registry records from actual reward crediting. |
| [A16](01-inventory.md#A16) `productCatalogue` | I | M | `5/5/5/5/5/4/–/4/5/6/6/5` | Preserve catalogue visibility and configuration status; coordinate with Arena 3. |
| [A17](01-inventory.md#A17) `limitCatalogue` | I | M | `5/5/5/5/5/4/–/4/5/6/6/5` | Keep profile/rule semantics, units and both tables legible. |
| [A18](01-inventory.md#A18) `limitAssignments` | I | H | `5/5/5/5/5/4/5/4/5/6/6/5` | Present assignment, usage and reservation as different facts; preserve scoped writes. |
| [A19](01-inventory.md#A19) `kycQueue` | I | H | `5/5/5/5/5/4/4/3/4/5/6/4` | Use explicit lookup and document-review wording; do not imply identity is verified from unreviewed evidence. |
| [A20](01-inventory.md#A20) `complianceCases` | I | H | `5/5/5/5/5/4/4/3/4/5/6/4` | Retain distinct compliance access and review state; do not assume workforce login grants access. |
| [A21](01-inventory.md#A21) `fraudCases` | I | M | `4/4/4/4/5/4/4/3/3/5/6/4` | Make lookup labels and table overflow accessible without altering risk policy. |
| [A22](01-inventory.md#A22) `workforceAccess` | I | H | `5/5/5/5/5/4/5/3/5/6/6/5` | Clarify which workforce changes are available to the current principal, preserving guards. |
| [A23](01-inventory.md#A23) `roleGovernance` | I | H | `5/5/5/5/5/4/6/3/5/6/7/5` | Make role, scope, dates and approval evidence visible before irreversible decisions. |
| [A24](01-inventory.md#A24) `approvalsInbox` | I | H | `5/5/4/4/5/4/4/3/3/6/6/4` | Associate labels and present the frozen request/actor/effect before decision; do not weaken maker-checker. |
| [A25](01-inventory.md#A25) `superAdminRecovery` | I | H | `4/4/4/4/5/4/4/3/3/5/6/4` | Provide an associated label and explicit high-risk review without displaying or retaining secrets. |
| [A26](01-inventory.md#A26) `notifications` | I | H | `5/5/4/4/5/4/5/4/5/6/6/4` | Stage changes with Arena 2/4; keep provider state, permissions and non-secret preview truthful. |
| [A27](01-inventory.md#A27) `systemHealth` | I | M | `5/5/5/5/5/4/5/4/5/7/6/5` | Present partial health explicitly, preserving separately authorized data sets. |
| [A28](01-inventory.md#A28) `auditEvents` | I | M | `4/4/4/4/5/4/3/3/3/5/6/4` | Add an explicit associated search label and horizontal-table affordance. |
## Admin embedded workspaces

| ID / view | Evidence | Priority | Scores | Screen-specific action |
|---|---|---|---|---|
| [E01](01-inventory.md#E01) `Customer 360 workspace` | I | H | `7/7/6/6/6/6/6/6/6/7/7/6` | Preserve role-specific field masking and contextual return paths. |
| [E02](01-inventory.md#E02) `Customer registration wizard` | I | H | `6/6/6/6/6/6/7/6/6/7/7/6` | Keep draft/verification distinction and existing per-field errors; never call unreviewed evidence verified. |
| [E03](01-inventory.md#E03) `Personal information & contact` | I | H | `6/6/6/5/6/6/6/6/6/6/7/6` | Keep independent read/edit permissions, masked contacts and validation semantics. |
| [E04](01-inventory.md#E04) `Proof of address` | I | H | `6/6/6/5/6/6/6/6/6/6/7/6` | Distinguish document submission, review and physical verification; no fabricated supervisor approval. |
| [E05](01-inventory.md#E05) `Tier 3 readiness` | I | M | `6/6/6/5/6/6/–/6/6/5/7/6` | Explain unmet factors without implying approval or inventing hard gates. |
| [E06](01-inventory.md#E06) `Agent funding/defunding` | I | H | `5/5/5/4/5/4/5/3/5/6/7/5` | Keep maker/checker separation, same-request recovery and exact server values. |
| [E07](01-inventory.md#E07) `Agent credentials` | I | H | `5/5/5/4/5/4/5/3/5/6/6/5` | Security-review ephemeral credential disclosure and no-secret logs before any visual change. |
| [E08](01-inventory.md#E08) `Agent class assignment` | I | M | `5/5/5/4/5/4/5/4/5/6/6/5` | Show eligibility impact from server data, not a client-derived policy. |
| [E09](01-inventory.md#E09) `Agent PIN support` | I | H | `5/5/5/4/5/4/5/4/5/6/7/5` | Maintain identity/authorization checks and prevent sensitive PIN display. |
| [E10](01-inventory.md#E10) `Agent unified history` | I | M | `5/5/5/5/5/4/5/4/5/6/7/5` | Keep safe references, status and money semantics while improving table readability. |
| [E11](01-inventory.md#E11) `Funding approvals queue` | I | H | `5/5/5/4/5/4/5/4/5/6/7/5` | Show maker, checker, amounts, approval status and execution state as distinct. |
| [E12](01-inventory.md#E12) `Notification template workspace` | I | H | `5/5/5/4/5/4/5/4/5/6/7/5` | Preserve protected-event locks, safe preview and maker-checker; coordinate Arena 2/4. |
| [E13](01-inventory.md#E13) `Provider configuration workspace` | I | H | `5/5/5/4/5/4/5/4/5/6/7/5` | No activation or credential changes; visual work requires Arena 2/4 coordination. |
## Customer Mobile

| ID / view | Evidence | Priority | Scores | Screen-specific action |
|---|---|---|---|---|
| [C01](01-inventory.md#C01) `Splash` | I | L | `5/5/5/5/5/5/–/5/3/4/–/5` | Provide an accessible loading announcement and reduced-motion behavior. |
| [C02](01-inventory.md#C02) `Welcome` | I | H | `6/6/5/5/5/5/–/5/3/4/3/5` | Replace overpromising copy with owner-approved, actually available capabilities. |
| [C03](01-inventory.md#C03) `Login` | I | M | `6/6/6/6/5/5/6/6/3/6/6/5` | Associate accessible field names and preserve credential secrecy. |
| [C04](01-inventory.md#C04) `Registration` | I | H | `6/6/6/6/5/5/6/6/3/7/7/6` | Expose step, expiry and errors accessibly; retain direct OTP and no fabricated session. |
| [C05](01-inventory.md#C05) `Home` | I | H | `6/6/6/3/4/5/–/6/3/3/4/5` | Link profile/PIN and support independently of wallet presence; distinguish unavailable history from empty. |
| [C06](01-inventory.md#C06) `SendMoney` | I | H | `5/5/5/4/4/5/5/6/3/6/4/5` | Avoid implied recipient verification or zero fees; keep unknown-outcome and same-intent replay protection. |
| [C07](01-inventory.md#C07) `Transactions` | I | H | `6/6/6/5/3/5/–/6/3/4/5/5` | Suppress empty messaging when loading failed; make status text legible. |
| [C08](01-inventory.md#C08) `Profile` | I | C | `6/6/5/1/4/5/–/4/3/4/4/5` | Restore a discoverable path before relying on profile/PIN; avoid defaults that masquerade as facts. |
| [C09](01-inventory.md#C09) `TransactionPin` | I | C | `6/6/6/1/4/5/6/6/3/7/7/5` | Make existing flow reachable without changing PIN rules; retain secret-clearing and lockout. |
| [C10](01-inventory.md#C10) `Support` | I | M | `6/6/6/4/4/5/–/6/3/6/6/5` | Make support available during no-wallet/error states. |
| [C11](01-inventory.md#C11) `CreateSupportTicket` | I | M | `6/6/6/5/4/5/6/6/3/6/6/5` | Label fields and errors for assistive tech; avoid copying secrets into support context. |
| [C12](01-inventory.md#C12) `SupportTicketDetail` | I | M | `6/6/6/5/4/5/6/6/3/6/6/5` | Make status and reply/error announcements explicit. |
| [C13](01-inventory.md#C13) `FundWallet (unregistered)` | I | H | `5/5/5/1/4/5/4/5/3/5/2/4` | Do not expose; resolve orphan/typecheck and policy only through a separate owner-approved task. |
| [C14](01-inventory.md#C14) `Withdraw (unregistered)` | I | H | `5/5/5/1/4/5/4/5/3/5/2/4` | Do not expose; resolve orphan/typecheck and policy only through a separate owner-approved task. |
## Agent Mobile

| ID / view | Evidence | Priority | Scores | Screen-specific action |
|---|---|---|---|---|
| [G01](01-inventory.md#G01) `Splash` | I | L | `5/5/5/5/5/5/–/5/3/5/–/5` | Announce session restoration accessibly. |
| [G02](01-inventory.md#G02) `RotateCredential` | I | H | `6/6/6/6/5/5/6/6/3/6/7/6` | Preserve mandatory gate and ephemeral secrets; add accessible field/error associations. |
| [G03](01-inventory.md#G03) `Login` | I | M | `6/6/6/6/5/5/6/6/3/6/6/5` | Associate field names, errors and focus with accessibility services. |
| [G04](01-inventory.md#G04) `Home` | I | H | `6/6/6/6/4/5/–/6/4/7/7/6` | Retain independent partial failures and server-authoritative capability gating. |
| [G05](01-inventory.md#G05) `Account` | I | M | `6/6/6/6/4/5/–/5/3/6/6/5` | Keep account/PIN/support discoverable and long content scrollable. |
| [G06](01-inventory.md#G06) `Support` | I | M | `6/6/6/6/4/5/–/6/3/6/6/5` | Improve status and accessibility without exposing hidden identifiers. |
| [G07](01-inventory.md#G07) `CreateSupportTicket` | I | M | `6/6/6/5/4/5/6/6/3/6/6/5` | Make labels, errors and success announcements accessible; exclude sensitive credentials. |
| [G08](01-inventory.md#G08) `SupportTicketDetail` | I | M | `6/6/6/5/4/5/6/6/3/6/6/5` | Announce messages and retain safe contextual references. |
| [G09](01-inventory.md#G09) `TransactionPinManage` | I | H | `6/6/6/6/4/5/–/6/3/7/7/5` | Preserve locked/unavailable distinctions and support path. |
| [G10](01-inventory.md#G10) `SetTransactionPin` | I | H | `6/6/6/6/4/5/6/6/3/7/7/5` | Keep create/rotate contracts and never persist or disclose PINs. |
| [G11](01-inventory.md#G11) `Transactions` | I | M | `6/6/6/6/4/5/5/6/4/7/7/6` | Keep safe row model and accessible row action while verifying status contrast. |
| [G12](01-inventory.md#G12) `History (alias)` | I | M | `6/6/6/6/4/5/5/6/4/7/7/6` | Preserve alias compatibility and test both entry names. |
| [G13](01-inventory.md#G13) `TransactionReceipt` | I | H | `6/6/6/6/4/5/–/6/3/6/5/5` | Correct unsupported physical-handover assertion only after owner/security review. |
| [G14](01-inventory.md#G14) `CashToWallet` | I | H | `6/6/6/6/4/5/6/6/3/7/7/6` | Preserve resolver identity and inactive/ineligible blocking. |
| [G15](01-inventory.md#G15) `CashToWalletAmount` | I | H | `6/6/6/6/4/5/6/6/3/6/7/6` | Maintain minor-unit handling and never calculate a fee client-side. |
| [G16](01-inventory.md#G16) `CashToWalletConfirm` | I | H | `6/6/6/6/4/5/6/6/3/7/7/6` | Preserve explicit no-fee-preview wording, PIN secrecy and same-intent recovery. |
| [G17](01-inventory.md#G17) `CashToWalletSuccess` | I | M | `6/6/6/6/4/5/–/6/3/7/7/6` | Keep success versus replay and safe receipt references distinct. |
| [G18](01-inventory.md#G18) `CashToCash` | I | H | `6/6/6/6/4/5/6/6/3/7/7/6` | Explain unregistered beneficiary and claim eligibility without inventing policy. |
| [G19](01-inventory.md#G19) `CashToCashAmount` | I | H | `6/6/6/6/4/5/6/6/3/6/7/6` | Make the unit explicit and retain server-authoritative fee/total. |
| [G20](01-inventory.md#G20) `CashToCashConfirm` | I | H | `6/6/6/6/4/5/6/6/3/7/6/6` | Do not fabricate a fee preview; preserve idempotency and credential handling. |
| [G21](01-inventory.md#G21) `CashToCashSuccess` | I | H | `6/6/6/6/4/5/–/6/3/7/2/5` | Escalate the conflicting instruction to Security/Product; do not transmit or copy secret credentials. |
| [G22](01-inventory.md#G22) `CashToCashClaim` | I | H | `6/6/6/6/4/5/6/6/3/7/7/6` | Keep locator separate from secret and preserve eligibility checks. |
| [G23](01-inventory.md#G23) `CashToCashClaimConfirm` | I | H | `5/5/5/5/4/5/6/6/4/7/7/5` | Protect unknown-outcome recovery and separate ledger settlement from cash handover. |
| [G24](01-inventory.md#G24) `CashToCashClaimSuccess` | I | M | `6/6/6/6/4/5/–/6/3/7/7/6` | Preserve explicit no-handover-proof language. |
| [G25](01-inventory.md#G25) `WalletToCash` | I | H | `6/6/6/6/4/5/6/6/3/7/7/6` | Preserve customer and wallet eligibility checks. |
| [G26](01-inventory.md#G26) `WalletToCashAmount` | I | H | `6/6/6/6/4/5/6/6/3/6/7/6` | Distinguish requested cash from the server-recorded financial result. |
| [G27](01-inventory.md#G27) `WalletToCashConfirm` | I | H | `6/6/6/6/4/5/6/6/3/7/7/6` | Preserve direct OTP, customer-factor ownership, credential privacy and same-intent recovery. |
| [G28](01-inventory.md#G28) `WalletToCashSuccess` | I | H | `6/6/6/6/4/5/–/6/3/7/3/5` | Existing receipt asserts handover without evidence; escalate, do not invent physical-handover policy. |
| [G29](01-inventory.md#G29) `Placeholder (unregistered)` | I | L | `5/5/5/1/4/5/–/5/3/4/–/5` | Keep explicitly non-functional; do not register as a feature. |

## Prioritized cross-cutting findings

| ID | Severity / evidence | Finding, impact, next verification and source |
|---|---|---|
| UX01 | **Critical, source inference** | **Customer PIN setup is apparently unreachable from the normal authenticated navigation.** Home links only Send, Support and Transactions; `Profile` is registered but no `navigate('Profile')`/linking entry was found; the only discovered PIN entry is in Profile. A newly registered user without a PIN may be unable to complete a PIN-protected transfer. Reproduce on native device and inspect any external entry mechanism before an approved fix. [Home](../../apps/customer-mobile/src/screens/authenticated/HomeScreen.tsx#L96-L156), [navigator](../../apps/customer-mobile/src/navigation/AppNavigator.tsx#L76-L99), [Profile](../../apps/customer-mobile/src/screens/authenticated/ProfileScreen.tsx#L280-L294), [PIN](../../apps/customer-mobile/src/screens/authenticated/TransactionPinScreen.tsx). |
| UX02 | **High, source inference** | The non-replay Wallet→Cash receipt states that physical cash *was* handed over, while the success view tells the Agent to hand it over **now**. A ledger response is not proof of physical handover. Ask Finance/Operations/Security to settle truthful wording and proof boundaries; do not invent or implement a handover policy. [AgentReceipt](../../apps/agent-mobile/src/components/AgentReceipt.tsx#L214-L216), [success screen](../../apps/agent-mobile/src/screens/authenticated/cash-out/WalletToCashSuccessScreen.tsx#L25-L53). |
| UX03 | **High, source inference; policy conflict** | Existing Cash→Cash success UI includes a manual instruction to share the display-once secret with the beneficiary. That conflicts with the standing direction not to send sensitive transfer credentials to beneficiaries. The safe locator/receipt share builders exclude the secret; no automatic secret transmission was observed in this review. Escalate wording/operational protocol to Security and Product without enabling any credential distribution. [success](../../apps/agent-mobile/src/screens/authenticated/cash-to-cash/CashToCashSuccessScreen.tsx#L139-L153), [safe receipt](../../apps/agent-mobile/src/components/AgentReceipt.tsx). |
| UX04 | **High, calculated from source colors** | Customer status badge uses `#F59E0B` on `#FEF3C7` (**1.93:1**), success `#10B981` on `#D1FAE5` (**2.24:1**) and error `#EF4444` on `#FEE2E2` (**3.08:1**): all below 4.5:1 normal text. Admin desktop logout white on `#EF4444` is **3.76:1** for 13px bold text. Verify actual composites and all states in browser/device. [badge](../../apps/customer-mobile/src/components/StatusBadge.tsx), [colors](../../apps/customer-mobile/src/theme/colors.ts), [Admin style](../../apps/admin-web/src/screens/authenticated/Layout.tsx). |
| UX05 | **High, rendered synthetic Admin** | At 390px the transfer view’s main scroller is **390px** wide but `scrollWidth` is **1038px**; key inputs/actions are off-screen because a wide two-column layout persists. Reflow forms and provide labeled table-region scroll only where genuinely necessary; test 320px and 400% zoom. [mobile screenshot](evidence/admin-transfers-mobile.png), [screen styles](../../apps/admin-web/src/screens/authenticated/TransactionObservabilityScreen.tsx#L538). |
| UX06 | **High, source inference** | Customer Home swallows recent-transaction fetch errors into `[]`, then shows an empty-history message; a wallet fetch error may coexist with “No Wallet Found.” Transactions may show both an error and “No transaction records found.” Treat unavailable, empty and stale as different states. [Home](../../apps/customer-mobile/src/screens/authenticated/HomeScreen.tsx#L50-L67), [history](../../apps/customer-mobile/src/screens/authenticated/TransactionsScreen.tsx#L40-L59). |
| UX07 | **High, source inference** | Customer transfer asks for a UUID and confirms amount + UUID, not a verified display name, fee or total. Do not infer the intended recipient, invent a fee or promise instant success. Product/API owners must confirm which fields/contracts can be supported before improving review. Preserve pending-intent/replay semantics. [SendMoney](../../apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx#L239-L320). |
| UX08 | **High, rendered synthetic Admin** | Mobile navigation toggle has an accessible name but no `aria-expanded`; while its overlay is open a keyboard Tab reached a customer-directory input behind it, and Escape left it open. Test as an explicitly modal drawer with focus containment/return or redesign as a non-obscuring disclosure; preserve section `aria-expanded` and route guards. [Layout](../../apps/admin-web/src/screens/authenticated/Layout.tsx#L267-L300), [screenshot](evidence/admin-navigation-mobile.png). |
| UX09 | **High, source inference** | Native shared `Input` renders a visible `Text` label separately from `TextInput` without an explicit accessible association; common `Button` has no explicit accessibility role/state. Customer source scan found no explicit `accessibilityLabel`/`Role`/`Hint`/`State` usage, while Agent has some (e.g. transaction row). Native controls may supply defaults; only device/assistive-tech testing establishes actual behavior. [customer Input](../../apps/customer-mobile/src/components/Input.tsx), [agent Input](../../apps/agent-mobile/src/components/Input.tsx), [agent row](../../apps/agent-mobile/src/components/TransactionRow.tsx). |
| UX10 | **High, command verified** | Customer TypeScript check fails because `FundWalletScreen` and `WithdrawScreen` reference route types absent from `RootStackParamList`. Both are unregistered sandbox UI, not permission to turn them on. Owner must decide how to handle orphan code in a later approved task. [route types](../../apps/customer-mobile/src/navigation/types.ts), [FundWallet](../../apps/customer-mobile/src/screens/authenticated/FundWalletScreen.tsx#L15), [Withdraw](../../apps/customer-mobile/src/screens/authenticated/WithdrawScreen.tsx#L15). |
| UX11 | **Medium, source inference** | Customer welcome promises funding and withdrawal, while Home says no customer-initiated funding/withdrawal in V1 and the two sandbox files are unregistered. Align copy with actual approved capability, not a new feature. [welcome](../../apps/customer-mobile/src/screens/unauthenticated/WelcomeScreen.tsx#L19-L22), [Home](../../apps/customer-mobile/src/screens/authenticated/HomeScreen.tsx#L23-L34). |
| UX12 | **High, rendered + source** | Some Admin forms use standalone `<label>` elements without `htmlFor` or nested controls (e.g. approvals and fee simulator), unlike Login/Customer fields. In the synthetic transaction view, axe reported four unnamed fee inputs and one unnamed category select; axe rates those rules critical, while this audit's High is a separate triage judgment. Approvals labels remain source-inferred. Associate controls without changing actions. [approvals](../../apps/admin-web/src/screens/authenticated/ApprovalsScreen.tsx#L158-L178), [fee simulator](../../apps/admin-web/src/screens/authenticated/TransactionObservabilityScreen.tsx#L335-L360), [evidence](evidence/README.md#automated-accessibility-sample). |
| UX13 | **High, source inference** | Customer Profile can render fallback account type `INDIVIDUAL`, KYC level `NONE` and KYC status `NOT_STARTED` when the identity request fails. These are not proof of actual account state; distinguish unavailable/unknown from a server result. [Profile](../../apps/customer-mobile/src/screens/authenticated/ProfileScreen.tsx#L121-L218). |
| UX14 | **Medium, source inference** | Dashboard’s trend SVG has a role, label and per-bar `<title>`; its detailed data has no equivalent adjacent table in that widget. Add an accessible data alternative rather than relying on hover/color, retaining count/value and period definitions. [widgets](../../apps/admin-web/src/components/dashboard/widgets.tsx). |
| UX15 | **Medium, rendered + source** | Seven Admin sections are initially expanded; the mocked all-scope desktop/mobile menu is long, with three near-identical transaction destinations and dense role/scope data on the dashboard. Actual role menus vary; do not use the artificial principal as an authorized production role. Group without removing destinations, exact scopes or Customer 360 contextual return paths. [Layout](../../apps/admin-web/src/screens/authenticated/Layout.tsx#L38-L127), [dashboard screenshot](evidence/admin-dashboard-desktop.png). |
| UX16 | **High, automated synthetic Admin** | In the empty Customer Directory, axe reported the table wrapper as a scrollable region without focusable content and found the subtitle at 4.40:1. Verify keyboard scrolling with populated/narrow tables and correct contrast; avoid removing columns or changing data access. [Directory](../../apps/admin-web/src/screens/authenticated/CustomerDirectoryScreen.tsx), [CSS](../../apps/admin-web/src/screens/authenticated/customer-management.css), [scan results](evidence/README.md#automated-accessibility-sample). |

No security conclusion is drawn from synthetic screenshots or unit tests. Notification provider-governance work, Arena 2 F-01/F-05 and Arena 4 independent acceptance remain independent open gates.
