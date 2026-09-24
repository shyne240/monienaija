import type {
  AddressType,
  ContactMethodType,
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
  IdentityDocumentType,
} from './customer.enums';

export interface CreateCustomerCommand {
  reference: string;
  type: CustomerType;
  status?: CustomerStatus;
  actor: string;
  /**
   * Optional primary Nigerian phone. When present, the customer's primary
   * PHONE contact method is created atomically with the customer using the
   * canonical +234########## representation.
   */
  phone?: string;
}

export interface UpdateCustomerCommand {
  status?: CustomerStatus;
  actor: string;
}

export interface CreateProfileCommand {
  displayName: string;
  legalName?: string;
  dateOfBirth?: string;
  nationality?: string;
  actor: string;
}

export interface CreateAddressCommand {
  type: AddressType;
  lineOne: string;
  lineTwo?: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string;
  isPrimary: boolean;
  actor: string;
}

export interface CreateContactCommand {
  type: ContactMethodType;
  value: string;
  isPrimary: boolean;
  actor: string;
}

export interface CreateIdentityDocumentCommand {
  type: IdentityDocumentType;
  documentNumber: string;
  issuingCountry: string;
  issuedAt?: string;
  expiresAt?: string;
  actor: string;
}

export interface CreateKycAssessmentCommand {
  level: CustomerKycLevel;
  status: CustomerKycStatus;
  reason?: string;
  assessedBy: string;
  expiresAt?: string;
}

/**
 * A1T28 — multi-status customer query.
 *
 * Each field is an INDEPENDENT status dimension already owned and persisted by
 * the `customers` aggregate. They are deliberately kept separate rather than
 * collapsed into a single status field: lifecycle `status`, `kycStatus` and
 * `kycLevel` are distinct concepts and one never implies another.
 *
 * Each dimension accepts MULTIPLE values (OR within a dimension); supplying
 * several dimensions narrows the result (AND across dimensions).
 *
 * Status dimensions owned by other domains (onboarding, eligibility,
 * authentication, wallet) are intentionally NOT included here: they live in
 * their own tables and are served by their own modules, and merging them would
 * collapse distinct lifecycle concepts into the A1 read model.
 */
export interface ListCustomersQuery {
  status?: readonly CustomerStatus[];
  kycStatus?: readonly CustomerKycStatus[];
  kycLevel?: readonly CustomerKycLevel[];
  type?: readonly CustomerType[];
  page?: number;
  limit?: number;
}
