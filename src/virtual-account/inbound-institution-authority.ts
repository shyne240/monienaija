import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** Port to Arena 4's future authoritative institution resolver. The implementation must
 * establish which institution owns the settlement account and is permitted to receive the
 * verified payment, and bind the destination and product scope to that same institution.
 * It must not infer affiliation from a provider/aggregator. No production authority exists. */
export interface InboundInstitutionAuthority {
  authorize(
    manager: EntityManager,
    input: {
      providerKey: string;
      bankCode: string;
      accountNumber: string;
      currency: string;
      amountMinor: string;
      providerReferenceHash: string;
      virtualAccountId: string | null;
      walletAccountId: string | null;
    },
  ): Promise<'AUTHORIZED' | 'DENIED' | 'UNAVAILABLE'>;
}

export const INBOUND_INSTITUTION_AUTHORITY = Symbol('INBOUND_INSTITUTION_AUTHORITY');

@Injectable()
export class UnavailableInboundInstitutionAuthority implements InboundInstitutionAuthority {
  authorize(): Promise<'UNAVAILABLE'> {
    return Promise.resolve('UNAVAILABLE');
  }
}
