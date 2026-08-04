import type {
  ComplianceCaseCategory,
  ComplianceCaseSeverity,
  ComplianceCaseStatus,
} from './customer-compliance.enums';

export interface CreateComplianceCaseCommand {
  caseNumber: string;
  category: ComplianceCaseCategory;
  severity: ComplianceCaseSeverity;
  actor: string;
}

export interface UpdateComplianceCaseCommand {
  status?: ComplianceCaseStatus;
  resolution?: string;
  actor: string;
  version?: number;
}

export interface CreateComplianceCaseCommentCommand {
  comment: string;
  actor: string;
}

export interface CreateComplianceCaseEvidenceCommand {
  documentName: string;
  documentType: string;
  reference: string;
  uploadedBy: string;
}

export interface CreateComplianceCaseAssignmentCommand {
  assignedTo: string;
  actor: string;
}
