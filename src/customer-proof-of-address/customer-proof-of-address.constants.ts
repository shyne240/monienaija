export const CANDIDATE_PROOF_OF_ADDRESS_TYPES = [
  {
    category: 'UTILITY',
    type: 'UTILITY_BILL',
    label: 'Utility bill',
    policyApproved: false,
  },
  {
    category: 'TAX',
    type: 'TAX_ASSESSMENT',
    label: 'Tax assessment',
    policyApproved: false,
  },
  {
    category: 'BANK',
    type: 'BANK_STATEMENT',
    label: 'Bank statement',
    policyApproved: false,
  },
  {
    category: 'PUBLIC_AUTHORITY',
    type: 'PUBLIC_AUTHORITY_LETTER',
    label: 'Public-authority letter',
    policyApproved: false,
  },
] as const;

export type CandidateProofOfAddressCategory =
  (typeof CANDIDATE_PROOF_OF_ADDRESS_TYPES)[number]['category'];
export type CandidateProofOfAddressType = (typeof CANDIDATE_PROOF_OF_ADDRESS_TYPES)[number]['type'];

/** Candidate formats only; the runtime upload boundary separately validates signatures. */
export const CANDIDATE_PROOF_OF_ADDRESS_FILE_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
] as const;

export const CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const DEFAULT_PROOF_OF_ADDRESS_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PROOF_OF_ADDRESS_MAX_UPLOAD_BYTES = DEFAULT_PROOF_OF_ADDRESS_MAX_UPLOAD_BYTES;

export const PROOF_OF_ADDRESS_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

export function candidateProofTypesForCategory(category: string) {
  return CANDIDATE_PROOF_OF_ADDRESS_TYPES.filter((candidate) => candidate.category === category);
}

export function isCandidateProofType(category: string, type: string): boolean {
  return CANDIDATE_PROOF_OF_ADDRESS_TYPES.some(
    (candidate) => candidate.category === category && candidate.type === type,
  );
}
