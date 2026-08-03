import type { BankStatus } from './bank.enums';

export interface CreateBankCommand {
  bankCode: string;
  bankName: string;
  shortName: string;
  nipSupported: boolean;
  status: BankStatus;
}

export interface UpdateBankCommand {
  bankName?: string;
  shortName?: string;
  nipSupported?: boolean;
  status?: BankStatus;
}

export interface BankView {
  id: string;
  bankCode: string;
  bankName: string;
  shortName: string;
  nipSupported: boolean;
  status: BankStatus;
  createdAt: Date;
  updatedAt: Date;
}
