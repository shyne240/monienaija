import type { MonnifyVerificationProvider } from '../identity-verification/monnify-verification.provider';
import type { IdentityDetails, KycProvider, ProviderResult, VerificationInput } from './kyc.types';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateParts(date: string): string | null {
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const mon = /^(\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})$/.exec(date);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (mon) {
    year = Number(mon[3]);
    month = months.indexOf(mon[2]!) + 1;
    day = Number(mon[1]);
  } else return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  )
    return null;
  return `${String(day).padStart(2, '0')}-${months[month - 1]}-${year}`;
}
function normalizedName(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleUpperCase('en');
}
export function matchNinDetails(
  expected: IdentityDetails,
  actual: { firstName: string; lastName: string; dateOfBirth: string },
): boolean {
  const date = dateParts(expected.dateOfBirth);
  return (
    !!date &&
    date === dateParts(actual.dateOfBirth) &&
    !!normalizedName(expected.firstName) &&
    !!normalizedName(expected.lastName) &&
    normalizedName(expected.firstName) === normalizedName(actual.firstName) &&
    normalizedName(expected.lastName) === normalizedName(actual.lastName)
  );
}
/** Only reuse the existing adapter; never interpret provider availability as an identity mismatch. */
export class MonnifyKycProvider implements KycProvider {
  readonly code = 'MONNIFY';
  constructor(private readonly adapter: MonnifyVerificationProvider) {}
  async verify(input: VerificationInput, signal: AbortSignal): Promise<ProviderResult> {
    if (signal.aborted) throw new Error('Aborted');
    if (input.kind === 'NIN') {
      const result = await this.adapter.getNinDetails(input.identifier);
      return { outcome: matchNinDetails(input.identity, result) ? 'MATCH' : 'REVIEW' };
    }
    const dateOfBirth = dateParts(input.identity.dateOfBirth);
    if (!dateOfBirth) throw new Error('Invalid identity date');
    const result = await this.adapter.matchBvnDetails({
      bvn: input.identifier,
      name: `${input.identity.firstName} ${input.identity.lastName}`,
      dateOfBirth,
      mobileNo: input.identity.phone,
    });
    return { outcome: result.match ? 'MATCH' : 'REVIEW' };
  }
}
