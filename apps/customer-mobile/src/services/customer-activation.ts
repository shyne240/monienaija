import { ApiClient } from './api-client';

/**
 * Customer-owned onboarding completion API (`/customers/me/activation`).
 *
 * Mirrors the backend's single readiness authority: the same requirement codes the admin
 * registration-review surface shows are what the customer sees here. Nothing in this module
 * decides eligibility — it only renders what the backend decided.
 */
export type ActivationRequirementState = 'MET' | 'OUTSTANDING' | 'UNAVAILABLE' | 'BLOCKED';

export interface ActivationRequirement {
  code: string;
  label: string;
  state: ActivationRequirementState;
  detail?: string;
}

export interface ActivationWallet {
  walletId: string;
  currency: string;
  status: string;
}

export interface CustomerActivationView {
  customerId: string;
  customerStatus: string;
  kyc: {
    level: string;
    status: string;
    assessment: {
      level: string;
      status: string;
      expiresAt: string | null;
      reason: string | null;
    } | null;
  };
  customerClass: {
    configured: boolean;
    classCode: string | null;
    className: string | null;
    source: string | null;
    effectiveFrom: string | null;
  };
  financialEligibility: string;
  onboardingWorkflow: { status: string | null; eligibility: string | null; completed: boolean };
  requirements: ActivationRequirement[];
  outstanding: string[];
  activatable: boolean;
  wallet: ActivationWallet | null;
  wallets: ActivationWallet[];
  evaluatedAt: string;
}

export interface CustomerActivationResult {
  customerId: string;
  activated: boolean;
  replayed: boolean;
  currency: string;
  wallet: {
    walletId: string;
    provisioningWalletId: string;
    currency: string;
    status: string;
    balanceHint: 'LEDGER_DERIVED';
  };
  checks: {
    customerActive: boolean;
    verifiedPrimaryPhone: boolean;
    onboardingCompleted: boolean;
    eligibility: string;
    /** Verified KYC tier the financial gate approved (e.g. `LEVEL_1`). */
    verifiedTier: string;
    financialEligibility: string;
  };
  activatedAt: string;
}

export const DEFAULT_ACTIVATION_ATTEMPT = 'primary-wallet';

export const CustomerActivationApi = {
  view: () => ApiClient.get<CustomerActivationView>('/customers/me/activation'),
  /**
   * Provisions the customer's own wallet. The idempotency key must be stable across retries of the
   * *same logical attempt* — the screen derives it from the customer id and the attempt, never
   * from a random value per press.
   */
  activate: (idempotencyKey: string) =>
    ApiClient.post<CustomerActivationResult>('/customers/me/activation', {}, { idempotencyKey }),
};

/** Stable idempotency key for one activation attempt by one customer. */
export function activationIdempotencyKey(
  customerId: string,
  attempt: string = DEFAULT_ACTIVATION_ATTEMPT,
): string {
  return `activate.${customerId}.${attempt}`;
}
