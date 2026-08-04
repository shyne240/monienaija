import type {
  CustomerAgreementType,
  CustomerApprovalDecisionStatus,
  CustomerOnboardingStatus,
  CustomerOnboardingTaskStatus,
  CustomerOnboardingTaskType,
  CustomerRiskLevel,
} from './customer-onboarding.enums';

export interface CreateCustomerOnboardingCommand {
  actor: string;
}

export interface UpdateCustomerOnboardingCommand {
  status: CustomerOnboardingStatus;
  actor: string;
  version?: number;
}

export interface CreateCustomerAgreementCommand {
  type: CustomerAgreementType;
  version: string;
  isRequired: boolean;
  accepted: boolean;
  acceptedBy?: string;
  actor: string;
}

export interface CreateCustomerRiskProfileCommand {
  riskLevel: CustomerRiskLevel;
  rationale?: string;
  assessedBy: string;
}

export interface CreateCustomerOnboardingTaskCommand {
  type: CustomerOnboardingTaskType;
  status: CustomerOnboardingTaskStatus;
  isRequired: boolean;
  completedBy?: string;
  notes?: string;
  actor: string;
}

export interface CreateCustomerApprovalDecisionCommand {
  decision: CustomerApprovalDecisionStatus;
  reason?: string;
  decidedBy: string;
}

export interface CustomerOnboardingReadiness {
  customerId: string;
  onboardingId: string | null;
  onboardingStatus: CustomerOnboardingStatus | null;
  status: 'READY' | 'NOT_READY';
  canComplete: boolean;
  missing: string[];
  checks: {
    customerActive: boolean;
    profilePresent: boolean;
    addressPresent: boolean;
    identityDocumentPresent: boolean;
    requiredAgreementsAccepted: boolean;
    requiredTasksCompleted: boolean;
    riskAllowed: boolean;
    onboardingNotRejected: boolean;
  };
  evaluatedAt: string;
}
