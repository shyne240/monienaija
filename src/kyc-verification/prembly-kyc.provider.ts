import type { PremblyVerificationProvider } from '../identity-verification/prembly-verification.provider';
import type { KycProvider, ProviderResult, VerificationInput } from './kyc.types';
import { matchNinDetails } from './monnify-kyc.provider';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function canonicalProviderDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{2}-[A-Za-z]{3}-\d{4}$/.test(value)) return value;
  const match = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return null;
  return `${String(day).padStart(2, '0')}-${MONTHS[month - 1]}-${year}`;
}

/** Only Prembly's documented BVN/NIN Basic records can reach the existing consent-bound KYC flow. */
export class PremblyKycProvider implements KycProvider {
  readonly code = 'PREMBLY';

  constructor(private readonly adapter: PremblyVerificationProvider) {}

  async verify(input: VerificationInput, signal: AbortSignal): Promise<ProviderResult> {
    if (signal.aborted) throw new Error('Aborted');
    const record = await this.adapter.verify(input, signal);
    if (!record) return { outcome: 'REVIEW' };
    if (input.kind === 'NIN' && record.identifier !== input.identifier)
      throw new Error('Prembly identifier mismatch');
    const dateOfBirth = canonicalProviderDate(record.dateOfBirth);
    if (!dateOfBirth) throw new Error('Prembly identity date unavailable');
    return {
      outcome: matchNinDetails(input.identity, {
        firstName: record.firstName,
        lastName: record.lastName,
        dateOfBirth,
      })
        ? 'MATCH'
        : 'REVIEW',
    };
  }
}
