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
