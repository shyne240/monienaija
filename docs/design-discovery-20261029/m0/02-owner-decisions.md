# Owner decision register

**All decisions are OPEN.** The defaults below are conservative recommendations or existing constraints, not approvals, product policy changes, instructions to operators, or changes to the live application. Owner roles are proposed; no individual has been assigned. IDs D1–D12 continue the [discovery register](../06-roadmap-and-decisions.md#decision-register); D13 adds the requested explicit outcome-state decision.

## Decision summary

| ID | Owner decision requested | Accountable / consulted | Recommended default while open | Blocks |
|---|---|---|---|---|
| D1 | Approve/revise Grounded Clarity, the M1 boundary and separately authorize the specified Admin files; provision a separate design workspace. | Product Owner; Design, Admin lead | No application implementation. A design approval is not code authorization. | **Start of M1** |
| D2 | Resolve the current Cash→Cash secret instruction against the standing prohibition on sending sensitive transfer credentials to beneficiaries. | Security + Product; Privacy, Agent Operations | No new secret distribution, copy/share mechanism, credential-bearing message or instruction to send a secret. Escalate the current conflict; do not silently alter the existing flow. | Cash→Cash UI/messaging and affected Agent acceptance |
| D3 | Approve truthful Wallet→Cash receipt/result wording and who owns the physical-handover process. | Finance + Operations + Product; Security | Receipt describes only evidenced ledger result and says handover is not recorded by the receipt; do not claim or invent a physical-handover state. | Wallet→Cash presentation work |
| D4 | Select a discoverable Profile/PIN and no-wallet Support entry after device verification. | Customer Product; Mobile, Security, Accessibility | No navigation or PIN-policy change in M0; preserve the conditional history alternative accurately. | Customer navigation work |
| D5 | Decide whether verified recipient and authoritative fee/total are prerequisites, and what happens when they are unavailable. | Product + Finance; API, Security, Compliance | Never fabricate them or treat unknown as zero. Default recommendation is to hold release of a redesigned flow **that requires these assurances** until a real contract supplies them; existing behavior remains unchanged pending authorization. | Transfer-review changes; backend expansion separately scoped |
| D6 | Approve light palette and accessibility target; decide whether dark mode is funded later. | Design + Accessibility; Product | Light first; no automatic dark mode. | M1 visual approval; dark-mode release |
| D7 | Choose a supported Customer build/install process and a resolution for the two unregistered type-error files. | Mobile engineering owner; Product/Build | Leave source and manifest alone; do not register unsupported routes to silence TypeScript. | Customer milestone acceptance |
| D8 | Approve the proposed navigation parity matrix and unresolved compliance boundary without changing policy. | Authorization/Security owner; Admin, Arena 3, Compliance | Existing server authorization and frontend scope/role/context guards remain authoritative and unchanged; no implied compliance grant. | **Start of M1**; sensitive reviews later |
| D9 | Coordinate notification provider F-01/F-05 and independent security acceptance. | Arena 2 + Security/Arena 4; notification owner | No overlapping edits, provider activation, external vendor call, or claim of completed independent acceptance. | Notification/provider work; integration/release gates as applicable |
| D10 | Confirm definitions, periods and freshness of dashboard metrics. | Finance/Analytics; Product, Admin | No new or inferred metric or “profit” claim. | Future dashboard redesign, not M1 |
| D11 | Confirm wording for KYC evidence, SERVICE actions and human supervisory review. | Compliance + Security; Product | Unreviewed documents are not verified identity; SERVICE approval is not human supervisor verification. No authorization-policy change. | Future compliance/agent review work |
| D12 | Confirm Cash→Cash unclaimed, claimed and expired presentation and recovery. | Finance + Product + Security | Display only evidenced server status/timestamps; no automatic expiry refund, release or redistribution. | Cash→Cash redesign |
| D13 | Approve the financial outcome vocabulary, allowed actions and per-flow status/error mappings. | Product + Finance + Security; API, QA | Use the matrix below; no new retry, reversal, cancellation, payout or refund behavior. | Any future financial UI change |

## D2 — Cash→Cash credential conflict

**Evidence:** the [current success screen](../../../apps/agent-mobile/src/screens/authenticated/cash-to-cash/CashToCashSuccessScreen.tsx#L139-L153) instructs private sharing of the display-once secret with the named beneficiary. That conflicts with the standing instruction not to send sensitive transfer credentials to beneficiaries. The [receipt builder](../../../apps/agent-mobile/src/components/AgentReceipt.tsx#L25-L30) excludes the transfer code, PINs and OTPs; the separate public locator is not that secret, but includes contact data and is not automatically free of privacy risk.

**Decision requested:** Security and Product must either specify and approve a compliant end-to-end credential lifecycle that satisfies the standing restriction, or explicitly escalate the incompatibility between that restriction and the present claim flow. This pack does **not** propose an alternative secret delivery channel or represent an unapproved process as safe. Maintain existing ephemeral handling, direct OTP and security controls until owners authorize a separately reviewed change. Never put PINs, passwords, OTPs or transfer secrets in receipts, logs, analytics, public locators or ordinary transaction/support/marketing messages; never send the transfer secret to beneficiaries or create a new secret-copy/share control. Preserve direct security OTP flows under their separate existing handling policy; that exception does not authorize transfer-secret distribution or OTP logging. Any public locator sharing remains limited to the existing authorized behavior and requires privacy review; a public identifier is still potentially identifying data.

## D3 — truthful Wallet→Cash receipt

**Evidence:** the [receipt](../../../apps/agent-mobile/src/components/AgentReceipt.tsx#L187-L229) states that physical cash was handed over for a non-replayed result; the [success screen](../../../apps/agent-mobile/src/screens/authenticated/cash-out/WalletToCashSuccessScreen.tsx#L25-L50) separately instructs cash handover. A ledger result does not itself prove that physical handover happened. No actual handover was observed in M0.

**Recommended wording for owner review, not deployed copy:** “Ledger result: [authoritative status]. This receipt does not record whether physical cash was handed over.” Mention a customer-wallet debit and agent-float credit only when the specific returned status and contract substantiate those effects. For an explicit idempotent replay, identify it as the prior instruction's result rather than a new debit; do not infer whether cash has already changed hands. Finance and Operations must decide any separate human process or instruction. This recommendation creates no handover checkbox, proof, timestamp, additional ledger state or payout policy.

**Alternatives for owners:** (A) approve the ledger-only wording and separately governed operational instructions; or (B) defer presentation changes until an independently approved handover-evidence policy and contract exist. Either requires Security/Finance review; neither is authorized merely by appearing here.

## D5 — recipient, fee and total without authoritative data

Customer [SendMoney](../../../apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx) uses an entered wallet UUID and does not evidence a verified recipient-name or pre-submit fee/total quote in this view. Agent Cash→Wallet has a recipient-resolution flow but explicitly says no fee preview; a post-result fee or Admin simulator is not a binding pre-submit quote. Availability and legal requirements must be confirmed per flow with the API and Finance owners.

**Choose:**

- **A — recommended for a redesigned flow whose requirements include verified preview:** require an authorized, current recipient resolution and an authoritative fee and total before the final review can be approved for release. If unavailable, label each unavailable value and hold that **new release**, pending separately scoped backend/API, policy, security and acceptance work. This is a proposed future requirement, not a current capability or an instruction to disable today's flow.
- **B — a constrained exception:** Product, Finance, Security and any required Compliance/legal owners explicitly accept an identifier-only/unquoted review for a defined flow. Show the exact submitted identifier and “recipient name unavailable,” “fee unavailable” and “total unavailable,” as applicable; never say verified, free or zero, and never compute a made-up total. Sign off the risk and user-facing wording before any change. This option does not create or imply consent to a fee.

An actual fee or total may be shown only from the relevant authorized server response, with currency and scope; freshness/expiry can be shown only if the contract supplies them. Existing transfer confirmation, PIN, idempotency and authorization behavior remain unchanged throughout M0.

## D13 — outcome vocabulary and safe actions

Owners must map each specific API response and error to these presentation categories; these are not newly invented server enum values. An example message is only appropriate when supported by that flow's contract.

| Situation | Recommended display | Safe boundary / existing action |
|---|---|---|
| Client request in flight | “Submitting…” / “Checking status…” | Do not label it server-pending, failed, completed or cancelled. Preserve the existing synchronous duplicate-submit guard. |
| Server-confirmed pending | “Pending” with the exact returned status and safe reference, if provided. | Pending is not success or failure; do not promise a completion time. Use only the flow's existing status/support path. |
| Ambiguous timeout / unknown outcome | “Outcome not confirmed. Check the existing status or history before another attempt.” | Never assert failure, reversal or refund. Preserve the same logical intent and recovery key **where the existing flow provides that behavior**; do not imply an unrelated/new request is safe. |
| Definitive rejection / failure | Show the contract-defined rejection and permitted correction/support. | Treat as no financial effect only when the specific contract guarantees that conclusion; do not generalize all 4xx responses. |
| Explicit replay / already recorded | Explain that the response refers to the same previously recorded instruction, and show the underlying status if supplied. | Replay is an idempotency observation, not a new financial event or universal lifecycle status. Do not claim no new effect without the corresponding contract guarantee. |
| Confirmed completion | State the exact server-confirmed result, amount/currency and safe reference. | Do not infer physical cash handover, verified identity, provider delivery or an approval that is not evidenced. |
| Cash→Cash unclaimed / claimed / expired | Show only the server-returned status and known timestamps; distinguish reservation and the specific claim destination. | Preserve `CUSTOMER_WALLET` vs `AGENT_CASH` accounting. No inferred expired-funds refund, release, redistribution or physical payout. |

Test each touched flow for pending, ambiguous/restart recovery, contract-defined rejection, replay and completion, including duplicate activation and secret-free output. No test or copy change may alter financial settlement, journal accounting, key reuse, payout locking, `CUSTOMER_WALLET` or `AGENT_CASH` semantics.

## Sign-off record to complete

| Approval | Decision / evidence link | Owner | Date | Status |
|---|---|---|---|---|
| Visual direction + light-first scope | [Design](03-design-approval.md), D1/D6 | Product / Design / Accessibility | — | OPEN |
| File authorization + branch provisioning | [M1 scope](04-m1-scope.md), [branch plan](05-branch-and-dependencies.md), D1 | Product / Admin lead | — | OPEN |
| Navigation/role parity and compliance boundary | D8, existing guards and tests | Authorization / Security owner | — | OPEN |
| Cash→Cash secret restriction | D2 / D12 | Security + Product + Finance | — | OPEN |
| Wallet→Cash truth | D3 | Finance + Operations + Product | — | OPEN |
| Recipient/fee/total and outcome semantics | D5 / D13 | Product + Finance + Security | — | OPEN |
| Independent security acceptance | Arena 4’s own evidence and decision | Arena 4 | — | OPEN / independent |

Do not fill owner names, approvals or dates without the actual decision. A financial decision is not permission to edit security/backend code or activate a provider.
