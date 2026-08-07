import type {
  AuthorizationDecision,
  AuthorizationPrincipal,
} from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';

export const INTERNAL_TRANSFER_PILOT_CONTROL_KEY = 'wallet.transfer.create.internal.v1';
export const PILOT_CONTROL_IDEMPOTENCY_SCOPE = 'pilot.control.v1';

export interface PilotSafetyThresholds {
  unknownOutcomeCount?: number;
  reconciliationErrorCount?: number;
  outboxFailureCount?: number;
  authorizationFailureCount?: number;
}

export interface PilotSafetySignals {
  unknownOutcomeCount: number;
  reconciliationErrorCount: number;
  outboxFailureCount: number;
  authorizationFailureCount: number;
}

export type PilotControlDecisionCode =
  | 'PILOT_ALLOWED'
  | 'PILOT_DISABLED'
  | 'PILOT_EMERGENCY_STOP'
  | 'PILOT_CONTROL_UNAVAILABLE'
  | 'PILOT_AUTHORIZATION_REQUIRED'
  | 'PILOT_COHORT_DENIED'
  | 'PILOT_CURRENCY_DENIED'
  | 'PILOT_AMOUNT_BELOW_MINIMUM'
  | 'PILOT_TRANSACTION_LIMIT_EXCEEDED'
  | 'PILOT_DAILY_COUNT_LIMIT_EXCEEDED'
  | 'PILOT_DAILY_AMOUNT_LIMIT_EXCEEDED'
  | 'PILOT_USAGE_UNAVAILABLE'
  | 'PILOT_SAFETY_STOP'
  | 'PILOT_SAFETY_SIGNAL_UNAVAILABLE';

export interface PilotControlEvaluationCommand {
  customerId: string;
  capability: string;
  action: string;
  scope: string;
  amountMinor: string;
  currency: string;
  principal: AuthorizationPrincipal;
  authorizationDecision: AuthorizationDecision;
  requestContext: RequestContext;
  dailyTransactionCount?: number;
  dailyTransactionAmountMinor?: string;
}

export interface PilotControlDecision {
  allowed: boolean;
  decisionCode: PilotControlDecisionCode;
  message: string;
  controlId: string | null;
  controlKey: string;
  controlVersion: number | null;
  cohortMember: boolean;
  emergencyStopped: boolean;
  evaluatedAt: string;
}

export interface PilotControlMutationCommand {
  controlKey: string;
  capability: string;
  action: string;
  scope: string;
  enabled: boolean;
  cohortCustomerIds: readonly string[];
  currency: string;
  minTransactionAmountMinor: string | number | bigint;
  maxTransactionAmountMinor: string | number | bigint;
  dailyTransactionCountLimit?: number | null;
  dailyTransactionAmountMinor?: string | number | bigint | null;
  safetyThresholds?: PilotSafetyThresholds;
  reason: string;
  principal: AuthorizationPrincipal;
  idempotencyKey: string;
  requestContext: RequestContext;
}

export interface PilotControlView {
  id: string;
  controlKey: string;
  capability: string;
  action: string;
  scope: string;
  enabled: boolean;
  cohortCustomerIds: string[];
  currency: string;
  minTransactionAmountMinor: string;
  maxTransactionAmountMinor: string;
  dailyTransactionCountLimit: number | null;
  dailyTransactionAmountMinor: string | null;
  safetyThresholds: PilotSafetyThresholds;
  version: number;
  updatedBy: string;
  lastCorrelationId: string | null;
  lastRequestId: string | null;
  updatedAt: Date;
}
