import type {
  CustomerBeneficiaryStatus,
  CustomerBeneficiaryType,
} from './customer-beneficiary.enums';

export interface CreateCustomerBeneficiaryCommand {
  type: CustomerBeneficiaryType;
  displayName: string;
  reference: string;
  destinationIdentifier: string;
  destinationName?: string;
  destinationInstitution?: string;
  nickname?: string;
  actor: string;
}

export interface UpdateCustomerBeneficiaryCommand {
  status: CustomerBeneficiaryStatus;
  actor: string;
  version?: number;
}

export interface VerifyCustomerBeneficiaryCommand {
  verifiedBy: string;
  verificationMethod: string;
  remarks?: string;
}

export interface CustomerBeneficiaryView {
  id: string;
  customerId: string;
  type: CustomerBeneficiaryType;
  displayName: string;
  reference: string;
  destinationIdentifier: string;
  destinationName: string | null;
  destinationInstitution: string | null;
  nickname: string | null;
  status: CustomerBeneficiaryStatus;
  verified: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
