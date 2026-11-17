import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Approval of a verified inbound payment as agent operating float.
 *
 * This is a *policy* decision, deliberately separate from the provider verification that established
 * the money exists and from the ledger posting that moves the float. Three independent questions:
 *
 *   1. Did the provider confirm this payment? (`BankingInboundFundingVerifier`)
 *   2. Does an approved policy say this payment may credit this agent's float? (this contract)
 *   3. What does the ledger record, and for which accounts? (`AgentFloatFundingService`)
 *
 * Collapsing 2 into 1 would make every verified payment into a funding account automatically float.
 * Collapsing 2 into 3 would put policy inside a transaction that has already started moving money.
 *
 * The default implementation approves nothing. A production implementation is an institutional
 * decision — it requires an approved policy row, an eligible agent, and an institution that has
 * accepted settlement liability for the float — and cannot be supplied by configuration.
 */
export interface AgentFloatFundingAuthority {
  /**
   * Decides whether `providerReference` may credit float to `walletId` under current policy.
   *
   * Must run inside the caller's transaction and lock what it depends on: a policy suspended
   * between this decision and the posting must not commit a credit under a policy that no longer
   * authorizes it.
   *
   * `DENIED` records a decision (an ineligible agent is a real answer). `UNAVAILABLE` means the
   * deployment cannot decide at all and the caller must refuse rather than guess.
   */
  authorize(
    manager: EntityManager,
    input: {
      institutionId: string;
      agentId: string;
      walletAccountId: string;
      fundingAccountNumber: string;
      providerKey: string;
      environment: 'sandbox' | 'production';
      providerReferenceHash: string;
      amountMinor: string;
      currency: string;
    },
  ): Promise<
    | {
        status: 'AUTHORIZED';
        /** The approved policy version this decision was taken under. Recorded on the receipt. */
        policyId: string;
        policyReference: string;
        /** The institution ledger account the payment's debit posts against. */
        settlementAssetAccountId: string;
        /**
         * The agent's float liability account. Institution-scoped, because the ledger refuses a
         * journal that mixes an institution-attributed account with an unattributed one: the
         * institution's cash arriving and the institution owing that float are the same
         * institutional balance sheet, so both legs must belong to it.
         */
        floatAccountId: string;
      }
    | { status: 'DENIED'; reason: AgentFloatDenialReason }
    | { status: 'UNAVAILABLE' }
  >;
}

export const AGENT_FLOAT_FUNDING_AUTHORITY = Symbol('AGENT_FLOAT_FUNDING_AUTHORITY');

/** Closed set. An obligation carries one of these, so operations can act on the reason. */
export type AgentFloatDenialReason =
  | 'NO_ACTIVE_POLICY'
  | 'POLICY_NOT_OPERATIONAL'
  | 'AGENT_INELIGIBLE'
  | 'WALLET_NOT_AGENT_OWNED'
  | 'WALLET_NOT_INSTITUTION_ATTRIBUTED'
  | 'ACCOUNT_NOT_AGENT_FUNDING_ACCOUNT'
  | 'EVIDENCE_INSUFFICIENT'
  | 'PRODUCTION_EXECUTION_WITHHELD';

/**
 * The shipped authority: it approves nothing.
 *
 * Every verified inbound payment into an agent funding account therefore becomes a durable
 * obligation rather than a credit. That is the honest state of a deployment with no approved funding
 * policy, and it is the state this repository ships in.
 */
@Injectable()
export class UnavailableAgentFloatFundingAuthority implements AgentFloatFundingAuthority {
  authorize(): Promise<{ status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

/**
 * Database-backed policy resolution.
 *
 * Reads `agent_float_funding_policies` and the agent's own eligibility. It is complete and exercised
 * in acceptance, but it is **not wired as the runtime default**: exporting a policy is a governed
 * action, and a deployment that has exported none resolves to `DENIED / NO_ACTIVE_POLICY`, never to
 * an implicit approval.
 *
 * Production execution stays withheld even when an ACTIVE production policy exists. A production
 * policy row requires an institution that has accepted settlement liability and an approved
 * financial policy for that liability; neither is representable by a row this service can write, so
 * `environment === 'production'` is refused with `PRODUCTION_EXECUTION_WITHHELD` and the obligation is
 * preserved. Controlled acceptance runs in `sandbox`, which is what exercises the full lifecycle.
 */
@Injectable()
export class PolicyAgentFloatFundingAuthority implements AgentFloatFundingAuthority {
  async authorize(
    manager: EntityManager,
    input: {
      institutionId: string;
      agentId: string;
      walletAccountId: string;
      fundingAccountNumber: string;
      providerKey: string;
      environment: 'sandbox' | 'production';
      providerReferenceHash: string;
      amountMinor: string;
      currency: string;
    },
  ): Promise<
    | {
        status: 'AUTHORIZED';
        policyId: string;
        policyReference: string;
        settlementAssetAccountId: string;
        floatAccountId: string;
      }
    | { status: 'DENIED'; reason: AgentFloatDenialReason }
    | { status: 'UNAVAILABLE' }
  > {
    // The wallet must be an agent wallet, attributed to the institution the money arrived for. A
    // customer wallet funded through this path would be a customer deposit booked as float.
    const wallets = await manager.query<
      Array<{
        owner_class: string;
        customer_id: string;
        institution_id: string | null;
        status: string;
        currency: string;
      }>
    >(
      `SELECT owner_class, customer_id::text AS customer_id, institution_id::text AS institution_id,
              status, currency
         FROM wallet_accounts WHERE id = $1 FOR SHARE`,
      [input.walletAccountId],
    );
    const wallet = wallets[0];
    if (!wallet) return { status: 'DENIED', reason: 'WALLET_NOT_AGENT_OWNED' };
    if (wallet.owner_class !== 'AGENT') {
      return { status: 'DENIED', reason: 'WALLET_NOT_AGENT_OWNED' };
    }
    if (wallet.customer_id !== input.agentId) {
      return { status: 'DENIED', reason: 'WALLET_NOT_AGENT_OWNED' };
    }
    // Institution attribution is checked *when present*. A wallet attributed to a different
    // institution is refused outright: that payment arrived for one institution and the wallet
    // belongs to another. An attributed wallet must also match.
    //
    // A wallet with no attribution is not automatically refused, because attribution is immutable
    // and reachable only through the governed two-party workflow — an agent enrolled before that
    // workflow existed has no attribution yet. For those wallets the institution binding comes from
    // the approved policy instead: the policy names the institution *and* that institution's own
    // settlement asset, and the trigger on the policy table refuses a settlement asset belonging to
    // any other institution. The debit and credit legs are therefore still institution-consistent;
    // what would be missing is only the wallet-side annotation. Requiring it here would mean this
    // path could not credit any unattributed agent, which is the gap this service exists to close.
    if (wallet.institution_id && wallet.institution_id !== input.institutionId) {
      return { status: 'DENIED', reason: 'WALLET_NOT_INSTITUTION_ATTRIBUTED' };
    }
    if (wallet.status !== 'ACTIVE') return { status: 'DENIED', reason: 'AGENT_INELIGIBLE' };
    if (wallet.currency !== input.currency) {
      // A cross-currency float credit is a conversion, and no approved conversion policy exists.
      return { status: 'DENIED', reason: 'EVIDENCE_INSUFFICIENT' };
    }

    // The funding account named by the provider must be the agent's own provisioned funding account.
    // Money that arrived in some other account is not this agent's float, whatever the webhook said.
    const accounts = await manager.query<Array<{ account_number: string }>>(
      `SELECT account_number FROM virtual_accounts
        WHERE wallet_id = $1 AND provider = $2 AND status = 'ACTIVE'
          AND account_number = $3`,
      [input.walletAccountId, input.providerKey, input.fundingAccountNumber],
    );
    if (!accounts[0]) {
      return { status: 'DENIED', reason: 'ACCOUNT_NOT_AGENT_FUNDING_ACCOUNT' };
    }

    // The agent must still be active and still hold the funding capability. Credit to a suspended
    // agent is a payment the institution must resolve, not float it holds on the agent's behalf.
    const agents = await manager.query<Array<{ status: string; deleted_at: Date | null }>>(
      `SELECT status, deleted_at FROM agents WHERE id = $1`,
      [input.agentId],
    );
    const agent = agents[0];
    if (!agent || agent.deleted_at !== null || agent.status !== 'ACTIVE') {
      return { status: 'DENIED', reason: 'AGENT_INELIGIBLE' };
    }

    const policies = await manager.query<
      Array<{
        id: string;
        status: string;
        settlement_asset_account_id: string;
        activated_at: Date | null;
      }>
    >(
      `SELECT id::text AS id, status, settlement_asset_account_id::text AS settlement_asset_account_id,
              activated_at
         FROM agent_float_funding_policies
        WHERE institution_id = $1 AND provider_key = $2 AND environment = $3 AND currency = $4
        ORDER BY (status = 'ACTIVE') DESC, created_at DESC
        FOR SHARE`,
      [input.institutionId, input.providerKey, input.environment, input.currency],
    );
    const active = policies.find((policy) => policy.status === 'ACTIVE');
    if (!active) {
      const exists = policies[0];
      return {
        status: 'DENIED',
        reason: exists ? 'POLICY_NOT_OPERATIONAL' : 'NO_ACTIVE_POLICY',
      };
    }

    // The agent's own float account, which must be institution-scoped for the journal to balance
    // within one institution's books.
    const walletAccounts = await manager.query<
      Array<{
        ledger_account_id: string;
        institutional_scope: string;
        institution_id: string | null;
      }>
    >(
      `SELECT w.ledger_account_id::text AS ledger_account_id,
              la.institutional_scope, la.institution_id::text AS institution_id
         FROM wallet_accounts w JOIN ledger_accounts la ON la.id = w.ledger_account_id
        WHERE w.id = $1`,
      [input.walletAccountId],
    );
    const floatAccount = walletAccounts[0];
    if (!floatAccount) return { status: 'DENIED', reason: 'WALLET_NOT_AGENT_OWNED' };
    if (
      floatAccount.institutional_scope !== 'INSTITUTION' ||
      floatAccount.institution_id !== input.institutionId
    ) {
      // The agent's float ledger account is not this institution's. The ledger would refuse the
      // journal anyway; refusing here gives operations a reason instead of a constraint violation.
      return { status: 'DENIED', reason: 'WALLET_NOT_INSTITUTION_ATTRIBUTED' };
    }

    if (input.environment === 'production') {
      // A sandbox policy proves the lifecycle. It does not authorize production money.
      return { status: 'DENIED', reason: 'PRODUCTION_EXECUTION_WITHHELD' };
    }

    return {
      status: 'AUTHORIZED',
      policyId: active.id,
      policyReference: `AGENT_FLOAT_POLICY:${active.id}`,
      settlementAssetAccountId: active.settlement_asset_account_id,
      floatAccountId: floatAccount.ledger_account_id,
    };
  }
}
