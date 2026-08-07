import { ConflictException } from '@nestjs/common';

import { TransferStatus } from './transfer.enums';

export const TRANSFER_STATUS_TRANSITIONS: Readonly<
  Record<TransferStatus, readonly TransferStatus[]>
> = {
  [TransferStatus.PENDING]: [
    TransferStatus.PROCESSING,
    TransferStatus.PENDING_RECOVERY,
    TransferStatus.UNKNOWN,
    TransferStatus.FAILED,
    TransferStatus.CANCELLED,
  ],
  [TransferStatus.PROCESSING]: [
    TransferStatus.COMPLETED,
    TransferStatus.PENDING_RECOVERY,
    TransferStatus.UNKNOWN,
    TransferStatus.FAILED,
  ],
  [TransferStatus.PENDING_RECOVERY]: [
    TransferStatus.PROCESSING,
    TransferStatus.COMPLETED,
    TransferStatus.UNKNOWN,
    TransferStatus.FAILED,
  ],
  [TransferStatus.UNKNOWN]: [
    TransferStatus.PENDING_RECOVERY,
    TransferStatus.COMPLETED,
    TransferStatus.FAILED,
  ],
  [TransferStatus.COMPLETED]: [],
  [TransferStatus.FAILED]: [],
  [TransferStatus.CANCELLED]: [],
};

export function assertTransferTransition(current: TransferStatus, next: TransferStatus): void {
  if (!TRANSFER_STATUS_TRANSITIONS[current]?.includes(next)) {
    throw new ConflictException(`Invalid transfer state transition from ${current} to ${next}`);
  }
}

export function isTerminalTransferStatus(status: TransferStatus): boolean {
  return (
    status === TransferStatus.COMPLETED ||
    status === TransferStatus.FAILED ||
    status === TransferStatus.CANCELLED
  );
}
