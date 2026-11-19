import { ApiClient } from './api-client';

export type PricingSource = 'APPROVED_RULE' | 'NO_FEE_RULE' | 'AMBIGUOUS_PRICING';
export interface BankTransferPricing {
  principalMinor: string;
  currency: string;
  feeMinor: string;
  vatMinor: string;
  totalDebitMinor: string;
  pricingSource: PricingSource;
  feeRuleId?: string;
  productCode?: string;
  beneficiaryId: string;
  bankCode: string;
}

export const BankTransferPricingApi = {
  preview(params: { beneficiaryId: string; amountMinor: string; walletId?: string }): Promise<BankTransferPricing> {
    const qs = new URLSearchParams({ beneficiaryId: params.beneficiaryId, amountMinor: params.amountMinor });
    if (params.walletId) qs.set('walletId', params.walletId);
    return ApiClient.get<BankTransferPricing>(`/customers/me/banking/bank-transfer-preview?${qs.toString()}`);
  },
};
