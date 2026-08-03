import type { BeneficiaryType } from './beneficiary.enums';

export interface CreateBeneficiaryCommand {
  customerId: string;
  nickname: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  type: BeneficiaryType;
}

export interface UpdateBeneficiaryCommand {
  nickname: string;
}

export interface BeneficiaryView {
  id: string;
  customerId: string;
  nickname: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  type: BeneficiaryType;
  createdAt: Date;
  updatedAt: Date;
}
