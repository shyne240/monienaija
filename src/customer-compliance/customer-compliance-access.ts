import type { AuthorizationRequest } from '../authorization/authorization.types';
import { ComplianceCaseCategory } from './customer-compliance.enums';

/** Access established by the workforce guard, never supplied by an HTTP client. */
export interface ComplianceCaseAccess {
  readonly actor: string;
  readonly categories: readonly ComplianceCaseCategory[];
}

export interface ComplianceCaseRequest extends AuthorizationRequest {
  method: string;
  params: { id?: string; caseId?: string };
  complianceCaseAccess: ComplianceCaseAccess;
}

// Explicit lists intentionally fail closed for any future category until it is reviewed.
export const NON_FRAUD_CASE_CATEGORIES: readonly ComplianceCaseCategory[] = Object.freeze([
  ComplianceCaseCategory.KYC,
  ComplianceCaseCategory.AML,
  ComplianceCaseCategory.SANCTIONS,
  ComplianceCaseCategory.PEP,
  ComplianceCaseCategory.DOCUMENT,
  ComplianceCaseCategory.ACCOUNT_REVIEW,
  ComplianceCaseCategory.MANUAL_REVIEW,
  ComplianceCaseCategory.OTHER,
]);

export const FRAUD_CASE_CATEGORIES: readonly ComplianceCaseCategory[] = Object.freeze([
  ComplianceCaseCategory.FRAUD,
]);
