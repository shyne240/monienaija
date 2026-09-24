# ADR-0093 Addendum — V1 Agent Identity Decision Resolution Package

- **Task:** V1-AGENT-DECISION-RESOLUTION-PACKAGE
- **Type:** Documentation-only decision-resolution addendum. Not a replacement for ADR-0093.
- **Parent decision:** [ADR-0093 — V1 Agent Identity and Financial Ownership Architecture](ADR-0093-V1-Agent-Identity-and-Financial-Ownership-Architecture.md)
- **Status:** Prepared. No decision in this document is resolved by Arena; each unresolved item is assigned to a named owner class.
- **Baseline:** branch `arena/01a0b942-monienaija`, HEAD `d05ebeb2e760f450475bc7791b9d8e1b394c738e`
- **Implementation status:** No source, test, migration, schema, enum or runtime behaviour is created or modified.

---

## 1. Purpose

ADR-0093 decided the Agent identity and financial-ownership architecture and left a set of decisions unresolved. This addendum converts those unresolved items into an explicit, owner-assigned, blocking-versus-non-blocking gate for the next task, `V1-AGENT-IDENTITY-WALLET`.

This document **does not** choose an accounting treatment, a commercial policy, a regulatory treatment, an Agent Code format, a PIN or MFA value, a number range, or a fee or commission. Where a decision is unresolved, it is named, scoped, costed and assigned — not answered.

---

## 2. Current architectural state

Verified at HEAD `d05ebeb`:

- Agent does not exist as a runtime domain: no `src/agent/`, no Agent entity, repository, service, controller, guard, route, migration or table.
- The only Agent-named artifact is the B2 read-only activation-readiness attestation (`b2_agent_activation_readiness`, migration `1785753600040`), whose `agent_id` is an unconstrained `VARCHAR(64)` with no foreign key.
- `AuthorizationPrincipalType` is `CUSTOMER | SUPPORT | OPERATOR | SERVICE | PRIVILEGED`.
- The customer financial chain is foreign-key bound to `customers` at every link, and `customer_financial_account_bindings` additionally carries `CHECK (accounting_unit = 'CUSTOMER_FUNDS')`.
- `wallet_accounts.customer_id` is `VARCHAR(160)` with no foreign key; `ledger_accounts` already carries `accounting_unit` and `allow_negative_balance` (default `FALSE`).
- **`CUSTOMER_FUNDS` is the only accounting unit that exists anywhere in the platform** — 122 occurrences in `src/`, and no second unit in any migration, entity, contract or test.

---

## 3. Authoritative V1 decisions

The V1 scope treated as authoritative for this work is: **Agent is a first-class V1 participant, not `Customer + agent flag`**, with separate identity, wallet, MonieNaija number, electronic balance, authentication, transaction PIN, permissions, limits, services, commissions and transaction history; Agent electronic balance may never be negative; physical cash is not electronic balance; existing ledger, wallet, binding, audit and idempotency infrastructure must be reused.

### RES-G2 — the V1 scope definition is not recorded in the repository

**This is a finding, not a challenge to the scope.** A full search of the repository establishes:

- there is no `docs/V1-*` document and no file named as a V1 handoff, specification or scope statement;
- the token `V1` appears in exactly **one** documentation file, `docs/A3-WALLET-LEDGER-MAPPING-CONTRACT.md:159`, and there it is a hash-prefix literal (`A3-WALLET-PROVISION-V1:<sha256(...)>`), not a product-scope definition;
- the phase-to-phase handoff documents that do exist (`A3-A4`, `A4-A5`, `A5-A6`, `A6-A7`, `A7-A8`, `B1-B2`, `A2-B9`, `B2-ROADMAP-RECONCILIATION`) are platform-sequence handoffs and none defines a V1 product scope.

The V1 definition therefore exists only as task instruction, outside version control. Every "is this already established by the V1 specification?" question in this package can consequently be answered only against the task instruction and the repository, never against a citable V1 artifact.

**Consequence:** implementation reviewers have nothing to check the built Agent against, and any future dispute about Agent scope has no repository tiebreaker. **Recommended action: commit the authoritative V1 scope statement to the repository** (for example `docs/V1-PLATFORM-SCOPE.md`) as an owner-approved document. This is cheap, unblocks citation, and is a prerequisite for resolving §4 cleanly.

**Classification:** governance / owner approval.

---

## 4. Governance conflict (Decision Group A)

### 4.1 The conflict, stated exactly

Per the task instruction, the in-repository roadmap position is treated as a **governance/ownership conflict requiring reconciliation — not as permission to remove Agent from V1**. The conflict is broader than ADR-0093 recorded. There are **four** in-repository statements, in three documents:

| # | Source | Exact statement |
| --- | --- | --- |
| S1 | `docs/AUTHORITATIVE-PLATFORM-ROADMAP.md:91` | B5 **Merchant Platform** owns "Merchant and agent lifecycle, merchant capabilities, onboarding, servicing, and merchant-domain operations." |
| S2 | `docs/AUTHORITATIVE-PLATFORM-ROADMAP.md:115–121` | Frontend portfolio lists Agent App as #2, and "Frontend development follows backend platform maturity." |
| S3 | `docs/B2-ROADMAP-RECONCILIATION-HANDOFF.md` §1, item 6 | "Existing merchant/agent work is preserved for later formal incorporation into **B5**." |
| S4 | `roadmap.md` §2.D | "**Agent App: NOT STARTED** (Requires `B5` backend)." |

Two further statements in the root `roadmap.md` are procedurally binding on this work regardless of how S1–S4 are reconciled:

| # | Source | Exact statement |
| --- | --- | --- |
| S5 | `roadmap.md:42` | "No future Customer Mobile, **Agent**, Merchant, or third-party work may begin until this human verification gate is fully satisfied and formally approved." |
| S6 | `roadmap.md` §Governance rule 11 | "**Fail-Closed Stop:** Arena agents **MUST STOP** immediately and notify operators if a proposed task conflicts with this `roadmap.md` or any accepted ADR." |

Additionally, `roadmap.md` governance rule 8 requires that "Every future implementation, test expansion, or deployment task must have a unique, explicit roadmap code (such as `W1`, `W2`, etc.)." **`V1-AGENT-IDENTITY-WALLET` has no roadmap code.**

### 4.2 Recency does not resolve it

`roadmap.md`, `docs/AUTHORITATIVE-PLATFORM-ROADMAP.md` and `docs/B2-ROADMAP-RECONCILIATION-HANDOFF.md` were all last modified in the **same commit**, `3d05aae` (2026-08-24). No in-repository document supersedes another by date, and all four statements agree with each other. Combined with RES-G2, the position is:

> Every governance document in the repository places Agent behind B5 and behind a human acceptance gate. The document that makes Agent a V1 participant is not in the repository.

This is precisely why the conflict must be reconciled by an owner and cannot be resolved by Arena reading files.

### 4.3 Proposed decision statement — requires owner ratification

The following answers the five required questions. Each is **proposed for ratification**, not adopted.

| # | Question | Proposed answer | Classification |
| --- | --- | --- | --- |
| A1 | Does Agent remain in V1? | **Yes.** The authoritative V1 scope makes Agent a first-class V1 participant. This package does not reopen it, and no repository document may be used to remove Agent from V1. | governance / owner approval |
| A2 | Which project/phase owns Agent **identity and financial capability**? | **V1 platform delivery**, executing under ADR-0093, using the A1/A3/A5 substrates. Rationale: Agent identity and wallet are foundation concerns of the same class as Customer identity and wallet, which V1 already owns. | governance / owner approval |
| A3 | Which team/phase owns Agent **lifecycle and servicing**? | **B5 Merchant Platform**, unchanged. Agent classes, onboarding workflow, application/approval, servicing, outlet and terminal operations, and merchant-domain operations remain B5. S1 and S3 are narrowed, not deleted. | governance / owner approval |
| A4 | Does B5 remain a dependency for V1 Agent identity/wallet? | **No**, if A2/A3 are ratified as above. Agent identity and wallet depend on A1 conventions, A3 binding patterns and A5 ledger — all `COMPLETE` per `roadmap.md` §2.A. They do not depend on any B5 artifact. B5 remains a dependency for Agent **lifecycle**, and the Agent **App** remains gated behind S2 and S5. | governance / owner approval |
| A5 | What exactly must be superseded or amended? | Four narrowings, listed in §4.4. | governance / owner approval |

### 4.4 Exact amendments required (to be made by the owner, not by Arena)

1. **S1** (`AUTHORITATIVE-PLATFORM-ROADMAP.md:91`) — narrow B5's scope from "Merchant and agent lifecycle …" to exclude Agent **canonical identity** and **Agent financial account ownership**, which move to V1.
2. **S3** (`B2-ROADMAP-RECONCILIATION-HANDOFF.md` §1 item 6) — clarify that "existing merchant/agent work … into B5" refers to the preserved B2T01–B2T10 readiness artifacts, and does not reserve Agent identity/wallet to B5.
3. **S4** (`roadmap.md` §2.D) — distinguish the **Agent App** (frontend, still `NOT STARTED`, still requires B5 and the S2/S5 gates) from **Agent backend identity/wallet** (authorized under V1). S4 as written conflates them.
4. **S5** (`roadmap.md:42`) — state explicitly whether the human-acceptance gate blocks Agent **backend** work or only Agent **channel/app** work. As written it blocks all "Agent … work". **Until this is answered, S6 (fail-closed stop) applies to `V1-AGENT-IDENTITY-WALLET` on its face.**

Additionally: **allocate a roadmap task code** for the Agent backend work, per `roadmap.md` governance rule 8.

### 4.5 Convention for making the amendment

The repository has an established precedent: `docs/B2-ROADMAP-RECONCILIATION-HANDOFF.md` (task code **B2R01**) reconciled an ownership conflict through a **documentation-only reconciliation document** containing a transition decision, a contradiction register, supersession rules and review gates — it did **not** edit historical documents in place, and it preserved all prior work unchanged.

Accordingly this addendum **does not edit** `roadmap.md`, `AUTHORITATIVE-PLATFORM-ROADMAP.md` or the B2 handoff. The convention-correct resolution is an **owner-authorized reconciliation task with its own roadmap code**, mirroring B2R01. Arena must not self-authorize that task, because B2R01 was itself owner-authorized and because S6 requires an operator notification rather than an agent-side judgement.

No organizational structure is invented here: A2–A4 reassign scope between **phases that already exist** in the repository's own roadmap.

---

## 5. Finance / B2F decisions (Decision Group B)

### B1 — Accounting unit

| Field | Content |
| --- | --- |
| **Exact question** | Should Agent electronic float use **(A)** the existing `CUSTOMER_FUNDS` accounting unit, or **(B)** a distinct accounting unit? |
| **Not chosen** | Arena does not choose. Both remain open. |
| **Why the architecture cannot assume** | `CUSTOMER_FUNDS` is the platform's **only** accounting unit (122 references, no second unit anywhere). Option B would create the first-ever second accounting unit. The existing customer binding constraint is `CHECK (accounting_unit = 'CUSTOMER_FUNDS')` — Agent implementation **cannot simply inherit that value because it is the default or because it is the only one that exists**. Inheriting it is an affirmative accounting statement that agent float is customer funds. |
| **Database / ledger consequence** | The unit is written to `ledger_accounts.accounting_unit` **at account creation and is immutable thereafter**: `docs/B2F-CHART-CLASSIFICATION-CONTRACT.md:112` states chart mapping "cannot override A5 account type, normal balance, currency, accounting unit, or negative-balance controls." It cannot be corrected later by remapping — only by creating new accounts and migrating balances. Reconciliation is also affected: the same contract (L78) records that reconciliation "groups accounts by A5 type/currency/accounting unit", so a second unit changes trial-balance and reconciliation grouping. It further determines the `CHECK` written on `agent_financial_account_bindings`. |
| **Decision owner** | Finance / accounting-policy authority, executed through B2F. Per `docs/B2-FINANCE-PLATFORM-BOUNDARY.md:19`, B2 Finance is authoritative "**subject to approved Finance and accounting-policy decisions**" — the platform implements policy, it does not originate it. |
| **Options** | **(A)** `CUSTOMER_FUNDS` — no new unit, no reconciliation grouping change, but asserts agent float is customer funds. **(B)** a distinct unit — separates agent float in every finance output, but is the platform's first second unit and requires reconciliation/trial-balance treatment for it. |
| **Implementation dependency** | Blocks creation of any Agent `ledger_accounts` row, therefore blocks Agent wallet provisioning and the `agent_financial_account_bindings` CHECK constraint. Does **not** block Agent identity tables. |

### B2 — Liability classification

| Field | Content |
| --- | --- |
| **Exact question** | What is the accounting classification of Agent electronic float? |
| **What Finance must establish, concretely** | Four ledger-level values that are fixed at account creation and cannot be changed by later mapping: (1) `ledger_accounts.account_type` — `LIABILITY` or another approved type; (2) `normal_balance` — `DEBIT` or `CREDIT`; (3) whether agent float belongs to the same liability pool as customer wallet balances for safeguarding, trial-balance and reconciliation purposes, or is a separately identifiable obligation; (4) confirmation that `allow_negative_balance = FALSE` is the correct Finance position as well as the V1 product requirement. |
| **Why the architecture cannot assume** | ADR-0004 establishes customer wallet accounts as liability accounts *for customers*. Nothing in the repository extends that classification to an agent, and the classification of agent float is a regulatory and accounting determination, not a schema default. |
| **Database / ledger consequence** | `account_type` and `normal_balance` are immutable per `B2F-CHART-CLASSIFICATION-CONTRACT.md:112`. Getting them wrong is not a migration fix — it is a balance migration and a finance correction. |
| **Decision owner** | Finance / accounting-policy authority (regulatory input as Finance requires). **Arena must not infer regulatory treatment.** |
| **Options** | Not enumerated here. Enumerating plausible classifications would itself be an accounting suggestion. |
| **Implementation dependency** | Same as B1: blocks Agent ledger-account creation, not Agent identity. |

### B3 — Chart of accounts / A5 mapping

| Field | Content |
| --- | --- |
| **Exact question** | What chart classification and A5 account-mapping treatment applies to Agent float accounts, and must a new account classification be created? |
| **Required Agent e-float classification** | Determined by B2 above; the chart entry cannot be drafted before it. |
| **Required A5 ledger-account role** | An owner-scoped Agent float account per Agent wallet, one-to-one with a `wallet_accounts` row via the existing `UNIQUE (ledger_account_id)` constraint. |
| **Is a new classification needed?** | Open. It depends on B2. Note `B2F-CHART-CLASSIFICATION-CONTRACT.md:269`: "A `WALLET-*` code pattern alone is insufficient. Finance must not infer customer ownership or role from text. Wallet/A3 relationships are canonical evidence." An Agent float account must therefore be distinguishable from a customer wallet account by **canonical relationship**, not by account code text — which is an independent argument for the additive `wallet_accounts.owner_type` discriminator decided in ADR-0093 §6(4). |
| **Can existing B2F mapping infrastructure support it?** | **Partially.** The mapping runtime exists (ADR-0089, `src/policy/b2f-account-mapping.*`) and the mapping lifecycle is defined as `DRAFT → PENDING_APPROVAL → ACTIVE` with `REJECTED`/`EXPIRED`/`REVOKED` terminals. However activation requires "A2 privileged approval plus **B2F06** controls" (`B2F-CHART-CLASSIFICATION-CONTRACT.md:36,39`), and ADR-0084 follow-up 5 assigns mapping approval/materiality roles to B2F06. `roadmap.md` §2.A records **"B2 (Finance Platform): NOT STARTED"**. So the mechanism is specified and partially built, but the approval-role machinery that activates a mapping is not in place. |
| **What must be approved before implementation** | The chart classification for Agent float, an active A5 mapping for it, and the approval path given that B2F06 is not implemented. |
| **Decision owner** | Finance / B2F, with A2 privileged approval for activation. |
| **Implementation dependency** | Blocks the **first Agent journal posting**. Does not block Agent identity tables, and does not strictly block account creation — though creating accounts that cannot yet be mapped should be an explicit owner choice. |

**Not created:** no account, mapping, classification or treatment is created by this document.

---

## 6. Product / security decisions (Decision Group C)

### C1 — Agent Code (ADR-0093 O3)

**Already defined in the repository or V1 specification?** **No.** `ADR-0023-Customer-Identifier-and-Reference-Conventions.md` has scope "Customer, account, reference, event, correlation, causation, request, trace, and idempotency identifiers" — it does not cover a participant login code, and it remains "Proposed for A1 architecture review" rather than Accepted. The only repository mention of an agent identifier is `docs/B2-IMPLEMENTATION-PLAN.md:393`, where "customer/merchant/agent identifier" is an opaque activation-request input with no format. No V1 artifact defines it (RES-G2).

**Therefore: product decision.** Format, length, alphabet, checksum and human-readability are unspecified. No format is invented here.

**Blocking?** **No** for `V1-AGENT-IDENTITY-WALLET`. Agent canonical identity is `Agent.id UUID` (ADR-0093 §8.2); the Agent Code is a **login identity**, which belongs to the Agent authentication task (dependency step 2). It must be decided before that task, not this one.

### C2 — Agent PIN / MFA (ADR-0093 O4)

Separated as required:

| Layer | Content | Decision needed? |
| --- | --- | --- |
| **Architectural reuse** | `PinHashService` (PBKDF2), the credential-table shape of `customer_authentication_credentials` (hash, algorithm, version, status, failed count, lock state), the lockout mechanism, and the existing `security_event_histories` vocabulary (`PIN_CREATED`, `PIN_CHANGED`, `PIN_VERIFICATION_FAILED`, `PIN_VERIFICATION_SUCCEEDED`). | **None.** Reuse is decided by ADR-0093 §12. |
| **Configurable policy** | `PIN_MIN_LENGTH`, `PIN_MAX_LENGTH`, `PIN_MAX_FAILED_ATTEMPTS`, validated at startup against `PIN_POLICY_BOUNDS` with defaults from `DEFAULT_TRANSACTION_PIN_SECURITY_POLICY`. | **Mechanism decided.** Whether Agent gets its own configuration namespace or shares the customer instance is a small design point for the auth task. |
| **Product / security decision** | Whether Agent PIN policy **values** differ from customer values, and whether V1 requires Agent MFA. | **Yes — product/security owner.** No values invented here. The standing constraint that no SMS or email OTP channel may be introduced continues to apply. |

**Blocking?** **No** for `V1-AGENT-IDENTITY-WALLET` — this is the step-2 authentication task. Working defaults exist either way.

### C3 — Agent MonieNaija number (ADR-0093 O5)

What must be decided, exactly:

1. **Shared namespace vs disjoint range.** Both participants' numbers must be unique across the platform. The existing guarantee, `uq_customer_receiving_numbers_number`, is **table-scoped**, so a parallel agent table inherits no protection. ADR-0093 §13 recommends disjoint allocation ranges enforced by per-table `CHECK`s, with a shared `monienaija_number_registry` as the eventual model. Neither has been ratified.
2. **Allocation authority.** Customer numbers are *derived* (`source = 'PHONE_NSN'`). Agent numbers under the recommended option would be *allocated*, which requires naming the allocator and its exhaustion/reuse behaviour. Undecided.
3. **Collision prevention.** If disjoint ranges are chosen, the reserved range must be recorded, and a durable obligation attaches: any future widening of `customer_receiving_numbers.source` beyond `PHONE_NSN` must honour the reservation.
4. **Nigerian phone derivation applicability.** ADR-0093 §13.6 proposes it does **not** apply to Agents, precisely so an agent's number cannot collide with the number derived from the same human's customer phone. Requires ratification.

**No number infrastructure is modified.** **No range value is invented.**

**Blocking?** **Conditionally.** The number determines a uniqueness strategy and a `CHECK` constraint, so it blocks the Agent *number* deliverable. It does **not** block Agent identity or Agent wallet/ledger binding. The owner should either ratify a range or explicitly descope Agent numbers from the first implementation task — see §9.

### C4 — Customer → Agent transfer (ADR-0093 O6)

**Does the current V1 specification establish `Customer wallet → Agent wallet` as a supported direct transfer capability?** **No — nothing in the repository establishes it.** A content search across all documentation returns no statement authorizing a customer-to-agent wallet transfer. `CustomerTransferDestinationType` exists (`WALLET_ACCOUNT`, `MONIENAIJA_NUMBER`, `PHONE`) but every resolution path terminates on a customer. **This must not be inferred merely because Agents will have wallets and numbers** — that inference is explicitly rejected.

**Therefore: product decision.** It is also functionally downstream — Cash→Wallet and Wallet→Cash are dependency steps 6 and 7.

**Blocking?** **No.** Not implemented, not designed, not in scope.

---

## 7. Decisions already settled — do not reopen

The following are settled and must not be re-litigated during implementation. "V1 scope" below means the authoritative task-instruction scope; see RES-G2 for why it is not repository-citable.

| # | Settled decision | Basis | Repository corroboration |
| --- | --- | --- | --- |
| 1 | Agent is a first-class V1 participant | V1 scope | **Discrepancy — see §4.** Four in-repo statements place Agent behind B5; none has been amended. Flagged, not silently changed. |
| 2 | Agent is **not** `Customer + agent flag` | V1 scope; ADR-0093 §22 | Corroborated: `CustomerType` is `INDIVIDUAL \| BUSINESS`, no agent flag exists. |
| 3 | Agent has separate identity | ADR-0093 §8 | No Agent identity exists yet (to be built). |
| 4 | Agent has separate wallet / account ownership | ADR-0093 §6, §9, §14 | Option B ratified in ADR-0093; substrate reused unmodified. |
| 5 | Agent has separate authentication | ADR-0093 §12 | Customer credential table is FK-bound to `customers`; structurally unavailable to Agent. |
| 6 | Agent has separate transaction PIN | ADR-0093 §12 | Customer PIN is `credential_type='PIN'` on the customer credential table. |
| 7 | Agent has separate permissions / limits | ADR-0093 §14 | `customer_limit_profiles`, `customer_operating_permissions`, `customer_restrictions` are all `customer_id`-bound. Agent equivalents are a later task. |
| 8 | Agent has separate transaction history | ADR-0093 §14 | Existing history is customer-scoped. |
| 9 | Agent electronic balance can never be negative | V1 scope; ADR-0093 §10 A1 | Mechanism exists: `ledger_accounts.allow_negative_balance` already defaults to `FALSE`. Finance confirmation requested as B2(4), which cannot weaken the V1 requirement. |
| 10 | Physical cash is not electronic balance | V1 scope; ADR-0093 §10 A2 | No cash-position field exists or is introduced. |
| 11 | Existing ledger remains the financial authority | ADR-0093 §10 A3; ADR-0004 | Corroborated: `B2-FINANCE-PLATFORM-BOUNDARY.md` §3.1 — "A5 Ledger remains the sole monetary/value authority". |
| 12 | Existing Customer architecture remains isolated | ADR-0093 §16 | Nine explicit must-not-change items. |
| 13 | Existing W→W implementation remains untouched | ADR-0093 §16.6 | Real-PG proven; not modified. |

Item 1 is the only discrepancy, and it is the subject of §4. Items 2–13 are consistent with both the V1 scope and the repository.

---

## 8. Blocking vs non-blocking

### Blocking for `V1-AGENT-IDENTITY-WALLET`

| ID | Decision | Owner class | Blocks |
| --- | --- | --- | --- |
| **G1** | Agent V1 ownership/governance reconciliation (§4.3–4.5), including a roadmap task code and an answer on whether `roadmap.md:42` gates Agent backend work | governance / owner approval | The entire task. `roadmap.md` rule 11 (fail-closed stop) applies until answered. |
| **G2** | Commit the authoritative V1 scope to the repository (§3) | governance / owner approval | Review and verification of the task; strictly it blocks *acceptance* rather than *coding*, but it should be done with G1. |
| **B1** | Agent float accounting unit | Finance / B2F | Agent `ledger_accounts` creation, Agent wallet provisioning, the binding `CHECK`. |
| **B2** | Agent float liability classification | Finance / B2F | Same as B1 — `account_type` and `normal_balance` are immutable at creation. |
| **B3** | Chart classification and A5 mapping treatment | Finance / B2F + A2 privileged approval | The **first Agent journal posting**. Not identity; arguably not account creation, but accounts that cannot be mapped should not be created without an explicit owner choice. |
| **C3** | Agent MonieNaija number strategy — *only if numbers are in scope for this task* | product | The Agent number deliverable only. Descopable — see §9. |

### Non-blocking (must not hold up implementation)

| ID | Decision | Owner class | Needed by |
| --- | --- | --- | --- |
| **C1** | Agent Code format | product | Agent authentication task (step 2). |
| **C2** | Agent PIN policy values; Agent MFA requirement | product / security | Agent authentication task (step 2). |
| **C4** | Customer→Agent transfer eligibility | product | Cash→Wallet / Wallet→Cash tasks (steps 6–7). |

### Explicitly **not** required for Agent identity/wallet

Per the instruction not to require irrelevant Finance or Commercial decisions, the following are **excluded from the gate**:

- Agent commission model, rates, accrual, eligibility and settlement (B1/Commercial) — needed for commissions, not for identity or wallet.
- Agent fees and who bears them (B1/Commercial).
- Agent classes, KYC requirements, onboarding workflow and approval authority (B5 / later task).
- Outlets, terminals, Aggregator, transfer codes, redemption, expiry.

---

## 9. Exact implementation gate for `V1-AGENT-IDENTITY-WALLET`

> **READY only when all of the following are true:**
>
> 1. **G1 resolved** — the Agent V1 ownership/governance conflict is reconciled by an owner: A1–A5 in §4.3 ratified, the four amendments in §4.4 recorded, `roadmap.md:42` clarified as to whether it gates Agent backend work, and a roadmap task code allocated per `roadmap.md` rule 8.
> 2. **G2 resolved** — the authoritative V1 scope statement is committed to the repository.
> 3. **B1 resolved** — the Agent float accounting unit is decided by Finance and recorded.
> 4. **B2 resolved** — the liability classification is decided by Finance, fixing `account_type`, `normal_balance`, pool membership, and confirming `allow_negative_balance = FALSE`.
> 5. **B3 resolved** — the chart classification and A5 mapping treatment are decided, including the approval path given that B2F06 is not implemented.
> 6. **C3 resolved or explicitly descoped** — either the Agent number strategy is ratified, or Agent MonieNaija numbers are formally removed from this task's scope.
>
> C1, C2 and C4 are **not** part of this gate and must not delay it.

### Optional staged gate

If the owner wishes to make progress while Finance deliberates, the work divides cleanly along the boundary Finance actually controls:

| Stage | Deliverable | Requires |
| --- | --- | --- |
| **1** | Agent canonical identity only — `agents` table, Agent aggregate, no financial account | G1, G2 |
| **2** | Agent wallet, binding, and Agent `ledger_accounts` | Stage 1 + B1 + B2 |
| **3** | First Agent journal posting | Stage 2 + B3 |
| **4** | Agent MonieNaija number | Stage 1 + C3 |

Stage 1 is genuinely useful, carries no accounting commitment, and creates nothing immutable. Stage 2 is where the irreversible ledger values are written, which is why B1/B2 gate it and nothing earlier.

---

## 10. Ownership of each unresolved decision

| ID | Decision | Owner | Classification |
| --- | --- | --- | --- |
| G1 | Agent V1 ownership reconciliation, roadmap amendments, task code | Roadmap / platform governance owner (operator) | governance / owner approval |
| G2 | Commit V1 scope to repository | Product + governance owner | governance / owner approval |
| B1 | Accounting unit | Finance / accounting-policy authority, via B2F | finance |
| B2 | Liability classification | Finance / accounting-policy authority (regulatory input as Finance requires) | finance / regulatory |
| B3 | Chart classification + A5 mapping, and approval path absent B2F06 | Finance / B2F, plus A2 privileged approval for activation | finance |
| C1 | Agent Code format | Product | product |
| C2 | Agent PIN values; Agent MFA | Product + Security | product / security |
| C3 | Agent number strategy, range, allocation authority | Product, with Architecture for the collision mechanism | product (+ technical) |
| C4 | Customer→Agent transfer eligibility | Product | product |

Arena owns none of these.

---

## 11. Consequences of each unresolved decision

| ID | If it is guessed rather than decided |
| --- | --- |
| **G1** | An Agent financial domain is built against four unamended governance statements assigning it to B5, and in apparent breach of `roadmap.md:42`. Ownership is later disputed over tables that by then hold live balances. `roadmap.md` rule 11 requires a stop, not a judgement call. |
| **G2** | Nothing verifiable to review the implementation against; every future scope dispute reopens from zero. |
| **B1** | `accounting_unit` is immutable at creation and cannot be remapped (`B2F-CHART-CLASSIFICATION-CONTRACT.md:112`). A wrong value is corrected only by creating new ledger accounts and migrating balances. Defaulting to `CUSTOMER_FUNDS` silently asserts agent float is customer funds — a Finance statement made by a developer. |
| **B2** | `account_type` and `normal_balance` are likewise immutable. A wrong classification misstates a liability in the trial balance and every downstream finance output, and is a finance correction rather than a schema fix. |
| **B3** | Agent journals cannot be classified or mapped; postings either fail or land unmapped, which the B2F mapping/drift reconciliation is designed to surface as a defect. |
| **C1** | An invented Agent Code becomes a de-facto identifier that is hard to change once agents are enrolled and it is printed on anything. |
| **C2** | Invented PIN values become the security posture by accident; an unnecessary MFA channel may be introduced against the standing constraint. |
| **C3** | An agent and a customer can be issued the same 10-digit number. Because customer numbers derive from phone NSNs and agent operators are commonly also customers, this is likely rather than theoretical, and it is a correctness *and* security defect in recipient resolution. |
| **C4** | A money-movement capability ships without product authorization, on the unstated inference that having a wallet implies being sendable-to. |

---

## 12. Required next action

1. **Operator notification (immediate).** `roadmap.md` rule 11 requires a fail-closed stop when a proposed task conflicts with `roadmap.md` or an accepted ADR. `V1-AGENT-IDENTITY-WALLET` conflicts with S4 and, on its face, with S5. This document is that notification. **Implementation must not begin on Arena's own judgement.**
2. **Owner: resolve G1** via an owner-authorized reconciliation task with a roadmap code, following the B2R01 precedent — a documentation-only reconciliation with a transition decision and contradiction register, not in-place edits.
3. **Owner: resolve G2** by committing the authoritative V1 scope statement.
4. **Finance: resolve B1, B2, then B3**, in that order — B3 cannot be drafted before B2, and B2 cannot be settled without B1's unit.
5. **Product: resolve C3**, or descope Agent numbers from the first implementation task.
6. **Then, and only then**, begin `V1-AGENT-IDENTITY-WALLET` against ADR-0093, or begin Stage 1 of the staged gate in §9 if the owner authorizes partial progress after G1 and G2 alone.
7. **Product, in parallel and off the critical path:** C1, C2 and C4 ahead of the Agent authentication and cash-transfer tasks respectively.

No decision in this document has been resolved by Arena.
