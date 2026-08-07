import type {
  AuthorizationDecision,
  AuthorizationPrincipal,
} from '../authorization/authorization.types';
import type {
  PolicyDecisionResult,
  PolicyEvidenceSnapshot,
  PolicyEvaluationCommand,
  PolicyLimitOutput,
  PolicyLimitUsageContext,
} from '../policy/capability-policy.types';
import type { PolicyEvidenceCollectionCommand } from '../policy/capability-policy-evidence.types';
import type {
  CustomerFinancialAccountBindingAssertion,
  CustomerFinancialAccountBindingValidation,
} from '../wallet/customer-financial-account-binding.types';

export const INTERNAL_TRANSFER_GATE_IDEMPOTENCY_SCOPE = 'wallet.transfer.create.v1';
export const INTERNAL_TRANSFER_POLICY_IDEMPOTENCY_SCOPE = 'policy.capability-decision.v1';
export const INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE = 'profile.wallet-transfer-create.v1';
export const INTERNAL_TRANSFER_BINDING_PORT = 'INTERNAL_TRANSFER_BINDING_PORT';
export const INTERNAL_TRANSFER_IDEMPOTENCY_PORT = 'INTERNAL_TRANSFER_IDEMPOTENCY_PORT';
export const INTERNAL_TRANSFER_AUDIT_PORT = 'INTERNAL_TRANSFER_AUDIT_PORT';

export type InternalTransferGateFailureCode =
  | 'COMMAND_INVALID'
  | 'CAPABILITY_ACTION_UNSUPPORTED'
  | 'IDENTITY_INVALID'
  | 'IDENTITY_MISMATCH'
  | 'SELF_TRANSFER'
  | 'AMOUNT_INVALID'
  | 'CURRENCY_INVALID'
  | 'CURRENCY_MISMATCH'
  | 'ACCOUNTING_UNIT_MISMATCH'
  | 'REFERENCE_INVALID'
  | 'NARRATION_INVALID'
  | 'AUTHORIZATION_REQUIRED'
  | 'POLICY_NOT_EXECUTABLE'
  | 'BINDING_NOT_ACTIVE'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'ACCOUNT_ASSERTION_MISMATCH'
  | 'ACCOUNT_DIMENSION_MISMATCH'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'OPERATIONS_EVIDENCE_UNAVAILABLE';

export interface InternalTransferGateFailure {
  readonly code: InternalTransferGateFailureCode;
  readonly message: string;
  readonly statusCode: number;
}

export interface InternalTransferRequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly causationId?: string;
}

export interface InternalTransferPolicyContext {
  readonly evidenceProfile?: string;
  readonly policyVersionHint?: string;
  readonly expectedDecisionReference?: string;
  readonly expectedProfileReference?: string;
  readonly expectedProfileVersion?: number;
  readonly expectedEvidenceSnapshotReference?: string;
  readonly expectedNormalizedInputHash?: string;
  readonly limitUsage?: PolicyLimitUsageContext;
}

/**
 * A5T02's customer-aware command as consumed by the A5T03 gate. The gate
 * accepts no transport-specific DTO and does not contain a transfer result.
 */
export interface InternalTransferGateCommand {
  readonly contractVersion: 1;
  readonly commandType: 'INTERNAL_TRANSFER';
  readonly commandId: string;
  readonly capability: 'wallet.transfer';
  readonly action: 'create';
  readonly scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER';
  readonly sourceCustomerId: string;
  readonly destinationCustomerId: string;
  readonly sourceCustomerWalletId: string;
  readonly destinationCustomerWalletId: string;
  readonly sourceBindingId: string;
  readonly destinationBindingId: string;
  readonly sourceWalletAccountId: string;
  readonly destinationWalletAccountId: string;
  readonly sourceLedgerAccountId: string;
  readonly destinationLedgerAccountId: string;
  readonly sourceBindingVersion: number;
  readonly destinationBindingVersion: number;
  readonly amountMinor: string | number | bigint;
  readonly currency: string;
  readonly accountingUnit?: string;
  readonly reference?: string | null;
  readonly narration?: string | null;
  readonly authorizationContextReference: string;
  readonly principal: AuthorizationPrincipal;
  readonly policy: InternalTransferPolicyContext;
  readonly requestContext: InternalTransferRequestContext;
  readonly requestedAt: string;
  readonly idempotencyKey: string;
}

export interface NormalizedInternalTransferGateCommand
  extends Omit<
    InternalTransferGateCommand,
    | 'contractVersion'
    | 'commandType'
    | 'amountMinor'
    | 'currency'
    | 'accountingUnit'
    | 'reference'
    | 'narration'
    | 'sourceBindingVersion'
    | 'destinationBindingVersion'
    | 'requestContext'
    | 'requestedAt'
    | 'idempotencyKey'
  > {
  readonly contractVersion: 1;
  readonly commandType: 'INTERNAL_TRANSFER';
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly reference: string | null;
  readonly narration: string | null;
  readonly sourceBindingVersion: number;
  readonly destinationBindingVersion: number;
  readonly requestContext: InternalTransferRequestContext;
  readonly requestedAt: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface InternalTransferGateAuthorizationView {
  readonly allowed: true;
  readonly principalType: AuthorizationDecision['principalType'];
  readonly principalId: string;
  readonly resourceType: string;
  readonly action: string;
  readonly evaluatedAt: string;
}

export interface InternalTransferGatePolicyView {
  readonly decision: PolicyDecisionResult['decision'];
  readonly decisionReference: string;
  readonly profileReference: string;
  readonly profileVersion: number;
  readonly policyVersion: string;
  readonly evidenceSnapshotReference: string;
  readonly normalizedInputHash: string;
  readonly expiresAt: string | null;
  readonly reviewAt: string | null;
  readonly obligations: readonly InternalTransferGateObligation[];
  readonly limits: readonly PolicyLimitOutput[];
}

export interface InternalTransferGateObligation {
  readonly obligationCode: string;
  readonly required: boolean;
  readonly dueAt?: string;
  readonly expiresAt?: string;
  readonly reference?: string;
}

export interface InternalTransferGateBindingView {
  readonly bindingId: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly bindingVersion: number;
  readonly currency: string;
  readonly accountingUnit: string;
}

export interface InternalTransferGateResult {
  readonly gateVersion: 1;
  readonly status: 'PASSED';
  readonly commandId: string;
  readonly requestHash: string;
  readonly idempotencyScope: typeof INTERNAL_TRANSFER_GATE_IDEMPOTENCY_SCOPE;
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly sourceCustomerId: string;
  readonly destinationCustomerId: string;
  readonly sourceWalletAccountId: string;
  readonly destinationWalletAccountId: string;
  readonly sourceLedgerAccountId: string;
  readonly destinationLedgerAccountId: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly a2Authorization: InternalTransferGateAuthorizationView;
  readonly policy: InternalTransferGatePolicyView;
  readonly sourceBinding: InternalTransferGateBindingView;
  readonly destinationBinding: InternalTransferGateBindingView;
  readonly requestContext: InternalTransferRequestContext;
}

export interface InternalTransferGateIdempotencyCommand {
  readonly scope: typeof INTERNAL_TRANSFER_GATE_IDEMPOTENCY_SCOPE;
  readonly key: string;
  readonly requestHash: string;
}

export interface InternalTransferGateIdempotencyReservation {
  readonly kind: 'NEW' | 'REPLAY' | 'IN_PROGRESS';
  readonly reservationId: string;
  readonly result?: InternalTransferGateResult;
  readonly failure?: InternalTransferGateFailure;
}

export interface InternalTransferGateIdempotencyPort {
  reserve(
    command: InternalTransferGateIdempotencyCommand,
  ): Promise<InternalTransferGateIdempotencyReservation>;
  complete(reservationId: string, result: InternalTransferGateResult): Promise<void>;
  fail(reservationId: string, failure: InternalTransferGateFailure): Promise<void>;
}

export interface InternalTransferGateAuditFact {
  readonly action: 'PASSED' | 'REJECTED' | 'REPLAYED';
  readonly commandId: string;
  readonly actor: string;
  readonly sourceCustomerId: string;
  readonly destinationCustomerId: string;
  readonly sourceBindingId: string;
  readonly destinationBindingId: string;
  readonly requestHash: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly policyDecisionReference?: string;
  readonly policyVersion?: string;
  readonly failureCode?: InternalTransferGateFailureCode;
}

export interface InternalTransferGateAuditPort {
  record(fact: InternalTransferGateAuditFact): Promise<void>;
}

export interface InternalTransferBindingPort {
  validateActiveBinding(
    assertion: CustomerFinancialAccountBindingAssertion,
  ): Promise<CustomerFinancialAccountBindingValidation>;
}

export type InternalTransferPolicyEvaluationPort = {
  evaluate(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult>;
};

export type InternalTransferEvidenceCoordinatorPort = {
  collect(command: PolicyEvidenceCollectionCommand): Promise<PolicyEvidenceSnapshot>;
};
