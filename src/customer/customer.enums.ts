export enum CustomerType {
  INDIVIDUAL = 'INDIVIDUAL',
  BUSINESS = 'BUSINESS',
}

export enum CustomerStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

export enum CustomerKycLevel {
  NONE = 'NONE',
  LEVEL_1 = 'LEVEL_1',
  LEVEL_2 = 'LEVEL_2',
  LEVEL_3 = 'LEVEL_3',
}

export enum CustomerKycStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum IdentityDocumentType {
  BVN = 'BVN',
  NIN = 'NIN',
  INTERNATIONAL_PASSPORT = 'INTERNATIONAL_PASSPORT',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  VOTERS_CARD = 'VOTERS_CARD',
  BUSINESS_REGISTRATION = 'BUSINESS_REGISTRATION',
}

export enum ContactMethodType {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
}

export enum AddressType {
  RESIDENTIAL = 'RESIDENTIAL',
  BUSINESS = 'BUSINESS',
  MAILING = 'MAILING',
}
