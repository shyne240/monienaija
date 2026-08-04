import type {
  CustomerFundingInstrumentStatus,
  CustomerFundingInstrumentType,
  FundingInstrumentVerificationState,
} from './customer-funding-instrument.enums';

export interface CreateCustomerFundingInstrumentCommand {
  type: CustomerFundingInstrumentType;
  displayName: string;
  reference: string;
  actor: string;
}

export interface UpdateCustomerFundingInstrumentCommand {
  status: CustomerFundingInstrumentStatus;
  actor: string;
  version?: number;
}

export interface VerifyCustomerFundingInstrumentCommand {
  verifiedBy: string;
  verificationMethod: string;
  remarks?: string;
}

export interface CustomerFundingInstrumentView {
  id: string;
  customerId: string;
  type: CustomerFundingInstrumentType;
  displayName: string;
  reference: string;
  status: CustomerFundingInstrumentStatus;
  verificationState: FundingInstrumentVerificationState;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
