export enum CustomerProofOfAddressReviewStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

/** File safety/lifecycle state is deliberately separate from documentary review. */
export enum CustomerProofOfAddressDocumentStatus {
  QUARANTINED = 'QUARANTINED',
  AVAILABLE = 'AVAILABLE',
  SUPERSEDED = 'SUPERSEDED',
  WITHDRAWN = 'WITHDRAWN',
  ARCHIVED = 'ARCHIVED',
}

export enum CustomerProofOfAddressScannerResult {
  CLEAN = 'CLEAN',
  INFECTED = 'INFECTED',
  UNAVAILABLE = 'UNAVAILABLE',
  ERROR = 'ERROR',
}

export enum CustomerProofOfAddressDocumentHistoryAction {
  UPLOADED = 'UPLOADED',
  SCAN_CLEAN = 'SCAN_CLEAN',
  QUARANTINED = 'QUARANTINED',
  SUPERSEDED = 'SUPERSEDED',
  WITHDRAWN = 'WITHDRAWN',
  ARCHIVED = 'ARCHIVED',
}

export enum CustomerProofOfAddressHistoryAction {
  SUBMITTED = 'SUBMITTED',
  RESUBMITTED = 'RESUBMITTED',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum PhysicalAddressVerificationStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  DECIDED = 'DECIDED',
}

export enum PhysicalAddressVerificationOutcome {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum PhysicalAddressVerificationHistoryAction {
  ASSIGNED = 'ASSIGNED',
  VISIT_RECORDED = 'VISIT_RECORDED',
  FINDINGS_SUBMITTED = 'FINDINGS_SUBMITTED',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}
