import { ApiClient } from './api-client';

/**
 * Customer-facing financial account read/write helpers.
 *
 * The CustomerWallet registry id (from GET /customers/:id/wallets) is NOT a
 * financial account identifier. Balances and money movement always resolve
 * through the customer's financial binding exposed by
 * GET /customers/:id/financial-accounts, and transaction history through the
 * customer-scoped transactions endpoint. The server re-validates ownership
 * for every operation.
 */

export interface FinancialAccountView {
  bindingId: string | null;
  customerWalletId: string | null;
  walletAccountId: string | null;
  bindingState: string | null;
  readState: string;
  currency: string | null;
  balanceMinor: string | null;
  /** System-issued primary MonieNaija receiving number (10 digits), or null when unissued. */
  receivingNumber: string | null;
  warnings: string[];
}

export interface FinancialAccountReadModel {
  customerId: string;
  generatedAt: string;
  accounts: FinancialAccountView[];
  warnings: string[];
}

export interface CustomerTransaction {
  id: string;
  narration: string;
  reference: string;
  amountMinor: number;
  currency: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'CANCELLED';
  createdAt: string;
}

interface WalletTransactionView {
  transferId: string;
  direction: 'SENT' | 'RECEIVED';
  counterpartyWalletId: string;
  amountMinor: string;
  currency: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  reference: string | null;
  narration: string | null;
  createdAt: string;
  completedAt: string | null;
}

export async function fetchFinancialAccounts(
  customerId: string,
): Promise<FinancialAccountReadModel> {
  return ApiClient.get<FinancialAccountReadModel>(`/customers/${customerId}/financial-accounts`);
}

/** Balance in minor units (number) for a CustomerWallet, 0 when unbound/unavailable. */
export function balanceForCustomerWallet(
  model: FinancialAccountReadModel | null,
  customerWalletId: string | undefined,
): number {
  if (!model || !customerWalletId) return 0;
  const account = model.accounts.find(
    (candidate) =>
      candidate.customerWalletId === customerWalletId &&
      candidate.readState === 'ACTIVE' &&
      candidate.balanceMinor !== null,
  );
  return account?.balanceMinor ? Number(account.balanceMinor) : 0;
}

/** The wallet's ACTIVE receiving number, or null (PENDING/unissued). */
export function receivingNumberForCustomerWallet(
  model: FinancialAccountReadModel | null,
  customerWalletId: string | undefined,
): string | null {
  if (!model || !customerWalletId) return null;
  return (
    model.accounts.find(
      (candidate) =>
        candidate.customerWalletId === customerWalletId && candidate.readState === 'ACTIVE',
    )?.receivingNumber ?? null
  );
}

/** Recipient identifier mechanisms accepted by the customer transfer API. */
export type RecipientMode = 'MONIENAIJA_NUMBER' | 'PHONE';

/** Safe, display-only recipient confirmation data (never internal identifiers). */
export interface CustomerRecipientView {
  lookupMode: RecipientMode;
  displayName: string;
  receivingNumber: string | null;
  canonicalPhone: string | null;
  currency: string;
}

export const MONIENAIJA_NUMBER_PATTERN = /^\d{10}$/;

export async function resolveRecipient(
  customerId: string,
  mode: RecipientMode,
  value: string,
): Promise<CustomerRecipientView> {
  const path =
    mode === 'MONIENAIJA_NUMBER'
      ? `/customers/${customerId}/recipients/by-number?number=${encodeURIComponent(value.trim())}`
      : `/customers/${customerId}/recipients/by-phone?phone=${encodeURIComponent(value.trim())}`;
  return ApiClient.get<CustomerRecipientView>(path);
}

export async function fetchWalletTransactions(
  customerId: string,
  customerWalletId: string,
  page: number,
  limit: number,
): Promise<{ items: CustomerTransaction[] }> {
  const result = await ApiClient.get<{ items: WalletTransactionView[] }>(
    `/customers/${customerId}/wallets/${customerWalletId}/transactions?page=${page}&limit=${limit}`,
  );
  return { items: (result.items || []).map(mapTransaction) };
}

function mapTransaction(view: WalletTransactionView): CustomerTransaction {
  return {
    id: view.transferId,
    narration: view.narration ?? 'Wallet transfer',
    reference: view.reference ?? '',
    amountMinor: Number(view.amountMinor),
    currency: view.currency,
    type: view.direction === 'SENT' ? 'TRANSFER_OUT' : 'TRANSFER_IN',
    status: view.status === 'COMPLETED' ? 'SUCCESS' : view.status === 'PENDING' ? 'PENDING' : 'FAILED',
    createdAt: view.createdAt,
  };
}
