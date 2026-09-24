# ADR-0093 — V1 Agent Identity and Financial Ownership Architecture

- **Task:** V1-AGENT-IDENTITY-DECISION — Agent Identity and Financial Ownership Architecture Decision
- **Owner:** V1 Platform Architecture
- **Contributing owners:** A2 Runtime Identity & Access, A3 Binding, A5 Ledger, B2F Finance, B1 Commercial, B5 Merchant Platform
- **Status:** Proposed — technical decisions ready for review; blocked on Finance/B2F accounting approval, Commercial/B1 commission scope, and a roadmap-ownership amendment (see §20)
- **Supersedes:** None
- **Related decisions:** [ADR-0021](ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md), [ADR-0023](ADR-0023-Customer-Identifier-and-Reference-Conventions.md), [ADR-0031](ADR-0031-Customer-to-Financial-Account-Identity-Binding.md), [ADR-0032](ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md), [ADR-0033](ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md), [ADR-0075](ADR-0075-B2-Merchant-Agent-Activation-Readiness.md), [ADR-0084](ADR-0084-B2-Finance-Chart-Classification-and-A5-Account-Mapping.md), [ADR-0092](ADR-0092-A2-Workforce-and-Privileged-Authentication.md)
- **Implementation status:** Documentation-only decision. No entity, migration, table, service, controller, API, enum, or runtime behaviour is introduced or modified by this ADR.

---

## 1. Status

**Proposed.**

Sections 8, 9, 11, 12, 13, 14, 15, 16 and 17 are technical decisions that this ADR resolves and that the follow-on implementation task may execute once this ADR is accepted.

Section 10 (accounting model) is **deliberately not decided here**. It requires B2F/Finance approval and is recorded as a blocker in §20. The implementation task must not proceed past the point where an accounting unit and liability classification are required until Finance has ruled.

Section 20 additionally records a **governance conflict** between the authoritative roadmap and the V1 scope statement that produced this task. That conflict must be resolved by the roadmap owner before implementation.

---

## 2. Context

The `V1-AGENT-IDENTITY-WALLET-AUDIT` established, against HEAD `926ea1c93b57113351188a56630c423f45419f11`, that Agent does not exist as a runtime domain:

- There is no `src/agent/`, no Agent entity, repository, service, controller, guard, API route, or Agent App.
- Of the 119 tables created by `src/migrations/*.ts`, none is an Agent identity or Agent wallet table.
- `AuthorizationPrincipalType` is `CUSTOMER | SUPPORT | OPERATOR | SERVICE | PRIVILEGED` — there is no Agent principal.
- Agent is **not** modelled as `Customer + agent flag` either: `CustomerType` is `INDIVIDUAL | BUSINESS`, `CustomerWalletType` is `PRIMARY | SAVINGS | BUSINESS | ESCROW`, and no agent boolean exists anywhere. The ground is empty, not wrong.

Two existing artifacts are frequently mistaken for an Agent and are **not** one:

1. **`b2_agent_activation_readiness`** (migration `1785753600040`, ADR-0075). This is a read-only activation-readiness attestation. Its `agent_id` is `VARCHAR(64)` with no foreign key to anything, because no agent table exists. Its own service header states that it "never activates a merchant or an agent, never creates a public API, never creates a credential, never posts a ledger entry". It exposes no controller.
2. **`CASH_AGENT`** in `customer-funding-instrument.enums.ts` and `customer-beneficiary.enums.ts`. This is a *counterparty category* describing where a customer funds from or sends to. It is not a participant identity.

The whole customer financial identity chain is bound to `customers` by enforced foreign key:

| Table | Binding to `customers` |
| --- | --- |
| `customer_wallets` | `customer_id UUID → customers(id)` |
| `customer_financial_account_bindings` | FKs to `customers(id)`, `customer_wallets(id, customer_id)`, `wallet_accounts(id, ledger_account_id)`, `ledger_accounts(id)` |
| `customer_receiving_numbers` | `customer_id → customers(id)` **and** `wallet_id → customer_wallets(id)` |
| `customer_authentication_credentials` | `customer_id → customers(id)` (the transaction PIN is `credential_type = 'PIN'` on this table, added by migration `1785753600054`) |
| `customer_limit_profiles`, `customer_operating_permissions`, `customer_restrictions` | `customer_id UUID` |

The consequence is structural: **an Agent cannot obtain a wallet, a binding, a MonieNaija number, a credential or a PIN today without being a row in `customers`**, which the V1 requirement forbids.

One layer is already participant-agnostic and is the foundation this ADR builds on:

```
wallet_accounts (
  id UUID PK,
  customer_id VARCHAR(160) NOT NULL,   -- no FK to customers
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) ...,
  ledger_account_id UUID NOT NULL,     -- FK → ledger_accounts(id)
  UNIQUE (customer_id, currency),
  UNIQUE (ledger_account_id)
)

ledger_accounts (
  ...,
  accounting_unit VARCHAR(64) NOT NULL DEFAULT 'CUSTOMER_FUNDS',
  allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
  ...
)
```

`wallet_accounts.customer_id` has **no foreign key** and `ledger_accounts` already supports a per-account non-negative-balance invariant and a free-form accounting unit. The A5 substrate therefore does not need to be redesigned to carry an Agent balance.

---

## 3. V1 requirements

The authoritative V1 scope statement for this work is:

> Agent is a **first-class V1 participant**. Agent is **NOT** `Customer + agent flag`.

An Agent must have its own: identity, wallet, MonieNaija number, electronic balance, authentication, transaction PIN, permissions, limits, services, commissions, and transaction history.

Two invariants are stated as non-negotiable:

- **R1.** Agent electronic balance must never be negative.
- **R2.** Physical cash held by an Agent is not electronic wallet balance and must never appear as one.

And one architectural constraint:

- **R3.** Existing ledger, wallet, binding, audit and idempotency infrastructure must be reused where architecturally appropriate. No second ledger architecture and no parallel balance system may be created.

---

## 4. Problem statement

Introducing a first-class Agent requires answering one question that everything else depends on:

> **Who may own a financial account?**

Today the answer encoded in the schema is "a Customer, and only a Customer" — enforced by foreign keys, by the `CHECK (accounting_unit = 'CUSTOMER_FUNDS')` constraint on `customer_financial_account_bindings`, and by the customer-centric shape of `AuthorizationPrincipal`.

Every other Agent question (number, PIN, limits, commission, cash-in/cash-out) is downstream of that answer. If ownership is decided badly, it must be re-decided later with live customer money in the tables. This ADR exists so that the ownership decision is made once, explicitly, and reviewed before any migration is written.

A secondary problem is **namespace collision**. `customer_receiving_numbers` carries a globally unique index on the 10-digit number, but that index is *table-scoped*:

```
CREATE UNIQUE INDEX uq_customer_receiving_numbers_number
  ON customer_receiving_numbers (number);
```

Numbers are derived from the Nigerian phone NSN (`source = 'PHONE_NSN'`). A naive parallel agent number table would therefore have **no protection at all** against issuing an agent the same 10 digits already issued to a customer — and because an agent operator is very often also a customer with the same phone, that collision is likely rather than theoretical.

---

## 5. Options considered

### Option A — Generalize the existing ownership model

Add an `owner_type` discriminator (`CUSTOMER | AGENT | …`) to the existing `customer_wallets`, `customer_financial_account_bindings` and `customer_receiving_numbers` tables, replacing their customer foreign keys with polymorphic owner references, while keeping the `WalletAccount → LedgerAccount` substrate unchanged.

### Option B — Participant-scoped structures over the shared substrate

Introduce Agent-owned tables that mirror the proven customer shape and terminate on the same shared substrate:

```
agents
  → agent_wallets
    → agent_financial_account_bindings
      → wallet_accounts   (existing, shared)
        → ledger_accounts (existing, shared)
```

Customer tables are not touched.

### Comparison

| Criterion | Option A — generalize | Option B — participant-scoped |
| --- | --- | --- |
| **Migration complexity** | High. Must drop `customer_wallets.customer_id → customers(id)`, the composite FK `(customer_wallet_id, customer_id)` on the binding table, and both FKs on `customer_receiving_numbers`, then backfill `owner_type = 'CUSTOMER'` across live financial rows. | Low. Purely additive: new tables with their own FKs. No customer row is read or rewritten. |
| **Backward compatibility** | Weak. Existing A3 binding semantics (ADR-0031/0033) and the `CHECK (accounting_unit = 'CUSTOMER_FUNDS')` invariant must be relaxed on a live financial table. | Strong. Every existing constraint, invariant and test remains literally unchanged. |
| **Customer isolation** | **Degraded.** PostgreSQL cannot enforce a polymorphic foreign key. Isolation that is DB-enforced today becomes application-enforced. | **Preserved and strengthened.** `customer_wallets.customer_id → customers(id)` survives; `agent_wallets.agent_id → agents(id)` is equally enforced. |
| **Agent isolation** | Depends entirely on every query remembering an `owner_type` predicate. One omission is a cross-participant data leak. | Structural. An agent row physically cannot reference a customer, and vice versa. |
| **Future Aggregator support** | Adding `AGGREGATOR` to the discriminator is cheap, but every aggregator-specific attribute must then live in a nullable column on a shared table, or in a side table anyway. | Same shape repeats: `aggregators → aggregator_wallets → aggregator_financial_account_bindings → wallet_accounts`. No ownership rewrite. |
| **Ledger reuse** | Full. | Full. Identical — both terminate on the same `wallet_accounts → ledger_accounts` pair. |
| **Receiving-number reuse** | Reuses one table, but see §13: the collision problem is solved by the shared table only if customer rows are migrated into it. | Requires an explicit collision strategy (§13). This is the one criterion where Option A is genuinely simpler. |
| **Authorization** | Tempts implementers to reuse `customerAccess: SELF` for agents, which would silently grant agent principals access to customer-scoped policies. | Forces an explicit, separate access scope — fail-closed by construction. |
| **Query complexity** | Every existing customer query must gain an `owner_type = 'CUSTOMER'` predicate. ~All existing customer financial queries become unsafe-by-default. | Queries stay single-participant and unchanged. Cross-participant reporting needs a union, which is explicit and reviewable. |
| **Auditability** | Harder. Audit records over a polymorphic owner need type-plus-id everywhere; historical rows have no type until backfilled. | Straightforward. Owner type is implied by the table; existing audit/outbox/idempotency infrastructure applies unchanged. |
| **New participant types** | Supported by enum extension. | Supported by table addition following a now-proven template. |
| **Risk of contaminating customer semantics** | **High.** This is the decisive risk: the change is performed on tables that currently hold live customer money bindings, and it weakens their enforced invariants for the benefit of a participant type that has zero rows. | **Negligible.** Customer semantics are untouched by construction. |

Table count is deliberately excluded as a criterion. Option B costs more tables; that is not a reason to prefer or reject it.

---

## 6. Decision

**Adopt Option B, with one additive discriminator on the shared substrate.**

1. Agent is a first-class domain aggregate with its own canonical identity (`agents`).
2. Agent financial ownership is expressed by Agent-owned tables (`agent_wallets`, `agent_financial_account_bindings`) that terminate on the **existing, unmodified** `wallet_accounts → ledger_accounts` substrate.
3. The existing customer chain — `customers → customer_wallets → customer_financial_account_bindings → wallet_accounts → ledger_accounts` — is not altered, relaxed, generalized or backfilled.
4. One **additive** column, `owner_type VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER'`, is added to `wallet_accounts` so that the shared substrate can state which participant type an account belongs to. The existing `customer_id` column is retained under its current name and continues to hold the owner reference; the existing `UNIQUE (customer_id, currency)` constraint is retained unchanged, because UUID namespaces do not collide.
5. Agent balance authority is `LedgerService` alone. No second balance representation is introduced.
6. Agent authorization, authentication, PIN and receiving numbers are Agent-scoped and are never satisfied by customer records.

The rationale for (4) rather than a rename: renaming `customer_id` or changing its unique constraint would rewrite a live financial table for cosmetic benefit. Adding a defaulted discriminator is backward compatible, requires no backfill, makes "all customer wallet accounts" queryable safely, and makes an agent account impossible to mistake for a customer account in audit and reconciliation output.

---

## 7. Detailed architecture

```
                      ┌────────────────────────────┐
  customers ─────────▶│ customer_wallets           │─┐
      │               └────────────────────────────┘ │
      │               ┌────────────────────────────┐ │
      └──────────────▶│ customer_financial_account │─┤
                      │ _bindings                  │ │
                      └────────────────────────────┘ │
                                                     ├──▶ wallet_accounts ──▶ ledger_accounts
                      ┌────────────────────────────┐ │    (shared, additive     (shared,
  agents ────────────▶│ agent_wallets              │─┤     owner_type only)      unchanged)
      │               └────────────────────────────┘ │
      │               ┌────────────────────────────┐ │
      └──────────────▶│ agent_financial_account    │─┘
                      │ _bindings                  │
                      └────────────────────────────┘
```

Both participants converge on the same ledger. Neither can reach the other's identity, wallet, binding, credential or number tables. Convergence happens only at the substrate, where money actually lives.

---

## 8. Agent identity model (Decision 1)

1. **Agent is a first-class domain aggregate**, distinct from Customer, with its own bounded context (`agent`) owning its own tables per ADR-0001.
2. **Agent has its own UUID identity namespace.** `Agent.id UUID` is canonical and is generated by the Agent domain. It follows ADR-0023 identifier conventions; it is never an alias, never a phone number, and never a MonieNaija number.
3. **Agent identity is not derived from a Customer record.** No `Agent.id` is computed from, defaulted to, or made equal to a `Customer.id`.
4. **The B2 readiness `agent_id` remains a cohort/readiness reference.** `b2_agent_activation_readiness.agent_id` stays `VARCHAR(64)` with no foreign key and does not become canonical Agent identity. When the Agent domain exists, that field may *reference* an `Agent.id` value by convention, but ADR-0075's attestation record remains a decision *about* an agent, never the agent. No migration retro-fits a foreign key onto it.
5. **Optional Customer association.** The following are decided:

   | Question | Decision |
   | --- | --- |
   | Is an Agent↔Customer relationship required? | **No. It is optional.** Modelled as a nullable `agents.operator_customer_id UUID NULL REFERENCES customers(id) ON DELETE RESTRICT`, for traceability only. |
   | Is Customer authoritative for Agent identity? | **No.** The Customer reference is a trace. It confers no identity, no wallet, no number, no credential and no permission on the Agent. This matches `docs/B2-MERCHANT-AGENT-ONBOARDING-CONTRACT.md` §4.1, which states the customer trace is "never a second canonical identity". |
   | Can an Agent exist without a Customer? | **Yes.** `operator_customer_id` is nullable and the Agent aggregate is complete without it. |
   | Can one Customer have multiple Agents? | **Yes.** No unique constraint is placed on `operator_customer_id`. A person operating two agent outlets is two Agents. |
   | Does Customer deletion/suspension affect Agent identity? | **No.** Agent status is owned solely by the Agent domain. `ON DELETE RESTRICT` prevents a customer row from disappearing under a live trace, but a suspended or closed Customer does **not** suspend or close the Agent, and Agent status transitions are never driven by Customer status. If V1 later wants propagation, it must be an explicit, separately approved policy — it is not implied by this ADR. |

6. **Agent lifecycle status** is Agent-owned (`agents.status`). This ADR fixes only that the column exists and is Agent-authoritative. The status *values*, the application/approval workflow, and Agent classes belong to the later Agent-lifecycle task and are **not** decided here.

> **Not decided here, and must not be invented by the implementation task:** Agent classes, Agent KYC requirements, Agent onboarding workflow, Agent approval authority, Agent tiering.

---

## 9. Financial ownership model (Decision 2)

Per §6, Option B is adopted.

**`agent_wallets`** — the Agent-domain provisioning record, mirroring `customer_wallets`:

- `agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT`
- currency, wallet type, status, metadata version, optimistic `version`
- one active primary wallet per Agent per currency, enforced by a partial unique index

**`agent_financial_account_bindings`** — the A3-equivalent binding, mirroring `customer_financial_account_bindings`:

- `agent_id UUID → agents(id)`
- `agent_wallet_id UUID → agent_wallets(id)` with `UNIQUE (agent_wallet_id)`
- `wallet_account_id UUID → wallet_accounts(id)` with `UNIQUE (wallet_account_id)`
- `ledger_account_id UUID → ledger_accounts(id)`
- `state` in the existing vocabulary `PENDING | ACTIVE | SUSPENDED | REPAIR_REQUIRED | CLOSED`
- source-version columns and correlation columns following the customer binding precedent
- an `accounting_unit` column whose `CHECK` value is **left open pending §10 / §20-F1**

**Ownership and lifecycle authority** follows ADR-0033's pattern, extended by analogy rather than by amendment:

| Concept | Authoritative owner |
| --- | --- |
| Agent identity and lifecycle | `agent` |
| Agent-wallet provisioning | `agent-wallet` |
| Financial wallet facade | `wallet` (unchanged) |
| Ledger account and balance | `ledger` (unchanged) |
| Agent binding association | `wallet` A3 account-binding capability, Agent edge |

No domain may write another domain's source rows. The binding may not mutate `agents`, `agent_wallets`, `wallet_accounts`, `ledger_accounts`, journals, lines or balances.

**The single change to shared infrastructure** is the additive `wallet_accounts.owner_type` column described in §6(4). Nothing else in `wallet_accounts` or `ledger_accounts` changes: no FK is added, no existing constraint is dropped, no unique constraint is redefined, no column is renamed.

---

## 10. Accounting model (Decision 3) — **partially blocked**

### Decided here (technical, no accounting judgement required)

- **A1. Agent electronic balance must never be negative.** Enforced at the source by `ledger_accounts.allow_negative_balance = FALSE` on every Agent float account. This column already exists and already defaults to `FALSE`; no ledger change is required. The invariant is a database-level property of the account, not an application check.
- **A2. Physical cash is not ledger balance.** Cash held in an Agent's drawer is never represented in `ledger_accounts` as Agent electronic balance. No cash-position field, column or table is introduced by the Agent identity/wallet work. Cash-position tracking, if it is ever wanted, is a separate domain with separate approval, and it is explicitly out of scope of this ADR.
- **A3. The existing ledger is the sole balance authority.** Agent balance is read through `LedgerService`. No cached balance column, no `agent_wallets.balance`, no derived balance table, and no second balance system of any kind.
- **A4. Agent float movements are journal-backed.** Every change to Agent electronic balance is a balanced journal posted through the existing A5 posting path, with existing idempotency and audit behaviour.

### Not decided here — requires B2F/Finance approval

- **F1. Accounting unit.** Whether Agent e-float sits in the existing `CUSTOMER_FUNDS` accounting unit or in a distinct unit (for example an `AGENT_FLOAT` unit) is a Finance decision. Both are *representable* today: `ledger_accounts.accounting_unit` is `VARCHAR(64)` with a permissive pattern check. The choice is not technical, and this ADR does not make it.
- **F2. Liability classification.** Whether Agent e-float is an e-money/customer-funds liability to the agent, or another approved classification, is a Finance/regulatory determination. This ADR does **not** assert a classification.
- **F3. Chart-of-accounts mapping.** Agent float accounts require a B2F chart classification and an A5 account mapping under ADR-0084 before any Agent journal can be posted.

**Consequence of the block:** the implementation task may create Agent identity, Agent wallet provisioning and the Agent binding structure, but it **must not choose an accounting unit or post a first Agent journal** until F1–F3 are ruled. The `accounting_unit` CHECK constraint on `agent_financial_account_bindings` is the concrete line: it cannot be written correctly without the Finance answer. Guessing `CUSTOMER_FUNDS` because it is the default would be exactly the invented accounting treatment this ADR forbids.

---

## 11. Authorization model (Decision 4)

1. **`AuthorizationPrincipalType` gains `AGENT`.** Decided in principle; **not implemented by this ADR**.
2. **A new, separate access scope.** `AuthorizationPrincipal` gains an optional `agentId?: string` and a dedicated `agentAccess: 'NONE' | 'SELF'` scope. The existing `customerId` / `customerAccess` fields are **not** reused for agents.

   This is the most important security decision in this ADR. If an agent principal were expressed as `customerAccess: 'SELF'` with an agent id in `customerId`, then every existing policy that admits `customerAccess: 'SELF'` would silently admit agents. A separate field means existing customer policies reject agent principals by construction.
3. **Default deny.** Adding `AGENT` to the union must not make it implicitly acceptable anywhere. Every action that an Agent may perform must name `AGENT` explicitly in its `allowedPrincipalTypes`. Actions that do not name it continue to reject agent principals.
4. **Agent access to its own wallet** is enforced by requiring `agentAccess === 'SELF'` **and** `principal.agentId === <owning agent id resolved from the agent binding>`. Ownership is resolved from `agent_financial_account_bindings`, never from a client-supplied value.
5. **An Agent can never act as a Customer.** There is no escalation, impersonation or dual-principal path. An agent principal carries `customerAccess: 'NONE'` and no `customerId`. This mirrors ADR-0092's rule that customer sessions cannot cross into workforce sessions.
6. **Isolation from Workforce and Privileged principals** is preserved: agent sessions are issued by the Agent authentication surface with their own audience, and are not accepted by workforce or privileged ingress, nor those by agent ingress.
7. **Future Aggregator principals** extend the same pattern — a new principal type plus its own `aggregatorId` / `aggregatorAccess` pair. No redesign of the principal model is required, because the model is additive in exactly this dimension.

---

## 12. Authentication model (Decision 5)

Reuse the existing security patterns; do not modify them.

| Concern | Decision |
| --- | --- |
| **Login identity** | A system-issued **Agent Code**, not a phone number and not an email. Rationale: an agent operator's phone may already identify a Customer, and reusing it as a login identity would couple two participants at the authentication layer. *(Recommended and decided technically; the human-facing format of the Agent Code is a product confirmation — see §20-O3.)* |
| **Credential storage** | A separate `agent_authentication_credentials` table, FK to `agents(id)`, mirroring `customer_authentication_credentials` (hash, algorithm, version, status, failed count, lock state, optimistic version). Agent credentials are never rows in the customer credential table. |
| **Transaction PIN** | A separate credential of `credential_type = 'PIN'` **in the Agent credential table**, following exactly the customer precedent established by migration `1785753600054`. Agent PIN ≠ Customer PIN even for the same human being. |
| **PIN hashing** | Reuse `PinHashService` unchanged — PBKDF2 with the configured iteration count. The PIN is never stored, logged, echoed or forwarded in plaintext, and never leaves the verification boundary. |
| **PIN policy** | Reuse the existing configurable `TRANSACTION_PIN_SECURITY_POLICY` (`PIN_MIN_LENGTH`, `PIN_MAX_LENGTH`, `PIN_MAX_FAILED_ATTEMPTS` and the validated `PIN_POLICY_BOUNDS`). Whether Agents get their *own* policy values or share the customer values is an open product question (§20-O4); the mechanism is reused either way. |
| **Login vs transaction authorization** | Strictly separated, as for customers. Session authentication establishes *who*; the PIN is a step-up factor verified immediately before money movement and is never sufficient to establish a session. |
| **Session/token model** | Short-lived, hashed, audience-bound, revocable Agent sessions in an `agent_sessions` table, following the ADR-0092 workforce-session pattern. Agent sessions are not customer sessions and are not workforce sessions. |
| **Password reset** | Reuse the existing customer reset state machine's shape, scoped to Agent. No SMS or email OTP is introduced. |
| **MFA** | Not required by this ADR. If V1 requires Agent MFA it must reuse the existing MFA scaffolding; no new channel (SMS/email OTP) may be introduced. Open — §20-O4. |

---

## 13. MonieNaija number model (Decision 6)

1. **Yes — an Agent has a unique primary MonieNaija number.** It is a 10-digit number in the same *format* as a customer receiving number.
2. **It shares the global 10-digit namespace.** Two participants must never hold the same number; a number must resolve to exactly one destination platform-wide.
3. **Collision prevention — this is the hard part.** The existing uniqueness guarantee is a *table-scoped* index (`uq_customer_receiving_numbers_number`). A second table gets no protection from it. Two mechanisms can give a genuine global guarantee:

   - **(i) Disjoint allocation ranges — recommended.** Customer numbers are derived exclusively from the Nigerian phone NSN (`source = 'PHONE_NSN'`, `CHECK (number ~ '^[0-9]{10}$')`). Nigerian mobile NSNs occupy a known leading-digit space. Allocating Agent numbers from a leading-digit range that can never be a Nigerian mobile NSN makes collision *structurally impossible*, enforced by a `CHECK` constraint on each table independently, with no shared table and no customer migration.

     This carries one durable obligation, which must be recorded wherever the numbering plan lives: **any future non-phone-derived customer number source must respect the reserved Agent range.** Today `customer_receiving_numbers.source` is constrained to `PHONE_NSN` only, so the guarantee holds; if that CHECK is ever widened, the range reservation must be honoured in the same migration.

   - **(ii) A shared number registry.** A `monienaija_number_registry` table owning the namespace, with both participants' number tables referencing it. This is the cleanest long-term model, but it requires migrating live customer receiving numbers into a new table — precisely the customer-side disruption Option B was chosen to avoid. Recorded as the preferred *eventual* model if a third numbered participant appears.

   **Recommendation: (i) for V1**, with (ii) as the documented evolution path.
4. **Agent gets a parallel registry, not a generalized customer table.** `agent_receiving_numbers`, FK to `agents(id)` and `agent_wallets(id)`, mirroring the customer table's status/version/issuance shape, plus its own global unique index on `number` and a range CHECK per (3)(i). `customer_receiving_numbers` is not altered.
5. **Agent numbers are eligible as transfer destinations.** `CustomerTransferDestinationType.MONIENAIJA_NUMBER` already exists; recipient resolution must be extended to resolve a number to either a customer or an agent destination, returning a typed, explicit result. *Whether V1 actually permits a Customer→Agent wallet transfer is a separate product decision belonging to the Cash→Wallet / Wallet→Cash tasks* — this ADR only establishes that the identity model does not prevent it and that resolution must be unambiguous.
6. **Nigerian-phone derivation does not apply to Agents.** Under (3)(i) Agent numbers are allocated, not derived, precisely so that they cannot collide with a phone-derived customer number. The canonical Nigerian phone handling already in the platform continues to apply to the Agent's *contact* phone, which is a contact detail and not a number source.

---

## 14. Agent wallet model (Decision 7)

| Aspect | Decision |
| --- | --- |
| **Cardinality** | Exactly **one primary Agent wallet** in V1. The schema does not forbid more (the unique index is per agent per currency per active primary), but V1 provisions and exposes one. |
| **Currency** | **NGN only** in V1. |
| **WalletAccount relationship** | Exactly one `wallet_accounts` row per Agent wallet, carrying `owner_type = 'AGENT'`, reached only through the Agent binding. |
| **LedgerAccount relationship** | Exactly one `ledger_accounts` row per wallet account, via the existing `UNIQUE (ledger_account_id)` constraint, with `allow_negative_balance = FALSE`. |
| **Financial binding** | `agent_financial_account_bindings`, one active binding per Agent wallet, states `PENDING \| ACTIVE \| SUSPENDED \| REPAIR_REQUIRED \| CLOSED`, fail-closed when any source is missing, suspended, closed, inactive or dimensionally incompatible. |
| **Balance authority** | `LedgerService` only. |
| **Status / lifecycle** | Agent wallet status is owned by the Agent-wallet domain (`PENDING \| ACTIVE \| SUSPENDED \| CLOSED`). Source states may disagree with binding state without either domain overwriting the other, per ADR-0033. |
| **Limits** | **Not decided here.** Agent limits, permissions and services belong to the later Agent classes/limits task. This ADR only records that they must be Agent-owned tables, never `customer_limit_profiles` rows. |
| **Isolation from CustomerWallet** | Absolute. No shared row, no shared table, no shared credential, no shared number. The only shared objects are `wallet_accounts` and `ledger_accounts`, at the substrate. |

---

## 15. Future compatibility (Decision 8)

None of the following is implemented now. The question answered here is only: *does the chosen architecture support it without another ownership rewrite?*

| Future capability | Supported without ownership rewrite? | Note |
| --- | --- | --- |
| **Outlets** | Yes | An Outlet is a child of an Agent (`outlets.agent_id → agents(id)`). Whether an Outlet holds its own float is a later decision; if it does, it repeats the `→ wallet_accounts` template. |
| **Terminals** | Yes | A Terminal is a child of an Outlet or Agent. Terminals are devices, not participants; they are expected to transact *against* the Agent float rather than own one. |
| **Aggregators** | Yes | `aggregators → aggregator_wallets → aggregator_financial_account_bindings → wallet_accounts`, plus an `AGGREGATOR` principal type with its own access scope. Identical template, zero rewrite. Aggregator funding architecture is explicitly **not** decided here. |
| **Agent classes** | Yes | A class reference on `agents` plus class-scoped limit/permission tables. No ownership change. |
| **Agent commissions** | Yes, structurally | Commission accrual would credit an Agent-owned ledger account through the existing B1 commercial-decision path. **Commission rates, rules and eligibility are B1/Commercial decisions and are not made here.** |
| **Cash→Wallet** | Yes | Agent float debit + customer wallet credit, both already ledger accounts. Requires the §10 accounting ruling first. |
| **Wallet→Cash** | Yes | The inverse. The non-negative invariant on the Agent float account is what makes this safe. |
| **Cash→Cash** | Yes, structurally | Involves reserved/unclaimed funds and redemption, which are separate later tasks with their own accounting decisions. |

The architecture's load-bearing property is that **participant identity is table-scoped while money is substrate-scoped**. Every new participant type is additive; no existing participant is disturbed.

---

## 16. Customer compatibility (Decision 9)

The following **must not change** because Agent is being introduced. An implementation that changes any of them has violated this ADR:

1. **Customer identity remains canonical for Customers.** `customers` is untouched.
2. **`customer_wallets` remains customer-owned**, with `customer_id UUID → customers(id)` intact. No `owner_type` column is added to it.
3. **`customer_financial_account_bindings` semantics remain intact** — including its foreign keys and its `CHECK (accounting_unit = 'CUSTOMER_FUNDS')` constraint.
4. **`customer_receiving_numbers` is not altered** — not its FKs, not its `source` CHECK, not its unique indexes.
5. **The Customer transaction PIN remains customer-specific**, as `credential_type = 'PIN'` on `customer_authentication_credentials`. No Agent shares it.
6. **The Customer Wallet→Wallet path remains untouched** — the A5 gate, the transfer lifecycle, destination typing, recipient resolution, and the replay/idempotency security boundary proven on real PostgreSQL.
7. **Ledger authority remains** with `LedgerService`; journals, lines and balance derivation are unchanged.
8. **Idempotency, audit and outbox infrastructure remains** and is reused, not forked.
9. **A2 and A4 security principles remain** — fail-closed authorization, explicit allowed principal types, no implicit scope widening, and no weakening of any existing policy to accommodate a new principal type.

The only permitted touch to any existing financial object is the single additive `wallet_accounts.owner_type` column of §6(4).

---

## 17. Migration strategy (Decision 10)

High-level only. **No migration code is written by this ADR.**

**Likely new tables:** `agents`, `agent_wallets`, `agent_financial_account_bindings`, `agent_receiving_numbers`, `agent_authentication_credentials`, `agent_sessions`. Plus, later and separately, Agent limits/permissions tables.

**Likely new column:** `wallet_accounts.owner_type VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER'`, with a CHECK over the allowed participant types.

**Additivity.** The migration set is additive. It creates new tables and adds one defaulted column. It drops nothing, renames nothing, and relaxes no existing constraint.

**Existing customers are unaffected.** No customer table is read, written or re-keyed. Every existing FK, CHECK and unique index survives verbatim.

**Existing `wallet_accounts` / `ledger_accounts` records remain valid.** The new column's `DEFAULT 'CUSTOMER'` makes every pre-existing wallet account correct at the instant the column appears. `UNIQUE (customer_id, currency)` is retained, so no existing row is revalidated against a changed constraint.

**Backfill.** None required. The column default *is* the backfill, and it is correct because every wallet account existing before this change is by definition a customer account.

**Ordering.** `agents` → `agent_wallets` → `wallet_accounts.owner_type` → `agent_financial_account_bindings` → auth/number tables. The binding table must come after the discriminator so its FKs and checks can reference the final shape.

**Rollback.** Conceptually clean because nothing is destructive: drop the Agent tables in reverse dependency order, then drop `owner_type`. Rollback is safe **only while no Agent ledger account has been posted to**; once Agent journals exist, the ledger rows are immutable and rollback becomes a Finance-governed correction rather than a schema operation. This is another reason the §10 accounting ruling must precede the first posting.

**Migration-head discipline.** The existing production launch gate validates the migration head; the new migrations must be appended in timestamp order after the current head `1785753600055-WidenReferenceIdentifierColumns.ts`, and any hardcoded expected-migration list in the test harness must be updated in the same change.

---

## 18. Security considerations

- **No shared credential surface.** An Agent authenticating never touches a customer credential row, and vice versa. Compromise of one participant's credential store does not expose the other's.
- **No principal escalation.** `AGENT` is added to the principal union as a *peer*, not a superset, of `CUSTOMER`. The separate `agentAccess` field means no existing customer-scoped policy silently admits agents (§11.2).
- **Ownership is server-resolved.** An Agent's access to a wallet is resolved from `agent_financial_account_bindings`, never from a client-supplied agent id, wallet id or number.
- **PIN handling is unchanged and unweakened.** PBKDF2 via `PinHashService`, never plaintext, never logged, never persisted, verified before money movement, subject to the configured lockout policy.
- **Number resolution must be unambiguous.** Recipient resolution returning a number that could match two participants is a correctness *and* a security defect; the disjoint-range decision of §13(3)(i) removes the possibility at the data layer rather than relying on resolution order.
- **The non-negative invariant is a database property.** `allow_negative_balance = FALSE` on Agent float accounts means an over-withdrawal fails in the ledger, not merely in a service check that could be bypassed by a second code path.
- **No new external channel.** No SMS or email OTP is introduced.

---

## 19. Auditability

- Agent identity, wallet, binding and credential changes reuse the existing immutable audit and security-event infrastructure. `security_event_histories` already carries `PIN_CREATED`, `PIN_CHANGED`, `PIN_VERIFICATION_FAILED` and `PIN_VERIFICATION_SUCCEEDED`; the Agent equivalents follow the same vocabulary rather than inventing a parallel one.
- Every Agent balance change is traceable to a balanced journal with correlation and causation identifiers, exactly as customer movements are.
- `wallet_accounts.owner_type` makes participant type explicit in reconciliation and finance extracts, so an Agent float account can never be silently aggregated into customer-funds reporting.
- The B2 readiness attestation remains a separate, independently auditable record. It is evidence about an agent, and this ADR keeps it that way.

---

## 20. Open decisions requiring B2F / Finance / B1 / Product

### Blocking — Finance / B2F

- **F1. Agent e-float accounting unit.** `CUSTOMER_FUNDS` or a distinct unit? Blocks the `accounting_unit` CHECK on `agent_financial_account_bindings` and the first Agent journal.
- **F2. Liability classification of Agent e-float.** Blocks chart classification.
- **F3. Chart-of-accounts classification and A5 account mapping** for Agent float accounts, under ADR-0084. Blocks any posting.

### Blocking — Commercial / B1

- **C1. Agent commission model** — rates, accrual basis, eligibility, settlement timing. Out of scope of this ADR; must not be inferred from the existing zero-rated B1 commission decision kind.
- **C2. Agent fees** — whether agent-initiated transactions carry fees, and who bears them.

### Blocking — Governance / roadmap owner

- **G1. Roadmap ownership conflict.** `docs/AUTHORITATIVE-PLATFORM-ROADMAP.md` assigns "Merchant and agent lifecycle, merchant capabilities, onboarding, servicing" to **B5 Merchant Platform**, and lists the Agent App as frontend #2 behind a backend-maturity gate. The V1 scope statement driving this task asserts Agent is a first-class V1 participant. These are in direct conflict.

  This ADR does **not** resolve it. A coherent split exists and is what this ADR assumes — *V1 owns Agent identity, wallet and transaction capability; B5 retains Agent lifecycle, servicing and merchant-domain operations* — but adopting that split is a roadmap amendment that only the roadmap owner may make. **Implementation should not begin until G1 is recorded**, because building an Agent domain against a roadmap that assigns it elsewhere invites a later ownership dispute over live financial tables.

### Non-blocking — Product confirmation

- **O3. Agent Code format** — the human-facing shape of the Agent login identity (§12).
- **O4. Agent PIN policy values and Agent MFA** — whether Agents share the customer PIN policy values or get their own, and whether V1 requires Agent MFA (§12).
- **O5. Agent MonieNaija number range** — confirmation of the reserved leading-digit range for Agent numbers (§13(3)(i)), and acknowledgement of the durable obligation on any future customer number source.
- **O6. Customer→Agent transfer eligibility** — whether a customer may send to an Agent MonieNaija number outside a cash-out flow (§13(5)).

---

## 21. Consequences

**Positive**

- The customer platform — including the real-PostgreSQL-proven Wallet→Wallet path — is completely undisturbed. The risk of this change to existing money movement is close to zero by construction.
- Agent is genuinely first-class: separate identity, wallet, number, credentials, PIN and principal type, with no `Customer + flag` shortcut available even accidentally.
- Both participants converge on one ledger, satisfying the no-second-balance-system constraint.
- The participant template is now proven and repeatable for Aggregator, and for Outlet if it ever needs float.
- Isolation is enforced by the database rather than by developer discipline.

**Negative / accepted costs**

- More tables. Agent duplicates the *shape* of several customer tables. This is the deliberate price of isolation, and it is accepted.
- Cross-participant queries (for example "all wallet accounts by owner") require a union or a substrate-level query using `owner_type`, rather than one table scan.
- The number namespace is protected by a range convention plus per-table CHECKs rather than by a single shared unique index. That obligation must be carried forward in the numbering plan; §13(3)(ii) records the eventual shared-registry model.
- Some logic will look similar across customer and agent domains. Premature sharing of that logic would re-couple the participants; duplication is preferred until a genuine shared abstraction is evident.

**Neutral**

- `wallet_accounts.customer_id` keeps a now-slightly-inaccurate name. Renaming it was rejected as a live-financial-table rewrite for cosmetic gain; `owner_type` supplies the missing meaning.

---

## 22. Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| **Agent as `Customer` + agent flag / new `CustomerType`** | Directly violates the V1 requirement. Would give Agents customer wallets, customer PINs, customer limits and customer numbers, permanently fusing two participants that must be separable. |
| **Option A — generalize customer tables with `owner_type`** | Requires dropping enforced customer foreign keys in favour of unenforceable polymorphic references, relaxing a live financial CHECK constraint, and backfilling live financial rows — degrading customer isolation to benefit a participant with zero rows. See §5. |
| **Writing agent ids into `wallet_accounts.customer_id` with no discriminator** | Mechanically works because the column has no FK, but silently models Agents as Customers in the substrate, corrupts finance extracts, and encodes the exact antipattern V1 forbids. |
| **A separate Agent ledger or Agent balance table** | Violates the no-second-balance-system constraint and would immediately diverge from A5. |
| **A cached `agent_wallets.balance` column** | Same violation. Balance is derived from the ledger, always. |
| **Deriving `Agent.id` from `Customer.id`** | Makes Customer authoritative for Agent identity, contradicting the requirement and `B2-MERCHANT-AGENT-ONBOARDING-CONTRACT.md` §4.1. |
| **Promoting `b2_agent_activation_readiness.agent_id` to canonical identity** | It is a `VARCHAR(64)` attestation reference with no FK, produced by a service that explicitly never activates an agent. Evidence, not identity. |
| **Reusing `customerAccess: 'SELF'` for Agent principals** | Would silently grant agent principals access to every existing customer-scoped policy. The single most dangerous shortcut available here. |
| **Deriving Agent MonieNaija numbers from the agent's phone NSN** | Guarantees collision with the customer number derived from the same phone — and agent operators are commonly also customers. |
| **A shared `monienaija_number_registry` for V1** | Correct long-term, but requires migrating live customer receiving numbers, reintroducing exactly the customer-side disruption Option B avoids. Recorded as the evolution path (§13(3)(ii)). |
| **Choosing `CUSTOMER_FUNDS` for Agent float because it is the column default** | An invented accounting treatment. Belongs to Finance (§20-F1). |
| **Proceeding with implementation before G1 is resolved** | Would build a financial domain against a roadmap that assigns it to another platform. |
