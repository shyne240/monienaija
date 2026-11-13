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
