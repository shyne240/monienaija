import type {
  CustomerProofOfAddressDocumentHistoryAction,
  CustomerProofOfAddressDocumentStatus,
  CustomerProofOfAddressReviewStatus,
  CustomerProofOfAddressScannerResult,
} from './customer-proof-of-address.enums';

export interface ProofOfAddressActor {
  principalId: string;
  roleKey: string;
}

export interface ProofOfAddressRequestAuditContext {
  correlationId: string;
  requestId: string;
}

export interface ProofOfAddressDocumentView {
  id: string;
  submissionGroupId: string;
  revisionNumber: number;
  supersedesSubmissionId: string | null;
  customerId: string;
  residentialAddressId: string;
  category: string;
  documentType: string;
  issuerName: string | null;
  documentDate: string | null;
  reviewStatus: CustomerProofOfAddressReviewStatus;
  documentStatus: CustomerProofOfAddressDocumentStatus;
  scannerResult: CustomerProofOfAddressScannerResult | null;
  originalFileName: string | null;
  detectedMimeType: string | null;
  fileSizeBytes: string | null;
  createdByPrincipalId: string;
  uploadedByPrincipalId: string | null;
  uploadedAt: Date | null;
  withdrawnAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProofOfAddressDocumentPage {
  items: ProofOfAddressDocumentView[];
  page: number;
  limit: number;
  total: number;
}

export interface ProofOfAddressDocumentHistoryView {
  id: string;
  submissionId: string;
  action: CustomerProofOfAddressDocumentHistoryAction;
  previousDocumentStatus: CustomerProofOfAddressDocumentStatus | null;
  newDocumentStatus: CustomerProofOfAddressDocumentStatus | null;
  actorPrincipalId: string;
  actorRoleKey: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface ProofOfAddressDocumentHistoryPage {
  items: ProofOfAddressDocumentHistoryView[];
  page: number;
  limit: number;
  total: number;
}

export interface ProofOfAddressDocumentContent {
  bytes: Buffer;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  fileName: string;
  fileSizeBytes: number;
}
