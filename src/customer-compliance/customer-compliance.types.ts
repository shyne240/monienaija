import type {
  ComplianceCaseCategory,
  ComplianceCaseSeverity,
  ComplianceCaseStatus,
} from './customer-compliance.enums';

export interface CreateComplianceCaseCommand {
  caseNumber: string;
  category: ComplianceCaseCategory;
  severity: ComplianceCaseSeverity;
}

export interface UpdateComplianceCaseCommand {
  status?: ComplianceCaseStatus;
  resolution?: string;
  version?: number;
}

export interface CreateComplianceCaseCommentCommand {
  comment: string;
}

export interface CreateComplianceCaseEvidenceCommand {
  documentName: string;
  documentType: string;
  reference: string;
}

export interface CreateComplianceCaseAssignmentCommand {
  assignedTo: string;
}
