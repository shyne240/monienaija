import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * The executed provider binding, reported by the authority that authorized it.
 *
 * `providerKey` and `environment` are recorded because dispatch must submit to the provider the
 * commitment was authorized under — not to whichever provider is configured at dispatch time. Those
 * can differ: an approval can be withdrawn, or a new provider engaged, between authorization and
 * dispatch. Dispatching under a different provider would send the money somewhere the customer never
 * authorized.
 */
export interface WithdrawalExecutionAuthorization {
  readonly outcome: 'AUTHORIZED' | 'DENIED' | 'UNAVAILABLE';
  readonly providerKey: string | null;
  readonly environment: 'sandbox' | 'production' | null;
}

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
      /**
       * ARENA 5 — which authenticated lane is debiting. Defaults to `CUSTOMER`, which is the
       * historical contract. `AGENT` binds the same check to the agent operating wallet and the
       * agent owner reference instead. `customerId` carries the owner reference in both lanes.
       */
      participantKind?: 'CUSTOMER' | 'AGENT';
    },
  ): Promise<WithdrawalExecutionAuthorization>;
}
export const WITHDRAWAL_EXECUTION_AUTHORITY = Symbol('WITHDRAWAL_EXECUTION_AUTHORITY');

@Injectable()
export class UnavailableWithdrawalExecutionAuthority implements WithdrawalExecutionAuthority {
  authorize(): Promise<WithdrawalExecutionAuthorization> {
    return Promise.resolve({
      outcome: 'UNAVAILABLE',
      providerKey: null,
      environment: null,
    });
  }
}
