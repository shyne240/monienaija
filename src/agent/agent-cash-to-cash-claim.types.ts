import type { AuthorizationPrincipal } from '../authorization/authorization.types';

export interface AgentCashToCashClaimInput {
  transferId: string;
  beneficiaryPhone: string;
  transferCode: string;
  customerId: string;
  mfaChallengeId: string;
  otp: string;
  idempotencyKey: string;
  // Auth principal for API binding — either AGENT or CUSTOMER; for claim, typically beneficiary CUSTOMER or redeeming AGENT
  claimantPrincipal?: AuthorizationPrincipal;
  reference?: string;
  description?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCashToCashClaimResult {
  status: 'COMPLETED' | 'REPLAYED';
  transferId: string;
  journalId: string;
  beneficiaryPhone: string;
  principalMinor: string;
  currency: string;
  amountMinor: string;
  claimantCustomerId: string;
  idempotencyKey: string;
  requestHash: string;
  replayed: boolean;
  correlationId?: string;
  reference?: string;
  claimedAt: Date;
}
