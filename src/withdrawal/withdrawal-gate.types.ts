import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { PolicyDecisionResult } from '../policy/capability-policy.types';

export interface WithdrawalGateCommand {
  principal: AuthorizationPrincipal;
  customerId: string;
  walletId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  bindingId: string;
  bindingVersion: number;
  amountMinor: string;
  currency: string;
  accountingUnit: 'CUSTOMER_FUNDS';
  idempotencyKey: string;
  requestContext: {
    requestId: string;
    correlationId: string;
    traceId?: string;
  };
}

export interface WithdrawalGateResult {
  status: 'ALLOWED' | 'DENIED';
  policyDecision?: PolicyDecisionResult;
  reason?: string;
  limits?: readonly {
    type: string;
    currency?: string;
    amountMinor?: string;
    count?: number;
    remainingMinor?: string;
    remainingCount?: number;
  }[];
}
