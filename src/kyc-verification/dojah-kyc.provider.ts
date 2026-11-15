import type { IdentityDetails, KycProvider, ProviderResult, VerificationInput } from './kyc.types';
import { matchNinDetails } from './monnify-kyc.provider';
import type { DojahVerificationProvider } from '../identity-verification/dojah-verification.provider';

/** Adapt only documented Dojah BVN/NIN operations; the governance router remains fail-closed. */
export class DojahKycProvider implements KycProvider {
  readonly code = 'DOJAH';

  constructor(private readonly adapter: DojahVerificationProvider) {}

  async verify(input: VerificationInput, signal: AbortSignal): Promise<ProviderResult> {
    if (signal.aborted) throw new Error('Aborted');
    if (input.kind === 'BVN') {
      const result = await this.adapter.validateBvn(
        {
          bvn: input.identifier,
          firstName: input.identity.firstName,
          lastName: input.identity.lastName,
          dateOfBirth: input.identity.dateOfBirth,
        },
        signal,
      );
      return { outcome: result.match ? 'MATCH' : 'REVIEW' };
    }

    const record = await this.adapter.getNinAdvanced(input.identifier, signal);
    const expected: IdentityDetails = input.identity;
    return {
      outcome:
        record.nin === input.identifier &&
        matchNinDetails(expected, {
          firstName: record.firstName,
          lastName: record.lastName,
          dateOfBirth: record.dateOfBirth,
        })
          ? 'MATCH'
          : 'REVIEW',
    };
  }
}
