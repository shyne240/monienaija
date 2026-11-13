import { Injectable } from '@nestjs/common';

/** A trusted adapter authenticates the provider independently; caller claims are never evidence.
 * RECEIVED means the stated amount reached a platform-controlled settlement account, not merely
 * that a transfer was submitted or acknowledged. No live adapter is provided here. */
export type InboundVerification =
  | { state: 'UNKNOWN' }
  | { state: 'UNAVAILABLE' }
  | {
      state: 'RECEIVED';
      providerKey: string;
      providerReference: string;
      bankCode: string;
      accountNumber: string;
      amountMinor: string;
      currency: string;
      observedAt: string;
    };

export interface InboundFundingVerifier {
  verify(input: { providerKey: string; providerReference: string }): Promise<InboundVerification>;
}

export const INBOUND_FUNDING_VERIFIER = Symbol('INBOUND_FUNDING_VERIFIER');

@Injectable()
export class UnavailableInboundFundingVerifier implements InboundFundingVerifier {
  verify(): Promise<InboundVerification> {
    return Promise.resolve({ state: 'UNAVAILABLE' });
  }
}
