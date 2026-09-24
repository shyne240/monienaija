# V1 Agent Roadmap Reconciliation

- **Originating task:** GOV-V1-SCOPE-AND-AGENT-ROADMAP-RECONCILIATION
- **Roadmap task code:** **NOT ASSIGNED** — see §6. No code is invented by this document.
- **Type:** Documentation-only reconciliation record, following the precedent of [`B2-ROADMAP-RECONCILIATION-HANDOFF.md`](B2-ROADMAP-RECONCILIATION-HANDOFF.md) (task code B2R01).
- **Status:** **PROPOSED — NOT APPROVED.** No reconciliation authority has approved the ownership model in §7. Nothing in this document controls future work until an owner approves it.
- **Prepared:** 2026-09-24
- **Scope:** The conflict between the current authoritative V1 product scope and existing roadmap ownership and governance statements concerning Agent.
- **Companion records:** [`AUTHORITATIVE-V1-PRODUCT-SCOPE.md`](AUTHORITATIVE-V1-PRODUCT-SCOPE.md), [`ADR/ADR-0093-V1-Agent-Identity-and-Financial-Ownership-Architecture.md`](ADR/ADR-0093-V1-Agent-Identity-and-Financial-Ownership-Architecture.md), [`ADR/ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md`](ADR/ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md)
- **Implementation status:** No source, test, app, migration, schema, enum, configuration or runtime behaviour is created or modified.

---

## 1. Reconciliation decision — proposed

The reconciliation proposed by this record is:

1. **Agent remains in V1 product scope**, as recorded in [`AUTHORITATIVE-V1-PRODUCT-SCOPE.md`](AUTHORITATIVE-V1-PRODUCT-SCOPE.md) §11. No roadmap statement is used to remove Agent from V1.
2. **No historical roadmap statement is deleted, rewritten or reinterpreted.** All conflicting statements are preserved verbatim in §4 and registered in §5.
3. **Product scope and phase ownership are separated.** V1 says *what* the product is; the roadmap says *which platform owns* a capability. The conflict is an ownership question, not a scope question.
4. **A reconciled ownership split is proposed** in §7 — V1 owns Agent canonical identity and financial capability; B5 retains Agent lifecycle and servicing. **This is PROPOSED and requires approval.**
5. **Implementation governance continues to apply unchanged** until an owner reconciles it. The `roadmap.md` human-acceptance gate, fail-closed stop rule, and unique-task-code requirement are not waived, relaxed or reinterpreted by this record.
6. **A roadmap task code must be allocated by the roadmap owner** before any Agent implementation task begins (§6). This record does not allocate one.
7. **This record introduces no implementation or runtime behaviour.**

> **Nothing in items 1–7 is approved.** Until a reconciliation authority approves §7 and answers §5 AGR-03, the conflict stands and the fail-closed stop in `roadmap.md` governance rule 11 continues to apply to Agent implementation tasks.

---

## 2. Package

- [`AUTHORITATIVE-V1-PRODUCT-SCOPE.md`](AUTHORITATIVE-V1-PRODUCT-SCOPE.md) — the V1 product scope now recorded in-repository.
- This record — conflict registration, proposed ownership model, task-code requirement, staged gate.
- [`ADR/ADR-0093-V1-Agent-Identity-and-Financial-Ownership-Architecture.md`](ADR/ADR-0093-V1-Agent-Identity-and-Financial-Ownership-Architecture.md) — the Agent identity and financial-ownership architecture decision.
- [`ADR/ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md`](ADR/ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md) — owner assignment and Finance/B2F dependencies.

---

## 3. Preservation

This reconciliation preserves, unchanged:

- every statement in [`../roadmap.md`](../roadmap.md), including its governance rules, its human-acceptance gate, its maturity order and its project state map;
- every statement in [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md), including the B5 ownership row and the frontend portfolio;
- every statement in [`B2-ROADMAP-RECONCILIATION-HANDOFF.md`](B2-ROADMAP-RECONCILIATION-HANDOFF.md), including §1 item 6;
- all B2T01–B2T10 artifacts, the `b2_agent_activation_readiness` attestation, its migration, its module wiring and its tests;
- all accepted ADRs, contracts, identifiers, event names, idempotency scopes and tests.

No file is mass-rewritten. Following B2R01 supersession rule 5 ("Primary roadmap/plan files receive notices; detailed contradictions are retained here"), the two primary roadmap files carry a short pointer notice to this record. Those notices **register a pending conflict and assert no supersession**, because §1 is not approved. No statement is edited, removed or reworded.

---

## 4. Statements registered verbatim

### From [`../roadmap.md`](../roadmap.md)

| Ref | Location | Statement |
| --- | --- | --- |
| **S4** | §2.D, line 101 | "**Agent App:** **NOT STARTED** (Requires `B5` backend)." |
| **S5** |  line 44 | "No future Customer Mobile, Agent, Merchant, or third-party work may begin until this human verification gate is fully satisfied and formally approved." |
| **S6** | governance rule 11, line 23 | "**Fail-Closed Stop:** Arena agents **MUST STOP** immediately and notify operators if a proposed task conflicts with this `roadmap.md` or any accepted ADR." |
| **S7** | governance rule 8, line 20 | "**Unique Task Codes:** Every future implementation, test expansion, or deployment task must have a unique, explicit roadmap code (such as `W1`, `W2`, etc.)." |
| **S8** | governance rule 9, line 21 | "**Authoritative Reference:** Every future Arena task must consult this `roadmap.md` first before any source, test, or config file changes are made." |

### From [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)

| Ref | Location | Statement |
| --- | --- | --- |
| **S1** | §4, line 93 | B5 **Merchant Platform** — "Merchant and agent lifecycle, merchant capabilities, onboarding, servicing, and merchant-domain operations." |
| **S2** | §6, lines 118–125 | "Frontend development follows backend platform maturity." Portfolio: 1. Customer Mobile App, 2. **Agent App**, 3. Merchant App, 4. Admin Portal, 5. Finance Portal, 6. Operations Portal. |

### From [`B2-ROADMAP-RECONCILIATION-HANDOFF.md`](B2-ROADMAP-RECONCILIATION-HANDOFF.md)

| Ref | Location | Statement |
| --- | --- | --- |
| **S3** | §1, item 6, line 19 | "Existing merchant/agent work is preserved for later formal incorporation into B5." |

> **Line-number note.** Line numbers above are as of the commit that introduced this record. The pointer notices described in §3 added two lines to the head of `roadmap.md` and `AUTHORITATIVE-PLATFORM-ROADMAP.md`, so line references to those two files in the earlier [`ADR/ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md`](ADR/ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md) predate the insertion and are two lines lower. The quoted text, section numbers and rule numbers are unaffected and remain the stable references.

### Observations offered to the reconciliation authority

These are **factual observations about the existing documents**, recorded because they bear on the decision. They are **not** arguments that the conflict is already resolved, and they resolve nothing.

- **O-1.** `AUTHORITATIVE-PLATFORM-ROADMAP.md` §1 defines its own supersession reach as controlling future sequencing and ownership where an older artifact "assigns a different future meaning to **A8, B2, B3, observability, frontend sequencing, or scale/extraction**". Agent and merchant ownership are not in that enumeration. S1's authority therefore rests on its table entry rather than on that supersession clause.
- **O-2.** The same document's binding guardrail list (§10) states at item 5 only "**B5 owns merchant lifecycle**" — it does not restate agent lifecycle, which S1's table row does. The two passages are internally inconsistent about Agent.
- **O-3.** S4 concerns the **Agent App** — a frontend channel — and states that the *App* requires a B5 backend. It does not, on its face, address Agent backend identity or wallet. S5, by contrast, is written broadly as "Agent … work".
- **O-4.** S1, S2, S3, S4 and S5 were all last modified in the same commit, `3d05aae` (2026-08-24). None supersedes another by recency.
- **O-5.** `roadmap.md` §2.A records the platforms V1 Agent identity and wallet would depend upon — A1 Identity, A3 Customer Binding, A5 Ledger — as **COMPLETE**, and records **B2 (Finance Platform) as NOT STARTED**.

---

## 5. Contradiction register

The review inspected `roadmap.md`, `AUTHORITATIVE-PLATFORM-ROADMAP.md`, `B2-ROADMAP-RECONCILIATION-HANDOFF.md`, `PLATFORM-ARTIFACT-CLASSIFICATION.md`, `B2-MERCHANT-AGENT-ONBOARDING-CONTRACT.md`, the B2F finance contracts, all ADRs referencing Agent, and Agent-related source, migrations and tests.

### AGR-01 — Agent ownership assigned to B5

**Contradiction**

The current authoritative V1 product scope makes Agent a first-class V1 participant with its own identity, wallet, authentication and transaction PIN. S1, S3 and S4 assign agent lifecycle and the Agent backend to B5, a platform that has not started.

**Affected primary roadmap documents**

- `docs/AUTHORITATIVE-PLATFORM-ROADMAP.md` (S1, and §10 guardrail 5 per O-2)
- `roadmap.md` (S4)

**Affected historical reconciliation/classification documents**

- `docs/B2-ROADMAP-RECONCILIATION-HANDOFF.md` (S3)
- `docs/PLATFORM-ARTIFACT-CLASSIFICATION.md` — "Future ownership: primarily B5 Merchant Platform, with later B10 integration"

**Proposed resolution** — §7. **Status:** PROPOSED, unapproved.

### AGR-02 — Agent App frontend sequencing

**Contradiction**

V1 scope includes the Agent App. S2 places Agent App second in the frontend portfolio behind backend platform maturity; `roadmap.md` governance rule 12 and S5 gate the next client application behind human acceptance testing of the current Admin milestone.

**Affected documents:** `docs/AUTHORITATIVE-PLATFORM-ROADMAP.md` (S2); `roadmap.md` (S5, rule 12).

**Proposed resolution** — **None proposed.** Agent App sequencing is outside the Agent identity/wallet reconciliation and is left entirely to the roadmap owner. Recorded so it is not mistaken for resolved. **Status:** REGISTERED, unresolved.

### AGR-03 — Scope of the human-acceptance gate

**Contradiction**

S5 states that no future "Agent … work" may begin until the human verification gate is satisfied. It does not distinguish Agent **backend** work from Agent **channel/app** work. S4 addresses only the Agent App (O-3). Read at its widest, S5 blocks Agent identity and wallet implementation outright; read narrowly, it blocks only the Agent client application.

**Why this is the decisive item**

S6 obliges a fail-closed stop when a proposed task conflicts with `roadmap.md`. Because S5 is ambiguous as written, **any Agent implementation task is in apparent conflict until the roadmap owner states which reading is correct.** No other item in this register can be worked around while AGR-03 is open.

**Affected documents:** `roadmap.md` (S5, S6).

**Resolution required:** the roadmap owner must state explicitly whether the gate at `roadmap.md:44` applies to Agent backend work, Agent channel work, or both. **Status:** REGISTERED, unresolved, **blocking**.

### AGR-04 — Missing roadmap task code

**Contradiction**

S7 requires a unique explicit roadmap code for every implementation, test-expansion or deployment task. The prospective task `V1-AGENT-IDENTITY-WALLET` has no roadmap code, and no V1 code namespace exists in either roadmap.

**Affected documents:** `roadmap.md` (S7).

**Proposed resolution** — §6. **Status:** REGISTERED, requires owner allocation.

### AGR-05 — Aggregator has no owner

**Contradiction**

V1 scope makes Aggregator a first-class corporate participant. No roadmap phase claims Aggregator, and no Aggregator entity, table, principal type or contract exists in the repository.

**Affected documents:** none assign it; this is an ownership gap rather than a conflicting statement.

**Proposed resolution** — **None proposed.** Recorded for the roadmap owner. **Status:** REGISTERED, unresolved.

---

## 6. Roadmap task code (S7 / AGR-04)

### 6.1 The convention

1. **The rule.** `roadmap.md` governance rule 8 (S7): every future implementation, test-expansion or deployment task must have a unique, explicit roadmap code.
2. **Observed code forms.** Phase-task codes `A1T01`, `A3T02`, `B2T05`, `B2F01`; a reconciliation code `B2R01`; frontend series `W1`–`W6`, `F1`–`F2`; platform codes `B5`, `C2`, `D1`.
3. **Namespace source.** Codes derive from the phase/platform namespaces enumerated in `AUTHORITATIVE-PLATFORM-ROADMAP.md` §2, which states that the roadmap "has exactly the phases and platforms below" and that the reconciliation "does not invent an A8, additional B platform, additional C platform, additional D platform, or additional E platform."

### 6.2 Who must authorize

`roadmap.md` is the authoritative register (S8) and `AUTHORITATIVE-PLATFORM-ROADMAP.md` §1 controls future sequencing and platform ownership. Allocation of a new code, and especially of a **new namespace**, is therefore a **roadmap-owner act**. The B2R01 precedent confirms it: that reconciliation carried an owner-authorized code and was recorded in the authoritative roadmap's own §9 sequence and §11 package list.

### 6.3 Does an existing namespace fit?

| Candidate | Assessment |
| --- | --- |
| `B5*` | Matches S1/S3/S4 ownership, but contradicts the proposed §7 split and implies starting B5 Merchant Platform. |
| `A1*`/`A3*`/`A5*` | Agent identity/wallet reuses these substrates, but those phases are recorded COMPLETE (O-5) and reopening them would blur completed-phase boundaries. |
| `W*` | Admin Web frontend series. Not applicable. |
| **A new `V1*` namespace** | No `V1` namespace exists in either roadmap. Creating one would add a namespace to a document that states it does not invent additional platforms — therefore an explicit owner decision, not a clerical act. |

**Conclusion: no existing namespace is a clean fit.** The roadmap owner must either allocate a code inside an existing namespace and accept its ownership implication, or create a namespace for V1 product work.

### 6.4 Required governance action

> **GA-1.** The roadmap owner allocates a unique roadmap code for the Agent backend identity/wallet work, records it in `roadmap.md`, and states which namespace it belongs to. **No code is invented by this document, and no implementation task may proceed under an unallocated code.**

---

## 7. Proposed reconciled ownership model — **PROPOSED, NOT APPROVED**

The V1 scope answers *what the product is*. The roadmap answers *which platform owns a capability*. The proposal separates them:

| Capability | Proposed owner | Note |
| --- | --- | --- |
| Agent **canonical identity** | **V1** | Same class of foundation concern as Customer identity, which V1 already owns. |
| Agent **financial identity / wallet** and binding | **V1** | Reuses A3 binding patterns and the A5 ledger substrate, both COMPLETE (O-5). |
| Agent **authentication** | **V1** | Required by V1 security separation. |
| Agent **transaction authorization** and transaction PIN | **V1** | Required by V1 money flows. |
| Agent **financial capabilities required by V1** (Cash→Wallet, Wallet→Cash, Cash→Cash) | **V1** | These are V1 money flows. |
| Agent **lifecycle and servicing** | **B5** | Unchanged from S1/S3. |
| Agent **onboarding operational workflows**, classes, application/approval | **B5** | Unchanged from S1/S3. |
| Merchant/agent **servicing infrastructure** and merchant-domain operations | **B5** | Unchanged from S1/S3. |
| Agent **App** (frontend) | **Not proposed** | Governed by AGR-02 and the frontend maturity gate. |
| **Aggregator** | **Not proposed** | AGR-05; no owner assigned. |

Under this proposal, S1 and S3 are **narrowed, not deleted**: B5 retains agent lifecycle and servicing; Agent canonical identity and financial ownership move to V1. S4 is **clarified**: the Agent App remains NOT STARTED and gated, while Agent backend identity/wallet is separable from it.

> **This table is a proposal.** It is not approved, does not control future work, and must not be cited as settled. If the reconciliation authority rejects it, Agent identity and wallet remain B5 work and `V1-AGENT-IDENTITY-WALLET` does not proceed in its current form.

**Classification:** governance / owner approval. No organizational structure is invented — the proposal reassigns scope only between phases the roadmap already defines.

---

## 8. Proposed supersession rules

Modelled on B2R01 §6, and effective **only if §1 and §7 are approved**:

1. Historical implementation facts remain valid.
2. Historical ownership labels do not control V1 product scope.
3. A historical prohibition remains in force where it protects an authority boundary — in particular the third-party integration freeze, the A5 ledger authority, and the segregation of Customer, Agent, Aggregator and Workforce identity.
4. Where an approved reconciliation narrows a historical ownership statement, the narrowing is recorded here; the historical statement is not deleted.
5. No historical file is silently mass-rewritten. Primary roadmap files receive pointer notices; detailed contradictions are retained in §5.
6. Accepted ADRs remain decision history for the implementation they actually govern.
7. Implementation governance — gates, fail-closed stops, task codes — is never superseded by product scope. It is amended only by an explicit owner act.

---

## 9. Staged implementation gate

Carried forward from `ADR-0093-V1-AGENT-IDENTITY-DECISION-RESOLUTION.md` §9. Each stage requires **all** of its own prerequisites **and** those of every earlier stage.

### Stage 1 — Agent identity

Deliverable: Agent canonical identity only. No financial account, no ledger object, nothing immutable.

Requires:

- V1 scope formally committed to the repository — **satisfied** by `AUTHORITATIVE-V1-PRODUCT-SCOPE.md`;
- governance/ownership reconciliation **approved** — §1 and §7 of this record, **outstanding**;
- AGR-03 answered — **outstanding, blocking**;
- roadmap code allocated per GA-1 — **outstanding**.

### Stage 2 — Agent wallet and financial binding

Adds:

- Finance **accounting-unit** decision;
- **liability classification** decision.

These fix `ledger_accounts.accounting_unit`, `account_type` and `normal_balance`, which are immutable after account creation.

### Stage 3 — Agent financial posting

Adds:

- **chart-of-accounts** classification decision;
- **A5 mapping** approval, including the approval path given that B2F06 is not implemented.

### Stage 4 — Agent MonieNaija number

Requires:

- an **approved number allocation strategy** — shared namespace versus disjoint range, allocation authority, collision prevention, and applicability of the Nigerian phone-derivation convention.

**No implementation change is made by this document at any stage.**

---

## 10. Approval required

| # | Action | Owner |
| --- | --- | --- |
| **GA-1** | Allocate the roadmap task code and namespace (§6.4) | Roadmap owner |
| **GA-2** | Answer AGR-03 — does `roadmap.md:44` gate Agent backend work, Agent channel work, or both? | Roadmap owner |
| **GA-3** | Approve or reject the §7 ownership model; if approved, record the narrowing of S1, S3 and the clarification of S4 | Reconciliation authority / roadmap owner |
| **GA-4** | Decide AGR-02 — Agent App sequencing against the frontend maturity gate | Roadmap owner |
| **GA-5** | Assign an owner for Aggregator (AGR-05) | Roadmap owner |
| **F-1 … F-4** | Accounting unit; liability classification; chart classification; A5 mapping approval | Finance / B2F, with A2 privileged approval for mapping activation |

GA-1, GA-2 and GA-3 gate Stage 1. F-1 and F-2 gate Stage 2. F-3 and F-4 gate Stage 3. GA-4 and GA-5 gate nothing in Stages 1–4 and must not delay them.

---

## 11. Exact next step

1. **Operator review of this record.** Per S6, a fail-closed stop applies while AGR-03 is open; this record is the required notification.
2. **Owner completes GA-1, GA-2 and GA-3.** If §7 is approved, record the narrowing of S1 and S3 and the clarification of S4 here, and update this record's status from PROPOSED to APPROVED.
3. **Finance proceeds with F-1 → F-2 → F-3/F-4** in that order, independently of the governance track.
4. **Only then** may Stage 1 of §9 begin, under its allocated roadmap code.

Do **not** begin `V1-AGENT-IDENTITY-WALLET` from this record.

---

## 12. Reconciliation validation checklist

- [x] V1 product scope recorded in-repository and citable.
- [x] Product scope distinguished from phase ownership and from implementation governance.
- [x] All conflicting statements preserved verbatim; none deleted, reworded or reinterpreted.
- [x] Contradiction register produced in the B2R01 pattern.
- [x] Proposed ownership model marked PROPOSED and unapproved.
- [x] No new phase, platform or organizational structure invented.
- [x] No roadmap task code invented; allocation recorded as a required governance action.
- [x] Fail-closed stop, human-acceptance gate and task-code rule preserved, not waived.
- [x] Finance/B2F decisions left unresolved and assigned.
- [x] Staged gate preserved from ADR-0093 resolution package.
- [x] Primary roadmap files receive pointer notices only, asserting no supersession.
- [x] No source, test, app, migration, schema, enum, configuration, runtime behaviour or ADR renumbering introduced.
