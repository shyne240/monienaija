export enum CustomerFundingInstrumentType {
  BANK_ACCOUNT = 'BANK_ACCOUNT',
  MOBILE_MONEY = 'MOBILE_MONEY',
  CASH_AGENT = 'CASH_AGENT',
  INTERNAL_SETTLEMENT = 'INTERNAL_SETTLEMENT',
}

export enum CustomerFundingInstrumentStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
  REJECTED = 'REJECTED',
}

export enum FundingInstrumentVerificationState {
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum FundingInstrumentHistoryAction {
  CREATED = 'CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  VERIFIED = 'VERIFIED',
  OWNERSHIP_CREATED = 'OWNERSHIP_CREATED',
}
