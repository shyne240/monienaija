# Information architecture and low-fidelity wireframe specifications

**Proposed, not implemented.** These text wireframes are layout/behavior specifications, not generated visual mockups. All labels, values and locations shown in brackets are placeholders; the server remains authoritative. The current route/component inventory is [here](01-inventory.md). Navigation changes must preserve every existing available destination, action, permission, context and conditional state—not merely the menu label.

## Admin Web — role-aware operations workspace

Keep the existing seven conceptual groups and all 28 canonical views; reduce scan cost through shorter labels, clear active state, collapsible groups, a restrained page header, and remembered expansion only if privacy and state-reset behavior are agreed. Avoid presenting a universal menu for a synthetic all-scope user. Use existing `canAccessAdminView`, role/function predicates and backend guards unchanged. Permissions do not become client authorization.

| Proposed group | Existing canonical view keys (all retained) | Context / constraints |
|---|---|---|
| Home & work | `dashboard`, `dashboardSettings` | Server-resolved role widgets; dashboard assignment remains governed. |
| Servicing | `customers`, `agents`, `agentClasses`, `support` | Customer Directory → Customer 360 → personal/contact, proof and contextual destinations; agent detail retains onboarding, class, credential, outlet/terminal, PIN, funding and history panels. |
| Money movement | `transfers`, `cashIn`, `cashOut`, `cashToCashOps` | Three transaction trace views share one component but retain their initial category and access; Cash-to-Cash remains a distinct operations view. No invented universal search. |
| Finance & ledger | `ledgerExplorer`, `reconciliation` | Read vs governed reversal clearly separated; no invented reconciliation-break resolution. |
| Commercial controls | `feeRules`, `commissionRules`, `rewardRules`, `productCatalogue`, `limitCatalogue`, `limitAssignments` | Five read-only registries remain separately function-gated; assignment/diagnostics retain their own rules. |
| Compliance & risk | `kycQueue`, `complianceCases`, `fraudCases` | Keep KYC, compliance and fraud functions distinct; workforce sign-in does not grant compliance access. |
| Platform & governance | `workforceAccess`, `roleGovernance`, `approvalsInbox`, `superAdminRecovery`, `notifications`, `systemHealth`, `auditEvents` | Preserve maker/checker, MFA, provider lifecycle, direct OTP separation, recovery and audit controls. |

- Desktop: collapsible persistent navigation and a main landmark; show role/session details without letting a raw list of every scope dominate the operational dashboard. Retain a discoverable authorized entitlement view.
- Narrow web: a modal navigation drawer with named open/close control, `aria-expanded`, focus management, Escape/close and focus return; or an explicitly nonmodal disclosure that never obscures focus. No new route model is required for the pilot. The existing nine internal aliases remain canonicalized and guarded; a URL router, deep-linking or persisted history would require a separately scoped proposal.
- Customer 360 currently exposes a contextual transaction link; the shell also accepts customer context for support, limits, KYC, compliance, fraud and audit views, but visible links to all of those were not found. Any additional contextual link is a proposal requiring the existing scope/context predicates and owner approval. Preserve existing return-to-customer behavior where present without leaking an old customer ID into unrelated views. Do not create new privilege or reveal hidden records.
- Dense tables retain columns and exact facts. On narrow screens, use a named scroll region or an accessible row-detail pattern rather than removing operational information. On big screens offer sensible density, not a requirement to show every column at once.

## Customer Mobile — purpose-led navigation

Current native stack: unauthenticated `Welcome → Login / Registration`; authenticated `Home → SendMoney / Transactions / Support`; `Profile` is registered but no incoming action was found, and `TransactionPin` is reachable from that Profile only. Proposed navigation should add an obvious, consistently available **Profile & security** entry once approved, and make Support reachable even if the wallet is missing or a request fails. Do not add customer-initiated funding/withdrawal or a beneficiary directory merely because unregistered sandbox files or future plans exist.

```text
Session restore: Splash
Public: Welcome → Login | Registration (phone → OTP → details → success → Login)
Authenticated:
  Home / balance → Send Money → existing review/authorization → Home
  Activity → Transactions → contextual CreateSupportTicket
  Support → CreateSupportTicket | SupportTicketDetail
  Profile & security → Profile → TransactionPin | Support | Log out
```

This is a **proposed entry structure**, not a claim that the current app has bottom tabs or that Profile is currently reachable. Any tab bar must retain native-stack back behavior, deep state and security; no change to PIN lifecycle, wallet ownership, OTP policy or session handling is authorized by this proposal.

## Agent Mobile — capability-led work

Keep existing login → required credential rotation → authenticated Home behavior. Organize the current flat action list into named sections; availability continues to be driven by the backend capability response and fail closed. Proposed destinations:

```text
Overview: Home (identity, float, receiving number, capability status)
Work:
  Cash→Wallet        recipient → amount → confirm/authorize → result
  Cash→Cash          beneficiary → amount → confirm/authorize → result
  Cash→Cash claim    locator/beneficiary → method/verify/confirm → result
  Wallet→Cash        customer → amount → confirm/authorize → result
Activity: Transactions [History alias retained] → TransactionReceipt
Account:  Account/outlets/terminals → TransactionPinManage → SetTransactionPin
          Support → CreateSupportTicket | SupportTicketDetail; Log out
```

No feature is enabled by a menu alone. Preserve separate `CUSTOMER_WALLET` and `AGENT_CASH` claim options exactly as the service supports them; outcomes and physical cash handling must not be conflated. Preserve current hidden back behavior on financial confirmation/success screens unless a Security-reviewed state-machine design says otherwise.

## Text wireframes (synthetic placeholders only)

### 1. Admin desktop — Customer Directory, read-first

```text
┌─────────────────┬──────────────────────────────────────────────────────────┐
│ MonieNaija      │ Customer servicing                                      │
│ Role/session    │ Customer directory                         [New customer]│
│ Home & work     │ Search [________________]  Status [▼] Type [▼] KYC [▼] │
│ Servicing   ▾   │ [Clear filters]                         [refresh status] │
│  Customers  ●   ├──────────────────────────────────────────────────────────┤
│  Agents         │ Customer | Reference | Type | Status | KYC | Registered │
│  Agent classes  │ [server-returned, permission-masked rows]               │
│  Support        │ [loading / no matches / unavailable + retry]            │
│ … other groups  │ Page [n] of [n]                         [Previous] [Next]│
└─────────────────┴──────────────────────────────────────────────────────────┘
```

`New customer` is visible only with the existing create function. Selecting a row opens the existing Customer 360 workspace; every contact/identity field retains masking and per-action checks. At narrow widths filters stack and the table gets a named scroll region or accessible details pattern. Display no example customer data in evidence or tests.

### 2. Customer home — available, missing and failed are different

```text
┌───────────────────────────────────┐
│ MonieNaija         [Profile & ⚙]  │ ← new entry, approval required
│ Available balance                 │
│ ₦ [server-provided amount]        │
│ [Wallet status / as-of if supplied]│
│ [Send money]       [Support]      │
│ Recent activity           [All]   │
│ [server rows: amount + status]    │
│ [or: unavailable  Retry]          │
└───────────────────────────────────┘
```

No wallet is a separate, truthful state; data failure is not “no wallet” and history failure is not “no transactions.” Support is available even without a wallet after an approved navigation change. Do not fabricate updated time, balance, fees or status.

### 3. Customer transfer — contract-aware review

```text
┌───────────────────────────────────┐
│ Review transfer        Step [n]   │
│ To: Wallet [exact supplied ID]    │
│ Recipient name: [only if returned │
│   by an approved resolver]        │
│ Amount: NGN [authoritative input] │
│ Fee: [server value / unavailable] │
│ Total: [server value / unavailable]│
│ [No claim that unknown fee is 0]  │
│ [Edit]         [Authorize & send] │
└───────────────────────────────────┘
```

The existing customer flow does **not** provide a verified recipient name or a demonstrated fee/total preview. The placeholders describe conditional future presentation, not new APIs. Whether missing fee/total should block a transaction is a Product/Finance decision; do not alter existing behavior during design discovery. PIN is masked, ephemeral and entered only where the existing authorization contract requires. On ambiguity: “Outcome not confirmed”; offer the existing history/recovery path, never suggest a new independent transfer. A separate successful receipt would require an approved, evidenced response/route.

### 4. Agent review and settlement outcome

```text
┌───────────────────────────────────┐
│ Confirm [existing operation]      │
│ Customer/beneficiary: [resolved]  │
│ Receiving identifier: [server]    │
│ Amount: NGN [entered/returned]    │
│ Fee/total: [only if provided]     │
│ Settlement: [server-described]    │
│ [Existing MFA/PIN controls]       │
│ [Back if safe] [Confirm action]   │
└───────────────────────────────────┘
```

Result differentiates confirmed ledger status, replay, pending/unknown and any separate physical action. A ledger result alone is never presented as proof of cash handover. For Cash→Cash, the public locator and a display-once secret are distinct; never include secrets in receipts, logs, analytics or messages to beneficiaries. Security/Product must resolve the existing UI instruction conflict before redesign.

### 5. Admin governed approval

```text
┌───────────────────────────────────────────────────────────────────┐
│ Approval [safe reference]                 [REQUESTED / APPROVED] │
│ Maker [available actor]  ·  Action [type]  ·  Created [time]      │
│ Subject [authorized target]  Amount [server value + currency]     │
│ Frozen request / reason / expiry [only where supplied]            │
│ [Open existing source context]                                     │
│ Comment [_____________________]                                   │
│ [Reject]                                [Approve / Execute]       │
└───────────────────────────────────────────────────────────────────┘
```

Preserve requester/checker separation, scope, role, MFA, approval state, exact financial effect and idempotency/recovery. If the existing endpoint does not return a field or a generic approval detail, label it unavailable and record a dependency; do not fabricate data, an approval endpoint or a new policy. No UI should imply a SERVICE approval is human supervisor verification.

## Interaction flow requirements

- Errors name what happened, what is known/unknown and the next permitted action; never conflate blocked, denied, not found, no data, failed and unknown outcome. Announce consequential changes accessibly.
- Review summaries retain currency, amount, recipient identifier and authoritative fee/total where available. Confirmation uses an action-specific verb rather than a generic “OK”; destructive or irreversible operations disclose consequence and existing approval requirements.
- Loading uses non-misleading skeletons/labels; partial data maintains its own source state. No decorative chart or synthetic placeholder may be presented as financial data.
- Navigation proposals are subject to Product, Security and accessibility review and are not a green light to alter existing financial handlers, backend routes or role/scope catalogues.
