import type { VirtualAccountStatus } from './virtual-account.enums';

export interface AssignVirtualAccountCommand {
  walletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  provider: string;
}

export interface VirtualAccountView {
  id: string;
  walletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  provider: string;
  status: VirtualAccountStatus;
  reference: string;
  assignedAt: Date;
  deactivatedAt: Date | null;
}
