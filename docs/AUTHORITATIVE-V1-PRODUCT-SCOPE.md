# Authoritative V1 Product Scope

- **Task:** GOV-V1-SCOPE-AND-AGENT-ROADMAP-RECONCILIATION — V1 Scope Formalization
- **Type:** Documentation-only governance record. No runtime behaviour, schema, migration, source, test or configuration is introduced.
- **Status:** Authoritative statement of the project owner's current V1 **product scope**, recorded in-repository for citation and review.
- **Effective date:** 2026-09-24
- **Scope:** V1 product definition, money flows, participants, services, security separation and exclusions.
- **Not in scope of this document:** phase/team ownership, implementation sequencing, task-code allocation, accounting treatment, commercial rates, and provider details. See §2 and §16.
- **Companion record:** [`V1-AGENT-ROADMAP-RECONCILIATION.md`](V1-AGENT-ROADMAP-RECONCILIATION.md) — registers and proposes resolution for the conflict between this scope and existing roadmap ownership statements.

---

## 1. Purpose

Prior audit work established that the repository contained **no canonical V1 scope document**. Consequently no implementation, review or dispute could be resolved against a citable V1 artifact. This document closes that gap by recording the project owner's V1 scope in the repository.

This document records scope. It does **not** authorize implementation, allocate a roadmap task code, or resolve any ownership conflict. Those are governance acts, handled in the companion reconciliation record.

---

## 2. Authority and interpretation

This document is the project owner's **current authoritative V1 product scope**.

Three distinct things must not be conflated:

| Layer | What it determines | Controlling document |
| --- | --- | --- |
| **Current authoritative V1 product scope** | *What* V1 is: participants, money flows, services, exclusions. | **This document.** |
| **Historical roadmap ownership** | *Which phase or platform* owns a capability, and the recorded ordering of platforms. | [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md), [`../roadmap.md`](../roadmap.md), [`B2-ROADMAP-RECONCILIATION-HANDOFF.md`](B2-ROADMAP-RECONCILIATION-HANDOFF.md). |
| **Implementation governance** | *Whether and when* a task may begin: gates, task codes, fail-closed stops, approvals. | [`../roadmap.md`](../roadmap.md) governance rules; accepted ADRs. |

Rules of interpretation:

1. **Historical documents are not declared wrong.** Where an older roadmap statement conflicts with this scope, the conflict is a **governance reconciliation item**, not an error to be silently corrected. Historical implementation evidence remains valid in all cases.
2. **This document does not silently override implementation governance.** Recording a capability as in-scope for V1 does **not** authorize work on it. Fail-closed governance rules, gates and task-code requirements continue to apply until an owner reconciles them.
3. **Conversely, an older roadmap ownership statement does not remove a capability from V1 product scope.** Ownership and scope are different questions.
4. Where this scope and a governance statement conflict, the conflict must be **registered and resolved explicitly** through the repository's reconciliation pattern. The first such record is the companion document for Agent.
5. This document invents nothing. Items the owner marked "do not invent" are preserved as prohibitions, not filled in.

---

## 3. V1 product

MonieNaija V1 is a Nigerian digital wallet and payments platform.

- **Primary currency:** NGN.
- **Primary customer population:** individual customers.
- **V1 explicitly includes:** Customers, Agents, Aggregators, and the Agent App.

> **Ordinary business-customer scope is not expanded** beyond what is explicitly established elsewhere in the repository. No additional V1 products are invented.

---

## 4. V1 money flows

V1 has exactly five money flows:

1. **Wallet → Wallet**
2. **Wallet → Bank**
3. **Wallet → Cash**
4. **Cash → Wallet**
5. **Cash → Cash**

---

## 5. Customer wallet identity

- Every eligible customer has a wallet.
- The **primary MonieNaija number is derived from the Nigerian phone number** according to the established Nigerian-number convention.
- The following are **distinct concepts** and must not be merged, aliased or conflated: **primary receiving number**, **additional virtual account**, **CustomerWallet**, **WalletAccount**, **LedgerAccount**.

---

## 6. Wallet → Wallet

V1 requires:

- registered customer → registered customer;
- phone destination;
- MonieNaija number destination;
- applicable Nigerian bank account destination;
- recipient identity/name confirmation where capability supports it;
- Customer Transaction PIN;
- configurable fees;
- double-entry accounting;
- atomicity;
- idempotency;
- concurrency safety;
- authorization;
- no double spend;
- auditability;
- principal/fee separation.

---

## 7. Wallet → Bank

V1 requires:

- bank beneficiary/account information;
- name confirmation where the provider supports it;
- provider-neutral external operation lifecycle;
- settlement/reconciliation;
- failure/reversal handling;
- idempotency;
- **no invented provider or NIBSS details where official materials are unavailable.**

---

## 8. Wallet → Cash

V1 includes **both** established methods.

### Method 1 — Agent-assisted cash-out

Customer physically at an Agent:

1. Agent enters customer phone and amount.
2. Customer authorizes using the **dedicated transaction PIN + OTP**.
3. The financial transaction executes.
4. Customer is debited.
5. Agent receives electronic value.
6. The transaction completes immediately.
7. Agent gives physical cash.

Constraints: **no physical ID**, **no redemption code**, **no extra confirmation**. Physical cash is outside the electronic ledger.

### Method 2 — Customer electronically transfers to Agent wallet

Once the electronic transfer completes, MonieNaija considers the transaction **complete**.

> **No automatic reversal is introduced for physical disputes.** See §15 (Support).

---

## 9. Cash → Wallet

V1 requires:

- physical cash handed to an authorized Agent;
- the recipient may differ from the depositor;
- Agent resolves the recipient;
- identity/name confirmation;
- Agent electronic balance debited;
- recipient wallet credited immediately;
- a completed transaction;
- physical cash is **not** electronically tracked.

---

## 10. Cash → Cash

V1 requires:

- unregistered recipient;
- sufficient Agent electronic balance;
- **no overdraft**;
- **no partial transfer**;
- **no pending state for insufficient balance**;
- principal reserved/unclaimed;
- fees separately accounted;
- exact beneficiary phone;
- transfer code as the redemption credential;
- **hashed** transfer code;
- failed-attempt protection;
- exact beneficiary-phone binding;
- onboarding/KYC required for claim;
- **no "Claim All"**;
- redemption requires **exact transfer code + exact beneficiary phone + OTP + acceptable identity verification**;
- failed verification leaves the transfer **pending**;
- the initiating and redeeming Agents may differ;
- configurable expiry;
- expiry moves funds to a dedicated **EXPIRED / UNCLAIMED FUNDS** state;
- **no automatic return of expired funds**;
- later disposition requires a formal backend/regulatory process.

---

## 11. Agent

**Agent is a first-class V1 participant. Agent is NOT `Customer + agent flag`.**

An Agent has separate: **identity, wallet, MonieNaija number, electronic balance, authentication, transaction PIN, permissions, limits, services, commissions, transaction history.**

- **Agent electronic balance can never be negative.**
- **Physical cash is not electronic balance.**

### 11.1 Agent services

- Cash → Wallet
- Cash → Cash
- Wallet → Cash

### 11.2 Agent status

`Pending`, `Active`, `Suspended`, `Terminated`.

- Suspended or terminated Agents **cannot initiate new transactions**.
- Existing valid Cash→Cash transfers **remain claimable/redeemable** according to the V1 rules in §10.

### 11.3 Agent classes and onboarding

V1 includes **configurable Agent classes** and Agent onboarding/application/approval.

- The applicant selects the desired class.
- The class determines requirements.
- Onboarding includes: class selection → requirements → structured information → documents → submission → review → approval/rejection → creation → activation.
- **Security and audit requirements cannot be configured away.**

---

## 12. Outlets and terminals

V1 includes:

- outlets;
- physical address;
- Agent association;
- terminals/devices;
- outlet status;
- transaction attribution;
- remote terminal disable;
- a maintained distinction between **Aggregator**, **Agent**, **Outlet**, **Terminal** and **Transaction**.

---

## 13. Aggregator

Aggregator is a **V1 corporate participant** supervising multiple Agents and outlets.

- Aggregator permissions and subordinate visibility **must be isolated**.
- **Aggregator funding architecture remains subject to the established V1 architecture and must not be invented.**

---

## 14. Commissions

Agent commissions are **separate** from: principal, customer fee, platform revenue, and other fee allocations.

Commission configuration may be **global / class / individual / service**.

> **Rates are not invented.** No rate, percentage or amount is established by this document.

---

## 15. Notifications and support

### Notifications

- V1 customer notifications: **Push** and **SMS**. Email is later.
- Agent notifications/receipts are configurable.
- **Outbox existence is not proof of delivery.**

### Support

- in-app tickets;
- transaction-linked support;
- ticket status;
- Admin servicing;
- auditable support history.

> **Wallet→Cash Method 2 physical disputes are not automatically reversed.** They are handled through support, not through automatic financial reversal.

---

## 16. Security separation

Authentication is separated by participant:

- Customer authentication
- Agent authentication
- Aggregator authentication
- Workforce authentication

Transaction PINs are separated:

- Customer transaction PIN
- Agent transaction PIN

Transfer codes are **one-time, hashed, exact-phone-bound credentials**.

---

## 17. V1 exclusions

Explicitly excluded from V1:

- cards
- dollar cards
- non-NGN currencies
- bills
- airtime
- data
- electricity
- cable
- betting

No additional V1 products are invented. Ordinary business-customer scope is not expanded unless explicitly established elsewhere.

---

## 18. Implementation dependencies and known governance conflicts

Recording a capability here does **not** authorize implementing it (§2 rule 2). The following dependencies and conflicts are registered so that they are visible at the point of scope rather than discovered during implementation.

### 18.1 Finance / B2F decisions — not resolved here

The following remain **Finance / B2F decisions** and are explicitly **not** resolved by this document:

| Dependency | Affects |
| --- | --- |
| Agent e-float **accounting unit** | Agent wallet (§11), Cash→Wallet (§9), Wallet→Cash (§8), Cash→Cash (§10) |
| Agent e-float **liability classification** | Same as above |
| **Chart-of-accounts classification** for Agent float | Any Agent posting |
| **A5 account mapping** approval | Any Agent posting |
| Accounting treatment of **reserved/unclaimed** Cash→Cash principal, and of the **EXPIRED / UNCLAIMED FUNDS** state (§10) | Cash→Cash, expiry disposition |
| Accounting treatment of **commission** as distinct from principal, customer fee and platform revenue (§14) | Commissions |

Detail and ownership for the first four are recorded in [`ADR/ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md`](ADR/ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md) §5.

### 18.2 Commercial / B1 decisions — not resolved here

Commission rates and structures (§14), and configurable fee values (§6), are Commercial/B1 decisions. No rate or amount is established here.

### 18.3 Registered governance conflicts

| # | V1 scope item | Conflicting governance statement | Status |
| --- | --- | --- | --- |
| **V1C-01** | Agent is a first-class V1 participant (§11) | `AUTHORITATIVE-PLATFORM-ROADMAP.md:93` assigns "Merchant and agent lifecycle" to B5; `roadmap.md` §2.D "Agent App: **NOT STARTED** (Requires `B5` backend)"; `B2-ROADMAP-RECONCILIATION-HANDOFF.md` §1 item 6; `roadmap.md:44` human-acceptance gate covering "Agent … work". | **Registered and proposed for resolution** in [`V1-AGENT-ROADMAP-RECONCILIATION.md`](V1-AGENT-ROADMAP-RECONCILIATION.md). |
| **V1C-02** | Agent App is in V1 (§3) | `AUTHORITATIVE-PLATFORM-ROADMAP.md` §6 lists Agent App as frontend #2 behind "Frontend development follows backend platform maturity"; `roadmap.md:44` and governance rule 12 gate the next client application behind human acceptance testing. | **Registered.** Not resolved. Frontend sequencing is outside the Agent identity/wallet reconciliation. |
| **V1C-03** | Wallet → Bank is a V1 money flow (§4, §7) | `roadmap.md` governance rule 4: "All NIBSS NIP, external payment processors, bank adapters, and virtual account provider integrations remain **strictly frozen and bypassed**." | **Registered.** Not resolved. Note §7 already forbids inventing provider/NIBSS details, so the freeze and the scope are compatible in the interim: the lifecycle may be provider-neutral while integrations stay bypassed. |
| **V1C-04** | Aggregator is a V1 corporate participant (§13) | No Aggregator entity, table, principal type or owner exists in the repository, and no phase currently owns Aggregator. | **Registered.** Not resolved. Ownership must be assigned before Aggregator work. |
| **V1C-05** | Any V1 implementation task | `roadmap.md` governance rule 8 requires a unique explicit roadmap code; no V1 code namespace exists. | **Registered.** Resolution path recorded in the companion reconciliation, §6. |

Registration means the conflict is visible and owned. It does **not** mean it is resolved, and it does **not** authorize proceeding.

---

## 19. What this document does not do

- It does not authorize any implementation task.
- It does not allocate or invent a roadmap task code.
- It does not amend, delete or rewrite any roadmap statement.
- It does not resolve any Finance, Commercial, regulatory or accounting question.
- It does not assign phase or team ownership of any capability.
- It does not invent rates, fees, commissions, PINs, number ranges, Agent Code formats, provider details or Aggregator funding architecture.
