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
  reference?: string;
  type: CustomerType;
  status?: CustomerStatus;
  actor: string;
}

export interface UpdateCustomerCommand {
  status?: CustomerStatus;
  actor: string;
}

export interface CreateProfileCommand {
  displayName: string;
  legalName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth?: string;
  nationality?: string;
  actor: string;
}

export interface UpdateProfileCommand {
  displayName?: string;
  legalName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
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

export interface UpdateAddressCommand {
  type?: AddressType;
  lineOne?: string;
  lineTwo?: string | null;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string | null;
  isPrimary?: boolean;
  actor: string;
}

export interface CreateContactCommand {
  type: ContactMethodType;
  value: string;
  isPrimary: boolean;
  actor: string;
}

export interface UpdateContactCommand {
  value?: string;
  isPrimary?: boolean;
  verificationToken?: string;
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

export interface UpdateIdentityDocumentCommand {
  type?: IdentityDocumentType;
  documentNumber?: string;
  issuingCountry?: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  actor: string;
}

export interface CreateKycAssessmentCommand {
  level: CustomerKycLevel;
  status: CustomerKycStatus;
  reason?: string;
  assessedBy: string;
  expiresAt?: string;
}
