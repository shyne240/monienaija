import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { PrivilegedActionApprovalView } from '../authorization/privileged-action-approval.types';
import type { RequestContext } from '../production/request-context';

export type B2FFinanceRole =
  | 'FINANCE_PREPARER'
  | 'FINANCE_APPROVER'
  | 'FINANCE_CONTROLLER'
  | 'FINANCE_AUDITOR';
export type B2FFinanceControlAction =
  | 'FINANCE_JOURNAL_POST'
  | 'FINANCE_PERIOD_OPEN'
  | 'FINANCE_PERIOD_SOFT_CLOSE'
  | 'FINANCE_PERIOD_HARD_CLOSE'
  | 'FINANCE_PERIOD_REOPEN'
  | 'FINANCE_PERIOD_RETIRE'
  | 'FINANCE_ACCOUNT_MAPPING_ACTIVATE'
  | 'FINANCE_ACCOUNT_MAPPING_RETIRE'
  | 'FINANCE_MATERIALITY_OVERRIDE'
  | 'FINANCE_EXCEPTION_ACCEPT';
export type B2FMaterialityBandName = 'STANDARD' | 'ELEVATED' | 'MATERIAL';
export interface B2FMaterialityBandV1 {
  readonly name: B2FMaterialityBandName;
  readonly minimumMinor: string;
  readonly maximumMinor: string | null;
  readonly requiredCheckerRoles: readonly B2FFinanceRole[];
  readonly requiredApprovalCount: number;
  readonly overrideEvidenceRequired: boolean;
}
export interface B2FActionControlV1 {
  readonly action: B2FFinanceControlAction;
  readonly makerRoles: readonly B2FFinanceRole[];
  readonly checkerRoles: readonly B2FFinanceRole[];
  readonly minimumApprovals: number;
  readonly materialityApplies: boolean;
  readonly overrideEvidenceRequired: boolean;
}
export interface B2FFinanceControlPolicyDefinitionV1 {
  readonly policyKey: 'finance.control-policy.ng.primary';
  readonly policyVersion: number;
  readonly materialityBands: readonly B2FMaterialityBandV1[];
  readonly actionControls: readonly B2FActionControlV1[];
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}
export interface B2FFinanceControlPolicyCommandV1 {
  readonly definition: B2FFinanceControlPolicyDefinitionV1;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly now?: Date;
}
export interface B2FFinanceControlEvaluationV1 {
  readonly action: B2FFinanceControlAction;
  readonly amountMinor: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly resourceHash: string;
  readonly makerPrincipalId: string;
  readonly makerRoles: readonly string[];
  readonly executorPrincipal: AuthorizationPrincipal;
  readonly approvals: readonly PrivilegedActionApprovalView[];
  readonly overrideEvidenceReference?: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly evaluatedAt?: Date;
}
export interface B2FFinanceControlDecisionV1 {
  readonly decisionReference: string;
  readonly outcome: 'ALLOW' | 'DENY';
  readonly action: B2FFinanceControlAction;
  readonly materialityBand: B2FMaterialityBandName | null;
  readonly policyKey: string;
  readonly policyVersion: number;
  readonly makerPrincipalId: string;
  readonly checkerPrincipalIds: readonly string[];
  readonly executorPrincipalId: string;
  readonly approvalReferences: readonly string[];
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly resourceHash: string;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly reasons: readonly string[];
  readonly overrideEvidenceReference: string | null;
  readonly evaluatedAt: string;
  readonly replayed: boolean;
}
export interface B2FFinanceControlConsumerPortsV1 {
  readonly contractName: 'B2F-FINANCE-CONTROL';
  readonly contractVersion: 1;
  readonly evaluate: (
    request: B2FFinanceControlEvaluationV1,
  ) => Promise<B2FFinanceControlDecisionV1>;
  readonly getActivePolicy: () => Promise<B2FFinanceControlPolicyDefinitionV1 | null>;
}
