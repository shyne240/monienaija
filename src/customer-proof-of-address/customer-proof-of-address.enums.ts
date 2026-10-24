export enum CustomerProofOfAddressReviewStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
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
