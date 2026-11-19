import { ApiClient } from './api-client';

export interface BankDirectoryEntry {
  bankCode: string;
  bankName: string;
  shortName: string;
  nipSupported: boolean;
  status: string;
}

export interface AccountEnquiryResult {
  bankCode: string;
  accountNumber: string;
  outcome: 'RESOLVED' | 'NOT_FOUND' | 'UNAVAILABLE';
  accountName?: string;
  establishesAccountOwnership: false;
  correlationId: string;
}

export const BankDirectoryApi = {
  list(search?: string): Promise<BankDirectoryEntry[]> {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return ApiClient.get<{ items: BankDirectoryEntry[] }>(`/customers/me/banking/banks${qs}`).then((r) => r.items ?? []);
  },

  enquire(input: { bankCode: string; accountNumber: string; walletId?: string }): Promise<AccountEnquiryResult> {
    return ApiClient.post<AccountEnquiryResult>('/customers/me/banking/account-enquiry', input);
  },
};
