import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** An approved policy must explicitly authorize accounting for uncreditable received funds.
 * The test policy is not an approval for production. No production policy is supplied. */
export interface InboundSuspensePolicy {
  authorize(
    manager: EntityManager,
    input: {
      providerKey: string;
      providerReferenceHash: string;
      amountMinor: string;
      currency: string;
      virtualAccountId: string | null;
      walletAccountId: string | null;
    },
  ): Promise<'AUTHORIZED' | 'DENIED' | 'UNAVAILABLE'>;
}

export const INBOUND_SUSPENSE_POLICY = Symbol('INBOUND_SUSPENSE_POLICY');

@Injectable()
export class UnavailableInboundSuspensePolicy implements InboundSuspensePolicy {
  authorize(): Promise<'UNAVAILABLE'> {
    return Promise.resolve('UNAVAILABLE');
  }
}
