import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** Integration point for authoritative institutional entitlement and independent destination
 * ownership evidence. The implementation must bind the exact customer, wallet, destination,
 * amount and currency under the caller's transaction; a beneficiary flag or provider identity
 * is not such evidence. No production implementation is supplied. */
export interface WithdrawalExecutionAuthority {
  authorize(
    manager: EntityManager,
    input: {
      customerId: string;
      walletAccountId: string;
      beneficiaryId: string;
      beneficiaryVersion: number;
      bankId: string;
      bankCode: string;
      accountNumber: string;
      targetReference: string;
      amountMinor: string;
      currency: string;
    },
  ): Promise<'AUTHORIZED' | 'DENIED' | 'UNAVAILABLE'>;
}
export const WITHDRAWAL_EXECUTION_AUTHORITY = Symbol('WITHDRAWAL_EXECUTION_AUTHORITY');

@Injectable()
export class UnavailableWithdrawalExecutionAuthority implements WithdrawalExecutionAuthority {
  authorize(): Promise<'UNAVAILABLE'> {
    return Promise.resolve('UNAVAILABLE');
  }
}
