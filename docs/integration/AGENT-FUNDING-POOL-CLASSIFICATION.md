# `AGENT_FUNDING_POOL-NGN` — economic classification and funding-authority decision

Status: **fail-closed, decision outstanding with the product owner and a licensed institution.**
Migration: `1785753600061-CreateAgentFundingPool` (unchanged, identifier not renumbered).
Code guard: `AgentFundingService.validateFundingTarget` (`src/agent/agent-funding.service.ts`).
Regression: `test/agent-funding-pool-classification.integration.spec.ts` (real PostgreSQL, 4 cases).

## 1. What the account is

| Property                                 | Published value          | Meaning                                                                                                     |
| ---------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `code`                                   | `AGENT_FUNDING_POOL-NGN` | single, global pool                                                                                         |
| `account_type` / `normal_balance`        | `LIABILITY` / `CREDIT`   | platform counterparty liability, not an asset held for a customer                                           |
| `accounting_unit`                        | `CUSTOMER_FUNDS`         | same accounting unit as customer and agent wallets                                                          |
| `currency`                               | `NGN`                    | NGN only; no other currency may be funded through it                                                        |
| `institutional_scope` / `institution_id` | `UNATTRIBUTED` / `NULL`  | **not** institution-owned; never assigned to an institution                                                 |
| `allow_negative_balance`                 | `TRUE`                   | the pool may go negative: it records the platform's funding obligation to agents rather than a cash balance |

It is **not** a bank account, settlement account, treasury account, CBN/NIBSS account, suspense
account, or an institution's funding account. No licensed institution owns it, and no external
treasury integration backs it. Its credit balance is a synthetic (controlled-test) representation
of the platform's obligation to fund Agent float; a negative balance is a real accounting fact
that must eventually be settled against verified external treasury, not netted away.

## 2. What is enforced today (fail-closed)

`validateFundingTarget` refuses, before any journal is posted and before any idempotency authority
is consumed, when:

1. the pool row is attributed to an institution (`institutional_scope = 'INSTITUTION'` or
   `institution_id IS NOT NULL`) — _"The agent funding pool is a platform-level account and must
   never be institution-attributed"_;
2. the pool row is inactive;
3. the pool row holds a different currency than the funding request;
4. the pool row is not in the `CUSTOMER_FUNDS` accounting unit;
5. the target Agent wallet is institution-attributed (`wallet_accounts.institution_id IS NOT NULL`)
   — _"Institutional agent float must be funded from the institution funds authority; the platform
   funding pool cannot fund an institution-attributed wallet"_.

Independently of (5), the database refuses to attribute a wallet or ledger account without a
governed `WALLET_INSTITUTION_ATTRIBUTION` execution, and the ledger refuses any journal that mixes
an institution-attributed account with an unattributed/platform one. Attributed-Agent float is
therefore funded only from that institution's own settlement account
(`GovernedFinancialFixture.fundLedgerAccount(..., { institutionId })`), never from platform float.

Bank-of-record flows are unchanged: the pool is still the counterparty for **platform**
(unattributed) Agents, which is the only rail this repository can honour without inventing a
funding authority.

## 3. What is _not_ decided here (deliberately)

The following are economic/regulatory questions, not engineering choices. None of them is
implemented, and none may be inferred from the code:

- **Who is the legal counterparty of the pool?** (platform entity, licensed institution, or an
  aggregator bank). Nothing in the repository assigns it.
- **How does the pool get funded externally?** Real treasury funding requires a bank/settlement
  integration and a verified funding authority. No such integration (no credentials, no provider)
  exists; the negative-balance allowance exists precisely so no fictional cash or settlement asset
  is created in the meantime.
- **How are pool debits settled/reimbursed?** No reimbursement, netting, refund, or
  settlement-instruction policy is implemented or implied.
- **May an institution-bound rail be used instead?** Preferred by the mission statement whenever a
  verified funding authority exists. It does not exist for Agent float today, so the fail-closed
  refusal in case (5) stands.

## 4. Required decision record

Before this account may be used for anything beyond platform (unattributed) Agents in controlled
environments, the product owner and a licensed institution must record, in writing:

1. the legal counterparty of Agent float funding and its licence/authorisation reference;
2. the funding source (institution settlement account, bank partner, or treasury facility) and the
   evidence that the source is authorised to fund Agent float;
3. the settlement/reimbursement mechanism for pool debits, including the accounting treatment of a
   negative pool balance;
4. whether pool-based funding is retired in favour of the institution-bound rail, and the migration
   path for existing platform Agents;
5. the reconciliation and reporting obligations that follow from (1)–(4).

Until that record exists, the correct behaviour is the current one: platform Agents only, explicit
refusals for institution-attributed Agents, no invented settlement asset, no institution assigned
to the global pool, and readiness continues to report
`financial_dependencies_not_ready`.
