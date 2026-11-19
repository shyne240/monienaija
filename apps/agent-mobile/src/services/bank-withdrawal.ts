import { ApiClient } from './api-client';

export interface AgentBankBeneficiary {
  id: string;
  nickname: string | null;
  displayName: string;
  bankCode: string | null;
  destinationName: string | null;
  receivingNumber: string | null;
  isVerified: boolean;
  isActive: boolean;
  status: string;
  beneficiaryType: string;
}

export interface InitiateAgentBankWithdrawalResult {
  commitmentId: string;
  withdrawalId: string;
  externalOperationId: string;
  state: 'RESERVED' | 'SETTLED' | 'RELEASED';
  replayed: boolean;
  operationReference: string | null;
}

export const AgentBankWithdrawalApi = {
  async listBankBeneficiaries(): Promise<AgentBankBeneficiary[]> {
    const page = await ApiClient.get<{ items?: AgentBankBeneficiary[] }>('/agents/me/banking/beneficiaries');
    const items = Array.isArray((page as unknown as { items?: AgentBankBeneficiary[] })?.items) ? (page as unknown as { items: AgentBankBeneficiary[] }).items : [];
    return items.filter((item) => item.beneficiaryType === 'BANK_ACCOUNT' && item.isVerified && item.isActive);
  },

  createBankBeneficiary(input: { bankCode: string; accountNumber: string; nickname?: string; walletId?: string }): Promise<{ id: string; bankCode: string; accountNumber: string; accountName: string; nickname: string | null; status: string; verified: boolean }> {
    return ApiClient.post('/agents/me/banking/beneficiaries/bank-accounts', input);
  },

  initiate(
    input: { walletAccountId?: string; beneficiaryId: string; amountMinor: string; pin: string },
    idempotencyKey: string,
  ): Promise<InitiateAgentBankWithdrawalResult> {
    return ApiClient.post<InitiateAgentBankWithdrawalResult>(
      '/agents/me/banking/bank-transfers',
      {
        walletAccountId: input.walletAccountId,
        beneficiaryId: input.beneficiaryId,
        amountMinor: input.amountMinor,
        currency: 'NGN',
        pin: input.pin,
      },
      { idempotencyKey },
    );
  },
};
