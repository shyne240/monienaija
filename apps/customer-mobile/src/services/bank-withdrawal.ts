import { ApiClient } from './api-client';

/**
 * ARENA 5 — customer banking: withdraw to a bank account outside MonieNaija.
 *
 * This is the one outbound journey the customer can perform without workforce involvement: it is
 * bound to the customer's own session, the customer's own transaction PIN, and a *verified*
 * BANK_ACCOUNT beneficiary that already exists. Nothing here can pick an arbitrary bank account,
 * and nothing here can verify one — verification is performed by MonieNaija operations, and this
 * client deliberately has no "trust me" flag to set.
 *
 * What this client does NOT do:
 * - it does not list banks (there is no customer bank directory; the workforce-only
 *   `/api/v1/banks` surface is intentionally not exposed to the app),
 * - it does not enquire an account name (provider name enquiry is not available to customers),
 * - it does not create or verify bank beneficiaries (no self-service path exists; operations does),
 * - it does not submit a second submission when one is in flight (the idempotency key is stable
 *   for the life of the form, and a replayed request returns the same commitment).
 */

export interface BankBeneficiary {
  id: string;
  nickname: string | null;
  displayName: string;
  /** Present because the wire projection carries it; null until the contract grows bank names. */
  bankCode: string | null;
  destinationName: string | null;
  /** The account number as stored — own beneficiary, shown to its owner only. */
  receivingNumber: string | null;
  isVerified: boolean;
  isActive: boolean;
  status: string;
  beneficiaryType: string;
}

export interface InitiateBankWithdrawalResult {
  commitmentId: string;
  withdrawalId: string;
  externalOperationId: string;
  state: 'RESERVED' | 'SETTLED' | 'RELEASED';
  /** True when this response replays an earlier identical request rather than a new commitment. */
  replayed: boolean;
  /**
   * Reference of the banking dispatch operation, present only when a banking dispatch intent
   * exists for the commitment. Null means "no trackable dispatch was created" — never a fabricated
   * reference.
   */
  operationReference: string | null;
}

export const BankWithdrawalApi = {
  /**
   * The customer's own verified, active BANK_ACCOUNT beneficiaries. Anything else (wallet
   * recipients, pending verification, suspended) is filtered out here so a screen cannot render
   * an unusable destination by accident.
   */
  async listBankBeneficiaries(): Promise<BankBeneficiary[]> {
    const page = await ApiClient.get<{ items?: BankBeneficiary[] }>(
      '/customers/me/beneficiaries?limit=100',
    );
    const items = Array.isArray(page?.items) ? page.items : [];
    return items.filter(
      (item) =>
        item.beneficiaryType === 'BANK_ACCOUNT' && item.isVerified && item.isActive,
    );
  },

  /**
   * Initiates the withdrawal commitment. The server never submits to a provider from here; the
   * commitment reserves the amount and creates the dispatch intent atomically. Submission happens
   * later, under the registered execution authority.
   */
  initiate(
    input: {
      walletAccountId: string;
      beneficiaryId: string;
      amountMinor: string;
      pin: string;
    },
    idempotencyKey: string,
  ): Promise<InitiateBankWithdrawalResult> {
    return ApiClient.post<InitiateBankWithdrawalResult>(
      '/customers/me/withdrawal-commitments',
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
