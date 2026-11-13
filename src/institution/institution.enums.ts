/**
 * ARENA 4 — institutional foundation enums.
 *
 * The institution lifecycle deliberately separates *administrative registration* and *regulatory
 * evidence* from *operational approval*. Only `APPROVED` confers authority to provide financial
 * services: a recorded licence reference is evidence supplied for verification, never proof of a
 * valid licence, and recording it never activates an institution.
 */
export enum FinancialInstitutionStatus {
  /** Administratively registered. Not authorized to provide financial services. */
  REGISTERED = 'REGISTERED',
  /** Regulatory evidence recorded for verification. Still not authorized. */
  EVIDENCE_SUBMITTED = 'EVIDENCE_SUBMITTED',
  /** Operationally approved. The only status that yields financial authority. */
  APPROVED = 'APPROVED',
  /** Authority withdrawn. Existing affiliations stay recorded but resolve unusable. */
  SUSPENDED = 'SUSPENDED',
  /** Terminal. No new affiliations, no financial authority, no deletion. */
  CLOSED = 'CLOSED',
}

export enum FinancialInstitutionType {
  MMO = 'MMO',
  COMMERCIAL_BANK = 'COMMERCIAL_BANK',
  MICROFINANCE_BANK = 'MICROFINANCE_BANK',
  PAYMENT_SERVICE_BANK = 'PAYMENT_SERVICE_BANK',
  PSP = 'PSP',
  PARTNER = 'PARTNER',
}

export enum InstitutionAffiliationStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  TERMINATED = 'TERMINATED',
}

export enum InstitutionAffiliationChangeKind {
  ASSIGN = 'ASSIGN',
  TRANSFER = 'TRANSFER',
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
  TERMINATE = 'TERMINATE',
}

/**
 * Evidence classes a governed affiliation change may cite. `AGGREGATOR_RELATIONSHIP` is evidence a
 * human records and an independent checker verifies — it is never an automatic determination.
 */
export enum InstitutionAffiliationEvidenceType {
  INSTITUTION_APPROVAL_LETTER = 'INSTITUTION_APPROVAL_LETTER',
  REGULATOR_RECORD = 'REGULATOR_RECORD',
  OPERATIONAL_DIRECTIVE = 'OPERATIONAL_DIRECTIVE',
  CONTRACT_REFERENCE = 'CONTRACT_REFERENCE',
  AGGREGATOR_RELATIONSHIP = 'AGGREGATOR_RELATIONSHIP',
}

export const INSTITUTION_AFFILIATION_EVIDENCE_TYPES: readonly InstitutionAffiliationEvidenceType[] =
  Object.values(InstitutionAffiliationEvidenceType);

/** Registered governed-action names used by this module. */
export const INSTITUTION_AFFILIATION_ACTION = 'INSTITUTION_AGENT_AFFILIATION_CHANGE';
export const INSTITUTION_LIFECYCLE_ACTION = 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE';
export const INSTITUTION_AFFILIATION_RESOURCE = 'AGENT';
export const INSTITUTION_LIFECYCLE_RESOURCE = 'FINANCIAL_INSTITUTION';

// --------------------------------------------------------------------------- Phase 2 additions

/** Governed action: institutional attribution of a wallet and its ledger account. */
export const WALLET_INSTITUTION_ATTRIBUTION_ACTION = 'WALLET_INSTITUTION_ATTRIBUTION';
/** Governed action: creation/transition of a customer institution enrolment. */
export const CUSTOMER_INSTITUTION_ENROLMENT_CHANGE_ACTION = 'CUSTOMER_INSTITUTION_ENROLMENT_CHANGE';

export const WALLET_ATTRIBUTION_RESOURCE = 'WALLET_ACCOUNT';
export const ENROLMENT_RESOURCE = 'CUSTOMER';

/**
 * Customer institution enrolment lifecycle. One customer identity may hold several enrolments (one
 * per institution); each is an independent financial relationship with its own lifecycle.
 *
 *  PENDING   — requested/approved but not yet financially usable at the institution.
 *  ACTIVE    — the only status that can back a financial relationship (`financial_eligibility`
 *              may still be PENDING_KYC / RESTRICTED, which are separate gates).
 *  SUSPENDED — temporarily unusable; the enrolment and its history remain.
 *  CLOSED    — terminal; never reopened, never deleted.
 */
export enum CustomerInstitutionEnrolmentStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

/**
 * Institutional financial eligibility. Deliberately separate from the global customer KYC level:
 * a globally verified customer is NOT automatically financially eligible at an institution.
 */
export enum InstitutionFinancialEligibility {
  PENDING_KYC = 'PENDING_KYC',
  ELIGIBLE = 'ELIGIBLE',
  RESTRICTED = 'RESTRICTED',
}

/** Evidence classes a governed wallet institutional attribution may cite. */
export enum InstitutionAttributionEvidenceType {
  INSTITUTION_AGREEMENT = 'INSTITUTION_AGREEMENT',
  CUSTOMER_MANDATE = 'CUSTOMER_MANDATE',
  REGULATOR_RECORD = 'REGULATOR_RECORD',
  OPERATIONAL_DIRECTIVE = 'OPERATIONAL_DIRECTIVE',
  SETTLEMENT_INSTRUCTION = 'SETTLEMENT_INSTRUCTION',
}

export const INSTITUTION_ATTRIBUTION_EVIDENCE_TYPES: readonly InstitutionAttributionEvidenceType[] =
  Object.values(InstitutionAttributionEvidenceType);

/**
 * Ledger account institutional scope (mirrors the database CHECK constraint).
 *
 * `UNATTRIBUTED` is never an institutional bypass: it is the honest historical state and it can
 * only take part in journals that have no institutional context at all.
 */
export enum LedgerInstitutionalScope {
  UNATTRIBUTED = 'UNATTRIBUTED',
  INSTITUTION = 'INSTITUTION',
  PLATFORM = 'PLATFORM',
}

/** Institution-specific account purposes. `PLATFORM_OPERATIONS` is the only platform purpose. */
export enum LedgerInstitutionalPurpose {
  CUSTOMER_FUNDS = 'CUSTOMER_FUNDS',
  SETTLEMENT = 'SETTLEMENT',
  SUSPENSE = 'SUSPENSE',
  CLEARING = 'CLEARING',
  PLATFORM_OPERATIONS = 'PLATFORM_OPERATIONS',
}

/** Enrolment transitions permitted by the service (the DB trigger enforces the rest). */
export const ENROLMENT_TRANSITIONS: Readonly<
  Record<CustomerInstitutionEnrolmentStatus, CustomerInstitutionEnrolmentStatus[]>
> = {
  [CustomerInstitutionEnrolmentStatus.PENDING]: [
    CustomerInstitutionEnrolmentStatus.ACTIVE,
    CustomerInstitutionEnrolmentStatus.CLOSED,
  ],
  [CustomerInstitutionEnrolmentStatus.ACTIVE]: [
    CustomerInstitutionEnrolmentStatus.SUSPENDED,
    CustomerInstitutionEnrolmentStatus.CLOSED,
  ],
  [CustomerInstitutionEnrolmentStatus.SUSPENDED]: [
    CustomerInstitutionEnrolmentStatus.ACTIVE,
    CustomerInstitutionEnrolmentStatus.CLOSED,
  ],
  [CustomerInstitutionEnrolmentStatus.CLOSED]: [],
};
