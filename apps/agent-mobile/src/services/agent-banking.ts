import { ApiClient } from './api-client';

/**
 * ARENA 3D — agent banking: the account an agent's float should be sent to.
 *
 * The agent's identity is never sent from here. `/agents/me/banking/*` resolves the agent from the
 * session, so there is no field in this client that could be tampered with to address another agent's
 * funding account.
 *
 * An agent funding account is a *receiving* instrument: it exists so float can arrive by bank transfer.
 * Nothing in this client can move money out of it.
 */

export type AgentFundingAccountState =
  | 'PROVISIONED'
  | 'PENDING'
  | 'UNKNOWN'
  | 'NOT_PROVISIONED'
  | 'WALLET_NOT_AGENT_OWNED'
  | 'NO_INSTITUTION';

export interface AgentFundingAccount {
  state: AgentFundingAccountState;
  agentId: string;
  institutionId: string;
  walletId: string;
  providerKey: string;
  currency: string;
  /** Always `AGENT_FLOAT_FUNDING`: it receives float and never pays it out. */
  purpose: string;
  /**
   * Nullable by type. Several states mean the provider issued no account, and an agent must never be
   * shown a number that does not exist at a bank.
   */
  accountNumber: string | null;
  bankName: string | null;
  accountName: string | null;
}

export type AgentDepositState =
  | 'FLOAT_CREDITED'
  | 'VERIFIED_AWAITING_FLOAT_CREDIT'
  | 'CONFIRMING'
  | 'REJECTED';

export interface AgentDeposit {
  id: string;
  reference: string;
  amountMinor: string;
  currency: string;
  receivedAt: string;
  state: AgentDepositState;
}

export const AgentBankingApi = {
  fundingAccount: (walletId: string) =>
    ApiClient.get<AgentFundingAccount>(
      `api/v1/agents/me/banking/funding-account?walletId=${encodeURIComponent(walletId)}`,
    ),

  /**
   * Requests the funding account.
   *
   * Idempotent by wallet: the reference is derived from the wallet, so a retry addresses the same
   * account instead of opening a second one. The screen still must not offer a retry while a previous
   * attempt is `UNKNOWN`.
   */
  requestFundingAccount: (walletId: string) =>
    ApiClient.post<AgentFundingAccount>(
      `api/v1/agents/me/banking/funding-account?walletId=${encodeURIComponent(walletId)}`,
      {},
    ),

  /** Verified float received into the funding account. */
  deposits: (walletId: string) =>
    ApiClient.get<AgentDeposit[]>(
      `api/v1/agents/me/banking/funding-account/${encodeURIComponent(walletId)}/deposits`,
    ),
};
