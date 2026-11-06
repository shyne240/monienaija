/** Selected fields of the synthetic HTTP history rows asserted in integration tests. */
export interface HistoryResponseFixture {
  id: string;
  type: string;
  transactionType: string;
  transferId?: string;
  status: string;
  direction: string;
  amountMinor: string;
  currency: string;
  feeMinor: string;
  createdAt: string;
  completedAt: string | null;
  reference: string | null;
  narration: string | null;
  sourceWalletId?: string | null;
  destinationWalletId?: string | null;
  counterparty: Record<string, unknown>;
  counterpartyWalletId?: string | null;
  beneficiaryPhone?: string;
  beneficiary_phone?: string;
}
